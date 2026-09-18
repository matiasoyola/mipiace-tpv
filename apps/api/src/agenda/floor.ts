// El SUELO temporal de la agenda (B-reservas-6a).
//
// No es una política de `booking_policies` y no se configura: es un
// invariante. Una cita que empieza antes de ahora no existe, y un motor que
// la acepta no es un motor al que se pueda dejar sola a una clienta. B-6b
// pondrá encima las reglas del centro (MIN_LEAD_MINUTES y compañía), que sí
// se encienden y se apagan; esto es el pavimento sobre el que se apoyan.
//
// DÓNDE ESTÁ EL SUELO: en el comienzo de la franja EN CURSO de la retícula
// del centro. Son las 11:10 → las 11:00 valen, las 10:45 no. Así
// "¿tienes hueco ahora?" —que es la mitad de las llamadas de Peluquería
// Sole— funciona, y lo que ya pasó no entra. Sin excepción de OWNER: una
// cita que ya ocurrió se cobra por venta rápida, no se agenda hacia atrás.
//
// TODO SE CALCULA EN HORA DE PARED del huso del centro, nunca sobre el
// epoch y nunca con la zona del proceso: es la misma aritmética que
// `gridStarts` (minutos desde medianoche), y es la que sobrevive a un huso
// con offset no entero y al cambio de hora.

import {
  CENTER_TZ,
  SLOT_MINUTES,
  minutesToTime,
  timeToMinutes,
  utcToWallDate,
  utcToWallTime,
  wallTimeToUtc,
} from "./time.js";
import type { Slot } from "./types.js";

// ── El alta que se creó sin red (B-reservas-6a, frente O) ─────────────
//
// El AP12 de Sole apaga la pantalla a los cinco minutos. La primera acción
// al despertarlo puede salir sin red — y justo con "¿tienes hueco ahora?",
// que es la que va pegada a la franja en curso. El alta se encola, y al
// reconectar veinte minutos después el suelo la rechazaría por una hora
// que era buena cuando la cajera la escribió. Trabajo hecho que
// desaparece.
//
// Mismo patrón que los tickets desde v1.11: el outbox sella `occurredAt`
// AL ENCOLAR y el servidor evalúa el suelo con ESE instante, no con el de
// llegada.
//
// LA COTA HACIA ATRÁS. Sin ella, `occurredAt` es un campo del cuerpo: se
// reserva en el pasado mintiendo en él, que es justo lo que el suelo
// existe para impedir. Y NO hay ningún número que heredar — comprobado:
// el outbox **no tiene edad máxima**, sus items viven hasta el 2xx o
// hasta un rechazo permanente (`outbox.ts`, sin purga por antigüedad).
// Así que se elige aquí, y se elige corto:
//
//   · Cubre de sobra el caso real: un AP12 que despierta sin red tarda
//     segundos, y una línea caída se mide en minutos.
//   · Es más larga que el servicio más largo del catálogo de Sole (120
//     min: mechas, recogido de novia), así que un alta aceptada está como
//     mucho a un servicio de distancia: la clienta sigue en la silla o
//     acaba de salir, y el cobro de B-5 funciona sobre ella.
//   · Y acota la mentira: un `occurredAt` falseado mueve una reserva dos
//     horas hacia atrás como máximo. Nunca a ayer, nunca cruzando el
//     corte de día (`Tenant.dayCutHour`, 05:00).
//
// Por encima de la cota el instante NO se usa — y no usarlo NO significa
// rechazar por sí mismo: el alta entra por el camino de siempre, con el
// suelo de "ahora". Si su hora ya pasó, la rechaza el suelo como a
// cualquier otra (409 BOOKING_IN_PAST).
export const BOOKING_OCCURRED_AT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export type BookingNowSource =
  /** No vino `occurredAt`: manda el reloj del servidor. */
  | "now"
  /** Se usó el instante del alta: el suelo se evalúa con él. */
  | "occurred_at"
  /** Vino del futuro (ya lo descarta `parseOccurredAt`): se ignora. */
  | "future"
  /** Más viejo que la cota: se ignora. */
  | "too_old";

/**
 * Con qué instante se evalúa el SUELO de un alta. Pura y única: la llaman
 * el motor (que manda) y la ruta (que sólo quiere saber qué loguear).
 *
 * `occurredAt` sólo puede mover el suelo HACIA ATRÁS y dentro de la cota.
 * Nunca hacia adelante: un reloj adelantado no abre el futuro.
 */
