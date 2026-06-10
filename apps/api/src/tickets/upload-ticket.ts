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
  type SalesreceiptPayload,
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
    include: {
      // v1.3-hotfix8 — necesitamos product.kind + holdedProductId para decidir
      // si la línea va como `sku` (PRODUCT) o como `serviceId` (SERVICE).
      // Holded requiere `serviceId` para que la línea de un servicio resuelva
      // el precio. Confirmado empíricamente con drafts (probe7).
      lines: { include: { product: { select: { kind: true, holdedProductId: true } } } },
      payments: true,
      tenant: { select: { id: true, holdedApiKeyCiphertext: true } },
      register: { select: { numSerieHolded: true } },
      user: { select: { isTestCashier: true } },
    },
  });
  if (!ticket) {
    return { kind: "skipped", reason: "ticket_not_found" };
  }
  if (ticket.status === TicketStatus.SYNCED) {
    return { kind: "skipped", reason: "already_synced" };
  }
  // B-OnboardingV2: tickets emitidos por el cajero técnico durante el
  // modo prueba se marcan TEST y NO se suben a Holded. El estado TEST
  // gana sobre el PENDING_SYNC habitual.
  if (ticket.status === TicketStatus.TEST || ticket.user?.isTestCashier === true) {
    if (ticket.status !== TicketStatus.TEST) {
      await prisma.ticket.update({
        where: { externalId },
        data: { status: TicketStatus.TEST },
      });
    }
    log.info("ticket en modo prueba — skip upload", { externalId });
    return { kind: "skipped", reason: "test_cashier" };
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
    const payload = buildTicketSalesreceiptPayload(ticket);

    try {
      const result = await createSalesreceiptApproved(
        client,
        payload,
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

// Payload exacto que el worker enviará a Holded. Reutilizado por el
// preview endpoint de la bandeja (B5 §2.1: GET
// /admin/tickets/:id/holded-payload-preview) para que el propietario
// vea ANTES de reintentar qué se va a mandar — sin drift entre worker
// y preview.
export function buildTicketSalesreceiptPayload(ticket: {
  externalId: string;
  notes: string | null;
  paidAt: Date | null;
  lines: Array<{
    nameSnapshot: string;
    units: { toString(): string } | number;
    unitPrice: { toString(): string } | number;
    // v1.2-Lite Lote 4.B: si la línea lleva override (el cajero pulsó el
    // lápiz), Holded recibe ese precio. unitPrice queda como histórico
    // del catálogo y sirve para auditoría TPV.
    unitPriceOverride?: { toString(): string } | number | null;
    taxRate: { toString(): string } | number;
    discountPct: { toString(): string } | number;
    sku: string;
    // v1.3-hotfix8 — discriminante producto vs servicio. Holded expone
    // endpoints/identificadores distintos y `salesreceipt` requiere
    // `serviceId` para las líneas de servicio (no `sku`).
    product?: { kind: "PRODUCT" | "SERVICE"; holdedProductId: string | null } | null;
    // Snapshot de modificadores (B-Bar-Modifiers). Puede ser:
    //   - null               → línea sin modifiers
    //   - string[] legacy    → ad-hoc tipeados; van a description literal
    //   - object[] B-Bar-Mod → desnormalizados con label + priceDelta;
    //                          se serializan como "(Grupo: Label; ...)"
    // Holded recibe el precio ROLLED-UP (unitPrice + sum deltas / 100)
    // porque el TPV ya ajustó subtotal/total al cobrar. El desglose
    // textual va en `description` para que el cliente final lo lea.
    modifiers?: unknown;
  }>;
  register: { numSerieHolded: string | null };
}): SalesreceiptPayload {
  const items: SalesreceiptItem[] = ticket.lines.map((l) => {
    const { rolledUpUnitPrice, description } = formatLineForHolded(l);
    // v1.3-hotfix8 · silent_reject en cuentas SERVICES — fix definitivo.
    //
    // Diagnóstico (probe7, 2026-05-27): Holded NO acepta línea libre en
    // `salesreceipt`. Si no hay identificador reconocido en la línea,
    // asigna `price=0` → total=0 → silent_reject. El hotfix7 (omitir
    // SKU "AUTO-*") no arregló el problema porque la línea sin SKU
    // también caía a 0.
    //
    // Empíricamente, para servicios el campo correcto es `serviceId`
    // (no `sku` ni `productId`) con el id MongoDB del servicio. Para
    // productos sigue siendo `sku` con el SKU canónico asignado por
    // `runAutoSku` durante onboarding.
    const isService = l.product?.kind === "SERVICE";
    const holdedId = l.product?.holdedProductId ?? null;
    let identifierField: { sku?: string; serviceId?: string } = {};
    if (isService && holdedId) {
      identifierField = { serviceId: holdedId };
    } else if (!isService && l.sku && !l.sku.startsWith("AUTO-")) {
      // PRODUCT con SKU real (asignado por runAutoSku). NO mandamos
      // sku para productos sin asignar (caso degradado raro).
      identifierField = { sku: l.sku };
    }
    return {
      name: l.nameSnapshot,
      units: Number(l.units),
      price: rolledUpUnitPrice,
      tax: Number(l.taxRate),
      discount: Number(l.discountPct),
      ...identifierField,
      ...(description ? { desc: description } : {}),
    };
  });
  const notes = composeNotes(ticket.externalId, ticket.notes);
  const numSerieId = ticket.register.numSerieHolded ?? undefined;
  return {
    approveDoc: true,
    date: Math.floor((ticket.paidAt ?? new Date()).getTime() / 1000),
    notes,
    items,
    ...(numSerieId ? { numSerieId } : {}),
  };
}

// Construye precio rolled-up + descripción para una línea con modifiers.
// El precio enviado a Holded incluye los deltas; Holded ve un solo
// número por línea. El detalle textual va en `desc` (campo aceptado por
// Holded en el item del salesreceipt, observado en fixtures Fase 0).
function formatLineForHolded(line: {
  unitPrice: { toString(): string } | number;
  unitPriceOverride?: { toString(): string } | number | null;
  modifiers?: unknown;
}): { rolledUpUnitPrice: number; description: string | null } {
  // v1.2-Lite Lote 4.B: override del cajero prevalece sobre el unitPrice
  // del catálogo. Holded recibe lo cobrado realmente.
  const baseUnitPrice =
    line.unitPriceOverride != null
      ? Number(line.unitPriceOverride)
      : Number(line.unitPrice);
  if (!Array.isArray(line.modifiers) || line.modifiers.length === 0) {
    return { rolledUpUnitPrice: baseUnitPrice, description: null };
  }
  // Detección por tipo del primer elemento (mismo patrón que el renderer
  // del TPV). string[] → ad-hoc; object[] → snapshot estructurado.
  const first = line.modifiers[0];
  if (typeof first === "string") {
    const labels = (line.modifiers as string[]).filter((s) => typeof s === "string");
    if (labels.length === 0) {
      return { rolledUpUnitPrice: baseUnitPrice, description: null };
    }
    return {
      rolledUpUnitPrice: baseUnitPrice,
      description: `(${labels.join("; ")})`,
    };
  }
  // Snapshot estructurado.
  let deltaCents = 0;
  const parts: string[] = [];
  for (const entry of line.modifiers as unknown[]) {
    if (
      entry &&
      typeof entry === "object" &&
      "groupName" in entry &&
      "label" in entry
    ) {
      const e = entry as {
        groupName: string;
        label: string;
        priceDeltaCents?: number;
      };
      parts.push(`${e.groupName}: ${e.label}`);
      if (typeof e.priceDeltaCents === "number") deltaCents += e.priceDeltaCents;
    }
  }
  // v1.4-Precio-Decimales · b30: NO redondeamos el precio a 2 decimales
  // al subir a Holded. Holded acepta 4 decimales en `price` y conservar
  // la precisión es lo que elimina el drift entre el TPV y el documento
  // emitido. `deltaCents/100` no añade nuevos decimales (los modifiers
  // viven en céntimos enteros). Si `baseUnitPrice` tiene 4 decimales del
  // NET, llegan intactos a Holded.
  return {
    rolledUpUnitPrice: round4(baseUnitPrice + deltaCents / 100),
    description: parts.length > 0 ? `(${parts.join("; ")})` : null,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
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
