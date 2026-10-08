// kds-1-cocina · EL REPARTO DE TARJETAS, en una función pura.
//
// Tres de las decisiones más concretas del bloque viven aquí:
//
//   · **Orden de LECTURA, no por columnas** (decisión 7, corrección del
//     08-10 al ver la maqueta): las tarjetas se colocan como se lee un
//     libro, de izquierda a derecha y después la fila de abajo. En
//     columnas el ojo se saltaba la segunda más antigua. Esto lo garantiza
//     el ORDEN DEL DOM —la lista ya viene ordenada del servidor y se
//     pinta en una cuadrícula—, así que su sabotaje («las 4 primeras en el
//     DOM son las 4 más antiguas») se comprueba sobre el array.
//   · **CUATRO columnas a 1280 px**, que es lo que dibuja la maqueta. Era
//     el cuarto defecto de kds-1b: con tres sólo caben 3 comandas por
//     fila y se escondían mesas que cabían.
//   · **Una tarjeta que no cabe entera NO SE CORTA** y pasa a la franja
//     vertical del borde, con el «+N» y las mesas.
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
// cocinero la ve en la franja; si faltase, se cortaría, que es lo que la
// decisión 7 prohíbe. El error prudente es el que deja sitio.

import {
  ALERGIA_ALERGENO_PX,
  ALERGIA_PX,
  CANTIDAD_ANCHO_PX,
  EYEBROW_COCINA_PX,
  FRANJA_URGENTE_ALTO_PX,
  LINEA_HEIGHT_PX,
  LISTA_HEIGHT_PX,
  MESA_PX,
  NOTA_PX,
  PLATO_PX,
  TARJETA_ANCHO_PX,
  TARJETA_HUECO_PX,
} from "./kitchenTheme.js";
import { tonoSemaforo, minutosDesdeMarchado, type UmbralesSemaforo } from "./kitchenSemaforo.js";

/** Lo que el reparto necesita saber de una tarjeta. Nada más. */
export interface TarjetaMedible {
  id: string;
  tableName: string | null;
  number: number;
  urgent: boolean;
  isNew: boolean;
  /** De dónde cuenta el semáforo. Lo usa el color de la franja «+N». */
  firedAt: string | null;
  /** Sólo importa CUÁNTAS son: cada franja mide lo mismo. */
  allergyBands: readonly unknown[];
  lines: Array<{
    /** El nombre, para saber en cuántas líneas se va a partir. */
    name: string;
    notes: string[];
    allergyWarning: string | null;
    seat: number | null;
    voidPending: boolean;
    changePending: boolean;
    fired: boolean;
  }>;
}

// ── LAS PIEZAS, CALIBRADAS CONTRA EL NAVEGADOR ───────────────────────
//
// No son números a ojo: salen del bucle visual
// (`docs/blocks/kds-1-cocina-shots/banco.mjs`, campo `alturasReales`), que
// mide la altura de cada tarjeta PINTADA a 1280 × 800 y la compara con lo
// que devuelve `altoTarjeta`.
//
// Y se quedan POR ENCIMA a propósito, con el margen justo: pasarse de
// generoso cuesta una fila entera de tarjetas (a 716 px de alto, 12 px de
// más en el pie son cuatro comandas menos en pantalla).

/** Padding arriba + abajo de la lista de platos. La maqueta: `10px 0`. */
const PADDING_PX = 20;

/**
 * La cabecera del semáforo: mesa y minutos en grande, más el eyebrow de
 * «2ª COMANDA» / la sección / «LLEGÓ TARDE», que la maqueta pone DENTRO de
 * la cabecera y no debajo.
 *
 * `10 + 10` de padding + la mesa (34, `line-height: 1`) + 2 de respiro +
 * la línea del eyebrow (~17). Se cuenta el eyebrow siempre, aunque esta
 * tarjeta no lo lleve: es la estimación por lo alto.
 */
const CABECERA_PX = 20 + MESA_PX + 2 + EYEBROW_COCINA_PX + 4;

/** La franja «URGENTE», más los 8 del anillo de 4 px que la rodea. */
const FRANJA_URGENTE_PX = FRANJA_URGENTE_ALTO_PX + 8;

/**
 * Cada franja de alergia de la mesa: `10 + 10` de padding más sus dos
 * líneas («SILLA 3 · CELÍACO» a 21 con `line-height: 1.1` y «Gluten» a
 * 15). El icono mide 26 y cabe dentro.
 */
const FRANJA_ALERGIA_PX =
  20 + Math.round(ALERGIA_PX * 1.1) + Math.round(ALERGIA_ALERGENO_PX * 1.3) + 2;

