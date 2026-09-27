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
import { captureAlert } from "../lib/sentry.js";
import { enqueueTicketEmail } from "../queues/ticket-email.js";
import {
  describeMismatchedDocument,
  inspectExistingDocument,
} from "./holded-document.js";
import {
  SALE_SIGN,
  buildHoldedLineItem,
  type HoldedLineSnapshot,
} from "./holded-line.js";
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
      // catalogo-local · `source` se trae para la puerta de más abajo:
      // un producto LOCAL no puede entrar en el payload de Holded.
      lines: {
        include: {
          product: { select: { id: true, name: true, kind: true, holdedProductId: true, source: true } },
        },
      },
      payments: true,
      tenant: {
        select: {
          id: true,
          holdedApiKeyCiphertext: true,
          // holded-desconectar (ADR-020) · para la carrera del corte, abajo.
          holdedEnabled: true,
          holdedDisconnectedAt: true,
        },
      },
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
  // v1.8-Fiado (variante B) · un fiado con deuda viva NO se sube a
  // Holded. El gate `shouldEnqueueHoldedUpload` ya impide encolarlo, así
  // que esto es un blindaje defensivo: si por lo que sea existiera un job
  // (sweeper, reintento manual, migración), lo saltamos sin dejar la
  // fila en estado raro. Al saldarse el ticket pasa a PAID y ESE sí sube.
  if (ticket.status === TicketStatus.ON_CREDIT) {
    return { kind: "skipped", reason: "on_credit" };
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
    // v1.5-B §3.a: el HoldedUpload pasa a SKIPPED (terminal). Antes
    // quedaba PENDING para siempre y el sweeper lo re-encolaba cada
    // 5 min en bucle (incidente 2026-06-11). updateMany: no-op
    // silencioso si la fila no existe (tests poblados a medias).
    await prisma.holdedUpload.updateMany({
      where: { externalId },
      data: { status: "SKIPPED", lastError: { skipped: "test_mode" } },
    });
    log.info("ticket en modo prueba — skip upload", { externalId });
    return { kind: "skipped", reason: "test_cashier" };
  }
  // holded-desconectar (ADR-020) · LA CARRERA DEL CORTE.
  //
  // La acción no arranca mientras queden subidas pendientes, así que en el
  // momento del corte no hay filas PENDING. Pero un job puede estar
  // EJECUTÁNDOSE justo cuando la transacción hace commit: entra con clave,
  // llega aquí sin ella. Sin esta rama caería en `no_holded_key` y
  // `markFailed` pondría el ticket en `SYNC_FAILED` — un ticket que estaba
  // perfectamente bien acabaría en la bandeja de errores del panel a los
  // dos segundos de dejar Holded, y ahí no hay nada que arreglar.
  //
  // `SKIPPED` en el upload y el ticket SIN TOCAR. El ticket se queda como
  // estaba: si era `PENDING_SYNC` se queda ahí y el corte del día lo cuenta
  // una vez, lo cual es ruido acotado y honesto; nunca `SYNC_FAILED`, que es
  // una alarma sobre algo que nadie puede resolver.
  if (ticket.tenant.holdedDisconnectedAt != null) {
    await prisma.holdedUpload.updateMany({
      where: { externalId },
      data: {
        status: "SKIPPED",
        lastError: { skipped: "holded_desconectado" },
      },
    });
    log.info("el comercio dejó Holded — skip upload", { externalId });
    return { kind: "skipped", reason: "holded_desconectado" };
  }
  if (!ticket.tenant.holdedApiKeyCiphertext) {
    await markFailed(prisma, externalId, "no_holded_key");
    return { kind: "permanent_failure", reason: "no_holded_key" };
  }

  // catalogo-local · LA PUERTA: un producto LOCAL no entra jamás en el
  // payload de un salesreceipt.
  //
  // Por qué existe, con nombre y apellidos. Un producto LOCAL no existe
  // en Holded: su línea llega allí sin identificador que resuelva. Hasta
  // el bloque abonos-holded eso era además una pérdida silenciosa de
  // dinero —Holded ponía `price = 0`, el total no cuadraba y el ticket
  // entero se caía en `silent_reject` (Peluquería Sole, 10-06-2026,
  // ticket 000022: 17,50 € contra 27,40 €)—. Desde que el item lleva
  // `subtotal` el importe ya no se pierde, pero la puerta se queda: una
  // venta cuyo producto no existe en la contabilidad del comercio entra
  // allí como línea suelta, sin enganche con el catálogo ni con el stock,
  // y eso hay que verlo y arreglarlo, no dejarlo pasar en silencio.
  //
  // Corta ANTES del POST y del `bumpAttempts`, y falla RUIDOSAMENTE:
  //
  //   · `permanent_failure` → el ticket queda SYNC_FAILED y sale en la
  //     bandeja de errores del panel con un motivo que se lee. Es el
  //     mismo camino que `no_holded_key`, no un estado nuevo.
  //   · `captureAlert` → alerta con el producto y el ticket DENTRO. Si
  //     esto salta alguna vez, lo que hace falta saber es CUÁL se coló y
  //     por dónde, no que se coló.
  //   · NO se reintenta: no hay reintento que arregle esto.
  //
  // Lo que esta puerta NO hace es tumbar la venta. El cobro ya ocurrió y
  // el dinero está en la caja; cobrar siempre se puede, sincronizar ya
  // se verá. Bloquear en `POST /tickets` habría dejado al cajero sin
  // poder cobrar por una invariante nuestra.
  const localLines = ticket.lines.filter((l) => l.product?.source === "LOCAL");
  if (localLines.length > 0) {
    const offenders = localLines.map((l) => ({
      productId: l.product?.id ?? null,
      productName: l.product?.name ?? l.nameSnapshot,
      sku: l.sku,
      lineId: l.id,
    }));
    log.error("producto LOCAL en el camino de subida a Holded — no se sube", {
      externalId,
      ticketId: ticket.id,
      tenantId: ticket.tenant.id,
      offenders,
    });
    captureAlert("catalogo-local: producto LOCAL en el payload de Holded", {
      tenantId: ticket.tenant.id,
      extra: { externalId, ticketId: ticket.id, offenders },
    });
    await markFailed(prisma, externalId, "local_product_in_holded_payload", {
      step: "pre-POST salesreceipt",
      offenders,
    });
    return { kind: "permanent_failure", reason: "local_product_in_holded_payload" };
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

  const expectedTotal = Number(ticket.total);
  let documentId = ticket.holdedDocumentId;
  let docNumber = ticket.holdedDocNumber;

  // FASE 0 (bloque abonos-holded) · si ya hay un documento guardado, se
  // mira qué hay al otro lado antes de dar un paso más. Mismo criterio
  // que en la devolución — ver `holded-document.ts`.
  if (documentId) {
    const verdict = await inspectExistingDocument(client, documentId, expectedTotal);
    if (verdict.kind === "gone") {
      log.warn("el documento guardado ya no existe en Holded — se crea de nuevo", {
        externalId,
        documentId,
      });
      await forgetDocument(prisma, externalId);
      documentId = null;
      docNumber = null;
    } else if (verdict.kind === "total_mismatch") {
      const message = describeMismatchedDocument(verdict);
      log.error("documento de Holded con total distinto al del ticket", {
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

  // FASE 1: si no hay documentId, POST salesreceipt + GET-back.
  if (!documentId) {
    const payload = buildTicketSalesreceiptPayload(ticket);

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
        // El documento YA existe en Holded (el POST lo creó; el GET-back
        // sólo demostró que no vale). Su id se guarda antes de marcar el
        // fallo: así el reintento no crea un segundo documento y el
        // propietario sabe cuál tiene que anular.
        if (err.document) {
          await saveDocument(
            prisma,
            externalId,
            err.document.id,
            err.document.docNumber,
          );
        }
        log.warn("salesreceipt silent reject", {
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
      amount: expectedTotal,
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
  // La forma de la línea y todo lo que Holded hace con ella viven en
  // `holded-line.ts`. Aquí sólo se dice de dónde salen.
  lines: HoldedLineSnapshot[];
  register: { numSerieHolded: string | null };
}): SalesreceiptPayload {
  // UNA sola construcción de línea para la venta y para el abono: ver
  // `holded-line.ts`. Aquí sólo se elige el signo.
  const items: SalesreceiptItem[] = ticket.lines.map((l) =>
    buildHoldedLineItem(l, SALE_SIGN),
  );
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

function composePayDesc(payments: Array<{ method: string; amount: { toString(): string } }>): string {
  if (payments.length === 1) return `TPV ${payments[0]!.method}`;
  const parts = payments.map(
    (p) => `${p.method}: ${Number(p.amount.toString()).toFixed(2)}€`,
  );
  return `TPV mixto · ${parts.join(" · ")}`;
}

async function saveDocument(
  prisma: PrismaClient,
  externalId: string,
  documentId: string,
  docNumber: string | null,
): Promise<void> {
  await prisma.$transaction([
    prisma.ticket.update({
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
    prisma.ticket.update({
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
