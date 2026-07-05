import type { FastifyInstance } from "fastify";

import { Prisma } from "@mipiacetpv/db";

import { getPrisma } from "../context.js";
import { verifyPassword } from "../auth/passwords.js";
import { cashierLabelFrom } from "../users/display.js";
import { requireCashierSession } from "./cashier-session.js";
import { ALLOWED_DENOMINATIONS, validateAndSumDenominations } from "./cash-count.js";
import { generateZReportPdf } from "./z-report.js";
import { computeZBreakdown, type ZBreakdown } from "./z-breakdown.js";

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
      // Mejora-02: contador de tickets emitidos en este turno. Lo
      // usa la PWA para mostrar "Ticket #N del turno" en el header
      // del SalePage sin que el cajero tenga que abrir el historial.
      // Filtramos por status NO-DRAFT (un ticket DRAFT todavía está
      // a medio cobrar) y NO-VOIDED (anulados no cuentan como ventas).
      const ticketsCount = await prisma.ticket.count({
        where: {
          shiftId: shift.id,
          status: { notIn: ["DRAFT", "VOIDED"] },
        },
      });
      return {
        shift: {
          id: shift.id,
          openedAt: shift.openedAt.toISOString(),
          lastActivityAt: shift.lastActivityAt.toISOString(),
          cashOpening: shift.cashOpening.toString(),
          userId: shift.userId,
          ticketsCount,
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

      // v1.5-consistencia-B §3.b — decisión de producto (Matías,
      // 2026-06-11): un problema de sync NUNCA cierra el negocio. El
      // gate `blocked` de B6 §3.2 (409 TENANT_BLOCKED con >48h sin
      // sync o sin API key) desaparece de la apertura: el turno se
      // abre siempre, los tickets quedan PENDING y el sweeper los
      // subirá al reconectar. El aviso vive en el banner persistente
      // del TPV (HealthBanner, level=blocked) y en el admin — no aquí.

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
      const result = await executeShiftClose({
        prisma: getPrisma(),
        log: request.log,
        cashier,
        shiftId,
        body,
      });
      if (!result.ok) {
        return reply.code(result.status).send(result.body);
      }
      return reply.code(200).send(result.body);
    },
  );

  // v1.3-Thalia Lote 4 · POST /shift/:id/cash-count
  // Arqueo por denominaciones. kind=X = control intermedio (sólo guarda
  // y devuelve descuadre). kind=Z = cierre del turno (guarda + dispara
  // close atómicamente, un único POST del frontend). El backend re-
  // calcula `cashTotal` desde el JSON — el cliente no es de fiar.
  app.post(
    "/shift/:shiftId/cash-count",
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
          required: ["kind", "denominations"],
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["X", "Z"] },
            // Validación fuerte del shape (llaves euro) la hace el
            // helper `validateAndSumDenominations`; aquí sólo damos
            // forma genérica para que Fastify no rechace.
            denominations: { type: "object" },
            // Sólo aplican a Z (se ignoran en X).
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
        kind: "X" | "Z";
        denominations: unknown;
        syncFailureAccepted?: boolean;
        managerPin?: string;
      };
      const prisma = getPrisma();

      const validation = validateAndSumDenominations(body.denominations);
      if (!validation.ok) {
        return reply.code(400).send({
          error: "INVALID_DENOMINATIONS",
          message: validation.error ?? "denominations inválidas",
        });
      }

      const shift = await prisma.shift.findFirst({
        where: { id: shiftId },
        select: {
          id: true,
          registerId: true,
          closedAt: true,
          cashOpening: true,
          register: { select: { store: { select: { tenantId: true } } } },
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

      if (body.kind === "Z") {
        const existingZ = await prisma.shiftCashCount.findFirst({
          where: { shiftId: shift.id, kind: "Z" },
          select: { id: true },
        });
        if (existingZ) {
          return reply.code(409).send({
            error: "Z_ALREADY_EXISTS",
            message: "Ya se registró un arqueo Z para este turno.",
          });
        }
      }

      // v1.0-pilotos · Lote 3 (#28): mismo desglose que el cierre Z —
      // cash esperado = fondo inicial + efectivo NETO (ventas −
      // devoluciones en efectivo).
      const breakdown = computeZBreakdown({
        cashOpening: Number(shift.cashOpening),
        ...(await loadShiftBreakdownSums(prisma, shift.id)),
        counted: { CASH: validation.total },
      });
      const cashTheoretical = breakdown.cashTheoretical;
      const descuadre = validation.total - cashTheoretical;

      // Persistimos el arqueo SIEMPRE — para Z, también dispara el
      // close. Si el close falla (sync_pending sin aceptar, falta de
      // PIN, etc.) revertimos el ShiftCashCount con una transacción
      // que envuelve ambas operaciones.
      if (body.kind === "X") {
        await prisma.shiftCashCount.create({
          data: {
            shiftId: shift.id,
            kind: "X",
            denominations: body.denominations as object,
            cashTotal: new Prisma.Decimal(validation.total),
            createdByUserId: cashier.sub,
          },
        });
        return reply.code(201).send({
          kind: "X" as const,
          cashCounted: validation.total,
          cashTheoretical,
          descuadre,
          breakdown,
        });
      }

      // kind === "Z": delega en el flujo de cierre existente. Si el
      // cierre devuelve error (PIN, sync, etc.) NO persistimos el
      // ShiftCashCount — el cajero verá el aviso y volverá a intentar.
      const closeResult = await executeShiftClose({
        prisma,
        log: request.log,
        cashier,
        shiftId: shift.id,
        body: {
          cashCounted: validation.total,
          methodTotals: {},
          syncFailureAccepted: body.syncFailureAccepted,
          managerPin: body.managerPin,
        },
      });
      if (!closeResult.ok) {
        return reply.code(closeResult.status).send(closeResult.body);
      }
      // Cierre OK → persistimos el arqueo Z con el total recién
      // validado por el backend. El timestamp queda ligeramente
      // después del closedAt (orden: close commit → cash-count
      // commit) pero ambos viven dentro de la misma request.
      await prisma.shiftCashCount.create({
        data: {
          shiftId: shift.id,
          kind: "Z",
          denominations: body.denominations as object,
          cashTotal: new Prisma.Decimal(validation.total),
          createdByUserId: cashier.sub,
        },
      });
      return reply.code(200).send({
        kind: "Z" as const,
        cashCounted: validation.total,
        // El cierre recalcula el desglose dentro de executeShiftClose;
        // devolvemos SUS números para que el front pinte exactamente lo
        // que quedó en el Z PDF.
        cashTheoretical: closeResult.body.breakdown.cashTheoretical,
        descuadre: closeResult.body.descuadre,
        breakdown: closeResult.body.breakdown,
        shift: closeResult.body.shift,
      });
    },
  );

  // GET /shift/:id/cash-counts → histórico X+Z del turno. Útil cuando
  // el cajero quiere ver los arqueos intermedios que ya hizo.
  app.get(
    "/shift/:shiftId/cash-counts",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["shiftId"],
          properties: { shiftId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { shiftId } = request.params as { shiftId: string };
      const prisma = getPrisma();
      const shift = await prisma.shift.findFirst({
        where: { id: shiftId },
        select: { register: { select: { store: { select: { tenantId: true } } } } },
      });
      if (!shift || shift.register.store.tenantId !== cashier.tid) {
        return reply
          .code(404)
          .send({ error: "SHIFT_NOT_FOUND", message: "Turno no encontrado" });
      }
      const counts = await prisma.shiftCashCount.findMany({
        where: { shiftId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          denominations: true,
          cashTotal: true,
          createdAt: true,
          createdByUserId: true,
        },
      });
      return {
        items: counts.map((c) => ({
          id: c.id,
          kind: c.kind,
          denominations: c.denominations,
          cashTotal: Number(c.cashTotal.toString()),
          createdAt: c.createdAt.toISOString(),
          createdByUserId: c.createdByUserId,
        })),
        allowedDenominations: ALLOWED_DENOMINATIONS,
      };
    },
  );
}

