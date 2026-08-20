// v1.11-cierre-de-dia · el resumen del día.
//
// El addendum del bloque (2026-08-20, Sirope) dejó claro que el resumen
// que pedía el prompt YA ESTÁ CONSTRUIDO: `z-breakdown.ts` calcula el
// desglose por método (bruto · devoluciones · neto) y el efectivo
// teórico del cajón. Lo que faltaba era **el orden**: hoy ese resumen es
// la recompensa por haber contado 15 denominaciones de pie.
//
// Este módulo lo saca de detrás del arqueo y lo convierte en un payload
// de primera clase, con UN solo cálculo para los cuatro consumidores:
//   - GET  /shift/:id/summary       (previsualizar antes de cerrar)
//   - POST /shift/:id/close-day     (cerrar sin contar)
//   - GET  /shift/last-closed       (la tarjeta de la mañana)
//   - el job de corte de día        (para dejarlo en el log)
//
// Auditabilidad (principio UX del proyecto): cada importe que se pinta
// sale de aquí y trae consigo de dónde viene — `ticketsCount`,
// `refundsCount` y el desglose por método, no un total opaco.

import type { getPrisma } from "../context.js";
import { cashierLabelFrom } from "../users/display.js";
import { loadShiftBreakdownSums } from "./breakdown-sums.js";
import { computeZBreakdown, type ZBreakdown } from "./z-breakdown.js";

export interface ShiftDaySummary {
  shift: {
    id: string;
    registerId: string;
    registerName: string;
    storeName: string;
    openedAt: string;
    closedAt: string | null;
    closeReason: "MANUAL" | "AUTO_DAY_CUT";
    cashOpening: number;
    // null = nadie contó el efectivo. Es el caso NORMAL a partir de
    // v1.11: contar es opcional.
    cashCounted: number | null;
    zReportPdfPath: string | null;
    // El Z se archivó y después entraron ventas (outbox offline imputado
    // por timestamp). El resumen lo dice en vez de callarlo.
    zReportStale: boolean;
    summaryAckAt: string | null;
    cashierLabel: string;
    closedByLabel: string | null;
  };
  ticketsCount: number;
  refundsCount: number;
  breakdown: ZBreakdown;
  // fondo inicial + neto en efectivo. Lo que DEBERÍA haber en el cajón.
  cashTheoretical: number;
  // contado − teórico. null cuando nadie contó: un descuadre de 0,00 €
  // que nadie ha verificado es una mentira cómoda.
  descuadre: number | null;
}

// Lo mínimo que hay que leer del turno para construir el resumen. Se
// declara aquí para que los callers usen el mismo `select`.
export const SHIFT_SUMMARY_SELECT = {
  id: true,
  registerId: true,
  userId: true,
  openedAt: true,
  closedAt: true,
  closeReason: true,
  cashOpening: true,
  cashCounted: true,
  closedByUserId: true,
  zReportPdfPath: true,
  zReportStale: true,
  summaryAckAt: true,
  register: {
    select: {
      id: true,
      name: true,
      store: { select: { id: true, name: true, tenantId: true } },
    },
  },
} as const;

interface ShiftSummaryRow {
  id: string;
  registerId: string;
  userId: string;
  openedAt: Date;
  closedAt: Date | null;
  closeReason: "MANUAL" | "AUTO_DAY_CUT";
  cashOpening: { toString: () => string };
  cashCounted: { toString: () => string } | null;
  closedByUserId: string | null;
  zReportPdfPath: string | null;
  zReportStale: boolean;
  summaryAckAt: Date | null;
  register: { id: string; name: string; store: { id: string; name: string; tenantId: string } };
}

export async function buildShiftDaySummary(
  prisma: ReturnType<typeof getPrisma>,
  shift: ShiftSummaryRow,
): Promise<ShiftDaySummary> {
  const cashOpening = Number(shift.cashOpening.toString());
  const cashCounted =
    shift.cashCounted != null ? Number(shift.cashCounted.toString()) : null;

  const [sums, ticketsCount, refundsCount, cashierUser, closedByUser] =
    await Promise.all([
      loadShiftBreakdownSums(prisma, shift.id),
      // Mismo criterio que el Z PDF: DRAFT (mesa sin cobrar) y VOIDED
      // (vaciada/agrupada) no son ventas.
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
      shift.closedByUserId
        ? prisma.user.findUnique({
            where: { id: shift.closedByUserId },
            select: { email: true, alias: true },
          })
        : Promise.resolve(null),
    ]);

  const breakdown = computeZBreakdown({
    cashOpening,
    ...sums,
    ...(cashCounted != null ? { counted: { CASH: cashCounted } } : {}),
  });

  return {
    shift: {
      id: shift.id,
      registerId: shift.registerId,
      registerName: shift.register.name,
      storeName: shift.register.store.name,
      openedAt: shift.openedAt.toISOString(),
      closedAt: shift.closedAt?.toISOString() ?? null,
      closeReason: shift.closeReason,
      cashOpening,
      cashCounted,
      zReportPdfPath: shift.zReportPdfPath,
      zReportStale: shift.zReportStale,
      summaryAckAt: shift.summaryAckAt?.toISOString() ?? null,
      cashierLabel: cashierUser ? cashierLabelFrom(cashierUser) : "—",
      closedByLabel: closedByUser ? cashierLabelFrom(closedByUser) : null,
    },
    ticketsCount,
    refundsCount,
    breakdown,
    cashTheoretical: breakdown.cashTheoretical,
    descuadre:
      cashCounted != null
        ? Math.round((cashCounted - breakdown.cashTheoretical) * 100) / 100
        : null,
  };
}
