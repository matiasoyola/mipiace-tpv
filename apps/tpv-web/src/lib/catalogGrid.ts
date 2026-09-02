// v1.14.1-el-catalogo-manda · §1. La aritmética de la rejilla de
// producto, en un módulo puro para que sea testeable sin navegador.
//
// El problema que resuelve: v1.14 midió el panel del ticket y arregló el
// panel del ticket, pero quien manda en la percepción de la pantalla de
// venta es el CATÁLOGO, que ocupa dos tercios del ancho. Cada tarjeta
// dedicaba ~125 px a un icono de taza genérico idéntico en las diez, y
// con eso sólo cabían DOS filas de producto a 1280 × 800.
//
// jsdom no hace layout (`getBoundingClientRect` devuelve ceros), así que
// "caben tres filas" no se puede comprobar montando el componente. Lo
// que sí se puede es dejar la aritmética en una función pura, alimentada
// por constantes MEDIDAS en el navegador, y hacer que el componente use
// esas mismas constantes al pintar. Así el sabotaje —devolver el
// placeholder a 125 px— cambia el número que entra en la función y el
// test cae.
//
// Todas las medidas salen del bucle visual del bloque a 1280 × 800 CSS,
// que es el viewport del AP11-1006 a densidad 240.

/**
 * Alto mínimo de la tarjeta de producto, en px.
 *
 * La tarjeta es ahora **tipográfica**: el nombre y el precio SON el
 * producto. Sin foto no se pinta ningún icono grande — como mucho una
 * banda de 4 px con el tono de la categoría. Con foto la imagen ocupa la
 * tarjeta entera bajo un velo, y el alto NO cambia: el reparto de la
 * rejilla no puede depender de si el propietario subió fotos a Holded.
 *
 * Medido: 206 px antes (125 de placeholder + 81 de texto), 104 después.
 */
export const PRODUCT_CARD_MIN_HEIGHT = 104;

/** `gap-3.5` de Tailwind entre tarjetas. Medido: 14 px. */
export const CATALOG_GRID_GAP = 14;

/**
 * Alto del bloque de chips de categoría: UNA fila `h-touch` (48) más el
 * `mb-6` (24) que la separa de la rejilla.
 *
 * v1.14 dejaba dos filas (104 + 24 = 128). Quitar el scroll horizontal a
 * cambio de 100 px de alto movió el problema de eje en vez de
 * resolverlo, y con "Más (3)" seguían sin verse todas.
 */
export const CATEGORY_CHIP_BLOCK_HEIGHT = 48 + 24;

/**
 * Lo que hay por encima de la rejilla y no es suyo: barra superior
 * (100 px) más el `p-7` del workspace (28 px). Medido en el navegador:
 * la columna del catálogo empieza en y=128.
 */
export const CATALOG_TOP_CHROME = 128;

/**
 * Lo que hay por debajo: `p-7` inferior (28 px) más la barra de estado
 * anclada al pie (68 px). Medido: la columna termina en y=704 de 800.
 */
export const CATALOG_BOTTOM_CHROME = 96;

/**
 * Cuántas filas COMPLETAS de producto se ven sin scroll.
 *
 * `cardHeight` se pasa a propósito en vez de leerse de la constante: es
 * lo que permite escribir el test del sabotaje sin tocar el módulo.
 */
export function catalogRowsVisible(
  viewportHeight: number,
  cardHeight: number = PRODUCT_CARD_MIN_HEIGHT,
  chipBlockHeight: number = CATEGORY_CHIP_BLOCK_HEIGHT,
): number {
  const available =
    viewportHeight - CATALOG_TOP_CHROME - CATALOG_BOTTOM_CHROME - chipBlockHeight;
  if (available <= 0 || cardHeight <= 0) return 0;
  // La última fila visible no arrastra hueco detrás, de ahí el `+ gap`.
  return Math.max(
    0,
    Math.floor((available + CATALOG_GRID_GAP) / (cardHeight + CATALOG_GRID_GAP)),
  );
}
