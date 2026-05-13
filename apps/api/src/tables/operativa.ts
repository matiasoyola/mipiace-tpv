// Operativa de mesa (B7 §4). Endpoints `requireCashierSession` para
// abrir mesas, añadir/editar/eliminar líneas y vaciar.
//
//   POST   /tables/:tableId/open            — abre mesa (crea ticket DRAFT vacío)
//   POST   /tables/:tableId/lines           — añade línea (crea ticket DRAFT si hace falta)
//   PATCH  /tickets/:ticketId/lines/:lineId — edita cantidad / descuento / modifiers
//   DELETE /tickets/:ticketId/lines/:lineId — elimina línea
//   DELETE /tickets/:ticketId               — vacía la mesa (DRAFT) con motivo opcional
//
// Notas:
// - Idempotencia opcional al añadir línea con `lineExternalId` UUIDv4
//   (cliente lo genera tras pulsar el producto). Si ya existe, devolver
//   200 sin duplicar.
// - El `internalNumber` se asigna al cobrar (POST /tickets/:id/checkout),
//   no aquí — un DRAFT cancelado no consume serie.
// - `externalId` del ticket se genera ahora (server-side) — lo necesita
//   el worker `upload-ticket` para idempotencia al cobrar.

import { randomUUID } from "node:crypto";

import { Prisma } from "@mipiacetpv/db";
import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { getStoreEventBus } from "../realtime/store-event-bus.js";
import { requireCashierSession } from "../shift/cashier-session.js";
import { computeTicket } from "../tickets/totals.js";

const UUID_V4 =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

interface LineBody {
  productId?: string;
  variantId?: string;
  holdedProductId?: string;
  nameSnapshot: string;
  sku: string;
  units: number;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
  modifiers?: string[];
  lineExternalId?: string;
}

