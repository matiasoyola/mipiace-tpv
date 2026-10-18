// v1.14-la-comanda-se-ve · hallazgos M1 y M2 de la auditoría del
// 2026-09-01.
//
// Los ocho chips de categoría vivían en un contenedor `overflow-x-auto`.
// Medido en el terminal: el último terminaba en x=1876 de 1920 — tocando
// el borde, sin gradiente, sin flecha y sin chip partido a propósito. Un
// camarero nuevo no sabe que hay más ni que aquello se desliza. Y no se
// arregla con una pista visual: `docs/ux-principles.md` §1.8 prohíbe el
// scroll horizontal en táctil ("nunca horizontal — el horizontal es
// ilegible en táctil"), así que la fila deja de deslizarse.
//
// Los chips envuelven a un máximo de UNA fila y lo que no cabe se va a
// un chip "Más (N)" que abre un sheet.
//
// v1.14.1-el-catalogo-manda §2 · eran DOS filas hasta v1.14, y sobre la
// captura del AP11 se vio que aquello no había resuelto el problema
// sino que lo había movido de eje: la fila costaba ~100 px de alto —el
// alto de media fila de producto en una pantalla donde sólo cabían
// dos— y con "Más (3)" seguían sin verse todas las categorías. Si de
// todas formas hay un sheet que las tiene todas, la segunda fila se
// paga con espacio del catálogo y no compra nada.
//
// Por qué se estima el ancho en vez de medirlo en el DOM: medir cada
// chip obliga a un render de dos pasadas (pintar todo, medir `offsetTop`,
// repintar recortado) que parpadea y que en un `flex-wrap` puede
// oscilar — quitar un chip cambia el reparto y vuelve a caber, que lo
// mete otra vez. Con una estimación el reparto es una función pura del
// ancho disponible y de las etiquetas: determinista, sin reflow y
// testeable sin navegador.

/** Filas máximas en un TERMINAL antes de mandar el resto al sheet. */
export const CHIP_MAX_ROWS = 1;

// n1-vertical · LA EXCEPCIÓN DEL APARATO DE MANO, y por qué no es una
// marcha atrás de v1.14.1.
//
// Medido en el N1 el 2026-10-18 (fila de 328 px, vertical):
//
//   Servicios 92 + Productos 99 + Todos 98 + «Más (8)» 107 + huecos = 437
//
// En 328 px no caben ni siquiera los chips FIJOS más el chip que anuncia
// el resto. Con una sola fila, «Más (8)» se salía hasta x=453 y —al ser
// la fila `overflow-hidden`, que es lo que manda `ux-principles` §1.8
// para no deslizar en táctil— **las ocho familias quedaban
// inalcanzables**. No es que se vieran pocas: es que no había forma de
// llegar a ellas.
//
// v1.14.1 quitó la segunda fila midiendo el AP11, donde el eje escaso es
// el VERTICAL: a 800 px de alto la fila costaba media fila de producto.
// En un aparato de mano en vertical pasa lo contrario —648 px de alto y
// 328 de ancho—, así que la segunda fila se paga con lo que sobra y
// compra lo único que importa: que se vea que hay más y que se pueda
// tocar.
//
// El terminal NO cambia: con la columna del AP11 (840 px) esto devuelve
// 1, que es el invariante que vigila `chip-rows.test.ts`.
export const CHIP_MAX_ROWS_ESTRECHO = 2;

/**
 * Por debajo de este ancho de fila, el reparto usa dos filas.
 *
 * 520 y no 437 (lo medido en el N1) para dejar margen a etiquetas más
 * largas que las de Sirope: lo que decide es si los chips fijos y el
 * «Más (N)» caben juntos en una fila, y eso depende del catálogo.
 */
export const ANCHO_FILA_ESTRECHA = 520;

/** Cuántas filas de chips admite una fila de este ancho. */
export function filasDeChips(rowWidth: number): number {
  const width = rowWidth > 0 ? rowWidth : CHIP_FALLBACK_ROW_WIDTH;
  return width < ANCHO_FILA_ESTRECHA ? CHIP_MAX_ROWS_ESTRECHO : CHIP_MAX_ROWS;
}

/** `gap-2` de Tailwind. */
const CHIP_GAP = 8;

