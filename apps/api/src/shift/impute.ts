// v1.11-cierre-de-dia · imputación de una venta al turno que le toca.
//
// **Esto es lo delicado del bloque.** El corte de día cierra los turnos
// desde el server. Si el terminal estaba sin red a la hora del corte, al
// reconectar su outbox sube tickets que llevan el `shiftId` de un turno
// que el server ya cerró. Hasta v1.10 eso terminaba en
// `409 SHIFT_NOT_OPEN`, que el outbox clasifica como rechazo permanente
// (`isPermanentRejection`): la venta queda visible en el chip y **no se
// registra**. Cerrar solos los turnos sin arreglar esto habría convertido
// un peaje molesto en ventas perdidas.
//
// Regla, la del prompt: **el ticket se imputa al turno que le corresponde
// por su timestamp, no al turno abierto en ese momento.** El cliente manda
// `occurredAt` (el instante en que el cajero pulsó Cobrar, sellado por el
// outbox al encolar); el server busca el turno de esa caja cuya ventana
// [openedAt, closedAt) lo contiene.
//
// Prioridades cuando la ventana no resuelve, en este orden:
//   1. Ventana que contiene `occurredAt` → ése, aunque esté cerrado.
//   2. Turno abierto ahora mismo en la caja (venta posterior al corte que
//      el terminal siguió metiendo en el turno viejo).
//   3. El propio turno cerrado por corte de día → lo aceptamos igual.
//      Perder la venta no es una opción; el turno queda marcado
//      `zReportStale` y el resumen lo dice.
//
// Un turno cerrado A MANO por una persona no entra en (3): ahí no hubo
// automatismo que sorprendiera a nadie, y el 409 histórico se mantiene.

import type { getPrisma } from "../context.js";

// addendum 2 (review 2026-08-26) · tolerancia de reloj hacia adelante.
//
// `occurredAt` lo sella el terminal, así que es su reloj. Hacia atrás la
// imputación ya está acotada (sólo se miran turnos abiertos desde el que
// pedía el cliente); hacia adelante no lo estaba: un tablet con el reloj
// adelantado —pasa después de quedarse sin batería— podía caer en la
// ventana de un turno posterior o salirse de las candidatas.
//
// Cinco minutos cubre la deriva normal de un dispositivo sincronizado.
// Por encima, el instante no es de fiar: se ignora y la venta entra por
// el camino de siempre. Ignorar NUNCA significa rechazar la venta.
export const OCCURRED_AT_MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Convierte el `occurredAt` del cuerpo en Date, o `null` si no viene, no
 * parsea, o está tan adelantado que no puede ser cierto.
 */
export function parseOccurredAt(
  raw: string | null | undefined,
  now: Date = new Date(),
): { at: Date | null; skewed: boolean } {
  if (!raw) return { at: null, skewed: false };
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return { at: null, skewed: false };
  if (at.getTime() > now.getTime() + OCCURRED_AT_MAX_SKEW_MS) {
    return { at: null, skewed: true };
  }
  return { at, skewed: false };
}

export interface ShiftWindow {
  id: string;
  openedAt: Date;
  closedAt: Date | null;
  closeReason: "MANUAL" | "AUTO_DAY_CUT";
}

/**
 * El turno cuya ventana [openedAt, closedAt) contiene `occurredAt`.
 * Semiabierta por arriba: una venta sellada exactamente en el instante
 * del cierre pertenece al turno SIGUIENTE, no al que se acaba de cerrar
 * (si no, el Z recién archivado nacería desfasado).
 *
 * Si varias ventanas encajan —no debería pasar, pero un turno colgado y
 * uno nuevo pueden solaparse por un reloj desviado— gana la de apertura
 * más reciente.
 */
export function pickShiftForOccurrence(
  shifts: readonly ShiftWindow[],
  occurredAt: Date,
): ShiftWindow | null {
  const t = occurredAt.getTime();
  let best: ShiftWindow | null = null;
  for (const s of shifts) {
    if (s.openedAt.getTime() > t) continue;
    if (s.closedAt != null && s.closedAt.getTime() <= t) continue;
    if (!best || s.openedAt.getTime() > best.openedAt.getTime()) best = s;
  }
  return best;
}

export type ShiftResolution =
  | {
      ok: true;
      shiftId: string;
      // El ticket NO va al turno que pedía el cliente. El caller lo
      // devuelve en la respuesta para que quede rastro.
      imputed: boolean;
      // El turno destino ya está cerrado y su Z archivado: hay que
      // marcarlo desfasado.
      stale: boolean;
    }
  | { ok: false; error: "SHIFT_NOT_FOUND" | "SHIFT_NOT_OPEN" };

/**
 * Resuelve a qué turno va una venta/devolución de esta caja.
 *
 * Camino normal (turno abierto, con red): devuelve el mismo `shiftId`
 * que pidió el cliente sin tocar nada ni hacer queries extra. Todo lo de
 * abajo sólo se ejecuta cuando el turno pedido ya está cerrado.
 */
export async function resolveShiftForSale(args: {
  prisma: ReturnType<typeof getPrisma>;
  registerId: string;
  requestedShiftId: string;
  occurredAt?: Date | null;
}): Promise<ShiftResolution> {
  const { prisma, registerId, requestedShiftId, occurredAt } = args;

  const requested = await prisma.shift.findFirst({
    where: { id: requestedShiftId, registerId },
    select: { id: true, openedAt: true, closedAt: true, closeReason: true },
  });
  if (!requested) return { ok: false, error: "SHIFT_NOT_FOUND" };
  if (requested.closedAt == null) {
    return { ok: true, shiftId: requested.id, imputed: false, stale: false };
  }

  // 1. Ventana por timestamp.
  if (occurredAt) {
    // Los turnos de esta caja alrededor del instante de la venta. La
    // ventana candidata empieza como muy pronto en el turno pedido, así
    // que basta con mirar desde su apertura en adelante.
    const candidates = await prisma.shift.findMany({
      where: { registerId, openedAt: { gte: requested.openedAt } },
      select: { id: true, openedAt: true, closedAt: true, closeReason: true },
      orderBy: { openedAt: "asc" },
      take: 50,
    });
    const hit = pickShiftForOccurrence(candidates as ShiftWindow[], occurredAt);
    if (hit) {
      return {
        ok: true,
        shiftId: hit.id,
        imputed: hit.id !== requestedShiftId,
        stale: hit.closedAt != null,
      };
    }
  }

  // A partir de aquí sólo rescatamos lo que rompió el automatismo. Un
  // cierre manual mantiene el 409 de siempre.
  if (requested.closeReason !== "AUTO_DAY_CUT") {
    return { ok: false, error: "SHIFT_NOT_OPEN" };
  }

  // 2. Turno abierto ahora en la caja.
  const open = await prisma.shift.findFirst({
    where: { registerId, closedAt: null },
    orderBy: { openedAt: "desc" },
    select: { id: true },
  });
  if (open) {
    return { ok: true, shiftId: open.id, imputed: true, stale: false };
  }

  // 3. Red de seguridad: el turno cerrado por el corte. Cero ventas
  //    perdidas gana a un Z que cuadre.
  return { ok: true, shiftId: requested.id, imputed: false, stale: true };
}

/** Marca el Z del turno como desfasado. Best-effort: si esto falla, la
 *  venta ya está registrada y eso es lo que importa. */
export async function markZReportStale(
  prisma: ReturnType<typeof getPrisma>,
  shiftId: string,
): Promise<void> {
  await prisma.shift.updateMany({
    where: { id: shiftId, zReportStale: false, closedAt: { not: null } },
    data: { zReportStale: true },
  });
}
