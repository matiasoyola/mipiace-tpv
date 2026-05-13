// Bandeja `SYNC_FAILED` del admin (B5 §2).
//
// Cubre tickets y refunds en la misma vista — para el propietario es
// la misma incidencia: "Holded rechazó un documento, ¿qué hago?".
// Desde B6 §1 todos los endpoints son `requireOwnerOrManager`: el
// MANAGER también gestiona la bandeja (retry / mark-resolved / edit-sku).
//
//   GET  /admin/tickets/sync-errors                — lista combinada.
//   GET  /admin/tickets/:id/holded-payload-preview — diagnostico.
//   POST /admin/tickets/:id/retry-sync             — re-encolar.
//   POST /admin/tickets/:id/mark-resolved          — saneo manual.
//   POST /admin/tickets/:id/edit-line-sku          — corregir SKU + re-encolar.
//   (los mismos cuatro sobre /admin/refunds/:id/…)

import { Prisma, TicketStatus } from "@mipiacetpv/db";
import type { FastifyInstance } from "fastify";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { enqueueRefundUpload } from "../queues/refund-upload.js";
import { enqueueTicketUpload } from "../queues/ticket-upload.js";
import {
  buildRefundSalesreceiptPayload,
} from "../tickets/upload-refund.js";
import {
  buildTicketSalesreceiptPayload,
} from "../tickets/upload-ticket.js";

export async function registerAdminTicketsErrorsRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── GET /admin/tickets/sync-errors ──────────────────────────────────
  app.get(
    "/admin/tickets/sync-errors",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            registerId: { type: "string", format: "uuid" },
            storeId: { type: "string", format: "uuid" },
            errorType: {
              type: "string",
              enum: [
                "silent_reject",
                "holded_4xx",
                "pay_silent_reject",
                "pay_4xx",
                "no_holded_key",
              ],
            },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const q = request.query as {
        from?: string;
        to?: string;
        registerId?: string;
        storeId?: string;
        errorType?: string;
        limit?: number;
      };
      const prisma = getPrisma();
      const limit = q.limit ?? 100;
      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (q.from) dateFilter.gte = new Date(q.from);
      if (q.to) dateFilter.lte = new Date(q.to);
      const registerFilter = q.registerId ?? undefined;
      const storeFilter = q.storeId
        ? { register: { storeId: q.storeId } }
        : undefined;

      const tickets = await prisma.ticket.findMany({
        where: {
          tenantId: auth.tenantId,
          status: TicketStatus.SYNC_FAILED,
          ...(registerFilter ? { registerId: registerFilter } : {}),
          ...(storeFilter ? { register: storeFilter.register } : {}),
          ...(dateFilter.gte || dateFilter.lte ? { createdAt: dateFilter } : {}),
        },
        include: {
          lines: { select: { sku: true } },
          register: {
            select: {
              id: true,
              name: true,
              store: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      const refunds = await prisma.refund.findMany({
        where: {
          tenantId: auth.tenantId,
          status: TicketStatus.SYNC_FAILED,
          ...(registerFilter ? { registerId: registerFilter } : {}),
          ...(storeFilter ? { register: storeFilter.register } : {}),
          ...(dateFilter.gte || dateFilter.lte ? { createdAt: dateFilter } : {}),
        },
        include: {
          register: {
            select: {
              id: true,
              name: true,
              store: { select: { id: true, name: true } },
            },
          },
          originalTicket: { select: { id: true, internalNumber: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      const externalIds = [
        ...tickets.map((t) => t.externalId),
        ...refunds.map((r) => r.externalId),
      ];
      const uploads = externalIds.length
        ? await prisma.holdedUpload.findMany({
            where: { externalId: { in: externalIds } },
            select: {
              externalId: true,
              attempts: true,
              lastAttemptAt: true,
              holdedDocumentId: true,
            },
          })
        : [];
      const uploadByExt = new Map(uploads.map((u) => [u.externalId, u]));

      const ticketEntries = tickets.map((t) => ({
        id: t.id,
        kind: "ticket" as const,
        internalNumber: t.internalNumber,
        externalId: t.externalId,
        createdAt: t.createdAt.toISOString(),
        total: Number(t.total.toString()),
        lineCount: t.lines.length,
        errorSummary: summarizeError(t.syncError, Number(t.total.toString())),
        errorType: extractErrorType(t.syncError),
        attempts: uploadByExt.get(t.externalId)?.attempts ?? 0,
        lastAttemptAt:
          uploadByExt.get(t.externalId)?.lastAttemptAt?.toISOString() ?? null,
        holdedDocumentId: t.holdedDocumentId,
        holdedDocNumber: t.holdedDocNumber,
        register: t.register
          ? { id: t.register.id, name: t.register.name, storeId: t.register.store.id, storeName: t.register.store.name }
          : null,
      }));
      const refundEntries = refunds
        .filter((r) => r.register !== null)
        .map((r) => ({
          id: r.id,
          kind: "refund" as const,
          internalNumber: r.internalNumber,
          externalId: r.externalId,
          createdAt: r.createdAt.toISOString(),
          total: Number(r.total.toString()),
          lineCount: 0, // refund line count opcional aquí; el drawer lo trae.
          errorSummary: summarizeError(r.syncError, Number(r.total.toString())),
          errorType: extractErrorType(r.syncError),
          attempts: uploadByExt.get(r.externalId)?.attempts ?? 0,
          lastAttemptAt:
            uploadByExt.get(r.externalId)?.lastAttemptAt?.toISOString() ?? null,
          holdedDocumentId: r.holdedDocumentId,
          holdedDocNumber: r.holdedDocNumber,
          originalTicket: r.originalTicket
            ? { id: r.originalTicket.id, internalNumber: r.originalTicket.internalNumber }
            : null,
          register: r.register
            ? { id: r.register.id, name: r.register.name, storeId: r.register.store.id, storeName: r.register.store.name }
            : null,
        }));

      const filtered = q.errorType
        ? [...ticketEntries, ...refundEntries].filter((e) => e.errorType === q.errorType)
        : [...ticketEntries, ...refundEntries];
      // Orden combinado por fecha descendente.
      filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

      return reply.send({
        items: filtered,
        pendingCount: tickets.length + refundEntries.length,
      });
    },
  );

  // ── GET /admin/tickets/:id/holded-payload-preview ───────────────────
  // Para tickets. El mismo handler para refunds está más abajo bajo
  // /admin/refunds/:id/holded-payload-preview.
  app.get(
    "/admin/tickets/:id/holded-payload-preview",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const params = request.params as { id: string };
      const ticket = await getPrisma().ticket.findFirst({
        where: { id: params.id, tenantId: auth.tenantId },
        include: { lines: true, register: { select: { numSerieHolded: true } } },
      });
      if (!ticket) return notFound(reply, "ticket");
      const payload = buildTicketSalesreceiptPayload(ticket);
      return reply.send({ kind: "ticket", payload });
    },
  );

  app.get(
    "/admin/refunds/:id/holded-payload-preview",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const params = request.params as { id: string };
      const refund = await getPrisma().refund.findFirst({
        where: { id: params.id, tenantId: auth.tenantId },
        include: {
          lines: true,
          originalTicket: { select: { holdedDocumentId: true, holdedDocNumber: true } },
          register: { select: { numSerieHolded: true } },
        },
      });
      if (!refund) return notFound(reply, "refund");
      const payload = buildRefundSalesreceiptPayload(refund);
      return reply.send({ kind: "refund", payload });
    },
  );

  // ── POST /admin/tickets/:id/retry-sync ──────────────────────────────
  app.post(
    "/admin/tickets/:id/retry-sync",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const params = request.params as { id: string };
      const ticket = await getPrisma().ticket.findFirst({
        where: { id: params.id, tenantId: auth.tenantId },
        select: { id: true, externalId: true, status: true },
      });
      if (!ticket) return notFound(reply, "ticket");
      if (ticket.status === TicketStatus.SYNCED) {
        return reply.code(409).send({
          error: "ALREADY_SYNCED",
          message: "El ticket ya está sincronizado.",
        });
      }
      await resetForRetry(getPrisma(), { kind: "ticket", externalId: ticket.externalId });
      await enqueueTicketUpload(ticket.externalId);
      return reply.code(202).send({ ok: true, jobId: `upload-ticket-${ticket.externalId}` });
    },
  );

  app.post(
    "/admin/refunds/:id/retry-sync",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const params = request.params as { id: string };
      const refund = await getPrisma().refund.findFirst({
        where: { id: params.id, tenantId: auth.tenantId },
        select: { id: true, externalId: true, status: true },
      });
      if (!refund) return notFound(reply, "refund");
      if (refund.status === TicketStatus.SYNCED) {
        return reply.code(409).send({
          error: "ALREADY_SYNCED",
          message: "La devolución ya está sincronizada.",
        });
      }
      await resetForRetry(getPrisma(), { kind: "refund", externalId: refund.externalId });
      await enqueueRefundUpload(refund.externalId);
      return reply.code(202).send({ ok: true, jobId: `upload-refund-${refund.externalId}` });
    },
  );

  // ── POST /admin/tickets/:id/mark-resolved ───────────────────────────
  // El propietario afirma "esto existe en Holded, déjame ya". Aceptamos
  // un holdedDocumentId que sustituye al actual y dejamos status=SYNCED
  // sin volver a llamar a Holded. Caso típico: GET-back falló por una
  // latencia rara pero el documento sí está en Holded; el dueño lo
  // encuentra en el panel de Holded y nos lo da.
  app.post(
    "/admin/tickets/:id/mark-resolved",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["holdedDocumentId"],
          additionalProperties: false,
          properties: {
            holdedDocumentId: { type: "string", minLength: 1, maxLength: 64 },
            holdedDocNumber: { type: "string", maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const params = request.params as { id: string };
      const body = request.body as { holdedDocumentId: string; holdedDocNumber?: string };
      const ticket = await getPrisma().ticket.findFirst({
        where: { id: params.id, tenantId: auth.tenantId },
        select: { id: true, externalId: true },
      });
      if (!ticket) return notFound(reply, "ticket");
      await getPrisma().$transaction([
        getPrisma().ticket.update({
          where: { id: ticket.id },
          data: {
            status: TicketStatus.SYNCED,
            holdedDocumentId: body.holdedDocumentId,
            holdedDocNumber: body.holdedDocNumber ?? null,
            syncedAt: new Date(),
            syncError: Prisma.JsonNull,
          },
        }),
        getPrisma().holdedUpload.update({
          where: { externalId: ticket.externalId },
          data: {
            status: "DONE",
            holdedDocumentId: body.holdedDocumentId,
            lastError: Prisma.JsonNull,
          },
        }),
      ]);
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/admin/refunds/:id/mark-resolved",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["holdedDocumentId"],
          additionalProperties: false,
          properties: {
            holdedDocumentId: { type: "string", minLength: 1, maxLength: 64 },
            holdedDocNumber: { type: "string", maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const params = request.params as { id: string };
      const body = request.body as { holdedDocumentId: string; holdedDocNumber?: string };
      const refund = await getPrisma().refund.findFirst({
        where: { id: params.id, tenantId: auth.tenantId },
        select: { id: true, externalId: true },
      });
      if (!refund) return notFound(reply, "refund");
      await getPrisma().$transaction([
        getPrisma().refund.update({
          where: { id: refund.id },
          data: {
            status: TicketStatus.SYNCED,
            holdedDocumentId: body.holdedDocumentId,
            holdedDocNumber: body.holdedDocNumber ?? null,
            syncedAt: new Date(),
            syncError: Prisma.JsonNull,
          },
        }),
        getPrisma().holdedUpload.update({
          where: { externalId: refund.externalId },
          data: {
            status: "DONE",
            holdedDocumentId: body.holdedDocumentId,
            lastError: Prisma.JsonNull,
          },
        }),
      ]);
      return reply.send({ ok: true });
    },
  );

  // ── POST /admin/tickets/:id/edit-line-sku ───────────────────────────
  // Edita el SKU de una línea concreta. Caso: Holded rechazó por SKU
  // no canónico; el propietario corrige y re-encola. SI el ticket ya
  // tenía holdedDocumentId (POST salesreceipt llegó pero /pay falló),
  // no se reusa — limpiamos el documento parcial para que el siguiente
  // intento re-cree con el SKU correcto. (En Holded queda el doc parcial
  // huérfano; el propietario lo cancelará desde el panel.)
  app.post(
    "/admin/tickets/:id/edit-line-sku",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["ticketLineId", "sku"],
          additionalProperties: false,
          properties: {
            ticketLineId: { type: "string", format: "uuid" },
            sku: { type: "string", minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const params = request.params as { id: string };
      const body = request.body as { ticketLineId: string; sku: string };
      const ticket = await getPrisma().ticket.findFirst({
        where: { id: params.id, tenantId: auth.tenantId },
        select: { id: true, externalId: true, status: true, lines: { select: { id: true } } },
      });
      if (!ticket) return notFound(reply, "ticket");
      if (ticket.status === TicketStatus.SYNCED) {
        return reply.code(409).send({
          error: "ALREADY_SYNCED",
          message: "El ticket ya está sincronizado; edita en Holded directamente.",
        });
      }
      const lineExists = ticket.lines.some((l) => l.id === body.ticketLineId);
      if (!lineExists) {
        return reply.code(400).send({
          error: "LINE_NOT_FOUND",
          message: "La línea indicada no pertenece a este ticket.",
        });
      }
      await getPrisma().$transaction([
        getPrisma().ticketLine.update({
          where: { id: body.ticketLineId },
          data: { sku: body.sku },
        }),
        // Limpiamos el documentId parcial para forzar un POST fresco.
        getPrisma().ticket.update({
          where: { id: ticket.id },
          data: { holdedDocumentId: null, holdedDocNumber: null },
        }),
      ]);
      await resetForRetry(getPrisma(), { kind: "ticket", externalId: ticket.externalId });
      await enqueueTicketUpload(ticket.externalId);
      return reply.code(202).send({ ok: true, jobId: `upload-ticket-${ticket.externalId}` });
    },
  );

  app.post(
    "/admin/refunds/:id/edit-line-sku",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["refundLineId", "sku"],
          additionalProperties: false,
          properties: {
            refundLineId: { type: "string", format: "uuid" },
            sku: { type: "string", minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const params = request.params as { id: string };
      const body = request.body as { refundLineId: string; sku: string };
      const refund = await getPrisma().refund.findFirst({
        where: { id: params.id, tenantId: auth.tenantId },
        select: { id: true, externalId: true, status: true, lines: { select: { id: true } } },
      });
      if (!refund) return notFound(reply, "refund");
      if (refund.status === TicketStatus.SYNCED) {
        return reply.code(409).send({
          error: "ALREADY_SYNCED",
          message: "La devolución ya está sincronizada.",
        });
      }
      const lineExists = refund.lines.some((l) => l.id === body.refundLineId);
      if (!lineExists) {
        return reply.code(400).send({
          error: "LINE_NOT_FOUND",
          message: "La línea indicada no pertenece a esta devolución.",
        });
      }
      await getPrisma().$transaction([
        getPrisma().refundLine.update({
          where: { id: body.refundLineId },
          data: { sku: body.sku },
        }),
        getPrisma().refund.update({
          where: { id: refund.id },
          data: { holdedDocumentId: null, holdedDocNumber: null },
        }),
      ]);
      await resetForRetry(getPrisma(), { kind: "refund", externalId: refund.externalId });
      await enqueueRefundUpload(refund.externalId);
      return reply.code(202).send({ ok: true, jobId: `upload-refund-${refund.externalId}` });
    },
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function summarizeError(syncError: unknown, ourTotal: number): string {
  if (!syncError || typeof syncError !== "object") return "error desconocido";
  const obj = syncError as { reason?: string; mismatches?: Array<{ field: string; expected: unknown; actual: unknown }>; message?: string };
  if (obj.reason === "silent_reject" || obj.reason === "pay_silent_reject") {
    if (obj.mismatches && obj.mismatches.length > 0) {
      const m = obj.mismatches[0]!;
      if (m.field === "total") {
        return `total mismatch · ${ourTotal} vs ${formatActual(m.actual)}`;
      }
      return `silent reject · ${m.field}`;
    }
    return "silent reject";
  }
  if (obj.reason === "holded_4xx" || obj.reason === "pay_4xx") {
    return obj.message ? `${obj.reason} · ${obj.message}` : obj.reason;
  }
  if (obj.reason === "no_holded_key") return "Holded API key ausente";
  return obj.reason ?? "error desconocido";
}

function extractErrorType(syncError: unknown): string | null {
  if (!syncError || typeof syncError !== "object") return null;
  const obj = syncError as { reason?: string };
  return obj.reason ?? null;
}

function formatActual(actual: unknown): string {
  if (typeof actual === "number") return actual.toFixed(2);
  return String(actual);
}

async function resetForRetry(
  prisma: ReturnType<typeof getPrisma>,
  target: { kind: "ticket" | "refund"; externalId: string },
): Promise<void> {
  // Dejamos el documento en PENDING_SYNC para que el worker lo procese
  // como flujo normal. El HoldedUpload conserva attempts (histórico)
  // pero se limpia lastError.
  if (target.kind === "ticket") {
    await prisma.$transaction([
      prisma.ticket.update({
        where: { externalId: target.externalId },
        data: { status: TicketStatus.PENDING_SYNC, syncError: Prisma.JsonNull },
      }),
      prisma.holdedUpload.update({
        where: { externalId: target.externalId },
        data: { status: "PENDING", lastError: Prisma.JsonNull },
      }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.refund.update({
        where: { externalId: target.externalId },
        data: { status: TicketStatus.PENDING_SYNC, syncError: Prisma.JsonNull },
      }),
      prisma.holdedUpload.update({
        where: { externalId: target.externalId },
        data: { status: "PENDING", lastError: Prisma.JsonNull },
      }),
    ]);
  }
}

function notFound(reply: import("fastify").FastifyReply, kind: "ticket" | "refund") {
  return reply.code(404).send({
    error: kind === "ticket" ? "TICKET_NOT_FOUND" : "REFUND_NOT_FOUND",
    message: kind === "ticket" ? "Ticket no encontrado" : "Devolución no encontrada",
  });
}