// Los tres números salen de MEDIR los chips reales en el navegador a
// 1280×800 (bucle visual del bloque, 12 chips del catálogo de Sirope
// más las de relleno), no de sumar paddings sobre el papel: la primera
// versión sumaba 58 + 7,6 px por carácter y se quedaba un 10 % corta,
// con lo que el reparto creía que cabían diez chips y "Más (N)" caía a
// una TERCERA fila — exactamente lo que el bloque prohíbe.
//
// Ajuste por mínimos cuadrados sobre las medidas: w ≈ 58,5 + 9,03·n.
// Se redondea hacia ARRIBA a propósito. El error tiene dos lados y no
// valen lo mismo: pasarse enseña un chip menos de los que cabrían;
// quedarse corto abre una tercera fila y rompe el invariante.

/** Icono (18) + hueco (8) + padding horizontal (2 × 20 en `md`). */
const CHIP_FIXED_WIDTH = 60;

/** Ancho medio de carácter en DM Sans 14px / 500, medido en pantalla. */
const CHIP_PER_CHAR = 9.2;

/** `max-w-[200px]` del chip: una etiqueta larga trunca, no crece. */
const CHIP_MAX_WIDTH = 200;

/**
 * Ancho de la columna del catálogo a 1280 × 800 CSS —el terminal AP11 a
 * densidad 240—: 1280 menos el panel del ticket (360), el `gap-6` (24) y
 * el padding `p-7` de los dos lados (56).
 *
 * Es el valor por defecto cuando no hay medida real (primer render, o
 * jsdom, que no hace layout). Deliberado: sin medida, el reparto es el
 * del viewport de diseño, que es el que hay que defender.
 */
export const CHIP_FALLBACK_ROW_WIDTH = 840;

export function estimateChipWidth(label: string): number {
  return Math.min(
    CHIP_FIXED_WIDTH + label.length * CHIP_PER_CHAR,
    CHIP_MAX_WIDTH,
  );
}

/** ¿Caben estos anchos en `rows` filas de `rowWidth`? */
function fitsInRows(widths: number[], rowWidth: number, rows: number): boolean {
  let usedRows = 1;
  let used = 0;
  for (const w of widths) {
    const need = used === 0 ? w : used + CHIP_GAP + w;
    if (need <= rowWidth) {
      used = need;
      continue;
    }
    usedRows += 1;
    if (usedRows > rows) return false;
    used = w;
    // Un chip más ancho que la fila entera igualmente ocupa su fila: se
    // acepta (trunca) en vez de entrar en bucle.
  }
  return true;
}

export interface ChipLayout {
  /** Cuántas etiquetas de `labels` se pintan en la barra. */
  visibleCount: number;
  /** Cuántas se van al sheet. 0 = no se pinta el chip "Más (N)". */
  overflowCount: number;
}

/**
 * Reparte las etiquetas entre la barra (dos filas) y el sheet.
 *
 * `leading` son los chips que van SIEMPRE delante y nunca se recortan
 * ("Todos", y en verticales SERVICES el toggle Servicios/Productos): son
 * navegación fija, no categorías.
 *
 * Si sobra algo, se reserva sitio para el chip "Más (N)" antes de
 * decidir el corte — si no, el propio chip que anuncia el desbordamiento
 * provocaría una tercera fila.
 */
export function layoutChips(
  labels: string[],
  rowWidth: number = CHIP_FALLBACK_ROW_WIDTH,
  leading: string[] = [],
  // n1-vertical · se deriva del ancho a propósito: así el reparto sigue
  // siendo una función pura de lo que hay en pantalla y ningún sitio
  // puede pedir dos filas en un terminal por descuido.
  maxRows: number = filasDeChips(rowWidth),
): ChipLayout {
  const width = rowWidth > 0 ? rowWidth : CHIP_FALLBACK_ROW_WIDTH;
  const leadingWidths = leading.map(estimateChipWidth);
  const labelWidths = labels.map(estimateChipWidth);

  if (fitsInRows([...leadingWidths, ...labelWidths], width, maxRows)) {
    return { visibleCount: labels.length, overflowCount: 0 };
  }

  for (let n = labels.length - 1; n >= 0; n--) {
    const overflow = labels.length - n;
    const moreWidth = estimateChipWidth(`Más (${overflow})`);
    const candidate = [...leadingWidths, ...labelWidths.slice(0, n), moreWidth];
    if (fitsInRows(candidate, width, maxRows)) {
      return { visibleCount: n, overflowCount: overflow };
    }
  }
  return { visibleCount: 0, overflowCount: labels.length };
}
