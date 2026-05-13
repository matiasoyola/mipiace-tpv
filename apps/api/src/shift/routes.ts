import type { FastifyInstance } from "fastify";

import { Prisma } from "@mipiacetpv/db";

import { getPrisma } from "../context.js";
import { verifyPassword } from "../auth/passwords.js";
import { getTenantHealthStatus } from "../tickets/health.js";
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

      // B6 §3.2: si el tenant está bloqueado (sin API key o >48h sin
      // sync), no permitimos abrir turno. El cobro local sigue funcionando
      // (en turnos ya abiertos antes del bloqueo), pero no se abren
      // nuevos hasta que el propietario reconecte Holded.
      const health = await getTenantHealthStatus(prisma, cashier.tid, now);
      if (health.level === "blocked") {
        return reply.code(409).send({
          error: "TENANT_BLOCKED",
          message:
            health.reason === "no_api_key"
              ? "Falta la API Key de Holded. Avisa al propietario para reconectarla."
              : "Llevamos más de 48h sin sincronizar con Holded. Contacta soporte.",
          reason: health.reason,
          blockedAt: health.blockedAt,
          lastSuccessfulSyncAt: health.lastSuccessfulSyncAt,
        });
      }

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

      // B6 §3.2: cerrar turno también requiere health no bloqueado. Si
      // estamos en `blocked`, el cierre dispararía la generación del Z
      // y la marcación de tickets sin posibilidad de sync — preferimos
      // que el cajero llame a soporte. Cuando el tenant vuelva a `ok` o
      // `warning`, el cierre fluye normal.
      const health = await getTenantHealthStatus(prisma, cashier.tid);
      if (health.level === "blocked") {
        return reply.code(409).send({
          error: "TENANT_BLOCKED",
          message:
            health.reason === "no_api_key"
              ? "Falta la API Key de Holded. El propietario debe reconectarla antes de cerrar el turno."
              : "Llevamos más de 48h sin sincronizar con Holded. Contacta soporte antes de cerrar el turno.",
          reason: health.reason,
          blockedAt: health.blockedAt,
          lastSuccessfulSyncAt: health.lastSuccessfulSyncAt,
        });
      }

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

      // Health-check de sync. Cuenta tickets+refunds del shift con sync
      // pendiente o fallida.
      const ticketIssues = await prisma.ticket.groupBy({
        by: ["status"],
        where: { shiftId: shift.id, status: { in: ["PENDING_SYNC", "SYNC_FAILED"] } },
        _count: true,
      });
      const refundIssues = await prisma.refund.groupBy({
        by: ["status"],
        where: { shiftId: shift.id, status: { in: ["PENDING_SYNC", "SYNC_FAILED"] } },
        _count: true,
      });
      const pendingSync =
        (ticketIssues.find((i) => i.status === "PENDING_SYNC")?._count ?? 0) +
        (refundIssues.find((i) => i.status === "PENDING_SYNC")?._count ?? 0);
      const failed =
        (ticketIssues.find((i) => i.status === "SYNC_FAILED")?._count ?? 0) +
        (refundIssues.find((i) => i.status === "SYNC_FAILED")?._count ?? 0);
      const hasSyncIssues = pendingSync > 0 || failed > 0;
      if (hasSyncIssues && !body.syncFailureAccepted) {
        // Devolvemos también la lista breve de tickets/refunds fallados
        // para que el modal de cierre muestre la tabla con badge rojo
        // (B5 §2.3). Sólo los SYNC_FAILED; los PENDING_SYNC son
        // técnicamente transitorios y no requieren intervención manual.
        const failedTickets = await prisma.ticket.findMany({
          where: { shiftId: shift.id, status: "SYNC_FAILED" },
          select: {
            id: true,
            internalNumber: true,
            total: true,
            syncError: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        const failedRefunds = await prisma.refund.findMany({
          where: { shiftId: shift.id, status: "SYNC_FAILED" },
          select: {
            id: true,
            internalNumber: true,
            total: true,
            syncError: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        return reply.code(409).send({
          error: "SYNC_PENDING",
          message:
            "Hay tickets sin sincronizar con Holded. Pide autorización del encargado y vuelve a confirmar.",
          pendingSync,
          failed,
          failedTickets: failedTickets.map((t) => ({
            id: t.id,
            kind: "ticket" as const,
            internalNumber: t.internalNumber,
            total: Number(t.total.toString()),
            createdAt: t.createdAt.toISOString(),
            errorSummary: brieflyDescribeError(t.syncError),
          })),
          failedRefunds: failedRefunds.map((r) => ({
            id: r.id,
            kind: "refund" as const,
            internalNumber: r.internalNumber,
            total: Number(r.total.toString()),
            createdAt: r.createdAt.toISOString(),
            errorSummary: brieflyDescribeError(r.syncError),
          })),
        });
      }

      // PIN encargado: lo exigimos en dos escenarios distintos.
      //   (a) Cierre forzado (actor != owner del shift): la política
      //       histórica de B3 — requireManagerPinForForceClose.
      //   (b) B5 §2.3: si hay SYNC_FAILED en el turno aunque el actor
      //       sea el propio cajero. El encargado debe confirmar que
      //       conoce los errores y se hace cargo (queda en log y en
      //       el Z PDF como audit trail).
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: cashier.tid },
        select: { requireManagerPinForForceClose: true },
      });
      const actorIsManager = cashier.role === "MANAGER";
      const needForceClosePin =
        !isOwnerOfShift && tenant.requireManagerPinForForceClose && !actorIsManager;
      const needSyncFailedPin = failed > 0 && !actorIsManager;
      let managerEmail: string | null = null;
      if (needForceClosePin || needSyncFailedPin) {
        if (!body.managerPin) {
          return reply.code(403).send({
            error: "MANAGER_PIN_REQUIRED",
            message: needSyncFailedPin
              ? "Hay tickets rechazados por Holded en este turno. Necesitas el PIN del encargado para cerrarlo."
              : "Este cierre forzado requiere PIN de encargado.",
            reason: needSyncFailedPin ? "sync_failed" : "force_close",
          });
        }
        // B7 §9: aceptamos PIN de OWNER (auto-generado al login admin)
        // además del de MANAGER. Desbloquea el caso "1 dueño + 1
        // cajero" sin necesidad de crear un MANAGER de respaldo.
        const managers = await prisma.user.findMany({
          where: {
            tenantId: cashier.tid,
            role: { in: ["MANAGER", "OWNER"] },
            pinHash: { not: null },
          },
          select: { id: true, email: true, pinHash: true },
        });
        let authorized: { id: string; email: string } | null = null;
        for (const m of managers) {
          if (m.pinHash && (await verifyPassword(m.pinHash, body.managerPin))) {
            authorized = { id: m.id, email: m.email };
            break;
          }
        }
        if (!authorized) {
          return reply.code(403).send({
            error: "INVALID_MANAGER_PIN",
            message: "PIN de encargado incorrecto.",
          });
        }
        managerEmail = authorized.email;
      }
      // Audit trail estructurado (B5 §2.3). Cuando montemos la tabla
      // audit_log dedicada, lo movemos allí; hoy basta con que quede
      // en pino para reconstrucción forense.
      if (managerEmail && needSyncFailedPin) {
        request.log.info(
          {
            event: "shift.close.sync_failed_accepted",
            shiftId: shift.id,
            registerId: shift.register.id,
            cashierUserId: cashier.sub,
            managerUserEmail: managerEmail,
            failedCount: failed,
            pendingSyncCount: pendingSync,
          },
          "encargado autorizó cierre con SYNC_FAILED",
        );
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
          managerAuthorizationEmail: managerEmail,
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

// Resumen humano del syncError persistido por el worker. El frontend
// del cierre lo pinta en la tabla de tickets fallados; el endpoint de
// la bandeja admin tiene su propio formato más completo.
function brieflyDescribeError(syncError: unknown): string {
  if (!syncError || typeof syncError !== "object") return "error desconocido";
  const obj = syncError as { reason?: string; message?: string };
  if (obj.reason === "silent_reject" || obj.reason === "pay_silent_reject") {
    return "Holded descartó el documento (silent reject)";
  }
  if (obj.reason === "holded_4xx" || obj.reason === "pay_4xx") {
    return obj.message ? `${obj.reason}: ${obj.message}` : obj.reason;
  }
  if (obj.reason === "no_holded_key") return "Falta API Key";
  return obj.reason ?? "error desconocido";
}
