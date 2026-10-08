// kds-1-cocina · EL SEMÁFORO Y LOS MINUTOS, en funciones puras.
//
// Puras y no dentro del componente por lo de siempre en esta casa: así se
// prueban con números y un sabotaje se ve en rojo sin mirar una captura.
// Dos de las filas de la tabla del bloque entran por aquí:
//
//   · «El semáforo cuenta desde la nota» → `minutosDesdeMarchado` cuenta
//     desde `firedAt`, y un tiempo retenido devuelve `null`.
//   · «Al pasar a rojo: un solo pulso» → `cruzoARojo`.

import type { TonoSemaforo } from "./kitchenTheme.js";

export interface UmbralesSemaforo {
  /** Verde por debajo de esto. De serie, 10 min. */
  greenMaxMin: number;
  /** Ámbar entre el verde y esto. Por encima, rojo. De serie, 20 min. */
  amberMaxMin: number;
}

/**
 * Los minutos que esta tarjeta lleva esperando, o `null` si todavía no ha
 * marchado.
 *
 * **Cuenta desde que el grupo MARCHA**, no desde que se envió ni desde que
 * se tomó la nota (decisión 3). Una mesa con el segundo plato en espera
 * lleva media hora en la pantalla y su bloque retenido marca 0 min en el
 * momento en que el camarero pulsa «Marchar 2º».
 *
 * `serverTime` y no `Date.now()`: una tablet de cocina barata se desvía, y
 * un reloj desviado pinta semáforos inventados. El servidor manda la hora
 * en cada GET y la pantalla cuenta contra ella.
 */
export function minutosDesdeMarchado(
  firedAt: string | null,
  serverTime: string,
): number | null {
  if (!firedAt) return null;
  const t0 = Date.parse(firedAt);
  const t1 = Date.parse(serverTime);
  if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
  // Al suelo y no redondeado: a los 59 s la tarjeta dice «0 min», que es
  // la verdad. Redondeando diría «1 min» al segundo 31 y el cocinero vería
  // un minuto que no ha pasado.
  return Math.max(0, Math.floor((t1 - t0) / 60_000));
}

/**
 * El tono de la cabecera.
 *
 * `null` de minutos = EN ESPERA: gris y sin semáforo. No se pinta verde
 * «porque todavía va bien»: verde significa «está marchando y va bien», y
 * un tiempo retenido no está marchando.
 */
export function tonoSemaforo(
  minutos: number | null,
  u: UmbralesSemaforo,
): TonoSemaforo {
  if (minutos == null) return "espera";
  if (minutos < u.greenMaxMin) return "verde";
  if (minutos <= u.amberMaxMin) return "ambar";
  return "rojo";
}

/**
 * ¿Esta tarjeta ACABA de cruzar a rojo?
 *
 * Decisión 8: «al pasar a rojo en el semáforo, un solo pulso». Uno, no un
 * parpadeo permanente — una tarjeta roja que parpadea para siempre deja de
 * señalar nada en cuanto hay dos.
 *
 * Se compara el tono anterior con el nuevo, así que la pantalla sólo tiene
 * que acordarse del tono de la pasada anterior.
 */
export function cruzoARojo(
  anterior: TonoSemaforo | undefined,
  actual: TonoSemaforo,
): boolean {
  return actual === "rojo" && anterior !== undefined && anterior !== "rojo";
}

/** «12 min». Lo que se pinta al lado de la mesa, en grande. */
export function etiquetaMinutos(minutos: number | null): string {
  if (minutos == null) return "EN ESPERA";
  return `${minutos} min`;
}
