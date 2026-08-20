// v1.11-cierre-de-dia · el resumen del día, lado TPV.
//
// Espejo del payload que arma `apps/api/src/shift/summary.ts`. Lo comparten
// los tres sitios donde ahora aparece la misma tarjeta:
//   - la pantalla de la mañana (turno que cerró el corte de día),
//   - el cierre desde el menú (antes de contar, no después),
//   - la pantalla de turno colgado tras "cerrar el día de ayer".
//
// El addendum del bloque (Sirope, 2026-08-20) encontró que había DOS
// cierres distintos y sólo uno enseñaba el Z: el del menú sí, el del turno
// colgado del login no — justo el que Sole ejecuta cada mañana, el único
// que ejecuta, y el que no le enseña nada. Este módulo es la pieza que
// permite que los dos caminos terminen en la misma tarjeta.

import { apiWithCashier } from "../api.js";
import { getLocalShift } from "./offlineShift.js";
import { outboxList } from "./outbox.js";

export interface ZMethodRow {
  method: string;
  gross: number;
  refunds: number;
  net: number;
  counted?: number;
}

export interface ZBreakdownPayload {
  methods: ZMethodRow[];
  grossSales: number;
  refundsTotal: number;
  netSales: number;
  cashTheoretical: number;
  creditSales?: { count: number; total: number };
  creditCollections?: Array<{ method: string; amount: number }>;
  creditCollectionsTotal?: number;
}

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
    // null = nadie contó el efectivo. NO es lo mismo que contar y que dé
    // cero: la tarjeta lo dice distinto.
    cashCounted: number | null;
    zReportPdfPath: string | null;
    zReportStale: boolean;
    summaryAckAt: string | null;
    cashierLabel: string;
    closedByLabel: string | null;
  };
  ticketsCount: number;
  refundsCount: number;
  breakdown: ZBreakdownPayload;
  cashTheoretical: number;
  descuadre: number | null;
}

export const METHOD_LABEL: Record<string, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  BIZUM: "Bizum",
  VOUCHER: "Vale",
  OTHER: "Otros",
};

export function formatEur(n: number): string {
  return n.toFixed(2).replace(".", ",") + " €";
}

/** Resumen de un turno (abierto = previsualización; cerrado = tarjeta). */
export async function fetchShiftSummary(shiftId: string): Promise<ShiftDaySummary> {
  return apiWithCashier<ShiftDaySummary>(`/shift/${shiftId}/summary`);
}

/** El último turno cerrado de esta caja cuyo resumen nadie ha confirmado.
 *  Es lo que dispara la tarjeta de la mañana. */
export async function fetchPendingDaySummary(): Promise<ShiftDaySummary | null> {
  const res = await apiWithCashier<{ summary: ShiftDaySummary | null }>(
    "/shift/last-closed",
  );
  return res.summary;
}

export async function ackDaySummary(shiftId: string): Promise<void> {
  await apiWithCashier(`/shift/${shiftId}/ack-summary`, { method: "POST", body: {} });
}

/**
 * Resumen armado con datos LOCALES, para cuando no hay red.
 *
 * v1.10 hizo que abrir y cerrar turno funcionen sin red; el bloque no
 * puede romper eso. Sin server no hay desglose por método fiable (los
 * tickets ya subidos no están en la cola local), así que enseñamos lo
 * único que sí sabemos con certeza: fondo de caja y efectivo de las
 * ventas que siguen en el outbox de ESTE turno. La tarjeta lo señala como
 * lo que es —un resumen sin conexión, incompleto— en vez de fingir un
 * total del día que no puede conocer.
 */
export async function buildOfflineDaySummary(shiftId: string): Promise<{
  cashOpening: number;
  cashFromQueue: number;
  cashTheoretical: number;
  ticketsInQueue: number;
}> {
  const local = await getLocalShift().catch(() => null);
  const cashOpening = local?.cashOpening ?? 0;
  let cashFromQueue = 0;
  let ticketsInQueue = 0;
  try {
    for (const it of await outboxList()) {
      const bodyShiftId =
        typeof it.body.shiftId === "string" ? it.body.shiftId : undefined;
      if (it.shiftLocalId !== shiftId && bodyShiftId !== shiftId) continue;
      if (it.kind !== "ticket" && it.kind !== "refund") continue;
      ticketsInQueue += 1;
      const payments = Array.isArray(it.body.payments)
        ? (it.body.payments as Array<{ method?: string; amount?: unknown }>)
        : [];
      for (const p of payments) {
        if (p?.method !== "CASH") continue;
        const amt = typeof p.amount === "number" ? p.amount : parseFloat(String(p.amount));
        if (Number.isFinite(amt)) cashFromQueue += it.kind === "refund" ? -amt : amt;
      }
    }
  } catch {
    /* best-effort: sin IDB el resumen local queda sólo con el fondo */
  }
  return {
    cashOpening,
    cashFromQueue: Math.round(cashFromQueue * 100) / 100,
    cashTheoretical: Math.round((cashOpening + cashFromQueue) * 100) / 100,
    ticketsInQueue,
  };
}