// Resultado de `executeShiftClose`. Encapsula success/error en una
// shape que cada caller (handler /close, handler /cash-count Z)
// serializa a su gusto. Evita acoplarse a FastifyReply para poder
// componerlo (kind=Z dentro de cash-count llama a esta función).
type ExecuteShiftCloseResult =
  | {
      ok: true;
      body: Record<string, unknown> & {
        shift: Record<string, unknown>;
        descuadre: number;
        breakdown: ZBreakdown;
      };
    }
  | { ok: false; status: number; body: Record<string, unknown> };

async function executeShiftClose(args: {
  prisma: ReturnType<typeof getPrisma>;
  log: { info: (obj: object, msg: string) => void; error: (obj: unknown, msg?: string) => void };
  cashier: { tid: string; rid: string; sub: string; role: "OWNER" | "MANAGER" | "CASHIER" };
  shiftId: string;
  body: {
    cashCounted: number;
    methodTotals: MethodTotalsBody;
    syncFailureAccepted?: boolean;
    managerPin?: string;
  };
}): Promise<ExecuteShiftCloseResult> {
  const { prisma, log, cashier, shiftId, body } = args;

  // v1.5-consistencia-B §3.b — el gate `blocked` de B6 §3.2 también
  // desaparece del cierre (decisión de producto: un problema de sync
  // nunca cierra el negocio). El cierre con tickets sin sincronizar ya
  // está cubierto por el flujo SYNC_PENDING + syncFailureAccepted de
  // más abajo (lista, aceptación explícita y PIN si hay SYNC_FAILED);
  // los pendientes los recupera el sweeper al reconectar.

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
    return {
      ok: false,
      status: 404,
      body: { error: "SHIFT_NOT_FOUND", message: "Turno no encontrado" },
    };
  }
  if (shift.closedAt) {
    return {
      ok: false,
      status: 409,
      body: { error: "SHIFT_ALREADY_CLOSED", message: "El turno ya está cerrado" },
    };
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
    return {
      ok: false,
      status: 409,
      body: {
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
      },
    };
  }

  // PIN encargado: lo exigimos en dos escenarios distintos.
  //   (a) Cierre forzado (actor != owner del shift): la política
  //       histórica de B3 — requireManagerPinForForceClose.
  //   (b) B5 §2.3: si hay SYNC_FAILED en el turno aunque el actor
  //       sea el propio cajero. El encargado debe confirmar que
  //       conoce los errores y se hace cargo (queda en log y en
  //       el Z PDF como audit trail).
  //
  // v1.4-Bugs-Operativos Lote 1 · regla nueva: el PIN aceptado por
  // defecto es el del USER autenticado en la cashierSession. Antes
  // exigíamos MANAGER/OWNER, lo que obligaba a la propietaria a estar
  // presente cada vez que un cajero quería cerrar (Peluquería Sole con
  // empleada fija). El tenant puede opt-in al comportamiento histórico
  // con `requireOwnerPinForCashClose=true` para restringir a OWNER/MANAGER.
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: cashier.tid },
    select: {
      requireManagerPinForForceClose: true,
      requireOwnerPinForCashClose: true,
    },
  });
  const actorIsManagerOrOwner =
    cashier.role === "MANAGER" || cashier.role === "OWNER";
  const needForceClosePin =
    !isOwnerOfShift && tenant.requireManagerPinForForceClose && !actorIsManagerOrOwner;
  const needSyncFailedPin = failed > 0 && !actorIsManagerOrOwner;
  let managerEmail: string | null = null;
  let managerAlias: string | null = null;
  let pinAuthorizationKind: "self" | "manager" | null = null;
  if (needForceClosePin || needSyncFailedPin) {
    if (!body.managerPin) {
      return {
        ok: false,
        status: 403,
        body: {
          error: "MANAGER_PIN_REQUIRED",
          message: needSyncFailedPin
            ? "Hay tickets rechazados por Holded en este turno. Necesitas el PIN del cajero (o del encargado) para cerrarlo."
            : "Este cierre forzado requiere PIN del cajero (o del encargado).",
          reason: needSyncFailedPin ? "sync_failed" : "force_close",
        },
      };
    }
    // 1) Default: el PIN del cajero autenticado vale.
    // 2) Back-compat: si el opt-in `requireOwnerPinForCashClose` está
    //    OFF (default), también aceptamos un PIN de OWNER/MANAGER
    //    cualquiera del tenant — útil para "encargado físicamente
    //    presente" que teclea su PIN en la PWA del cajero.
    // 3) Opt-in ON: sólo OWNER/MANAGER. Mantiene la política histórica
    //    para tenants pequeños que quieran este control.
    const candidates = await prisma.user.findMany({
      where: {
        tenantId: cashier.tid,
        OR: [
          { id: cashier.sub },
          { role: { in: ["MANAGER", "OWNER"] } },
        ],
        pinHash: { not: null },
      },
      select: { id: true, email: true, alias: true, role: true, pinHash: true },
    });
    const eligible = tenant.requireOwnerPinForCashClose
      ? candidates.filter((c) => c.role === "MANAGER" || c.role === "OWNER")
      : candidates;
    let authorized: {
      id: string;
      email: string;
      alias: string | null;
      isSelf: boolean;
    } | null = null;
    for (const c of eligible) {
      if (c.pinHash && (await verifyPassword(c.pinHash, body.managerPin))) {
        authorized = {
          id: c.id,
          email: c.email,
          alias: c.alias,
          isSelf: c.id === cashier.sub,
        };
        break;
      }
    }
    if (!authorized) {
      return {
        ok: false,
        status: 403,
        body: {
          error: "INVALID_MANAGER_PIN",
          message: tenant.requireOwnerPinForCashClose
            ? "PIN de encargado incorrecto."
            : "PIN incorrecto. Usa tu PIN de cajero o el del encargado.",
        },
      };
    }
    managerEmail = authorized.email;
    managerAlias = authorized.alias;
    pinAuthorizationKind = authorized.isSelf ? "self" : "manager";
  }
  // Audit trail estructurado (B5 §2.3). Cuando montemos la tabla
  // audit_log dedicada, lo movemos allí; hoy basta con que quede
  // en pino para reconstrucción forense.
  if (managerEmail && needSyncFailedPin) {
    log.info(
      {
        event: "shift.close.sync_failed_accepted",
        shiftId: shift.id,
        registerId: shift.register.id,
        cashierUserId: cashier.sub,
        authorizationEmail: managerEmail,
        authorizationKind: pinAuthorizationKind,
        failedCount: failed,
        pendingSyncCount: pendingSync,
      },
      pinAuthorizationKind === "self"
        ? "cajero autorizó su propio cierre con SYNC_FAILED"
        : "encargado autorizó cierre con SYNC_FAILED",
    );
  }

  // Cálculo de teóricos a partir de los ticket_payments del turno
  // (B4). v1.0-pilotos · Lote 3 (#28): el desglose ahora separa ventas
  // brutas y devoluciones por método (computeZBreakdown) y el teórico
  // de CASH resta las devoluciones en efectivo — ese dinero SALE del
  // cajón y antes el descuadre lo culpaba al cajero.
  const breakdown = computeZBreakdown({
    cashOpening: Number(shift.cashOpening),
    ...(await loadShiftBreakdownSums(prisma, shift.id)),
    counted: {
      CASH: body.cashCounted,
      ...(body.methodTotals.CARD != null ? { CARD: body.methodTotals.CARD } : {}),
      ...(body.methodTotals.BIZUM != null ? { BIZUM: body.methodTotals.BIZUM } : {}),
      ...(body.methodTotals.VOUCHER != null
        ? { VOUCHER: body.methodTotals.VOUCHER }
        : {}),
    },
  });
  const cashTheoretical = breakdown.cashTheoretical;

  const closedAt = new Date();

  // Genera Z PDF antes de marcar closedAt — si la generación falla,
  // mantenemos el turno abierto y devolvemos error.
  const [cashierUser, closedByUser] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: shift.userId },
      select: { email: true, alias: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: cashier.sub },
      select: { email: true, alias: true },
    }),
  ]);

  let zPath: string | null = null;
  try {
    zPath = await generateZReportPdf({
      shiftId: shift.id,
      storeName: shift.register.store.name,
      registerName: shift.register.name,
      // v1.7-alias-cajeros: alias en el Z; fallback a la local-part
      // del email para users legacy sin alias.
      cashierLabel: cashierLabelFrom(cashierUser),
      closedByLabel: isOwnerOfShift ? null : cashierLabelFrom(closedByUser),
      openedAt: shift.openedAt,
      closedAt,
      cashOpening: Number(shift.cashOpening),
      cashCounted: body.cashCounted,
      cashTheoretical,
      breakdown,
      // Emitidos de verdad: DRAFT (mesa sin cobrar) y VOIDED (vaciada/
      // agrupada) no son ventas.
      ticketsCount: await prisma.ticket.count({
        where: { shiftId: shift.id, status: { notIn: ["DRAFT", "VOIDED"] } },
      }),
      // v1.9.5-formacion · Frente 1: las devoluciones TEST computan en el
      // Z del turno de prueba igual que las ventas TEST (cuyos pagos ya
      // entran al desglose sin filtro de status). Coherencia formativa: si
      // la venta test aparece en el Z, su devolución también. En turnos
      // reales no hay refunds TEST, así que esto no altera el Z de producción.
      refundsCount: await prisma.refund.count({
        where: { shiftId: shift.id, status: { notIn: ["DRAFT", "VOIDED"] } },
      }),
      syncIssues: { pendingSync, failed },
      acceptedSyncFailures: body.syncFailureAccepted === true,
      managerAuthorizationEmail: managerEmail,
      managerAuthorizationAlias: managerAlias,
    });
  } catch (err) {
    log.error(err, "Z report generation failed");
    return {
      ok: false,
      status: 500,
      body: {
        error: "Z_REPORT_FAILED",
        message: "No se pudo generar el informe Z. El turno sigue abierto.",
      },
    };
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

  return {
    ok: true,
    body: {
      shift: {
        id: updated.id,
        closedAt: updated.closedAt!.toISOString(),
        zReportPdfPath: updated.zReportPdfPath,
      },
      descuadre: body.cashCounted - cashTheoretical,
      breakdown,
      forceClose: !isOwnerOfShift,
    },
  };
}