export function resolveBookingNow(
  now: Date,
  occurredAt: Date | null | undefined,
  maxAgeMs: number = BOOKING_OCCURRED_AT_MAX_AGE_MS,
): { at: Date; source: BookingNowSource } {
  if (!occurredAt || Number.isNaN(occurredAt.getTime())) {
    return { at: now, source: "now" };
  }
  if (occurredAt.getTime() > now.getTime()) {
    return { at: now, source: "future" };
  }
  if (now.getTime() - occurredAt.getTime() > maxAgeMs) {
    return { at: now, source: "too_old" };
  }
  return { at: occurredAt, source: "occurred_at" };
}

/** La única fuente del "ahora" del motor. Inyectable para los tests: un
 *  motor con reloj de mentira es un motor que se puede probar. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * Comienzo de la franja EN CURSO de la retícula del centro — el suelo.
 * 11:10 con retícula de 15 → 11:00.
 */
export function currentGridStart(
  now: Date,
  tz: string = CENTER_TZ,
  stepMin: number = SLOT_MINUTES,
): Date {
  const date = utcToWallDate(now, tz);
  const min = timeToMinutes(utcToWallTime(now, tz));
  const floored = Math.floor(min / stepMin) * stepMin;
  const wallFloor = wallTimeToUtc(date, minutesToTime(floored), tz);
  if (wallFloor.getTime() <= now.getTime()) return wallFloor;
  // La hora REPETIDA del cambio de hora (25-10-2026 en Europe/Madrid: las
  // 02:00–03:00 se viven dos veces). Esa hora de pared es ambigua y
  // `wallTimeToUtc` resuelve a la segunda pasada, que cae DESPUÉS de `now`
  // — y un suelo en el futuro rechazaría una cita perfectamente legal.
  // Se cae al epoch, que es exacto mientras el offset del huso sea múltiplo
  // de la retícula: lo es en todos los husos vivos (hasta el +05:45 de
  // Nepal es múltiplo de 15).
  const stepMs = stepMin * 60_000;
  return new Date(Math.floor(now.getTime() / stepMs) * stepMs);
}

/**
 * ¿`start` cae en un inicio de la retícula del centro? (D-4b del cruce:
 * `availability()` sólo propone inicios alineados, pero `hold()` aceptaba
 * cualquiera — se podía reservar a las 10:07 llamando al endpoint.)
 *
 * Se mira en minutos de pared y se exige además el segundo en cero: un
 * `10:15:30` está alineado a la vista y no es el instante de ninguna franja.
 */
export function isOnGrid(
  start: Date,
  tz: string = CENTER_TZ,
  stepMin: number = SLOT_MINUTES,
): boolean {
  if (start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0) {
    return false;
  }
  return timeToMinutes(utcToWallTime(start, tz)) % stepMin === 0;
}

/** "YYYY-MM-DD" → el día siguiente. Por texto, no sumando 24 h: el día del
 *  cambio de hora dura 23 o 25. */
export function nextWallDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ── Las frases ────────────────────────────────────────────────────────
//
// Se escriben aquí, donde se conocen el huso y las alternativas, y no en la
// ruta: un error que la cajera no puede leer en voz alta obliga a traducir
// delante de la clienta. Regla heredada del prompt de B-6b: si el texto no
// se puede decir por teléfono, no entra.

function horas(alternatives: Slot[], tz: string): string {
  const hh = alternatives.map((s) => utcToWallTime(new Date(s.start), tz));
  if (hh.length === 1) return `las ${hh[0]}`;
  return `las ${hh.slice(0, -1).join(", las ")} o las ${hh[hh.length - 1]}`;
}

export function pastMessage(alternatives: Slot[], tz: string): string {
  if (alternatives.length === 0) {
    return "Esa hora ya ha pasado, y no me queda ningún hueco después.";
  }
  return `Esa hora ya ha pasado. Te puedo dar ${horas(alternatives, tz)}.`;
}

export function offGridMessage(
  alternatives: Slot[],
  tz: string,
  stepMin: number = SLOT_MINUTES,
): string {
  const cada =
    stepMin === 15
      ? "cada cuarto de hora"
      : stepMin === 30
        ? "cada media hora"
        : `cada ${stepMin} minutos`;
  if (alternatives.length === 0) {
    return `Las citas empiezan ${cada}, y no me queda ningún hueco cerca de esa hora.`;
  }
  return `Las citas empiezan ${cada}. Te puedo dar ${horas(alternatives, tz)}.`;
}