export async function registerTableOperativaRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── Abrir mesa (sin líneas todavía) ───────────────────────────────
  app.post(
    "/tables/:tableId/open",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["tableId"],
          properties: { tableId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            diners: { type: "integer", minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { tableId } = request.params as { tableId: string };
      const body = request.body as { diners?: number };
      const prisma = getPrisma();
      const ctx = await ensureTableContext(prisma, cashier, tableId);
      if ("error" in ctx) return reply.code(ctx.status).send(ctx.error);
      const wasNew = !(await prisma.ticket.findFirst({
        where: { tableId: ctx.tableId, status: "DRAFT" },
        select: { id: true },
      }));
      const draft = await getOrCreateDraftTicket(
        prisma,
        ctx,
        cashier.sub,
        body.diners ?? null,
      );
      if (wasNew) {
        const cashierUser = await prisma.user.findUniqueOrThrow({
          where: { id: cashier.sub },
          select: { email: true },
        });
        getStoreEventBus().broadcast(ctx.storeId, {
          type: "table.opened",
          tableId: ctx.tableId,
          ticketId: draft.id,
          byEmail: cashierUser.email,
          at: new Date().toISOString(),
        });
      }
      return reply.code(201).send({ ticket: serializeDraft(draft) });
    },
  );

  // ── Añadir línea ───────────────────────────────────────────────────
  app.post(
    "/tables/:tableId/lines",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["tableId"],
          properties: { tableId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["nameSnapshot", "sku", "units", "unitPrice", "discountPct", "taxRate"],
          additionalProperties: false,
          properties: {
            productId: { type: "string", format: "uuid" },
            variantId: { type: "string", format: "uuid" },
            holdedProductId: { type: "string", maxLength: 64 },
            nameSnapshot: { type: "string", minLength: 1, maxLength: 300 },
            sku: { type: "string", minLength: 1, maxLength: 64 },
            units: { type: "number", exclusiveMinimum: 0, maximum: 99999 },
            unitPrice: { type: "number", minimum: 0, maximum: 100000 },
            discountPct: { type: "number", minimum: 0, maximum: 100 },
            taxRate: { type: "number", minimum: 0, maximum: 100 },
            modifiers: {
              type: "array",
              items: { type: "string", maxLength: 80 },
              maxItems: 10,
            },
            lineExternalId: { type: "string", pattern: UUID_V4 },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { tableId } = request.params as { tableId: string };
      const body = request.body as LineBody;
      const prisma = getPrisma();
      const ctx = await ensureTableContext(prisma, cashier, tableId);
      if ("error" in ctx) return reply.code(ctx.status).send(ctx.error);

      const draft = await getOrCreateDraftTicket(prisma, ctx, cashier.sub, null);

      // Idempotencia por lineExternalId: si el cliente lo manda y ya
      // existe, devolvemos el ticket actual.
      if (body.lineExternalId) {
        const existing = await prisma.ticketLine.findFirst({
          where: {
            ticketId: draft.id,
            id: body.lineExternalId,
          },
          select: { id: true },
        });
        if (existing) {
          const refreshed = await reloadDraft(prisma, draft.id);
          return reply.code(200).send({
            ticket: serializeDraft(refreshed),
            duplicate: true,
          });
        }
      }

      const lineId = body.lineExternalId ?? randomUUID();
      const lineSnapshot = computeTicket([
        {
          units: body.units,
          unitPrice: body.unitPrice,
          discountPct: body.discountPct,
          taxRate: body.taxRate,
        },
      ]).lines[0]!;
      const updated = await prisma.$transaction(async (tx) => {
        await tx.ticketLine.create({
          data: {
            id: lineId,
            ticketId: draft.id,
            productId: body.productId ?? null,
            variantId: body.variantId ?? null,
            holdedProductId: body.holdedProductId ?? null,
            sku: body.sku,
            nameSnapshot: body.nameSnapshot,
            units: new Prisma.Decimal(body.units),
            unitPrice: new Prisma.Decimal(body.unitPrice),
            discountPct: new Prisma.Decimal(body.discountPct),
            taxRate: new Prisma.Decimal(body.taxRate),
            subtotal: new Prisma.Decimal(lineSnapshot.subtotal),
            total: new Prisma.Decimal(lineSnapshot.total),
            modifiers:
              body.modifiers && body.modifiers.length > 0
                ? (body.modifiers as unknown as object)
                : Prisma.JsonNull,
          },
        });
        return recomputeTicketTotals(tx, draft.id);
      });
      getStoreEventBus().broadcast(ctx.storeId, {
        type: "table.lineAdded",
        tableId: ctx.tableId,
        ticketId: draft.id,
        line: {
          id: lineId,
          sku: body.sku,
          nameSnapshot: body.nameSnapshot,
        },
        at: new Date().toISOString(),
      });
      return reply.code(201).send({ ticket: serializeDraft(updated) });
    },
  );

  // ── Editar línea (cantidad / descuento / modifiers) ────────────────
  app.patch(
    "/tickets/:ticketId/lines/:lineId",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["ticketId", "lineId"],
          properties: {
            ticketId: { type: "string", format: "uuid" },
            lineId: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            units: { type: "number", exclusiveMinimum: 0, maximum: 99999 },
            discountPct: { type: "number", minimum: 0, maximum: 100 },
            modifiers: {
              type: "array",
              items: { type: "string", maxLength: 80 },
              maxItems: 10,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId, lineId } = request.params as {
        ticketId: string;
        lineId: string;
      };
      const body = request.body as {
        units?: number;
        discountPct?: number;
        modifiers?: string[];
      };
      const prisma = getPrisma();
      const draft = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid, status: "DRAFT" },
        select: {
          id: true,
          registerId: true,
          tableId: true,
          register: { select: { storeId: true } },
        },
      });
      if (!draft) {
        return reply.code(404).send({
          error: "TICKET_NOT_FOUND_OR_NOT_DRAFT",
          message: "Sólo se pueden editar líneas de un ticket DRAFT.",
        });
      }
      if (draft.registerId !== cashier.rid) {
        return reply.code(403).send({
          error: "REGISTER_MISMATCH",
          message: "El ticket no pertenece a tu caja.",
        });
      }
      const line = await prisma.ticketLine.findFirst({
        where: { id: lineId, ticketId },
        select: {
          id: true,
          units: true,
          unitPrice: true,
          discountPct: true,
          taxRate: true,
          modifiers: true,
        },
      });
      if (!line) {
        return reply
          .code(404)
          .send({ error: "LINE_NOT_FOUND", message: "Línea no encontrada" });
      }
      const newUnits = body.units ?? Number(line.units);
      const newDiscount = body.discountPct ?? Number(line.discountPct);
      const computed = computeTicket([
        {
          units: newUnits,
          unitPrice: Number(line.unitPrice),
          discountPct: newDiscount,
          taxRate: Number(line.taxRate),
        },
      ]).lines[0]!;
      const updated = await prisma.$transaction(async (tx) => {
        await tx.ticketLine.update({
          where: { id: lineId },
          data: {
            units: new Prisma.Decimal(newUnits),
            discountPct: new Prisma.Decimal(newDiscount),
            subtotal: new Prisma.Decimal(computed.subtotal),
            total: new Prisma.Decimal(computed.total),
            ...(body.modifiers
              ? {
                  modifiers:
                    body.modifiers.length > 0
                      ? (body.modifiers as unknown as object)
                      : Prisma.JsonNull,
                }
              : {}),
          },
        });
        return recomputeTicketTotals(tx, ticketId);
      });
      if (draft.tableId) {
        getStoreEventBus().broadcast(draft.register.storeId, {
          type: "table.lineUpdated",
          tableId: draft.tableId,
          ticketId,
          lineId,
          at: new Date().toISOString(),
        });
      }
      return { ticket: serializeDraft(updated) };
    },
  );

  // ── Eliminar línea ────────────────────────────────────────────────
  app.delete(
    "/tickets/:ticketId/lines/:lineId",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["ticketId", "lineId"],
          properties: {
            ticketId: { type: "string", format: "uuid" },
            lineId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId, lineId } = request.params as {
        ticketId: string;
        lineId: string;
      };
      const prisma = getPrisma();
      const draft = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid, status: "DRAFT" },
        select: {
          id: true,
          registerId: true,
          tableId: true,
          register: { select: { storeId: true } },
        },
      });
      if (!draft) {
        return reply.code(404).send({
          error: "TICKET_NOT_FOUND_OR_NOT_DRAFT",
          message: "Sólo se pueden eliminar líneas de un ticket DRAFT.",
        });
      }
      if (draft.registerId !== cashier.rid) {
        return reply.code(403).send({
          error: "REGISTER_MISMATCH",
          message: "El ticket no pertenece a tu caja.",
        });
      }
      const updated = await prisma.$transaction(async (tx) => {
        const removed = await tx.ticketLine.deleteMany({
          where: { id: lineId, ticketId },
        });
        if (removed.count === 0) {
          throw new LineNotFoundError();
        }
        return recomputeTicketTotals(tx, ticketId);
      });
      if (draft.tableId) {
        getStoreEventBus().broadcast(draft.register.storeId, {
          type: "table.lineRemoved",
          tableId: draft.tableId,
          ticketId,
          lineId,
          at: new Date().toISOString(),
        });
      }
      return { ticket: serializeDraft(updated) };
    },
  );

  // ── Vaciar mesa (cancela DRAFT con motivo) ─────────────────────────
  app.delete(
    "/tickets/:ticketId",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { reason: { type: "string", maxLength: 200 } },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const query = request.query as { reason?: string };
      const prisma = getPrisma();
      const draft = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid, status: "DRAFT" },
        select: {
          id: true,
          registerId: true,
          tableId: true,
          register: { select: { storeId: true } },
        },
      });
      if (!draft) {
        return reply.code(404).send({
          error: "TICKET_NOT_FOUND_OR_NOT_DRAFT",
          message: "Sólo se pueden cancelar tickets en DRAFT.",
        });
      }
      if (draft.registerId !== cashier.rid) {
        return reply.code(403).send({
          error: "REGISTER_MISMATCH",
          message: "El ticket no pertenece a tu caja.",
        });
      }
      await prisma.ticket.update({
        where: { id: ticketId },
        data: {
          status: "VOIDED",
          notes: query.reason
            ? `[VACIADA] ${query.reason}`
            : "[VACIADA] sin motivo",
        },
      });
      if (draft.tableId) {
        getStoreEventBus().broadcast(draft.register.storeId, {
          type: "table.cleared",
          tableId: draft.tableId,
          ticketId,
          reason: query.reason ?? null,
          at: new Date().toISOString(),
        });
      }
      request.log.info(
        {
          event: "table.cleared",
          tenantId: cashier.tid,
          cashierId: cashier.sub,
          ticketId,
          tableId: draft.tableId,
          reason: query.reason ?? null,
        },
        "Mesa vaciada (DRAFT → VOIDED)",
      );
      return reply.code(204).send();
    },
  );
}

