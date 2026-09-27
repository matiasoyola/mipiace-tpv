// Sube una devolución a Holded como un salesreceipt con importes
// negativos (B4 §5.1, núcleo §10). Mismo patrón que upload-ticket:
// POST + GET-back + /pay + GET-back, y —desde el bloque abonos-holded—
// EXACTAMENTE la misma construcción de líneas: `holded-line.ts`.
//
// La convención de signos ya no es una hipótesis: se probó contra la
// cuenta Holded de PRUEBAS MIPIACE el 26-09-2026. `units` negativas y
// precio unitario positivo → documento con total negativo
// (paymentsPending negativo), y `/pay` con `amount` negativo lo deja a
// cero. Ver `docs/blocks/abonos-holded-done.md` §4 con payload y
// respuesta.

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
import {
  describeMismatchedDocument,
  inspectExistingDocument,
} from "./holded-document.js";
import {
  REFUND_SIGN,
  buildHoldedLineItem,
  chargedLineTotal,
  type HoldedLineSnapshot,
} from "./holded-line.js";

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

// Las líneas del abono llevan el precio del ticket original, que es un
// snapshot fiscal inmutable. De ahí salen el override del lápiz y los
// modificadores; de la `RefundLine`, las unidades devueltas.
export function refundLineInclude() {
  return {
    include: {
      ticketLine: {
        select: {
          unitPrice: true,
          unitPriceOverride: true,
          modifiers: true,
          product: { select: { kind: true, holdedProductId: true } },
        },
      },
    },
  } as const;
}

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
      lines: refundLineInclude(),
      originalTicket: { select: { id: true, holdedDocumentId: true, holdedDocNumber: true } },
      tenant: {
        select: {
          id: true,
          holdedApiKeyCiphertext: true,
          // holded-desconectar (ADR-020) · ver la nota gemela de
          // `upload-ticket.ts`.
          holdedEnabled: true,
          holdedDisconnectedAt: true,
        },
      },
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
  // holded-desconectar (ADR-020) · la misma carrera que en la venta, y aquí
  // importa más: un abono en `SYNC_FAILED` bloquea las devoluciones
  // legítimas de esas líneas hasta que alguien lo anule a mano
  // (v1.5-consistencia-A §3.c). Que el corte creara uno solo sería empezar
  // la vida sin Holded con la bandeja encendida.
  if (refund.tenant.holdedDisconnectedAt != null) {
    await prisma.holdedUpload.updateMany({
      where: { externalId },
      data: {
        status: "SKIPPED",
        lastError: { skipped: "holded_desconectado" },
      },
    });
    log.info("el comercio dejó Holded — skip upload del abono", { externalId });
    return { kind: "skipped", reason: "holded_desconectado" };
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

  await bumpAttempts(prisma, externalId);

  // El abono es dinero que SALE: el documento nace en negativo.
  const expectedTotal = -Math.abs(Number(refund.total));
  let documentId = refund.holdedDocumentId;
  let docNumber = refund.holdedDocNumber;

  // FASE 0 · ya hay un documento guardado. No se vuelve a postear nunca
  // sin mirar primero qué hay al otro lado (ver `holded-document.ts`).
  if (documentId) {
    const verdict = await inspectExistingDocument(client, documentId, expectedTotal);
    if (verdict.kind === "gone") {
      // El propietario borró en Holded el documento malo. Olvidamos el id
      // y dejamos que la FASE 1 cree el bueno.
      log.warn("el documento guardado ya no existe en Holded — se crea de nuevo", {
        externalId,
        documentId,
      });
      await forgetDocument(prisma, externalId);
      documentId = null;
      docNumber = null;
    } else if (verdict.kind === "total_mismatch") {
      const message = describeMismatchedDocument(verdict);
      log.error("documento de Holded con total distinto al del abono", {
        externalId,
        documentId: verdict.documentId,
        docNumber: verdict.docNumber,
        storedTotal: verdict.storedTotal,
        expectedTotal: verdict.expectedTotal,
      });
      await markFailed(prisma, externalId, "holded_document_total_mismatch", {
        step: "pre-POST salesreceipt",
        holdedDocumentId: verdict.documentId,
        holdedDocNumber: verdict.docNumber,
        holdedTotal: verdict.storedTotal,
        expectedTotal: verdict.expectedTotal,
        message,
      });
      return { kind: "permanent_failure", reason: "holded_document_total_mismatch" };
    }
  }

  if (!documentId) {
    const payload = buildRefundSalesreceiptPayload(refund);

    // LA PUERTA DEL IMPORTE. El payload se construye con el precio
    // COBRADO del ticket original; `refund.total` es el dinero que salió
    // del cajón. Si no cuadran, el snapshot del abono se creó con otro
    // precio (abonos anteriores a este bloque guardaban el precio de
    // catálogo, sin el override del lápiz ni los modificadores). Antes eso
    // acababa en un documento emitido con el importe equivocado; ahora
    // corta ANTES del POST, sin dejar nada en Holded.
    const payloadTotal = refundPayloadTotal(refund);
    if (Math.abs(payloadTotal - Math.abs(Number(refund.total))) > 0.05) {
      log.error("el importe del payload no coincide con el total del abono", {
        externalId,
        payloadTotal,
        refundTotal: Number(refund.total),
      });
      await markFailed(prisma, externalId, "refund_snapshot_total_mismatch", {
        step: "pre-POST salesreceipt",
        payloadTotal,
        refundTotal: Number(refund.total),
        message:
          `El abono guardó ${Number(refund.total).toFixed(2)} € pero sus líneas, ` +
          `al precio realmente cobrado en el ticket original, suman ` +
          `${payloadTotal.toFixed(2)} €. Hay que rehacer la devolución.`,
      });
      return { kind: "permanent_failure", reason: "refund_snapshot_total_mismatch" };
    }

    try {
      const result = await createSalesreceiptApproved(
        client,
        payload,
        { externalId, expectedTotal },
      );
      documentId = result.documentId;
      docNumber = result.stored.docNumber ?? null;
      await saveDocument(prisma, externalId, documentId, docNumber);
    } catch (err) {
      if (err instanceof HoldedSilentRejectError) {
        // El POST creó el documento y es el GET-back el que lo desmiente.
        // Se guarda el id ANTES de marcar el fallo: un documento que
        // existe en Holded no se queda sin su id en nuestra base, y el
        // reintento encuentra ese id y no crea un segundo documento.
        if (err.document) {
          await saveDocument(
            prisma,
            externalId,
            err.document.id,
            err.document.docNumber,
          );
        }
        log.warn("refund salesreceipt silent reject", {
          externalId,
          documentId: err.document?.id ?? null,
          mismatches: err.mismatches,
        });
        await markFailed(prisma, externalId, "silent_reject", {
          step: "POST salesreceipt",
          mismatches: err.mismatches,
          ...(err.document
            ? {
                holdedDocumentId: err.document.id,
                holdedDocNumber: err.document.docNumber,
                message: describeMismatchedDocument({
                  documentId: err.document.id,
                  docNumber: err.document.docNumber,
                  storedTotal: Number(
                    err.mismatches.find((m) => m.field === "total")?.actual ?? 0,
                  ),
                  expectedTotal,
                }),
              }
            : {}),
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

  // Registrar el "cobro" negativo. Holded admite `amount` negativo en
  // /pay y deja `paymentsPending` a 0 (probado el 26-09-2026 con el abono
  // T2614948 de PRUEBAS MIPIACE: paymentsTotal -9.68, pending 0).
  try {
    await registerPaymentWithGetBack(client, documentId, {
      date: Math.floor(refund.createdAt.getTime() / 1000),
      amount: expectedTotal,
      desc: `TPV refund · ${refund.method ?? "OTHER"}`,
    });
  } catch (err) {
    if (err instanceof HoldedSilentRejectError) {
      await markFailed(prisma, externalId, "pay_silent_reject", {
        step: "POST pay",
        holdedDocumentId: documentId,
        mismatches: err.mismatches,
      });
      return { kind: "permanent_failure", reason: "pay_silent_reject" };
    }
    if (isPermanent4xx(err)) {
      await markFailed(prisma, externalId, "pay_4xx", {
        step: "POST pay",
        holdedDocumentId: documentId,
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

  return { kind: "success", documentId, docNumber: docNumber ?? "" };
}

// La línea del abono, vista como la ve el constructor compartido: el
// precio y los modificadores salen del ticket original (lo que de verdad
// se cobró), las unidades y el sku del snapshot de la devolución —el sku
// porque el panel permite corregirlo antes de reintentar.
export interface RefundLineForPayload {
  nameSnapshot: string;
  sku: string;
  units: { toString(): string } | number;
  taxRate: { toString(): string } | number;
  discountPct: { toString(): string } | number;
  unitPrice: { toString(): string } | number;
  ticketLine: {
    unitPrice: { toString(): string } | number;
    unitPriceOverride: { toString(): string } | number | null;
    modifiers: unknown;
    product: { kind: "PRODUCT" | "SERVICE"; holdedProductId: string | null } | null;
  };
}

export function refundLineSnapshot(l: RefundLineForPayload): HoldedLineSnapshot {
  return {
    nameSnapshot: l.nameSnapshot,
    sku: l.sku,
    units: l.units,
    taxRate: l.taxRate,
    discountPct: l.discountPct,
    unitPrice: l.ticketLine.unitPrice,
    unitPriceOverride: l.ticketLine.unitPriceOverride,
    modifiers: l.ticketLine.modifiers,
    product: l.ticketLine.product,
  };
}

// Suma con IVA de las líneas del abono al precio realmente cobrado. En
// positivo: se compara con `refund.total`, que también es positivo.
export function refundPayloadTotal(refund: {
  lines: RefundLineForPayload[];
}): number {
  const sum = refund.lines.reduce(
    (acc, l) => acc + chargedLineTotal(refundLineSnapshot(l)),
    0,
  );
  return Math.round(sum * 100) / 100;
}

// Payload exacto que el worker enviará a Holded para una devolución.
// Reutilizado por el preview endpoint del admin (B5 §2.1).
export function buildRefundSalesreceiptPayload(refund: {
  externalId: string;
  createdAt: Date;
  total: { toString(): string } | number;
  lines: RefundLineForPayload[];
  originalTicket: {
    holdedDocumentId: string | null;
    holdedDocNumber: string | null;
  };
  register: { numSerieHolded: string | null } | null;
}): SalesreceiptPayload {
  // MISMO constructor que la venta. Lo único que cambia es el signo.
  const items: SalesreceiptItem[] = refund.lines.map((l) =>
    buildHoldedLineItem(refundLineSnapshot(l), REFUND_SIGN),
  );
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

async function saveDocument(
  prisma: PrismaClient,
  externalId: string,
  documentId: string,
  docNumber: string | null,
): Promise<void> {
  await prisma.$transaction([
    prisma.refund.update({
      where: { externalId },
      data: { holdedDocumentId: documentId, holdedDocNumber: docNumber },
    }),
    prisma.holdedUpload.updateMany({
      where: { externalId },
      data: { holdedDocumentId: documentId },
    }),
  ]);
}

async function forgetDocument(
  prisma: PrismaClient,
  externalId: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.refund.update({
      where: { externalId },
      data: { holdedDocumentId: null, holdedDocNumber: null },
    }),
    prisma.holdedUpload.updateMany({
      where: { externalId },
      data: { holdedDocumentId: null },
    }),
  ]);
}

async function bumpAttempts(prisma: PrismaClient, externalId: string): Promise<void> {
  await prisma.holdedUpload.updateMany({
    where: { externalId },
    data: { attempts: { increment: 1 }, lastAttemptAt: new Date() },
  });
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
