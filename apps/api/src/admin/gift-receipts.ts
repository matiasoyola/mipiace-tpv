// Backend del frente 5 de B6 — reimpresión masiva de ticket regalo.
//
// La impresión real vive en el bloque dedicado posterior (agente local
// ESC/POS). Aquí dejamos la infraestructura para que cuando llegue, el
// botón "Reimprimir ticket regalo" del admin tenga datos consistentes.
//
//   GET  /admin/tickets/gift-receipt-candidates
//   POST /admin/tickets/:id/gift-receipt-intent
//   POST /admin/tickets/batch-gift-receipt

import type { FastifyInstance } from "fastify";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";

const DEFAULT_DAYS_BACK = 30;
const MAX_DAYS_BACK = 365;
const MAX_BATCH = 500;

export async function registerAdminGiftReceiptRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/admin/tickets/gift-receipt-candidates",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            daysBack: { type: "integer", minimum: 1, maximum: MAX_DAYS_BACK },
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            registerId: { type: "string", format: "uuid" },
            storeId: { type: "string", format: "uuid" },
            minTotal: { type: "number", minimum: 0 },
          },
        },
      },
    },
    async (request) => {
      const auth = request.auth!;
      const q = request.query as {
        daysBack?: number;
        from?: string;
        to?: string;
        registerId?: string;
        storeId?: string;
        minTotal?: number;
      };
      const prisma = getPrisma();
      // Resolución del rango: prioriza `from`/`to` explícitos; si faltan,
      // ventana de `daysBack` (default 30) hasta hoy.
      const days = q.daysBack ?? DEFAULT_DAYS_BACK;
      const to = q.to ? new Date(q.to) : new Date();
      const from = q.from
        ? new Date(q.from)
        : new Date(to.getTime() - days * 86_400_000);

      // Si filtra por tienda, resolvemos los registerIds del tenant que
      // pertenecen a esa tienda. No queremos exponer datos cross-tenant.
      let registerFilter: { in: string[] } | string | undefined;
      if (q.registerId) {
        registerFilter = q.registerId;
      } else if (q.storeId) {
        const registers = await prisma.register.findMany({
          where: {
            storeId: q.storeId,
            store: { tenantId: auth.tenantId },
            deletedAt: null,
          },
          select: { id: true },
        });
        registerFilter = { in: registers.map((r) => r.id) };
      }

      const tickets = await prisma.ticket.findMany({
        where: {
          tenantId: auth.tenantId,
          createdAt: { gte: from, lte: to },
          status: { in: ["PAID", "PENDING_SYNC", "SYNCED"] },
          ...(typeof registerFilter === "string"
            ? { registerId: registerFilter }
            : registerFilter
            ? { registerId: registerFilter }
            : {}),
          ...(q.minTotal != null ? { total: { gte: q.minTotal } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          id: true,
          internalNumber: true,
          createdAt: true,
          total: true,
          giftReceiptIntentAt: true,
          status: true,
          register: {
            select: {
              id: true,
              name: true,
              store: { select: { id: true, name: true } },
            },
          },
          lines: {
            select: { nameSnapshot: true, units: true },
            take: 5,
            orderBy: { id: "asc" },
          },
        },
      });

      return {
        items: tickets.map((t) => ({
          id: t.id,
          internalNumber: t.internalNumber,
          createdAt: t.createdAt.toISOString(),
          total: Number(t.total.toString()),
          status: t.status,
          giftReceiptIntentAt: t.giftReceiptIntentAt?.toISOString() ?? null,
          register: {
            id: t.register.id,
            name: t.register.name,
            storeId: t.register.store.id,
            storeName: t.register.store.name,
          },
          linesPreview: t.lines.map((l) => ({
            name: l.nameSnapshot,
            units: Number(l.units.toString()),
          })),
        })),
        range: { from: from.toISOString(), to: to.toISOString() },
      };
    },
  );

  app.post(
    "/admin/tickets/:ticketId/gift-receipt-intent",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
        body: { type: "object", additionalProperties: false, properties: {} },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { ticketId } = request.params as { ticketId: string };
      const prisma = getPrisma();
      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!ticket) {
        return reply
          .code(404)
          .send({ error: "TICKET_NOT_FOUND", message: "Ticket no encontrado" });
      }
      const updated = await prisma.ticket.update({
        where: { id: ticket.id },
        // Marcar idempotente: si ya tenía intent previa, sobreescribimos
        // con `now()` — el agente local podrá distinguir el último deseo
        // del propietario y reimprimir si corresponde.
        data: { giftReceiptIntentAt: new Date() },
        select: { id: true, giftReceiptIntentAt: true },
      });
      return reply.code(200).send({
        ticket: {
          id: updated.id,
          giftReceiptIntentAt: updated.giftReceiptIntentAt!.toISOString(),
        },
      });
    },
  );

  app.post(
    "/admin/tickets/batch-gift-receipt",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        body: {
          type: "object",
          required: ["ticketIds"],
          additionalProperties: false,
          properties: {
            ticketIds: {
              type: "array",
              minItems: 1,
              maxItems: MAX_BATCH,
              items: { type: "string", format: "uuid" },
              uniqueItems: true,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { ticketIds } = request.body as { ticketIds: string[] };
      const prisma = getPrisma();
      // updateMany con `tenantId` evita cualquier fuga cross-tenant si
      // alguien intenta colar ids de otro tenant en el body.
      const result = await prisma.ticket.updateMany({
        where: {
          id: { in: ticketIds },
          tenantId: auth.tenantId,
        },
        data: { giftReceiptIntentAt: new Date() },
      });
      return reply.code(200).send({
        updated: result.count,
        requested: ticketIds.length,
      });
    },
  );
}
