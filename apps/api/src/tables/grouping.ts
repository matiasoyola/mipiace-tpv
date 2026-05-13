// Mover líneas entre mesas + agrupar / desagrupar mesas (B7 §5).
//
//   POST /tickets/:sourceTicketId/lines/move    — mueve líneas a otra mesa
//   POST /tables/:mainTableId/group             — absorbe N mesas en una
//   POST /tables/:mainTableId/ungroup           — revierte el grupo
//
// Todos requireCashierSession. La validación de pertenencia tenant +
// register se hace en cada endpoint para mantener el aislamiento
// multi-tenant que B1/B2 exigieron.

import { randomUUID } from "node:crypto";

import { Prisma } from "@mipiacetpv/db";
import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { getStoreEventBus } from "../realtime/store-event-bus.js";
import { requireCashierSession } from "../shift/cashier-session.js";
import { computeTicket } from "../tickets/totals.js";

export async function registerTableGroupingRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── Mover líneas entre mesas ───────────────────────────────────────
  app.post(
    "/tickets/:sourceTicketId/lines/move",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["sourceTicketId"],
          properties: { sourceTicketId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["lineIds", "destinationTableId"],
          additionalProperties: false,
          properties: {
            lineIds: {
              type: "array",
              minItems: 1,
              items: { type: "string", format: "uuid" },
              maxItems: 50,
            },
            destinationTableId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { sourceTicketId } = request.params as { sourceTicketId: string };
      const body = request.body as {
        lineIds: string[];
        destinationTableId: string;
      };
      const prisma = getPrisma();

      const source = await prisma.ticket.findFirst({
        where: {
          id: sourceTicketId,
          tenantId: cashier.tid,
          status: "DRAFT",
        },
        select: {
          id: true,
          registerId: true,
          shiftId: true,
          tableId: true,
        },
      });
      if (!source) {
        return reply.code(404).send({
          error: "TICKET_NOT_FOUND_OR_NOT_DRAFT",
          message: "Sólo se pueden mover líneas de un ticket DRAFT.",
        });
      }
      if (source.registerId !== cashier.rid) {
        return reply.code(403).send({
          error: "REGISTER_MISMATCH",
          message: "El ticket origen no pertenece a tu caja.",
        });
      }
      const destinationTable = await prisma.table.findFirst({
        where: {
          id: body.destinationTableId,
          deletedAt: null,
          store: { tenantId: cashier.tid },
        },
        select: { id: true, storeId: true },
      });
      if (!destinationTable) {
        return reply.code(404).send({
          error: "DESTINATION_TABLE_NOT_FOUND",
          message: "La mesa de destino no existe.",
        });
      }

      // Cargamos las líneas concretas para validar que pertenecen al
      // origen y para registrar el `originalTableId` correctamente.
      const lines = await prisma.ticketLine.findMany({
        where: { id: { in: body.lineIds }, ticketId: source.id },
        select: { id: true, originalTableId: true },
      });
      if (lines.length !== body.lineIds.length) {
        return reply.code(400).send({
          error: "LINE_NOT_FOUND",
          message: "Una o más líneas no pertenecen al ticket origen.",
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        // Asegura DRAFT en la mesa destino. Si no hay, lo crea.
        let destinationTicket = await tx.ticket.findFirst({
          where: {
            tableId: destinationTable.id,
            status: "DRAFT",
          },
          select: { id: true, shiftId: true, registerId: true },
        });
        if (!destinationTicket) {
          destinationTicket = await tx.ticket.create({
            data: {
              tenantId: cashier.tid,
              registerId: source.registerId,
              shiftId: source.shiftId,
              userId: cashier.sub,
              internalNumber: `D-${randomUUID()}`,
              externalId: randomUUID(),
              status: "DRAFT",
              total: new Prisma.Decimal(0),
              totalTax: new Prisma.Decimal(0),
              totalDiscount: new Prisma.Decimal(0),
              tableId: destinationTable.id,
              printIntent: true,
            },
            select: { id: true, shiftId: true, registerId: true },
          });
        }
        if (destinationTicket.registerId !== source.registerId) {
          throw new RegisterMismatchError();
        }
        // Mueve cada línea: cambia ticketId y registra el origen sólo
        // si no estaba ya marcado (preservamos la primera mudanza
        // histórica para reverso).
        for (const line of lines) {
          await tx.ticketLine.update({
            where: { id: line.id },
            data: {
              ticketId: destinationTicket.id,
              originalTableId: line.originalTableId ?? source.tableId,
            },
          });
        }
        const sourceTotals = await totalsFromLines(tx, source.id);
        const destinationTotals = await totalsFromLines(tx, destinationTicket.id);
        await tx.ticket.update({
          where: { id: source.id },
          data: {
            total: new Prisma.Decimal(sourceTotals.total),
            totalTax: new Prisma.Decimal(sourceTotals.tax),
            totalDiscount: new Prisma.Decimal(sourceTotals.discount),
          },
        });
        await tx.ticket.update({
          where: { id: destinationTicket.id },
          data: {
            total: new Prisma.Decimal(destinationTotals.total),
            totalTax: new Prisma.Decimal(destinationTotals.tax),
            totalDiscount: new Prisma.Decimal(destinationTotals.discount),
          },
        });
        return {
          sourceTicketId: source.id,
          destinationTicketId: destinationTicket.id,
          movedLineIds: lines.map((l) => l.id),
        };
      });

      getStoreEventBus().broadcast(destinationTable.storeId, {
        type: "table.linesMoved",
        sourceTableId: source.tableId,
        destinationTableId: destinationTable.id,
        lineIds: result.movedLineIds,
        at: new Date().toISOString(),
      });
      request.log.info(
        {
          event: "table.linesMoved",
          tenantId: cashier.tid,
          cashierId: cashier.sub,
          sourceTableId: source.tableId,
          destinationTableId: destinationTable.id,
          lineIds: result.movedLineIds,
        },
        "Líneas movidas entre mesas",
      );
      return reply.code(200).send(result);
    },
  );

  // ── Agrupar mesas (absorber) ───────────────────────────────────────
  app.post(
    "/tables/:mainTableId/group",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["mainTableId"],
          properties: { mainTableId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["tablesToAbsorbIds"],
          additionalProperties: false,
          properties: {
            tablesToAbsorbIds: {
              type: "array",
              minItems: 1,
              maxItems: 12,
              items: { type: "string", format: "uuid" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { mainTableId } = request.params as { mainTableId: string };
      const { tablesToAbsorbIds } = request.body as {
        tablesToAbsorbIds: string[];
      };
      const prisma = getPrisma();
      if (tablesToAbsorbIds.includes(mainTableId)) {
        return reply.code(400).send({
          error: "MAIN_TABLE_IN_LIST",
          message: "La mesa principal no puede absorberse a sí misma.",
        });
      }
      const allIds = [mainTableId, ...tablesToAbsorbIds];
      const tables = await prisma.table.findMany({
        where: {
          id: { in: allIds },
          deletedAt: null,
          store: { tenantId: cashier.tid },
        },
        select: { id: true, storeId: true, groupedIntoTableId: true },
      });
      if (tables.length !== allIds.length) {
        return reply.code(404).send({
          error: "TABLES_NOT_FOUND",
          message: "Una o más mesas no existen en tu tienda.",
        });
      }
      const storeIds = new Set(tables.map((t) => t.storeId));
      if (storeIds.size > 1) {
        return reply.code(400).send({
          error: "STORE_MISMATCH",
          message: "Sólo se pueden agrupar mesas de la misma tienda.",
        });
      }
      const alreadyGrouped = tables.find(
        (t) => t.groupedIntoTableId && t.id !== mainTableId,
      );
      if (alreadyGrouped) {
        return reply.code(409).send({
          error: "TABLE_ALREADY_GROUPED",
          message:
            "Una de las mesas ya forma parte de otro grupo. Desagrúpala primero.",
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        // Asegura DRAFT en la mesa principal (si no había, la abrimos).
        let mainTicket = await tx.ticket.findFirst({
          where: { tableId: mainTableId, status: "DRAFT" },
          select: { id: true, shiftId: true, registerId: true },
        });
        if (!mainTicket) {
          mainTicket = await tx.ticket.create({
            data: {
              tenantId: cashier.tid,
              registerId: cashier.rid,
              shiftId: (await tx.shift.findFirstOrThrow({
                where: { registerId: cashier.rid, closedAt: null },
                orderBy: { openedAt: "desc" },
                select: { id: true },
              })).id,
              userId: cashier.sub,
              internalNumber: `D-${randomUUID()}`,
              externalId: randomUUID(),
              status: "DRAFT",
              total: new Prisma.Decimal(0),
              totalTax: new Prisma.Decimal(0),
              totalDiscount: new Prisma.Decimal(0),
              tableId: mainTableId,
              printIntent: true,
            },
            select: { id: true, shiftId: true, registerId: true },
          });
        }

        const absorbedTickets = await tx.ticket.findMany({
          where: {
            tableId: { in: tablesToAbsorbIds },
            status: "DRAFT",
          },
          select: { id: true, tableId: true, registerId: true },
        });
        for (const absorbed of absorbedTickets) {
          if (absorbed.registerId !== mainTicket.registerId) {
            throw new RegisterMismatchError();
          }
          // Mueve todas las líneas y marca el ticket VOIDED.
          await tx.ticketLine.updateMany({
            where: { ticketId: absorbed.id, originalTableId: null },
            data: { originalTableId: absorbed.tableId },
          });
          await tx.ticketLine.updateMany({
            where: { ticketId: absorbed.id },
            data: { ticketId: mainTicket.id },
          });
          await tx.ticket.update({
            where: { id: absorbed.id },
            data: {
              status: "VOIDED",
              notes: `[AGRUPADA EN ${mainTableId}]`,
            },
          });
        }
        await tx.table.updateMany({
          where: { id: { in: tablesToAbsorbIds } },
          data: { groupedIntoTableId: mainTableId },
        });
        const totals = await totalsFromLines(tx, mainTicket.id);
        await tx.ticket.update({
          where: { id: mainTicket.id },
          data: {
            total: new Prisma.Decimal(totals.total),
            totalTax: new Prisma.Decimal(totals.tax),
            totalDiscount: new Prisma.Decimal(totals.discount),
          },
        });
        return {
          mainTicketId: mainTicket.id,
          mainTableId,
          absorbedTableIds: tablesToAbsorbIds,
          voidedTicketIds: absorbedTickets.map((a) => a.id),
        };
      });

      // Resuelvo storeId para el broadcast (todas comparten el mismo
      // por la validación de §1 de este endpoint).
      const storeId = tables[0]!.storeId;
      getStoreEventBus().broadcast(storeId, {
        type: "table.grouped",
        mainTableId,
        absorbedTableIds: result.absorbedTableIds,
        at: new Date().toISOString(),
      });
      request.log.info(
        {
          event: "table.grouped",
          tenantId: cashier.tid,
          cashierId: cashier.sub,
          mainTableId,
          absorbedTableIds: result.absorbedTableIds,
        },
        "Mesas agrupadas",
      );
      return reply.code(200).send(result);
    },
  );

  // ── Desagrupar mesas ──────────────────────────────────────────────
  app.post(
    "/tables/:mainTableId/ungroup",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["mainTableId"],
          properties: { mainTableId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { mainTableId } = request.params as { mainTableId: string };
      const prisma = getPrisma();
      const main = await prisma.table.findFirst({
        where: {
          id: mainTableId,
          deletedAt: null,
          store: { tenantId: cashier.tid },
        },
        select: { id: true },
      });
      if (!main) {
        return reply.code(404).send({
          error: "MAIN_TABLE_NOT_FOUND",
          message: "Mesa principal no encontrada",
        });
      }
      const mainTicket = await prisma.ticket.findFirst({
        where: { tableId: mainTableId, status: "DRAFT" },
        select: { id: true, registerId: true, shiftId: true },
      });
      if (!mainTicket) {
        return reply.code(409).send({
          error: "MAIN_TICKET_NOT_DRAFT",
          message: "La mesa principal no tiene un ticket abierto.",
        });
      }
      if (mainTicket.registerId !== cashier.rid) {
        return reply.code(403).send({
          error: "REGISTER_MISMATCH",
          message: "El ticket principal no pertenece a tu caja.",
        });
      }
      const absorbedTables = await prisma.table.findMany({
        where: { groupedIntoTableId: mainTableId },
        select: { id: true },
      });
      if (absorbedTables.length === 0) {
        return reply.code(409).send({
          error: "NOTHING_TO_UNGROUP",
          message: "Esta mesa no tiene mesas absorbidas.",
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        const restored: Array<{ tableId: string; ticketId: string }> = [];
        for (const t of absorbedTables) {
          const movedLines = await tx.ticketLine.findMany({
            where: { ticketId: mainTicket.id, originalTableId: t.id },
            select: { id: true },
          });
          if (movedLines.length === 0) {
            // Mesa absorbida vacía → sólo limpiar el groupedInto.
            continue;
          }
          const newTicket = await tx.ticket.create({
            data: {
              tenantId: cashier.tid,
              registerId: mainTicket.registerId,
              shiftId: mainTicket.shiftId,
              userId: cashier.sub,
              internalNumber: `D-${randomUUID()}`,
              externalId: randomUUID(),
              status: "DRAFT",
              total: new Prisma.Decimal(0),
              totalTax: new Prisma.Decimal(0),
              totalDiscount: new Prisma.Decimal(0),
              tableId: t.id,
              printIntent: true,
            },
            select: { id: true },
          });
          await tx.ticketLine.updateMany({
            where: { id: { in: movedLines.map((l) => l.id) } },
            data: { ticketId: newTicket.id, originalTableId: null },
          });
          const totals = await totalsFromLines(tx, newTicket.id);
          await tx.ticket.update({
            where: { id: newTicket.id },
            data: {
              total: new Prisma.Decimal(totals.total),
              totalTax: new Prisma.Decimal(totals.tax),
              totalDiscount: new Prisma.Decimal(totals.discount),
            },
          });
          restored.push({ tableId: t.id, ticketId: newTicket.id });
        }
        await tx.table.updateMany({
          where: { groupedIntoTableId: mainTableId },
          data: { groupedIntoTableId: null },
        });
        const mainTotals = await totalsFromLines(tx, mainTicket.id);
        await tx.ticket.update({
          where: { id: mainTicket.id },
          data: {
            total: new Prisma.Decimal(mainTotals.total),
            totalTax: new Prisma.Decimal(mainTotals.tax),
            totalDiscount: new Prisma.Decimal(mainTotals.discount),
          },
        });
        return restored;
      });

      const storeForBroadcast = await prisma.table.findUnique({
        where: { id: mainTableId },
        select: { storeId: true },
      });
      if (storeForBroadcast) {
        getStoreEventBus().broadcast(storeForBroadcast.storeId, {
          type: "table.ungrouped",
          mainTableId,
          at: new Date().toISOString(),
        });
      }
      request.log.info(
        {
          event: "table.ungrouped",
          tenantId: cashier.tid,
          cashierId: cashier.sub,
          mainTableId,
          restoredCount: result.length,
        },
        "Mesas desagrupadas",
      );
      return reply.code(200).send({ mainTableId, restored: result });
    },
  );
}

class RegisterMismatchError extends Error {
  constructor() {
    super("register mismatch");
  }
}

async function totalsFromLines(tx: Prisma.TransactionClient, ticketId: string) {
  const lines = await tx.ticketLine.findMany({
    where: { ticketId },
    select: {
      units: true,
      unitPrice: true,
      discountPct: true,
      taxRate: true,
    },
  });
  return computeTicket(
    lines.map((l) => ({
      units: Number(l.units),
      unitPrice: Number(l.unitPrice),
      discountPct: Number(l.discountPct),
      taxRate: Number(l.taxRate),
    })),
  );
}
