// Sube un ticket a Holded: POST salesreceipt → GET-back → POST /pay →
// GET-back paymentsPending==0. Toda la lógica vive aquí para que el
// worker BullMQ y los tests la compartan.
//
// Idempotencia: si `HoldedUpload.holdedDocumentId` ya está poblado, no
// re-POSTeamos — sólo intentamos el `/pay` si paymentsPending != 0.
// Si el ticket está ya `SYNCED`, no-op.

import { Prisma, type PrismaClient, TicketStatus } from "@mipiacetpv/db";
import {
  ApiKeyClient,
  HoldedApiError,
  HoldedInvalidResponseError,
  HoldedSilentRejectError,
  createSalesreceiptApproved,
  registerPaymentWithGetBack,
  type SalesreceiptItem,
} from "@mipiacetpv/holded-client";

import { decryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";
import { enqueueTicketEmail } from "../queues/ticket-email.js";
import { computeLine } from "./totals.js";

export interface UploadTicketOptions {
  externalId: string;
  prisma: PrismaClient;
  // Inyectable para tests.
  buildClient?: (apiKey: string) => ApiKeyClient;
  logger?: {
    info: (msg: string, extra?: unknown) => void;
    warn: (msg: string, extra?: unknown) => void;
    error: (msg: string, extra?: unknown) => void;
  };
}

export type UploadTicketResult =
  | { kind: "skipped"; reason: string }
  | { kind: "success"; documentId: string; docNumber: string }
  | { kind: "permanent_failure"; reason: string };

// Errores 4xx no transitorios que NO debemos reintentar. El worker los
// captura y deja el ticket en SYNC_FAILED sin más reintentos.
function isPermanent4xx(err: unknown): boolean {
  if (err instanceof HoldedApiError) {
    const code = (err as { status?: number }).status;
    return code != null && code >= 400 && code < 500 && code !== 429;
  }
  return false;
}

export async function uploadTicket(
  options: UploadTicketOptions,
): Promise<UploadTicketResult> {
  const { externalId, prisma } = options;
  const log = options.logger ?? consoleLogger();

  const ticket = await prisma.ticket.findUnique({
    where: { externalId },
    include: { lines: true, payments: true, tenant: { select: { id: true, holdedApiKeyCiphertext: true } }, register: { select: { numSerieHolded: true } } },
  });
  if (!ticket) {
    return { kind: "skipped", reason: "ticket_not_found" };
  }
  if (ticket.status === TicketStatus.SYNCED) {
    return { kind: "skipped", reason: "already_synced" };
  }
  if (!ticket.tenant.holdedApiKeyCiphertext) {
    await markFailed(prisma, externalId, "no_holded_key");
    return { kind: "permanent_failure", reason: "no_holded_key" };
  }

  const env = loadEnv();
  const apiKey = decryptSecret(
    ticket.tenant.holdedApiKeyCiphertext,
    env.HOLDED_KEY_ENCRYPTION_SECRET,
  );
  const client = options.buildClient
    ? options.buildClient(apiKey)
    : new ApiKeyClient(apiKey, { baseUrl: env.HOLDED_BASE_URL });

  await bumpAttempts(prisma, externalId);

  let documentId = ticket.holdedDocumentId;
  let docNumber = ticket.holdedDocNumber;

  // FASE 1: si no hay documentId, POST salesreceipt + GET-back.
  if (!documentId) {
    const items: SalesreceiptItem[] = ticket.lines.map((l) => ({
      name: l.nameSnapshot,
      units: Number(l.units),
      price: Number(l.unitPrice),
      tax: Number(l.taxRate),
      discount: Number(l.discountPct),
      sku: l.sku,
    }));

    const notes = composeNotes(externalId, ticket.notes);
    const numSerieId = ticket.register.numSerieHolded ?? undefined;

    try {
      const result = await createSalesreceiptApproved(
        client,
        {
          approveDoc: true,
          date: Math.floor((ticket.paidAt ?? new Date()).getTime() / 1000),
          notes,
          items,
          ...(numSerieId ? { numSerieId } : {}),
        },
        { externalId, expectedTotal: Number(ticket.total) },
      );
      documentId = result.documentId;
      docNumber = result.stored.docNumber ?? null;
      await prisma.ticket.update({
        where: { externalId },
        data: {
          holdedDocumentId: documentId,
          holdedDocNumber: docNumber,
        },
      });
      await prisma.holdedUpload.update({
        where: { externalId },
        data: { holdedDocumentId: documentId },
      });
    } catch (err) {
      if (err instanceof HoldedSilentRejectError) {
        log.warn("salesreceipt silent reject", {
          externalId,
          mismatches: err.mismatches,
        });
        await markFailed(prisma, externalId, "silent_reject", {
          step: "POST salesreceipt",
          mismatches: err.mismatches,
        });
        return { kind: "permanent_failure", reason: "silent_reject" };
      }
      if (isPermanent4xx(err)) {
        log.warn("holded rechazo permanente", {
          externalId,
          message: (err as Error).message,
        });
        await markFailed(prisma, externalId, "holded_4xx", {
          step: "POST salesreceipt",
          message: (err as Error).message,
        });
        return { kind: "permanent_failure", reason: "holded_4xx" };
      }
      if (err instanceof HoldedInvalidResponseError) {
        // 200 + HTML — endpoint roto. Reintentamos hasta agotar attempts.
        log.warn("invalid response from holded", {
          externalId,
          message: (err as Error).message,
        });
      }
      throw err; // 5xx / network → BullMQ reintenta exponencial.
    }
  }

  if (!documentId) {
    throw new Error("documentId missing after POST salesreceipt");
  }

  // FASE 2: registrar el cobro vía /pay con la suma total. Núcleo §7.3:
  // Holded recibe un único pay con el total agregado. El desglose por
  // método vive sólo en el TPV (ADR-007).
  try {
    await registerPaymentWithGetBack(client, documentId, {
      date: Math.floor((ticket.paidAt ?? new Date()).getTime() / 1000),
      amount: Number(ticket.total),
      desc: composePayDesc(ticket.payments),
    });
  } catch (err) {
    if (err instanceof HoldedSilentRejectError) {
      log.warn("pay silent reject", {
        externalId,
        mismatches: err.mismatches,
      });
      await markFailed(prisma, externalId, "pay_silent_reject", {
        step: "POST pay",
        mismatches: err.mismatches,
      });
      return { kind: "permanent_failure", reason: "pay_silent_reject" };
    }
    if (isPermanent4xx(err)) {
      await markFailed(prisma, externalId, "pay_4xx", {
        step: "POST pay",
        message: (err as Error).message,
      });
      return { kind: "permanent_failure", reason: "pay_4xx" };
    }
    throw err;
  }

  // ÉXITO.
  await prisma.$transaction([
    prisma.ticket.update({
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

  // Disparar email pendiente, si lo hay.
  const emailJob = await prisma.ticketEmailJob.findFirst({
    where: { ticketId: ticket.id, status: "PENDING" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (emailJob) {
    try {
      await enqueueTicketEmail(emailJob.id);
    } catch (err) {
      log.warn("no se pudo encolar email job", { externalId, err });
    }
  }

  return { kind: "success", documentId, docNumber: docNumber ?? "" };
}

function composeNotes(externalId: string, userNotes: string | null): string {
  const tag = `TPV-uuid: ${externalId}`;
  if (!userNotes) return tag;
  return `${tag}\n${userNotes}`;
}

function composePayDesc(payments: Array<{ method: string; amount: { toString(): string } }>): string {
  if (payments.length === 1) return `TPV ${payments[0]!.method}`;
  const parts = payments.map(
    (p) => `${p.method}: ${Number(p.amount.toString()).toFixed(2)}€`,
  );
  return `TPV mixto · ${parts.join(" · ")}`;
}

async function bumpAttempts(prisma: PrismaClient, externalId: string): Promise<void> {
  // El HoldedUpload se crea siempre en la transacción del POST /tickets,
  // así que aquí basta con update; si por algún motivo no existe (test
  // mal poblado), updateMany silenciosamente no-op.
  await prisma.holdedUpload.updateMany({
    where: { externalId },
    data: {
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  });
}

async function markFailed(
  prisma: PrismaClient,
  externalId: string,
  reason: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await prisma.$transaction([
    prisma.ticket.update({
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
      console.log(`[upload-ticket] ${msg}`, extra ?? ""),
    warn: (msg: string, extra?: unknown) =>
      console.warn(`[upload-ticket] ${msg}`, extra ?? ""),
    error: (msg: string, extra?: unknown) =>
      console.error(`[upload-ticket] ${msg}`, extra ?? ""),
  };
}

// referencia para que vitest pueda compute totals coherentes con el
// worker en tests. Re-export para reducir imports en tests futuros.
export { computeLine };
