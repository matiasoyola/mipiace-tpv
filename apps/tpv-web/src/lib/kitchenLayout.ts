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

// ── LAS PIEZAS, CALIBRADAS CONTRA EL NAVEGADOR ───────────────────────
//
// No son números a ojo: salen del bucle visual
// (`docs/blocks/kds-1-cocina-shots/banco.mjs`, campo `alturasReales`), que
// mide la altura de cada tarjeta PINTADA a 1280 × 800 y la compara con lo
// que devuelve `altoTarjeta`.
//
// La primera versión las puso a ojo y se quedó CORTA —21 px en una tarjeta
// urgente y 82 en una con alergia y sillas—, que es la dirección peligrosa:
// con la estimación por debajo, el reparto cree que una fila cabe cuando no
// cabe y una tarjeta SE CORTA, que es justo lo que la decisión 7 prohíbe.
// Lo que miden ahora, en el navegador: cabecera 60 + eyebrow, franja
// urgente 57, franja de alergia 51, «¡LLEVA GLUTEN!» 41, nota 28,5, línea
// 56, «Lista» 56.
//
// Y se quedan POR ENCIMA a propósito, con el margen justo: pasarse de
// generoso cuesta una fila entera de tarjetas (a 728 px de alto, 12 px de
// más en el pie son tres comandas menos en pantalla).

/** Padding arriba + abajo del cuerpo de la tarjeta. */
const PADDING_PX = 16;
/**
 * La cabecera del semáforo —mesa y minutos en grande— más el eyebrow de
 * «2ª COMANDA» / la sección / «LLEGÓ TARDE», que va debajo en su línea.
 *
 * Medido: 60 de cabecera + 17 de eyebrow + 3 de respiro = 80.
 */
const CABECERA_PX = MESA_PX + EYEBROW_COCINA_PX + 27;
/** La franja «⚡ URGENTE». Medida: 57, más los 4 del borde de 3 px. */
const FRANJA_URGENTE_PX = URGENTE_PX + 40;
/** Cada franja de alergia. Medida: 51, más los 8 de su margen. */
const FRANJA_ALERGIA_PX = ALERGIA_PX + 38;
/** Una nota o un modificador bajo un plato. Medida: 28,5. */
const NOTA_LINEA_PX = NOTA_PX + 12;
/**
 * El «¡LLEVA GLUTEN!» de un plato SIN silla. Medido: 41.
 *
 * Con silla no suma nada: va pegado al «SILLA 3» en la misma línea
 * (decisión 3, «SILLA 3 · SIN GLUTEN»), y esa línea ya la cuenta
 * `SILLA_LINEA_PX`.
 */
const AVISO_PX = 44;
/**
 * La línea «SILLA 3 · ¡LLEVA GLUTEN!» de un plato asignado.
 *
 * UNA línea para las dos cosas. El bucle visual midió que en dos líneas
 * —silla arriba y grito debajo— cada plato de la silla alérgica costaba
 * 79 px, y una mesa con tres platos asignados se comía la pantalla.
 */
const SILLA_LINEA_PX = 38;
/** «ANULADO · ERAN 3 · −1» con su «Visto» de 44 px. */
const ANULADO_LINEA_PX = 52;
/** El encabezado del bloque «EN ESPERA». */
const BLOQUE_ESPERA_PX = EYEBROW_COCINA_PX + 16;
/** El botón «Lista» del pie, con sus márgenes de 8. */
const PIE_PX = LISTA_HEIGHT_PX + 16;

/**
 * Lo que se añade a cada tarjeta para no cortarla nunca.
 *
 * 12 px: una línea de texto que se parte en dos por un nombre largo cabe
 * en ese margen. Más sería dejar hueco visible al final de cada fila;
 * menos sería apostar a que ningún plato de ninguna carta se parte.
 *
 * El bucle visual comprueba que `altoTarjeta` queda por encima del alto
 * REAL de cada tarjeta pintada. El `-done` lleva los tres números.
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
 * La aritmética, con la zona MEDIDA en el navegador (1040 × 728: 1280 −
 * 240 de la columna «Listas»; 800 − 72 de la barra superior):
 *
 *   tarjeta de TRES platos, estimada = 16 (padding) + 80 (cabecera)
 *     + 168 (3 × 56) + 72 (pie «Lista») + 12 (margen) = 348 px
 *   dos filas = 348 × 2 + 16 = 712 ≤ 728  →  2 × 3 = **6 tarjetas**
 *   (medida real de esa tarjeta: 322 px, así que la estimación va por
 *    encima, que es el lado que no corta)
 *   tres filas = 348 × 3 + 32 = 1.076  →  no cabe
 *
 * Subirlo a 8 exigía CUATRO columnas, o sea tarjetas de 244 px. A 244 px,
 * «Croquetas de jamón» a 26 px ya no cabe en una línea, y el nombre del
 * plato es lo primero que la decisión 3 manda que se lea. Entre ver ocho
 * nombres partidos y ver seis enteros con dos en el indicador, se elige lo
 * segundo: el indicador nombra las mesas que faltan y entran en cuanto
 * salen las primeras.
 *
 * Y una comanda con alergia por silla ocupa más (la franja, el «SILLA n»
 * de cada plato y el «¡LLEVA GLUTEN!»): con una de ésas en pantalla caben
 * tres. Es correcto — esa tarjeta es la que hay que leer entera.
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
    // El grito suma SÓLO si el plato no tiene silla: con silla va en la
    // misma línea que ella.
    if (l.allergyWarning && l.seat == null) alto += AVISO_PX;
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