// Σ pagos y Σ devoluciones del turno agrupados por método, en EUR.
// Input de `computeZBreakdown` — lo usan el cierre Z y el arqueo X.
async function loadShiftBreakdownSums(
  prisma: ReturnType<typeof getPrisma>,
  shiftId: string,
): Promise<{
  paymentsByMethod: Record<string, number>;
  refundsByMethod: Record<string, number>;
  creditCollectionsByMethod: Record<string, number>;
  creditSales: { count: number; total: number };
}> {
  const [paymentTotals, refundTotals, creditCollectionTotals, creditSalesAgg] =
    await Promise.all([
      // Ventas normales del turno: pagos de tickets vendidos AQUÍ que NO
      // son cobros de deuda (collectedInShiftId null). Excluir los cobros
      // de deuda evita contarlos dos veces (van en su propia sección) y
      // que un fiado saldado en otro turno contamine el de la venta.
      prisma.ticketPayment.groupBy({
        by: ["method"],
        where: { ticket: { shiftId }, collectedInShiftId: null },
        _sum: { amount: true },
      }),
      // v1.9.5-formacion · Frente 1: incluye refunds TEST en el desglose
      // (coherente con las ventas TEST, cuyos pagos no se filtran por
      // status). Sin efecto en turnos reales (no tienen refunds TEST).
      prisma.refund.groupBy({
        by: ["method"],
        where: { shiftId, status: { notIn: ["DRAFT", "VOIDED"] } },
        _sum: { total: true },
      }),
      // v1.8-Fiado · cobros de deuda imputados a ESTE turno (por
      // collectedInShiftId), sin importar en qué turno se vendió el fiado.
      prisma.ticketPayment.groupBy({
        by: ["method"],
        where: { collectedInShiftId: shiftId },
        _sum: { amount: true },
      }),
      // v1.8-Fiado · fiados VENDIDOS en este turno (deuda viva). No entra
      // dinero: sección informativa "Ventas a crédito (no cobradas)".
      prisma.ticket.aggregate({
        where: { shiftId, status: "ON_CREDIT" },
        _count: { _all: true },
        _sum: { total: true },
      }),
    ]);
  const paymentsByMethod: Record<string, number> = {};
  for (const row of paymentTotals) {
    paymentsByMethod[row.method] = Number(row._sum.amount ?? 0);
  }
  const refundsByMethod: Record<string, number> = {};
  for (const row of refundTotals) {
    // method null (no debería darse — el endpoint de refunds siempre lo
    // fija) cae al bucket OTHER para no perder el importe del desglose.
    const key = row.method ?? "OTHER";
    refundsByMethod[key] = (refundsByMethod[key] ?? 0) + Number(row._sum.total ?? 0);
  }
  const creditCollectionsByMethod: Record<string, number> = {};
  for (const row of creditCollectionTotals) {
    creditCollectionsByMethod[row.method] = Number(row._sum.amount ?? 0);
  }
  return {
    paymentsByMethod,
    refundsByMethod,
    creditCollectionsByMethod,
    creditSales: {
      count: creditSalesAgg._count._all,
      total: Number(creditSalesAgg._sum.total ?? 0),
    },
  };
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
