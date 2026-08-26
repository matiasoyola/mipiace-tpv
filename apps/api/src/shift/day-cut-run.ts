// v1.11-cierre-de-dia · la pasada del corte de día.
//
// Cierra los turnos abiertos que han cruzado la hora de corte local de
// su tenant (`Tenant.dayCutHour`, default 05:00 Europe/Madrid) y genera
// su informe Z con los datos del server. Nadie cuenta efectivo: el
// turno queda con `cashCounted = NULL` y `closeReason = AUTO_DAY_CUT`,
// que es la verdad — el descuadre de un turno que nadie arqueó no es
// 0,00 €, es *desconocido*.
//
// Lo que este job NO hace, a propósito:
//   - No pide PIN ni exige aceptación de sync: un problema de sync nunca
//     cierra el negocio (v1.5-consistencia-B §3.b), y aquí no hay nadie
//     delante a quien pedirle nada. Los pendientes los recupera el
//     sweeper al reconectar.
//   - No abre el turno siguiente. El cajero lo abre al llegar, que es
//     cuando sabe el fondo de caja.
//   - No toca los turnos del día en curso.
//
// Terminal offline: el server cierra igual. La convivencia (que el
// terminal no pierda ventas ni duplique el cierre al reconectar) se
// resuelve en `shift/impute.ts` y en la idempotencia 409 del outbox de
// v1.10 — ver el done.md del bloque.

import type { getPrisma } from "../context.js";
import { loadShiftBreakdownSums } from "./breakdown-sums.js";
import { shiftCrossedDayCut } from "./day-cut.js";
import { computeZBreakdown } from "./z-breakdown.js";
import { generateZReportPdf } from "./z-report.js";
import { cashierLabelFrom } from "../users/display.js";

export interface DayCutOutcome {
  shiftId: string;
  registerId: string;
  tenantId: string;
  openedAt: string;
  closedAt: string;
  netSales: number;
  ticketsCount: number;
  cashTheoretical: number;
  zReportPdfPath: string | null;
  // El Z no se pudo generar (disco lleno, pdf-lib). El turno se cierra
  // IGUAL: dejarlo abierto otras 24 h para salvar un PDF sería cambiar
  // un problema de archivo por el problema que este bloque arregla.
  zReportError?: string;
}

