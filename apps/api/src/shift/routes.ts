import type { FastifyInstance } from "fastify";

import { Prisma } from "@mipiacetpv/db";

import { getPrisma } from "../context.js";
import { verifyPassword } from "../auth/passwords.js";
import { requireCashierSession } from "./cashier-session.js";
import { generateZReportPdf } from "./z-report.js";

// Body shape de close (B3 §3.4). methodTotals reportado por el cajero
// (cash, card, bizum, voucher). En B3 todavía no hay tickets reales →
// "teórico" = 0 y "contado" = lo que el cajero indique; descuadre por
// método se calcula sólo para cash (el resto no se cuenta físicamente).
interface MethodTotalsBody {
  CASH?: number;
  CARD?: number;
  BIZUM?: number;
  VOUCHER?: number;
}

export async function registerShiftRoutes(app: FastifyInstance): Promise<void> {
  // Devuelve el turno abierto en la caja del cajero, si existe. Lo usa
  // la PWA en B4 para resolver `shiftId` cuando vuelve a la SalePage
  // tras abrir/reanudar el turno — sin él, B3 pintaba "pending-refresh".
  app.get(
    "/shift/current",
    { preHandler: requireCashierSession },
    async (request) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const shift = await prisma.shift.findFirst({
        where: { registerId: cashier.rid, closedAt: null },
        orderBy: { openedAt: "desc" },
        select: {
          id: true,
          openedAt: true,
          lastActivityAt: true,
          cashOpening: true,
          userId: true,
        },
      });
      if (!shift) return { shift: null };
      return {
        shift: {
          id: shift.id,
          openedAt: shift.openedAt.toISOString(),
          lastActivityAt: shift.lastActivityAt.toISOString(),
          cashOpening: shift.cashOpening.toString(),
          userId: shift.userId,
        },
      };
    },
  );

  app.post(
    "/shift/open",
    {
      preHandler: requireCashierSession,
      schema: {
        body: {
          type: "object",
          required: ["cashOpening"],
          additionalProperties: false,
          properties: {
            cashOpening: { type: "number", minimum: 0, maximum: 100_000 },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { cashOpening } = request.body as { cashOpening: number };
      const prisma = getPrisma();
      const now = new Date();

      // Sanity-check: no permitir abrir si ya hay uno abierto en la caja.
      const open = await prisma.shift.findFirst({
        where: { registerId: cashier.rid, closedAt: null },
        select: { id: true },
      });
      if (open) {
        return reply.code(409).send({
          error: "SHIFT_ALREADY_OPEN",
          message: "Hay un turno abierto. Reanúdalo o ciérralo antes de abrir uno nuevo.",
          openShiftId: open.id,
        });
      }

      const shift = await prisma.shift.create({
        data: {
          registerId: cashier.rid,
          userId: cashier.sub,
          cashOpening: new Prisma.Decimal(cashOpening),
          openedAt: now,
          lastActivityAt: now,
        },
        select: { id: true, openedAt: true, cashOpening: true },
      });
      return reply.code(201).send({
        shift: {
          id: shift.id,
          openedAt: shift.openedAt.toISOString(),
          cashOpening: shift.cashOpening.toString(),
        },
      });
    },
  );

  app.post(
    "/shift/:shiftId/close",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["shiftId"],
          properties: { shiftId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["cashCounted", "methodTotals"],
          additionalProperties: false,
          properties: {
            cashCounted: { type: "number", minimum: 0, maximum: 1_000_000 },
            methodTotals: {
              type: "object",
              additionalProperties: false,
              properties: {
                CASH: { type: "number" },
                CARD: { type: "number" },
                BIZUM: { type: "number" },
                VOUCHER: { type: "number" },
              },
            },
            syncFailureAccepted: { type: "boolean" },
            managerPin: { type: "string", minLength: 4, maxLength: 16 },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { shiftId } = request.params as { shiftId: string };
      const body = request.body as {
        cashCounted: number;
        methodTotals: MethodTotalsBody;
        syncFailureAccepted?: boolean;
        managerPin?: string;
      };
      const prisma = getPrisma();
      const shift = await prisma.shift.findFirst({
        where: { id: shiftId, register: { storeId: { not: undefined } } },
        select: {
          id: true,
          registerId: true,
          userId: true,
          cashOpening: true,
          openedAt: true,
          closedAt: true,
          register: {
            select: {
              id: true,
              name: true,
              store: { select: { id: true, name: true, tenantId: true } },
            },
          },
        },
      });
      if (!shift || shift.register.store.tenantId !== cashier.tid) {
        return reply
          .code(404)
          .send({ error: "SHIFT_NOT_FOUND", message: "Turno no encontrado" });
      }
      if (shift.closedAt) {
        return reply
          .code(409)
          .send({ error: "SHIFT_ALREADY_CLOSED", message: "El turno ya está cerrado" });
      }

      const isOwnerOfShift = shift.userId === cashier.sub;

      // Cierre forzado: si el actor != owner del shift, exigir PIN
      // encargado salvo que el actor ya sea MANAGER (o tenant haya
      // desactivado la exigencia).
      if (!isOwnerOfShift) {
        const tenant = await prisma.tenant.findUniqueOrThrow({
          where: { id: cashier.tid },
          select: { requireManagerPinForForceClose: true },
        });
        const actorIsManager = cashier.role === "MANAGER";
        if (tenant.requireManagerPinForForceClose && !actorIsManager) {
          if (!body.managerPin) {
            return reply.code(403).send({
              error: "MANAGER_PIN_REQUIRED",
              message: "Este cierre forzado requiere PIN de encargado.",
            });
          }
          const manager = await prisma.user.findFirst({
            where: {
              tenantId: cashier.tid,
              role: "MANAGER",
            },
            select: { id: true, pinHash: true },
          });
          // Probamos contra cualquier manager del tenant: si el PIN
          // matchea con alguno, autoriza.
          const managers = await prisma.user.findMany({
            where: { tenantId: cashier.tid, role: "MANAGER", pinHash: { not: null } },
            select: { pinHash: true },
          });
          let authorized = false;
          for (const m of managers) {
            if (m.pinHash && (await verifyPassword(m.pinHash, body.managerPin))) {
              authorized = true;
              break;
            }
          }
          if (!authorized) {
            return reply.code(403).send({
              error: "INVALID_MANAGER_PIN",
              message: "PIN de encargado incorrecto.",
            });
          }
          // referencia para typecheck — evita unused var en algunos linters.
          void manager;
        }
      }

      // Health-check de sync. Cuenta tickets del shift con sync
      // pendiente o fallida. En B3 todavía no hay POST de tickets;
      // por tanto siempre vendrá 0. Dejamos la lógica para B5+ y la
      // expone el endpoint para que el front la consuma.
      const issues = await prisma.ticket.groupBy({
        by: ["status"],
        where: { shiftId: shift.id, status: { in: ["PENDING_SYNC", "SYNC_FAILED"] } },
        _count: true,
      });
      const pendingSync =
        issues.find((i) => i.status === "PENDING_SYNC")?._count ?? 0;
      const failed = issues.find((i) => i.status === "SYNC_FAILED")?._count ?? 0;
      const hasSyncIssues = pendingSync > 0 || failed > 0;
      if (hasSyncIssues && !body.syncFailureAccepted) {
        return reply.code(409).send({
          error: "SYNC_PENDING",
          message:
            "Hay tickets sin sincronizar con Holded. Pide autorización del encargado y vuelve a confirmar.",
          pendingSync,
          failed,
        });
      }

      // Cálculo de teóricos a partir de los ticket_payments del turno
      // (B4). B3 los dejaba en 0 porque no había tickets reales; ahora
      // sí. El descuadre = real − teórico aplica sólo a CASH; el resto
      // se reporta como "diferencia frente al teórico" en el Z, sin
      // bloquear el cierre.
      const paymentTotals = await prisma.ticketPayment.groupBy({
        by: ["method"],
        where: { ticket: { shiftId: shift.id } },
        _sum: { amount: true },
      });
      const theoreticalByMethod = new Map<string, number>();
      for (const row of paymentTotals) {
        theoreticalByMethod.set(row.method, Number(row._sum.amount ?? 0));
      }
      const cashTheoretical =
        (theoreticalByMethod.get("CASH") ?? 0) + Number(shift.cashOpening);
      const methodTotals = [
        { method: "CASH", theoretical: cashTheoretical, counted: body.cashCounted },
        {
          method: "CARD",
          theoretical: theoreticalByMethod.get("CARD") ?? 0,
          counted: body.methodTotals.CARD,
        },
        {
          method: "BIZUM",
          theoretical: theoreticalByMethod.get("BIZUM") ?? 0,
          counted: body.methodTotals.BIZUM,
        },
        {
          method: "VOUCHER",
          theoretical: theoreticalByMethod.get("VOUCHER") ?? 0,
          counted: body.methodTotals.VOUCHER,
        },
      ];

      const closedAt = new Date();

      // Genera Z PDF antes de marcar closedAt — si la generación falla,
      // mantenemos el turno abierto y devolvemos error.
      const [cashierUser, closedByUser] = await Promise.all([
        prisma.user.findUniqueOrThrow({
          where: { id: shift.userId },
          select: { email: true },
        }),
        prisma.user.findUniqueOrThrow({
          where: { id: cashier.sub },
          select: { email: true },
        }),
      ]);

      let zPath: string | null = null;
      try {
        zPath = await generateZReportPdf({
          shiftId: shift.id,
          storeName: shift.register.store.name,
          registerName: shift.register.name,
          cashierLabel: cashierUser.email,
          closedByLabel: isOwnerOfShift ? null : closedByUser.email,
          openedAt: shift.openedAt,
          closedAt,
          cashOpening: Number(shift.cashOpening),
          cashCounted: body.cashCounted,
          cashTheoretical,
          methodTotals,
          ticketsCount: await prisma.ticket.count({ where: { shiftId: shift.id } }),
          refundsCount: 0, // los Refund se contarán cuando lleguen en B6.
          syncIssues: { pendingSync, failed },
          acceptedSyncFailures: body.syncFailureAccepted === true,
        });
      } catch (err) {
        request.log.error(err, "Z report generation failed");
        return reply.code(500).send({
          error: "Z_REPORT_FAILED",
          message: "No se pudo generar el informe Z. El turno sigue abierto.",
        });
      }

      const updated = await prisma.shift.update({
        where: { id: shift.id },
        data: {
          closedAt,
          cashCounted: new Prisma.Decimal(body.cashCounted),
          closedByUserId: cashier.sub,
          zReportPdfPath: zPath,
        },
        select: { id: true, closedAt: true, zReportPdfPath: true },
      });

      return reply.code(200).send({
        shift: {
          id: updated.id,
          closedAt: updated.closedAt!.toISOString(),
          zReportPdfPath: updated.zReportPdfPath,
        },
        descuadre: body.cashCounted - cashTheoretical,
        forceClose: !isOwnerOfShift,
      });
    },
  );
}