/** Una nota o un modificador bajo un plato: 17 px y 2 de margen. */
const NOTA_LINEA_PX = Math.round(NOTA_PX * 1.3) + 2;

/**
 * La sub-franja del recuadro de un plato de silla: «SILLA 3 · SIN
 * GLUTEN». `4 + 4` de padding, 13 px de texto y los 4 del borde de 2 px
 * que lleva el recuadro arriba y abajo.
 */
const SILLA_LINEA_PX = 30;

/**
 * El «¡LLEVA GLUTEN!» de un plato SIN silla: su propia sub-franja.
 *
 * Con silla no suma nada aparte: va en la MISMA sub-franja que ella
 * («SILLA 3 · ¡LLEVA GLUTEN!»), y esa línea ya la cuenta
 * `SILLA_LINEA_PX`.
 */
const AVISO_PX = 26;

/** «ANULADO» / «ERAN 3 · −1», que va bajo el nombre del plato. */
const ANULADO_LINEA_PX = Math.round(16 * 1.3) + 2;

/** El encabezado «EN ESPERA · SALE CUANDO LO MARCHEN», con su filete. */
const BLOQUE_ESPERA_PX = 8 + 2 + Math.round(EYEBROW_COCINA_PX * 1.3) + 8;

/** El botón «Lista» del pie, con su margen inferior de 14. */
const PIE_PX = LISTA_HEIGHT_PX + 14;

/**
 * Lo que se añade a cada tarjeta para no cortarla nunca.
 *
 * 12 px: el redondeo de las piezas de arriba y el respiro de una línea
 * que mida un pelo más que lo estimado. Más sería dejar hueco visible al
 * final de cada fila; menos sería apostar a que ninguna pieza se pasa.
 *
 * El bucle visual comprueba que `altoTarjeta` queda por encima del alto
 * REAL de cada tarjeta pintada. El `-done` lleva los números.
 */
const MARGEN_SEGURIDAD_PX = 12;

/**
 * **CUÁNTOS CARACTERES DE NOMBRE CABEN EN UNA LÍNEA.**
 *
 * Con cuatro columnas la tarjeta mide ~251 px, y al nombre le quedan
 * 251 − 28 (padding) − 30 (la cantidad) − 10 (el hueco) = ~183 px. A 22 px
 * y peso 600, DM Sans gasta ~0,52 em por carácter de media en castellano,
 * o sea ~11,4 px: **16 caracteres por línea**.
 *
 * El número es una media y por eso la estimación lleva su margen encima.
 * Lo que NO se hace es truncar: el nombre del plato es lo primero que la
 * decisión 3 manda que se lea, y «Croquetas de jamón (sin gluten)» leído
 * «Croquetas de jamó…» es un plato distinto.
 */
const CHARS_POR_LINEA = Math.max(
  6,
  Math.floor(
    (TARJETA_ANCHO_PX - 28 - CANTIDAD_ANCHO_PX - 10) / (PLATO_PX * 0.52),
  ),
);

/** El alto de la fila de un plato, con el nombre partido si no cabe. */
function altoNombre(name: string): number {
  const lineas = Math.max(1, Math.ceil(name.length / CHARS_POR_LINEA));
  // `8 + 8` de padding de la fila.
  return Math.max(LINEA_HEIGHT_PX, 16 + lineas * Math.round(PLATO_PX * 1.2));
}

/** La altura que ocupará esta tarjeta. Estimada por lo alto. */
export function altoTarjeta(t: TarjetaMedible): number {
  let alto = PADDING_PX + CABECERA_PX;
  if (t.urgent) alto += FRANJA_URGENTE_PX;
  alto += t.allergyBands.length * FRANJA_ALERGIA_PX;
  const hayEspera = t.lines.some((l) => !l.fired);
  if (hayEspera) alto += BLOQUE_ESPERA_PX;
  for (const l of t.lines) {
    alto += altoNombre(l.name);
    alto += l.notes.length * NOTA_LINEA_PX;
    if (l.seat != null || l.allergyWarning != null) alto += SILLA_LINEA_PX;
    // El grito suma su propia sub-franja SÓLO si el plato no tiene silla:
    // con silla va en la misma que ella.
    if (l.allergyWarning && l.seat == null) alto += AVISO_PX - SILLA_LINEA_PX;
    if (l.voidPending || l.changePending) alto += ANULADO_LINEA_PX;
  }
  alto += PIE_PX;
  return alto + MARGEN_SEGURIDAD_PX;
}

