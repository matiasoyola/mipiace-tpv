// kds-1-cocina · EL REPARTO DE TARJETAS, en una función pura.
//
// Dos de las decisiones más concretas del bloque viven aquí:
//
//   · **Orden de LECTURA, no por columnas** (decisión 7, corrección del
//     08-10 al ver la maqueta): las tarjetas se colocan como se lee un
//     libro, de izquierda a derecha y después la fila de abajo. En
//     columnas el ojo se saltaba la segunda más antigua. Esto lo garantiza
//     el ORDEN DEL DOM —la lista ya viene ordenada del servidor y se
//     pinta en un `flex-wrap`—, así que su sabotaje («las 4 primeras en el
//     DOM son las 4 más antiguas») se comprueba sobre el array.
//   · **Una tarjeta que no cabe entera NO SE CORTA** y pasa al indicador
//     «+N · M1 · T2» del borde. Eso es lo que calcula `repartirTarjetas`.
//
// ── POR QUÉ SE ESTIMA LA ALTURA EN VEZ DE MEDIRLA ─────────────────────
//
// Medir con el DOM obligaría a pintar las tarjetas para preguntarles su
// alto y volver a pintarlas: dos pasadas, un parpadeo visible en cada
// cambio, y un fallo imposible de reproducir en un test sin navegador.
//
// Así que la altura se CALCULA de los tokens, con el mismo criterio que
// `hospitalityGrid.ts` usa para la cuadrícula de productos: alturas fijas
// por pieza, sumadas. La estimación se hace **por lo alto** a propósito
// (`MARGEN_SEGURIDAD_PX`): si sobra, la última tarjeta se va al «+N» y el
// cocinero la ve en el indicador; si faltase, se cortaría, que es lo que
// la decisión 7 prohíbe. El error prudente es el que deja sitio.

import {
  ALERGIA_PX,
  EYEBROW_COCINA_PX,
  LINEA_HEIGHT_PX,
  LISTA_HEIGHT_PX,
  MESA_PX,
  NOTA_PX,
  TARJETA_ANCHO_PX,
  TARJETA_HUECO_PX,
  URGENTE_PX,
} from "./kitchenTheme.js";

/** Lo que el reparto necesita saber de una tarjeta. Nada más. */
export interface TarjetaMedible {
  id: string;
  tableName: string | null;
  number: number;
  urgent: boolean;
  isNew: boolean;
  allergyBands: string[];
  lines: Array<{
    notes: string[];
    allergyWarning: string | null;
    seat: number | null;
    voidPending: boolean;
    changePending: boolean;
    fired: boolean;
  }>;
}

// ── Las piezas de una tarjeta, en píxeles ─────────────────────────────

/** Padding arriba + abajo del cuerpo de la tarjeta. */
const PADDING_PX = 16;
/**
 * La cabecera del semáforo: mesa y minutos en grande, más el eyebrow de
 * «2ª COMANDA» / la sección / «LLEGÓ TARDE».
 *
 * El eyebrow comparte fila con nada —va debajo— pero su línea es la que
 * hace que la cabecera mida esto. 20 px de respiro arriba y abajo.
 */
const CABECERA_PX = MESA_PX + EYEBROW_COCINA_PX + 20;
/** La franja «⚡ URGENTE». */
const FRANJA_URGENTE_PX = URGENTE_PX + 18;
/** Cada franja de alergia. */
const FRANJA_ALERGIA_PX = ALERGIA_PX + 18;
/** Una nota o un modificador bajo un plato. */
const NOTA_LINEA_PX = NOTA_PX + 6;
/** El «¡LLEVA GLUTEN!» de un plato. */
const AVISO_PX = 28;
/** El «SILLA 3» de un plato asignado. */
const SILLA_LINEA_PX = 26;
/** «ANULADO · ERAN 3 · −1» con su «Visto» de 44 px. */
const ANULADO_LINEA_PX = 48;
/** El encabezado del bloque «EN ESPERA». */
const BLOQUE_ESPERA_PX = EYEBROW_COCINA_PX + 14;
/** El botón «Lista» del pie. */
const PIE_PX = LISTA_HEIGHT_PX + 12;

/**
 * Lo que se añade a cada tarjeta para no cortarla nunca.
 *
 * 12 px: una línea de texto que se parte en dos por un nombre largo cabe
 * en ese margen. Más sería dejar hueco visible al final de cada fila;
 * menos sería apostar a que ningún plato de ninguna carta se parte.
 */
const MARGEN_SEGURIDAD_PX = 12;