export interface DayCutLog {
  info: (obj: object, msg: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

/**
 * Una pasada completa. Devuelve un outcome por turno cerrado.
 *
 * Un fallo en un turno no aborta los demás: la caja de un tenant no
 * puede quedar colgada porque a otro le falló el PDF.
 */
export async function runShiftDayCut(args: {
  prisma: ReturnType<typeof getPrisma>;
  log: DayCutLog;
  now?: Date;
}): Promise<{ scanned: number; closed: DayCutOutcome[]; failed: number }> {
  const { prisma, log } = args;
  const now = args.now ?? new Date();

  const open = await prisma.shift.findMany({
    where: { closedAt: null },
    orderBy: { openedAt: "asc" },
    select: {
      id: true,
      registerId: true,
      userId: true,
      openedAt: true,
      cashOpening: true,
      register: {
        select: {
          id: true,
          name: true,
          store: {
            select: {
              id: true,
              name: true,
              tenantId: true,
              tenant: { select: { id: true, dayCutHour: true } },
            },
          },
        },
      },
    },
  });

  const closed: DayCutOutcome[] = [];
  let failed = 0;

  for (const shift of open) {
    const tenant = shift.register.store.tenant;
    if (!shiftCrossedDayCut(shift, now, tenant.dayCutHour)) continue;
    try {
      const outcome = await closeShiftAtDayCut({ prisma, log, shift, now });
      // `null` = lo cerró una persona mientras corría la pasada. No es un
      // fallo y no cuenta como cierre nuestro.
      if (outcome) closed.push(outcome);
    } catch (err) {
      failed += 1;
      log.error(
        { err, event: "shift.day_cut.failed", shiftId: shift.id, tenantId: tenant.id },
        "corte de día: no se pudo cerrar el turno",
      );
    }
  }

  return { scanned: open.length, closed, failed };
}

interface OpenShiftRow {
  id: string;
  registerId: string;
  userId: string;
  openedAt: Date;
  cashOpening: { toString: () => string };
  register: {
    id: string;
    name: string;
    store: { id: string; name: string; tenantId: string; tenant: { id: string; dayCutHour: number } };
  };
}

async function closeShiftAtDayCut(args: {
  prisma: ReturnType<typeof getPrisma>;
  log: DayCutLog;
  shift: OpenShiftRow;
  now: Date;
}): Promise<DayCutOutcome | null> {
  const { prisma, log, shift, now } = args;
  const cashOpening = Number(shift.cashOpening.toString());

  // addendum 2 (review 2026-08-26) · RECLAMAR EL TURNO ANTES DE NADA.
  //
  // La lista de turnos abiertos se lee al principio de la pasada y
  // generar el Z lleva segundos. Si en esa ventana un cajero cierra a
  // mano, escribir el cierre automático al final le pisaba el suyo:
  // `closedByUserId` a NULL, `closeReason = AUTO_DAY_CUT` y —peor— el
  // PDF, que se llama `<shiftId>.pdf`, sobrescrito por uno que dice
  // "descuadre 0,00 €" sobre un turno que esa persona SÍ contó.
  //
  // El `updateMany` con `closedAt: null` es la reclamación atómica: o
  // cerramos nosotros, o cerró alguien y nos apartamos sin tocar nada.
  const claimed = await prisma.shift.updateMany({
    where: { id: shift.id, closedAt: null },
    data: {
      closedAt: now,
      // cashCounted se queda NULL a propósito — ver cabecera del módulo.
      closedByUserId: null,
      closeReason: "AUTO_DAY_CUT",
      // El resumen de la mañana está pendiente de enseñarse.
      summaryAckAt: null,
    },
  });
  if (claimed.count === 0) {
    log.info(
      { event: "shift.day_cut.raced", shiftId: shift.id },
      "corte de día: el turno lo cerró una persona durante la pasada; no se toca",
    );
    return null;
  }

  const [sums, ticketsCount, refundsCount, cashierUser, syncIssues] =
    await Promise.all([
      loadShiftBreakdownSums(prisma, shift.id),
      prisma.ticket.count({
        where: { shiftId: shift.id, status: { notIn: ["DRAFT", "VOIDED"] } },
      }),
      prisma.refund.count({
        where: { shiftId: shift.id, status: { notIn: ["DRAFT", "VOIDED"] } },
      }),
      prisma.user.findUnique({
        where: { id: shift.userId },
        select: { email: true, alias: true },
      }),
      loadSyncIssueCounts(prisma, shift.id),
    ]);

  // Sin `counted`: nadie contó. El desglose sale igual — lo que no sale
  // es un descuadre inventado.
  const breakdown = computeZBreakdown({ cashOpening, ...sums });

  let zPath: string | null = null;
  let zReportError: string | undefined;
  try {
    zPath = await generateZReportPdf({
      shiftId: shift.id,
      storeName: shift.register.store.name,
      registerName: shift.register.name,
      cashierLabel: cashierUser ? cashierLabelFrom(cashierUser) : "—",
      // No hubo persona que cerrase. El PDF lo dice tal cual en vez de
      // atribuirle el cierre a nadie.
      closedByLabel: "Cierre automático por corte de día",
      openedAt: shift.openedAt,
      closedAt: now,
      cashOpening,
      // El generador pinta "Cash contado" y el descuadre a partir de
      // esto. Con el teórico, ambos quedan en 0,00 € de diferencia, que
      // es exactamente lo que significa "no se contó": no afirmamos ni
      // un sobrante ni un faltante. El resumen del TPV sí distingue
      // `cashCounted: null` de un cero contado.
      cashCounted: breakdown.cashTheoretical,
      cashTheoretical: breakdown.cashTheoretical,
      breakdown,
      ticketsCount,
      refundsCount,
      syncIssues,
      acceptedSyncFailures: false,
      managerAuthorizationEmail: null,
      managerAuthorizationAlias: null,
    });
  } catch (err) {
    zReportError = err instanceof Error ? err.message : "error desconocido";
    log.error(
      { err, event: "shift.day_cut.z_report_failed", shiftId: shift.id },
      "corte de día: falló el Z; el turno se cierra igual",
    );
  }

  // El cierre ya está escrito (la reclamación de arriba). Aquí sólo
  // queda colgarle el Z si se pudo generar.
  if (zPath) {
    await prisma.shift.update({
      where: { id: shift.id },
      data: { zReportPdfPath: zPath },
    });
  }

  const outcome: DayCutOutcome = {
    shiftId: shift.id,
    registerId: shift.registerId,
    tenantId: shift.register.store.tenantId,
    openedAt: shift.openedAt.toISOString(),
    closedAt: now.toISOString(),
    netSales: breakdown.netSales,
    ticketsCount,
    cashTheoretical: breakdown.cashTheoretical,
    zReportPdfPath: zPath,
    ...(zReportError ? { zReportError } : {}),
  };
  log.info({ event: "shift.day_cut.closed", ...outcome }, "turno cerrado por corte de día");
  return outcome;
}

async function loadSyncIssueCounts(
  prisma: ReturnType<typeof getPrisma>,
  shiftId: string,
): Promise<{ pendingSync: number; failed: number }> {
  const [ticketIssues, refundIssues] = await Promise.all([
    prisma.ticket.groupBy({
      by: ["status"],
      where: { shiftId, status: { in: ["PENDING_SYNC", "SYNC_FAILED"] } },
      _count: true,
    }),
    prisma.refund.groupBy({
      by: ["status"],
      where: { shiftId, status: { in: ["PENDING_SYNC", "SYNC_FAILED"] } },
      _count: true,
    }),
  ]);
  const count = (rows: Array<{ status: string; _count: number }>, status: string) =>
    rows.find((r) => r.status === status)?._count ?? 0;
  return {
    pendingSync:
      count(ticketIssues as never, "PENDING_SYNC") +
      count(refundIssues as never, "PENDING_SYNC"),
    failed:
      count(ticketIssues as never, "SYNC_FAILED") +
      count(refundIssues as never, "SYNC_FAILED"),
  };
}
