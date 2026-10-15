// residencia-1 (D-54) · «¿EN QUÉ TURNO CAE ESTE INSTANTE?»
//
// Función PURA: mismas entradas, misma respuesta, sin base de datos. Los
// turnos entran como datos (los lee quien llama), igual que
// `puedeVerHistoria` recibe el estado ya leído — y por la misma razón: así
// el test es una tabla de verdad y no una maqueta de Prisma.
//
// Para qué existe: todo lo que la puerta registre en residencia-3 se
// adscribe al turno en que ocurre, y el turno es la unidad del relevo
// (residencia-5) y del plan de cuidados (residencia-2). Si esto contesta
// mal, un cuidado hecho a las 22:05 aparece en el parte de la tarde y la
// noche entra a ciegas.
//
// ── Las dos cosas que hacen que esto no sea un `>=` y un `<` ─────────
//
// 1. **LA NOCHE CRUZA MEDIANOCHE.** 22:00 → 08:00. Un turno con
//    `ends <= starts` es un turno nocturno, y «¿son las 02:00 un instante
//    de la noche?» es `02:00 >= 22:00 OR 02:00 < 08:00` — una disyunción,
//    no una conjunción. Escribirlo como un rango normal deja la madrugada
//    sin turno, que es justo el tramo en que una residencia está más sola.
//
// 2. **LA HORA ES DE PARED, Y LA PARED ESTÁ EN ESPAÑA.** Lo que se compara
//    no es el instante UTC: es la hora que marca el reloj de la sala de
//    terapia. El 25-10-2026 a las 02:30 UTC+2 y a las 02:30 UTC+1 son dos
//    instantes distintos y los dos son «las dos y media de la madrugada»,
//    o sea los dos son turno de noche. Por eso el instante se convierte a
//    hora de pared de `Europe/Madrid` con `utcToWallTime` —que ya conoce
//    las reglas DST y lo usa la agenda desde B-reservas-4— y sólo entonces
//    se compara.
//
//    Consecuencia buscada: el día que la hora salta de 02:59 a 04:00 (o
//    repite de 02:59 a 02:00) ningún registro se queda sin turno y ninguno
//    cambia de turno. Está en los tests.

import { CENTER_TZ, timeToMinutes, utcToWallTime } from "../agenda/time.js";

/** Lo mínimo de un `CenterShift` que hace falta para decidir. */
export interface TurnoDelCentro {
  id: string;
  code: string;
  name: string;
  /** Hora de pared «HH:MM». */
  startsAt: string;
  /** Hora de pared «HH:MM». `<= startsAt` ⇒ el turno cruza medianoche. */
  endsAt: string;
}

/** ¿Este turno cruza la medianoche? (la noche de 22 a 08). */
export function cruzaMedianoche(turno: {
  startsAt: string;
  endsAt: string;
}): boolean {
  return timeToMinutes(turno.endsAt) <= timeToMinutes(turno.startsAt);
}

/**
 * ¿Cae `minutos` (minutos desde medianoche, hora de pared) dentro de este
 * turno?
 *
 * Semiabierto por el final —`[inicio, fin)`— para que dos turnos
 * consecutivos no se solapen a las 15:00 en punto. El de la mañana acaba a
 * las 15:00 y el de la tarde empieza a las 15:00: las 15:00 son de la
 * tarde, y la alternativa (que fueran de las dos) obligaría a que algo
 * eligiera, y «algo» acabaría siendo el orden de la lista.
 */
export function minutosEnTurno(
  minutos: number,
  turno: { startsAt: string; endsAt: string },
): boolean {
  const inicio = timeToMinutes(turno.startsAt);
  const fin = timeToMinutes(turno.endsAt);
  if (fin > inicio) return minutos >= inicio && minutos < fin;
  // Cruza medianoche: la unión de [inicio, 24:00) y [00:00, fin).
  return minutos >= inicio || minutos < fin;
}

/**
 * El turno del centro en el que cae `instante`, o `null` si los turnos
 * configurados no lo cubren.
 *
 * `null` y no «el primero» a propósito: un centro puede tener un hueco en
 * su cuadrante (lo normal es que no, los tres de serie cubren las 24 h) y
 * adscribir un registro a un turno equivocado es peor que decir que no se
 * sabe. Quien llama decide qué hacer con el `null`; en residencia-3 será
 * guardar el registro sin turno y pintarlo como aviso en el panel, nunca
 * rechazar el registro —«cobrar siempre se puede» vale igual aquí: un
 * cuidado hecho se apunta.
 *
 * Si dos turnos se solapan (configuración mal hecha), gana el de
 * `sortOrder` más bajo, que es el orden en que llegan. No se valida el
 * solape en la base: un centro con tres turnos y una ronda de noche
 * partida es una configuración legítima que no conocemos todavía.
 */
export function turnoDe(
  instante: Date,
  turnos: TurnoDelCentro[],
  tz: string = CENTER_TZ,
): TurnoDelCentro | null {
  const minutos = timeToMinutes(utcToWallTime(instante, tz));
  for (const turno of turnos) {
    if (minutosEnTurno(minutos, turno)) return turno;
  }
  return null;
}

/**
 * residencia-1 · LOS TRES TURNOS DE SERIE (D-54), los que se siembran al
 * encender el interruptor.
 *
 * Mañana 08–15, tarde 15–22, noche 22–08. Salen de cómo trabaja Jardín de
 * Gredos hoy y cubren las 24 h sin hueco ni solape. Un centro los cambia
 * desde la pantalla de Turnos; lo que no puede es quedarse sin ninguno.
 */
export const TURNOS_DE_SERIE = [
  { code: "M", name: "Mañana", startsAt: "08:00", endsAt: "15:00", sortOrder: 1 },
  { code: "T", name: "Tarde", startsAt: "15:00", endsAt: "22:00", sortOrder: 2 },
  { code: "N", name: "Noche", startsAt: "22:00", endsAt: "08:00", sortOrder: 3 },
] as const;