/**
 * **CUÁNTAS COMANDAS CABEN DE VERDAD, y la diferencia con la decisión 7.**
 *
 * La decisión 7 pide «unas 8 comandas normales en 1280 × 800 sin
 * desplazar». Con los tokens de este bloque **entran 6**, y las que sobran
 * van al indicador «+N» — que es exactamente el mecanismo que la misma
 * decisión 7 manda usar en vez de paginar.
 *
 * La aritmética, para que se pueda discutir con números:
 *
 *   zona de tarjetas a 1280 × 800 ≈ 1016 × 696 px
 *     (1280 − 240 de la columna «Listas» − 24 de padding;
 *      800 − 72 de la barra superior − 32 de padding)
 *   tarjeta de TRES platos = 16 (padding) + 73 (cabecera) + 168 (3 × 56)
 *                            + 68 (pie «Lista») + 12 (margen) = 337 px
 *   dos filas = 337 × 2 + 16 = 690 ≤ 696  →  2 × 3 = **6 tarjetas**
 *   tres filas = 337 × 3 + 32 = 1.043  →  no cabe
 *
 * Subirlo a 8 exigía CUATRO columnas, o sea tarjetas de 244 px. A 244 px,
 * «Croquetas de jamón» a 26 px ya no cabe en una línea, y el nombre del
 * plato es lo primero que la decisión 3 manda que se lea. Entre ver ocho
 * nombres partidos y ver seis enteros con dos en el indicador, se elige lo
 * segundo: el indicador nombra las mesas que faltan y entran en cuanto
 * salen las primeras.
 *
 * Queda anotado como diferencia en el `-done`.
 */
export const TARJETAS_NORMALES_A_1280 = 6;

/** La altura que ocupará esta tarjeta. Estimada por lo alto. */
export function altoTarjeta(t: TarjetaMedible): number {
  let alto = PADDING_PX + CABECERA_PX;
  if (t.urgent) alto += FRANJA_URGENTE_PX;
  alto += t.allergyBands.length * FRANJA_ALERGIA_PX;
  const hayEspera = t.lines.some((l) => !l.fired);
  if (hayEspera) alto += BLOQUE_ESPERA_PX;
  for (const l of t.lines) {
    alto += LINEA_HEIGHT_PX;
    alto += l.notes.length * NOTA_LINEA_PX;
    if (l.seat != null) alto += SILLA_LINEA_PX;
    if (l.allergyWarning) alto += AVISO_PX;
    if (l.voidPending || l.changePending) alto += ANULADO_LINEA_PX;
  }
  alto += PIE_PX;
  return alto + MARGEN_SEGURIDAD_PX;
}

export interface Reparto<T> {
  /** Las que caben ENTERAS, en orden de lectura. */
  visibles: T[];
  /** Las que no caben. Van al indicador «+N». */
  extra: T[];
  /** Cuántas columnas entran en este ancho. */
  columnas: number;
}

/**
 * Reparte las tarjetas entre lo que se ve y el indicador «+N».
 *
 * El empaquetado imita lo que hará el `flex-wrap` del navegador: se
 * rellena fila a fila de izquierda a derecha, y **cada fila mide lo que su
 * tarjeta más alta** (decisión 7, literal). Cuando la siguiente fila no
 * cabe entera en el alto disponible, todo lo que queda se va al «+N».
 *
 * Se corta por FILAS y no por tarjetas sueltas: dejar media fila dentro y
 * media fuera rompería el orden de lectura, que es justo lo que la
 * corrección del 08-10 vino a arreglar.
 */
export function repartirTarjetas<T extends TarjetaMedible>(
  tarjetas: readonly T[],
  viewport: { ancho: number; alto: number },
): Reparto<T> {
  const columnas = Math.max(
    1,
    Math.floor(
      (viewport.ancho + TARJETA_HUECO_PX) / (TARJETA_ANCHO_PX + TARJETA_HUECO_PX),
    ),
  );
  const visibles: T[] = [];
  const extra: T[] = [];
  let usado = 0;
  let i = 0;
  while (i < tarjetas.length) {
    const fila = tarjetas.slice(i, i + columnas);
    const altoFila = Math.max(...fila.map((t) => altoTarjeta(t)));
    const conHueco = usado === 0 ? altoFila : usado + TARJETA_HUECO_PX + altoFila;
    if (conHueco > viewport.alto) break;
    visibles.push(...fila);
    usado = conHueco;
    i += columnas;
  }
  extra.push(...tarjetas.slice(i));
  return { visibles, extra, columnas };
}

/**
 * El texto del indicador del borde: «+2 · M1 · T2».
 *
 * Nombra las mesas y no sólo cuenta, porque lo que el cocinero necesita
 * saber es si lo que no cabe es suyo. Con más de tres se corta: a partir
 * de ahí el indicador deja de ser una pista y empieza a ser otra lista.
 */
export function etiquetaMasN(extra: readonly TarjetaMedible[]): string {
  if (extra.length === 0) return "";
  const nombres = extra
    .slice(0, 3)
    .map((t) => t.tableName ?? `#${t.number}`)
    .join(" · ");
  const resto = extra.length > 3 ? " · …" : "";
  return `+${extra.length} · ${nombres}${resto}`;
}

/** ¿Alguna de las que no caben es NUEVA? Entonces el indicador parpadea. */
export function masNParpadea(extra: readonly TarjetaMedible[]): boolean {
  return extra.some((t) => t.isNew);
}