class LineNotFoundError extends Error {
  constructor() {
    super("line not found");
  }
}

interface TableContextOk {
  tableId: string;
  storeId: string;
  registerId: string;
  shiftId: string;
}

async function ensureTableContext(
  prisma: ReturnType<typeof getPrisma>,
  cashier: { sub: string; tid: string; rid: string },
  tableId: string,
): Promise<
  | TableContextOk
  | { error: { error: string; message: string }; status: number }
> {
  const table = await prisma.table.findFirst({
    where: { id: tableId, deletedAt: null, store: { tenantId: cashier.tid } },
    select: { id: true, storeId: true },
  });
  if (!table) {
    return {
      status: 404,
      error: { error: "TABLE_NOT_FOUND", message: "Mesa no encontrada" },
    };
  }
  const register = await prisma.register.findFirst({
    where: { id: cashier.rid, storeId: table.storeId, deletedAt: null },
    select: { id: true },
  });
  if (!register) {
    return {
      status: 409,
      error: {
        error: "REGISTER_STORE_MISMATCH",
        message: "Tu caja no pertenece a la tienda de esta mesa.",
      },
    };
  }
  const shift = await prisma.shift.findFirst({
    where: { registerId: cashier.rid, closedAt: null },
    select: { id: true },
    orderBy: { openedAt: "desc" },
  });
  if (!shift) {
    return {
      status: 409,
      error: {
        error: "SHIFT_NOT_OPEN",
        message: "No hay turno abierto en esta caja.",
      },
    };
  }
  return {
    tableId: table.id,
    storeId: table.storeId,
    registerId: cashier.rid,
    shiftId: shift.id,
  };
}

