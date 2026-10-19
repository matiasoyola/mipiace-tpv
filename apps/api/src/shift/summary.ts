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
import { contarMesasVaciadas, ETIQUETA_MOTIVO } from "./mesas-vaciadas.js";
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
  // hierro-sirope (C) · LO QUE SE VACIÓ, TAMBIÉN EN LA PANTALLA.
  //
  // `contarMesasVaciadas` existía desde auditoria-sirope (#18) pero sólo
  // llegaba al PDF del Z. Quien cierra el día en el TPV no veía que se
  // habían tirado 1,50 € de M5 (capturas 43, 44, 50): para enterarse
  // tenía que abrir el PDF, que es justo lo que nadie hace.
  //
  // Va aquí, en el payload que arman los cuatro consumidores del resumen,
  // y sale de la MISMA función que el PDF. Que la pantalla y el papel
  // puedan decir números distintos es la fila «El resumen de cierre
  // cuenta las vaciadas distinto que el PDF» de la tabla de sabotajes.
  mesasVaciadas: MesasVaciadasPayload;
  breakdown: ZBreakdown;
  // S1-sello · los Z archivados del turno, del más reciente al más
  // antiguo. El primero es el vigente; los que llevan `supersededAt` son
  // los corregidos, conservados. Con esto `zReportStale` deja de ser un
  // boolean que no lleva a ninguna parte: dice que hay un Z posterior, y
  // aquí está.
  zReports: ZReportRef[];
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

/** Espejo de `MesasVaciadas` con la etiqueta ya resuelta: la pantalla no
 *  tiene por qué saber traducir `SE_FUERON_SIN_PAGAR`, y así el papel y la
 *  pantalla escriben la misma palabra. */
export interface MesasVaciadasPayload {
  count: number;
  total: number;
  porMotivo: Array<{
    motivo: string | null;
    /** «Invitación», «Sin motivo». */
    label: string;
    count: number;
    total: number;
  }>;
}

export interface ZReportRef {
  id: string;
  sequence: number;
  reason: string;
  sealedHash: string;
  sealedAt: string;
  pdfPath: string | null;
  /** No null = existe un Z posterior que corrige a este. */
  supersededAt: string | null;
}

export async function buildShiftDaySummary(
  prisma: ReturnType<typeof getPrisma>,
  shift: ShiftSummaryRow,
): Promise<ShiftDaySummary> {
  const cashOpening = Number(shift.cashOpening.toString());
  const cashCounted =
    shift.cashCounted != null ? Number(shift.cashCounted.toString()) : null;

  const [sums, ticketsCount, refundsCount, cashierUser, closedByUser, vaciadas] =
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
      contarMesasVaciadas(prisma, shift.id),
    ]);

  const breakdown = computeZBreakdown({
    cashOpening,
    ...sums,
    ...(cashCounted != null ? { counted: { CASH: cashCounted } } : {}),
  });

  const zReports = await prisma.shiftZReport.findMany({
    where: { shiftId: shift.id },
    orderBy: { sequence: "desc" },
    select: {
      id: true,
      sequence: true,
      reason: true,
      sealedHash: true,
      sealedAt: true,
      pdfPath: true,
      supersededAt: true,
    },
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
    mesasVaciadas: {
      count: vaciadas.count,
      total: vaciadas.total,
      porMotivo: vaciadas.porMotivo.map((m) => ({
        motivo: m.motivo,
        label: m.motivo ? ETIQUETA_MOTIVO[m.motivo] : "Sin motivo",
        count: m.count,
        total: m.total,
      })),
    },
    breakdown,
    zReports: zReports.map((z) => ({
      id: z.id,
      sequence: z.sequence,
      reason: z.reason,
      sealedHash: z.sealedHash,
      sealedAt: z.sealedAt.toISOString(),
      pdfPath: z.pdfPath,
      supersededAt: z.supersededAt?.toISOString() ?? null,
    })),
    cashTheoretical: breakdown.cashTheoretical,
    descuadre:
      cashCounted != null
        ? Math.round((cashCounted - breakdown.cashTheoretical) * 100) / 100
        : null,
  };
}
