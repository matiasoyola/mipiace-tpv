// residencia-2 · «¿EN QUÉ TURNO CAE ESTE INSTANTE?», que residencia-1
// escribió y que ahora vive aquí.
//
// ── Por qué se MUEVE ──────────────────────────────────────────────────
//
// `queToca` la necesita en bucle, y esto es un paquete puro que no puede
// importar de `apps/api`. Las opciones eran copiarla por tercera vez —ya
// está en la API y en la tablet— o traerla aquí y que la API la
// re-exporte. Lo segundo deja DOS copias (ésta y la de la tablet, que es
// deliberada: la tablet tiene que adscribir un registro a un turno sin
// red) en vez de tres, y `apps/api/src/residencia/turnos.ts` sigue
// exportando lo mismo que exportaba, así que nada que importara de allí
// cambia.
//
// El cuerpo es el de residencia-1, letra por letra, y las dos razones por
// las que no es un `>=` y un `<` se repiten aquí porque son el fichero:
//
// 1. **LA NOCHE CRUZA MEDIANOCHE.** 22:00 → 08:00. «¿Son las 02:00 un
//    instante de la noche?» es `02:00 >= 22:00 OR 02:00 < 08:00` — una
//    DISYUNCIÓN. Escrito como rango, la madrugada entera se queda sin
//    turno: justo el tramo en que una residencia está más sola.
//
// 2. **LA HORA ES DE PARED, Y LA PARED ESTÁ EN ESPAÑA.** Lo que se compara
//    no es el instante UTC: es la hora que marca el reloj del office. El
//    25-10-2026 a las 02:30 UTC+2 y a las 02:30 UTC+1 son dos instantes
//    distintos separados por una hora real, y los dos son «las dos y
//    media de la madrugada», o sea los dos son turno de noche.

import {
  CENTER_TZ,
  addDays,
  timeToMinutes,
  utcToWallDate,
  utcToWallTime,
} from "./tiempo.js";

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
 * consecutivos no se solapen a las 15:00 en punto: el de la mañana acaba a
 * las 15:00 y el de la tarde empieza a las 15:00, así que las 15:00 son de
 * la tarde. La alternativa (que fueran de las dos) obligaría a que algo
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
 * `null` y no «el primero» a propósito: adscribir un cuidado a un turno
 * equivocado es peor que decir que no se sabe. Quien llama decide qué
 * hacer con el `null`; en residencia-3 será guardar el registro sin turno
 * y pintarlo como aviso, nunca rechazarlo — «cobrar siempre se puede»
 * vale igual aquí: un cuidado hecho se apunta.
 *
 * Si dos turnos se solapan (configuración mal hecha), gana el primero de
 * la lista, que es el de `sortOrder` más bajo porque así los pide la ruta.
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

/**
 * residencia-3 (decisión de producto 3) · **EL DÍA DEL TURNO**, que no es
 * siempre el día del reloj.
 *
 * «YYYY-MM-DD» de pared del centro. Es la columna `care_records.care_day`
 * y es lo que agrupa «lo que se ha hecho en este turno».
 *
 * ── Por qué no vale la fecha de `instante` ─────────────────────────────
 *
 * Porque **la noche cruza medianoche**. El turno de noche del lunes va de
 * las 22:00 del lunes a las 08:00 del martes: lo registrado a las 02:00
 * del martes pertenece a la noche DEL LUNES. Con la fecha del reloj, esa
 * ronda saldría partida en dos días, y las dos mitades contarían como dos
 * turnos distintos — cada uno con la mitad de los cambios posturales
 * hechos y la otra mitad «sin registrar». Es el mismo error que
 * `turnoDe` evita al no escribir la noche como un rango, una capa más
 * arriba.
 *
 * La regla, en una línea: si el turno cruza medianoche y la hora de pared
 * cae en la parte DE MADRUGADA (antes de `endsAt`), el día del turno es
 * **el anterior**.
 *
 * Sin turno (`null`, un hueco en el cuadrante) el día es el del reloj: no
 * hay nada que desplazar, y el registro se guarda sin turno con su aviso.
 */
export function diaDelTurno(
  instante: Date,
  turno: { startsAt: string; endsAt: string } | null,
  tz: string = CENTER_TZ,
): string {
  const dia = utcToWallDate(instante, tz);
  if (turno == null || !cruzaMedianoche(turno)) return dia;
  const minutos = timeToMinutes(utcToWallTime(instante, tz));
  // La parte de madrugada del turno que cruza: `[00:00, endsAt)`.
  if (minutos < timeToMinutes(turno.endsAt)) return addDays(dia, -1);
  return dia;
}