const DRAFT_INCLUDE = {
  lines: true,
  table: { select: { id: true, name: true, zone: true, capacity: true } },
} as const;

async function getOrCreateDraftTicket(
  prisma: ReturnType<typeof getPrisma>,
  ctx: TableContextOk,
  cashierUserId: string,
  diners: number | null,
) {
  const existing = await prisma.ticket.findFirst({
    where: { tableId: ctx.tableId, status: "DRAFT" },
    include: DRAFT_INCLUDE,
  });
  if (existing) {
    if (diners != null && existing.diners == null) {
      // Backfill el dato si el cajero lo introduce más tarde.
      return prisma.ticket.update({
        where: { id: existing.id },
        data: { diners },
        include: DRAFT_INCLUDE,
      });
    }
    return existing;
  }
  const tenant = await prisma.table.findUniqueOrThrow({
    where: { id: ctx.tableId },
    select: { store: { select: { tenantId: true } } },
  });
  return prisma.ticket.create({
    data: {
      tenantId: tenant.store.tenantId,
      registerId: ctx.registerId,
      shiftId: ctx.shiftId,
      userId: cashierUserId,
      // internalNumber se asigna al pasar PAID; en DRAFT lo dejamos
      // como placeholder. Es @unique([registerId, internalNumber]), así
      // que usamos un valor único por DRAFT con prefijo "D-<uuid>".
      internalNumber: `D-${randomUUID()}`,
      externalId: randomUUID(),
      status: "DRAFT",
      total: new Prisma.Decimal(0),
      totalTax: new Prisma.Decimal(0),
      totalDiscount: new Prisma.Decimal(0),
      tableId: ctx.tableId,
      diners,
      printIntent: true,
    },
    include: DRAFT_INCLUDE,
  });
}

async function reloadDraft(
  prisma: ReturnType<typeof getPrisma>,
  ticketId: string,
) {
  return prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: DRAFT_INCLUDE,
  });
}

async function recomputeTicketTotals(
  tx: Prisma.TransactionClient,
  ticketId: string,
) {
  const lines = await tx.ticketLine.findMany({
    where: { ticketId },
    select: {
      units: true,
      unitPrice: true,
      discountPct: true,
      taxRate: true,
    },
  });
  const totals = computeTicket(
    lines.map((l) => ({
      units: Number(l.units),
      unitPrice: Number(l.unitPrice),
      discountPct: Number(l.discountPct),
      taxRate: Number(l.taxRate),
    })),
  );
  return tx.ticket.update({
    where: { id: ticketId },
    data: {
      total: new Prisma.Decimal(totals.total),
      totalTax: new Prisma.Decimal(totals.tax),
      totalDiscount: new Prisma.Decimal(totals.discount),
    },
    include: DRAFT_INCLUDE,
  });
}

interface SerializedDraft {
  id: string;
  status: string;
  externalId: string;
  tableId: string | null;
  table: { id: string; name: string; zone: string; capacity: number } | null;
  diners: number | null;
  total: string;
  totalTax: string;
  totalDiscount: string;
  createdAt: string;
  lines: Array<{
    id: string;
    sku: string;
    nameSnapshot: string;
    units: string;
    unitPrice: string;
    discountPct: string;
    taxRate: string;
    subtotal: string;
    total: string;
    modifiers: string[] | null;
  }>;
}

function serializeDraft(
  t: Awaited<ReturnType<typeof reloadDraft>>,
): SerializedDraft {
  return {
    id: t.id,
    status: t.status,
    externalId: t.externalId,
    tableId: t.tableId,
    table: t.table
      ? {
          id: t.table.id,
          name: t.table.name,
          zone: t.table.zone,
          capacity: t.table.capacity,
        }
      : null,
    diners: t.diners,
    total: t.total.toString(),
    totalTax: t.totalTax.toString(),
    totalDiscount: t.totalDiscount.toString(),
    createdAt: t.createdAt.toISOString(),
    lines: t.lines.map((l) => ({
      id: l.id,
      sku: l.sku,
      nameSnapshot: l.nameSnapshot,
      units: l.units.toString(),
      unitPrice: l.unitPrice.toString(),
      discountPct: l.discountPct.toString(),
      taxRate: l.taxRate.toString(),
      subtotal: l.subtotal.toString(),
      total: l.total.toString(),
      modifiers: Array.isArray(l.modifiers)
        ? (l.modifiers as string[])
        : null,
    })),
  };
}
