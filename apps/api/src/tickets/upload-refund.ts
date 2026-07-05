// Sube una devolución a Holded como un salesreceipt con importes
// negativos (B4 §5.1, núcleo §10). Mismo patrón que upload-ticket:
// POST + GET-back + /pay + GET-back. La diferencia es que `units` o
// `price` van en negativo y las notas referencian el ticket original.

import { Prisma, type PrismaClient, TicketStatus } from "@mipiacetpv/db";
import {
  ApiKeyClient,
  HoldedApiError,
  HoldedInvalidResponseError,
  HoldedSilentRejectError,
  createSalesreceiptApproved,
  registerPaymentWithGetBack,
  type SalesreceiptItem,
  type SalesreceiptPayload,
} from "@mipiacetpv/holded-client";

import { decryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";

export interface UploadRefundOptions {
  externalId: string;
  prisma: PrismaClient;
  buildClient?: (apiKey: string) => ApiKeyClient;
  logger?: {
    info: (msg: string, extra?: unknown) => void;
    warn: (msg: string, extra?: unknown) => void;
    error: (msg: string, extra?: unknown) => void;
  };
}

export type UploadRefundResult =
  | { kind: "skipped"; reason: string }
  | { kind: "success"; documentId: string; docNumber: string }
  | { kind: "permanent_failure"; reason: string };

function isPermanent4xx(err: unknown): boolean {
  if (err instanceof HoldedApiError) {
    const code = (err as { status?: number }).status;
    return code != null && code >= 400 && code < 500 && code !== 429;
  }
  return false;
}

export async function uploadRefund(
  options: UploadRefundOptions,
): Promise<UploadRefundResult> {
  const { externalId, prisma } = options;
  const log = options.logger ?? consoleLogger();
  const refund = await prisma.refund.findUnique({
    where: { externalId },
    include: {
      lines: true,
      originalTicket: { select: { id: true, holdedDocumentId: true, holdedDocNumber: true } },
      tenant: { select: { id: true, holdedApiKeyCiphertext: true } },
      register: { select: { numSerieHolded: true } },
    },
  });
  if (!refund) return { kind: "skipped", reason: "refund_not_found" };
  // v1.9.5-formacion · Frente 1: red de seguridad del gate fiscal. Un
  // refund de prueba (status TEST, heredado del ticket TEST) nunca debe
  // llegar a Holded. En la práctica no se encola (POST /refunds lo evita),
  // pero si por lo que sea aterriza aquí, lo marcamos SKIPPED y salimos —
  // mismo tratamiento que la venta test en upload-ticket.
  if (refund.status === TicketStatus.TEST) {
    await prisma.holdedUpload.updateMany({
      where: { externalId },
      data: { status: "SKIPPED", lastError: { skipped: "test_mode" } },
    });
    return { kind: "skipped", reason: "test_mode" };
  }
  if (refund.status === TicketStatus.SYNCED) {
    return { kind: "skipped", reason: "already_synced" };
  }
  if (!refund.tenant.holdedApiKeyCiphertext) {
    await markFailed(prisma, externalId, "no_holded_key");
    return { kind: "permanent_failure", reason: "no_holded_key" };
  }
  const env = loadEnv();
  const apiKey = decryptSecret(
    refund.tenant.holdedApiKeyCiphertext,
    env.HOLDED_KEY_ENCRYPTION_SECRET,
  );
  const client = options.buildClient
    ? options.buildClient(apiKey)
    : new ApiKeyClient(apiKey, { baseUrl: env.HOLDED_BASE_URL });

  let documentId = refund.holdedDocumentId;

  if (!documentId) {
    // Refund items: precios positivos, units negativas. La negociación
    // de signos con Holded en MVP usa unidades negativas (alternativa:
    // precios negativos; ambos producen total negativo). El spike §08.B
    // no probó ninguno explícitamente — esta decisión sigue la
    // convención del prompt B4 §5.1 ("importes en negativo") y se
    // confirmará con el primer refund real en sandbox.
    const payload = buildRefundSalesreceiptPayload(refund);
    const expectedTotal = -Math.abs(Number(refund.total));

    try {
      const result = await createSalesreceiptApproved(
        client,
        payload,
        { externalId, expectedTotal },
      );
      documentId = result.documentId;
      await prisma.refund.update({
        where: { externalId },
        data: {
          holdedDocumentId: documentId,
          holdedDocNumber: result.stored.docNumber ?? null,
        },
      });
      await prisma.holdedUpload.update({
        where: { externalId },
        data: { holdedDocumentId: documentId },
      });
    } catch (err) {
      if (err instanceof HoldedSilentRejectError) {
        log.warn("refund salesreceipt silent reject", {
          externalId,
          mismatches: err.mismatches,
        });
        await markFailed(prisma, externalId, "silent_reject", {
          mismatches: err.mismatches,
        });
        return { kind: "permanent_failure", reason: "silent_reject" };
      }
      if (isPermanent4xx(err)) {
        await markFailed(prisma, externalId, "holded_4xx", {
          message: (err as Error).message,
        });
        return { kind: "permanent_failure", reason: "holded_4xx" };
      }
      if (err instanceof HoldedInvalidResponseError) {
        log.warn("invalid response", { externalId });
      }
      throw err;
    }
  }

  if (!documentId) {
    throw new Error("documentId missing after refund POST salesreceipt");
  }

  // Registrar el "cobro" negativo (Holded admite amount negativo en
  // /pay según Núcleo §10; si no, el total queda paymentsPending=-total
  // y nos quedamos en SYNC_FAILED).
  try {
    await registerPaymentWithGetBack(client, documentId, {
      date: Math.floor(refund.createdAt.getTime() / 1000),
      amount: -Math.abs(Number(refund.total)),
      desc: `TPV refund · ${refund.method ?? "OTHER"}`,
    });
  } catch (err) {
    if (err instanceof HoldedSilentRejectError) {
      await markFailed(prisma, externalId, "pay_silent_reject", {
        mismatches: err.mismatches,
      });
      return { kind: "permanent_failure", reason: "pay_silent_reject" };
    }
    if (isPermanent4xx(err)) {
      await markFailed(prisma, externalId, "pay_4xx", {
        message: (err as Error).message,
      });
      return { kind: "permanent_failure", reason: "pay_4xx" };
    }
    throw err;
  }

  await prisma.$transaction([
    prisma.refund.update({
      where: { externalId },
      data: {
        status: TicketStatus.SYNCED,
        syncedAt: new Date(),
        syncError: Prisma.JsonNull,
      },
    }),
    prisma.holdedUpload.update({
      where: { externalId },
      data: { status: "DONE", lastError: Prisma.JsonNull },
    }),
  ]);

  return { kind: "success", documentId, docNumber: "" };
}

// Payload exacto que el worker enviará a Holded para una devolución.
// Reutilizado por el preview endpoint del admin (B5 §2.1).
export function buildRefundSalesreceiptPayload(refund: {
  externalId: string;
  createdAt: Date;
  total: { toString(): string } | number;
  lines: Array<{
    nameSnapshot: string;
    units: { toString(): string } | number;
    unitPrice: { toString(): string } | number;
    taxRate: { toString(): string } | number;
    discountPct: { toString(): string } | number;
    sku: string;
  }>;
  originalTicket: {
    holdedDocumentId: string | null;
    holdedDocNumber: string | null;
  };
  register: { numSerieHolded: string | null } | null;
}): SalesreceiptPayload {
  const items: SalesreceiptItem[] = refund.lines.map((l) => ({
    name: l.nameSnapshot,
    units: -Math.abs(Number(l.units)),
    price: Number(l.unitPrice),
    tax: Number(l.taxRate),
    discount: Number(l.discountPct),
    sku: l.sku,
  }));
  const notes = `TPV-refund-uuid: ${refund.externalId} · original: ${
    refund.originalTicket.holdedDocNumber ??
    refund.originalTicket.holdedDocumentId ??
    "unknown"
  }`;
  const numSerieId = refund.register?.numSerieHolded ?? undefined;
  return {
    approveDoc: true,
    date: Math.floor(refund.createdAt.getTime() / 1000),
    notes,
    items,
    ...(numSerieId ? { numSerieId } : {}),
  };
}

async function markFailed(
  prisma: PrismaClient,
  externalId: string,
  reason: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await prisma.$transaction([
    prisma.refund.update({
      where: { externalId },
      data: {
        status: TicketStatus.SYNC_FAILED,
        syncError: { reason, ...extra } as object,
      },
    }),
    prisma.holdedUpload.update({
      where: { externalId },
      data: {
        status: "FAILED",
        lastError: { reason, ...extra } as object,
      },
    }),
  ]);
}

function consoleLogger() {
  return {
    info: (msg: string, extra?: unknown) =>
      console.log(`[upload-refund] ${msg}`, extra ?? ""),
    warn: (msg: string, extra?: unknown) =>
      console.warn(`[upload-refund] ${msg}`, extra ?? ""),
    error: (msg: string, extra?: unknown) =>
      console.error(`[upload-refund] ${msg}`, extra ?? ""),
  };
}