/**
 * **CUÁNTAS COMANDAS CABEN DE VERDAD.**
 *
 * La decisión 7 pide «unas 8 comandas normales en 1280 × 800 sin
 * desplazar». Con los tokens de la maqueta **entran las 8**: cuatro
 * columnas por dos filas. Con los de la primera versión del bloque —tres
 * columnas de 320 px— entraban 6, y eso era el cuarto defecto de kds-1b.
 *
 * La aritmética, con la zona de CONTENIDO a 1280 × 800 (1036 × 716: 1280
 * − 160 de «Listas» − 60 de la franja del indicador − 24 del padding;
 * 800 − 60 de la barra superior − 24 del padding):
 *
 *   tarjeta de TRES platos de nombre corto, estimada
 *     = 20 (padding) + 73 (cabecera) + 3 × 56 + 70 (pie) + 12 = 343 px
 *   dos filas = 343 × 2 + 10 = 696 ≤ 716  →  2 × 4 = **8 tarjetas**
 *   tres filas = 343 × 3 + 20 = 1.049  →  no cabe
 *
 * Y una comanda con alergia por silla ocupa más (la franja de dos líneas,
 * el recuadro de cada plato de la silla y el «¡LLEVA GLUTEN!»): con una de
 * ésas en pantalla caben menos. Es correcto — esa tarjeta es la que hay
 * que leer entera.
 */
export const TARJETAS_NORMALES_A_1280 = 8;

export interface Reparto<T> {
  /** Las que caben ENTERAS, en orden de lectura. */
  visibles: T[];
  /** Las que no caben. Van a la franja «+N». */
  extra: T[];
  /** Cuántas columnas entran en este ancho. */
  columnas: number;
}

/**
 * Reparte las tarjetas entre lo que se ve y la franja «+N».
 *
 * El empaquetado imita lo que hará la cuadrícula del navegador: se rellena
 * fila a fila de izquierda a derecha, y **cada fila mide lo que su tarjeta
 * más alta** (decisión 7, literal). Cuando la siguiente fila no cabe
 * entera en el alto disponible, todo lo que queda se va al «+N».
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

/** Cuántas no caben: el «+2» de la franja, en grande. */
export function cuentaMasN(extra: readonly TarjetaMedible[]): string {
  if (extra.length === 0) return "";
  return `+${extra.length}`;
}

/**
 * Las mesas que no caben, una por línea bajo el «+N».
 *
 * Nombra las mesas y no sólo cuenta, porque lo que el cocinero necesita
 * saber es si lo que no cabe es suyo. Con más de tres se corta: a partir
 * de ahí la franja deja de ser una pista y empieza a ser otra lista.
 */
export function mesasMasN(extra: readonly TarjetaMedible[]): string[] {
  const nombres = extra.slice(0, 3).map((t) => t.tableName ?? `#${t.number}`);
  if (extra.length > 3) nombres.push("…");
  return nombres;
}

/** ¿Alguna de las que no caben es NUEVA? Entonces la franja parpadea. */
export function masNParpadea(extra: readonly TarjetaMedible[]): boolean {
  return extra.some((t) => t.isNew);
}

/**
 * **EL COLOR DE LA FRANJA «+N», y por qué casi nunca es rojo.**
 *
 * La franja es NEUTRA. Era el cuarto defecto de kds-1b: salía en rojo en
 * cuanto había algo escondido, y eso deshace la regla del rojo —«+2 · M1 ·
 * T2» no es una urgencia, es una pista—. Con la franja roja permanente, el
 * ojo deja de creerse el rojo de la franja «URGENTE» de al lado.
 *
 * Tres estados, y sólo tres:
 *
 *   · `rojo` — una de las escondidas ya pasó a rojo en el semáforo. Eso SÍ
 *     no puede esperar: hay una mesa que lleva 25 minutos y no se ve.
 *   · `verde` — hay alguna NUEVA ahí detrás. Parpadea en verde (el pulso
 *     de la maqueta), que es «mira, ha entrado algo».
 *   · `neutro` — lo demás.
 */
export type ColorMasN = "neutro" | "verde" | "rojo";

export function colorMasN(
  extra: readonly TarjetaMedible[],
  umbrales: UmbralesSemaforo,
  ahora: string,
): ColorMasN {
  if (extra.length === 0) return "neutro";
  const hayRoja = extra.some(
    (t) => tonoSemaforo(minutosDesdeMarchado(t.firedAt, ahora), umbrales) === "rojo",
  );
  if (hayRoja) return "rojo";
  return masNParpadea(extra) ? "verde" : "neutro";
}
