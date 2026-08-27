// v1.11-cierre-de-dia · corte de día.
//
// Hallazgo que origina el módulo (BD de producción, 2026-08-20): los
// quince últimos turnos de Peluquería Sole se cierran entre 1 y 4
// segundos antes de abrirse el siguiente. Nadie cierra el turno: llega
// por la mañana, `POST /shift/open` devuelve 409 SHIFT_ALREADY_OPEN y
// hace el arqueo de ayer de pie antes de su primera clienta. Un turno
// que dura 288 h no es un control de caja.
//
// A partir de aquí el server cierra por su cuenta a la hora de corte
// local del tenant (`Tenant.dayCutHour`, default 05:00 Europe/Madrid).
//
// Funciones PURAS aquí; el efecto (leer BD, generar el Z, escribir el
// cierre) vive en `day-cut-run.ts`. Así la conversión de hora local —lo
// único con aristas de verdad, por el DST— se testea sin BD.

import { CENTER_TZ, utcToWallDate, wallTimeToUtc } from "../agenda/time.js";

// Default del corte si el tenant no tiene nada (no debería pasar: la
// columna lleva default en BD). 05:00 local: después del cierre de un
// bar de noche y antes de que abra nadie.
export const DEFAULT_DAY_CUT_HOUR = 5;

export function normalizeDayCutHour(raw: unknown): number {
  const n = typeof raw === "number" ? Math.trunc(raw) : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > 23) return DEFAULT_DAY_CUT_HOUR;
  return n;
}

// "YYYY-MM-DD" → el día natural anterior, en aritmética de calendario
// (no de instantes): restar 24 h a un instante se rompe en el cambio de
// hora, restar un día a una fecha de pared no.
export function previousWallDate(wallDate: string): string {
  const [y, m, d] = wallDate.split("-").map(Number);
  const prev = new Date(Date.UTC(y!, m! - 1, d!) - 24 * 60 * 60 * 1000);
  const yy = prev.getUTCFullYear();
  const mm = String(prev.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(prev.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * El último instante de corte que YA pasó en el momento `now`.
 *
 * Con corte a las 05:00 y `now` = martes 04:30 local, el último corte es
 * el del LUNES a las 05:00 — el turno que se abrió el lunes a las 09:00
 * todavía no ha cruzado ningún corte y no se toca.
 *
 * Va por hora de pared (`wallTimeToUtc`), no por aritmética de instantes:
 * el día del cambio de hora en Europe/Madrid dura 23 o 25 horas y "las
 * 05:00 de ayer" no es "hace 24 h".
 */
export function lastDayCutBefore(
  now: Date,
  dayCutHour: number,
  tz: string = CENTER_TZ,
): Date {
  const hour = String(normalizeDayCutHour(dayCutHour)).padStart(2, "0");
  const today = utcToWallDate(now, tz);
  const todayCut = wallTimeToUtc(today, `${hour}:00`, tz);
  if (todayCut.getTime() <= now.getTime()) return todayCut;
  return wallTimeToUtc(previousWallDate(today), `${hour}:00`, tz);
}

/**
 * ¿Este turno abierto ha cruzado un corte de día?
 *
 * Criterio: se abrió ANTES del último corte que ya pasó. Un turno abierto
 * esta mañana a las 09:00 con corte a las 05:00 no ha cruzado nada (el
 * corte de hoy es anterior a su apertura). El de ayer a las 09:00, sí.
 *
 * Deliberadamente NO miramos `lastActivityAt`: un turno con actividad a
 * las 03:00 de la madrugada sigue siendo el turno de ayer, y lo que
 * decide es cuándo se abrió.
 */
export function shiftCrossedDayCut(
  shift: { openedAt: Date },
  now: Date,
  dayCutHour: number,
  tz: string = CENTER_TZ,
): boolean {
  return crossedDayCut(shift.openedAt, now, dayCutHour, tz);
}

/**
 * La misma pregunta para cualquier instante, no sólo la apertura de un
 * turno: ¿esto es de antes del último corte que ya pasó?
 *
 * v1.12-mesas-abandonadas la usa sobre `Ticket.createdAt` para decidir si
 * un DRAFT vacío es de hoy (se respeta) o viene de antes del corte (se
 * anula y su mesa queda libre).
 */
export function crossedDayCut(
  at: Date,
  now: Date,
  dayCutHour: number,
  tz: string = CENTER_TZ,
): boolean {
  return at.getTime() < lastDayCutBefore(now, dayCutHour, tz).getTime();
}
