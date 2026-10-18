// v2-H1-venta-y-sala · la aritmética de la venta de hostelería, en un
// módulo puro para que sea testeable sin navegador.
//
// Mismo patrón que `catalogGrid.ts` y `roomGrid.ts`: constantes MEDIDAS
// en el bucle visual, el componente pinta con ellas, y las funciones
// puras las comen para que un sabotaje cambie el número que entra y el
// test caiga. jsdom no hace layout (`getBoundingClientRect` devuelve
// ceros), así que «los 31 Licores caben sin desplazar» no se puede
// comprobar montando el componente; lo que sí se puede es dejar la
// cuenta aquí.
//
// EL PROBLEMA QUE RESUELVE
//
// La decisión 3b del bloque es la más dura: **nunca paginación**
// (Matías: «olvídate de paginación, eso nunca»). Una familia se ve
// ENTERA en una pantalla: nada de páginas, flechas, «Más (N)» ni
// desplazamiento dentro de la cuadrícula. Eso convierte el reparto de la
// rejilla en una restricción con número: la cuadrícula se adapta al
// número de productos, con un mínimo de 64 px de alto y nombre ≥ 20 px
// por botón. El caso real a medir son los **31 Licores de La
// Maestranza** a 1443 × 812.
//
// Lo que este módulo NO hace: inventar una salida si no cabe. Si una
// familia no entra con el mínimo, `gridShapeFor` devuelve `fits: false`
// y el `-done` lo dice con su número. Partir la familia en páginas está
// prohibido, así que la función no puede ofrecerlo.

import {
  FAMILY_BUTTON_PX,
  ORDER_PANEL_BORDER,
  ORDER_PANEL_WIDTH,
  PRODUCT_NAME_MIN_PX,
  PRODUCT_NAME_PX,
  QTY_KEY_HEIGHT_PX,
} from "./hospitalityTheme.js";

// ──────────────────────────────────────────────────────────────────────
// Lo medido en la maqueta revisada con Matías
// (`docs/mockups/v2-hosteleria/venta-oscuro.dc.html`, 1443 × 812)
// ──────────────────────────────────────────────────────────────────────

/** `padding: 16px` de la columna del catálogo, a cada lado. */
export const CATALOG_PADDING = 16;

/** Hueco entre los bloques de la columna (`gap: 14px`). */
export const BLOCK_GAP = 14;

/** El filete de 1 px que separa las familias de la fila de cantidad. */
export const DIVIDER_HEIGHT = 1;

/** `gap: 8px`, tanto en la barra de familias como en la cuadrícula. */
export const GRID_GAP = 8;

/**
 * Columnas de la barra de familias en el terminal. Es el
 * `repeat(5, minmax(0, 1fr))` de la maqueta.
 *
 * Cinco y no más porque el nombre va a 21 px: a 1443 px la columna del
 * catálogo deja 990 px útiles y cinco botones son 190 px cada uno, que
 * es lo que necesita «Desayunos» en una línea. Con seis bajan a 157 y
 * las etiquetas largas se parten.
 */
export const FAMILY_BAR_COLUMNS = 5;

/** Columnas de la barra de familias en handheld (< 640 px). */
export const FAMILY_BAR_COLUMNS_HANDHELD = 3;

/**
 * Alto mínimo del botón de producto, en px. Lo fija el prompt del
 * bloque y está por encima del suelo táctil de 56 de `tokens.md` §9.4:
 * una familia apretada da botones más bajos, pero nunca por debajo de
 * esto.
 */
export const PRODUCT_MIN_HEIGHT = 64;

/**
 * Alto MÁXIMO del botón de producto.
 *
 * No está en el prompt; sale de mirar el caso pequeño. Sin tope, una
 * familia de cuatro productos reparte los 521 px de rejilla entre dos
 * filas y da botones de 256 px: un cartel, no un botón, y además rompe
 * el reconocimiento por posición cuando el camarero salta de «Cervezas»
 * (4 productos) a «Licores» (31).
 *
 * 120 está por encima de los 98 px que da el caso canónico de la maqueta
 * (20 productos en 4 × 5 a 1443 × 812), así que **no toca el caso que
 * Matías revisó**; sólo impide el cartel.
 */
export const PRODUCT_MAX_HEIGHT = 120;

/**
 * Ancho mínimo del botón de producto, en px.
 *
 * De dónde sale: con `padding: 0 16px` a cada lado, un botón de 150 px
 * deja 118 px de caja de texto. A 20 px —el suelo del nombre— ahí entran
 * «Tostada» y «Pincho» enteros y los nombres de dos palabras caen a dos
 * líneas, que es el máximo que el bloque permite (sin «nombre corto de
 * botón», que es v2-H2). Con 140 ya se parten palabras.
 */
export const PRODUCT_MIN_WIDTH = 150;

/**
 * Columnas de la cuadrícula en el caso normal.
 *
 * Es el `repeat(4, …)` de la maqueta: hasta 20 productos la rejilla es
 * 4 × 5. A partir de ahí crece en columnas antes que en filas, porque lo
 * que escasea en un lienzo apaisado es el alto.
 */
export const PRODUCT_COLUMNS_DEFAULT = 4;

/** El umbral del 4 × 5. */
export const PRODUCT_COUNT_DEFAULT_GRID = 20;

/** Columnas de la cuadrícula en handheld (< 640 px). */
export const PRODUCT_COLUMNS_HANDHELD = 2;

// ──────────────────────────────────────────────────────────────────────
// La columna del catálogo
// ──────────────────────────────────────────────────────────────────────

/**
 * Ancho de la columna del catálogo: lo que queda a la derecha de la
 * comanda y su borde.
 */
export function catalogColumnWidth(viewportWidth: number): number {
  return Math.max(0, viewportWidth - ORDER_PANEL_WIDTH - ORDER_PANEL_BORDER);
}

/** Ancho útil de la cuadrícula (la columna menos su padding). */
export function gridWidth(viewportWidth: number): number {
  return Math.max(0, catalogColumnWidth(viewportWidth) - 2 * CATALOG_PADDING);
}

/**
 * Alto de la barra de familias para `buttonCount` botones.
 *
 * `buttonCount` incluye «Ahora», que es un botón más de la barra: nueve
 * familias de La Maestranza más «Ahora» son diez, o sea DOS filas de 76
 * con su hueco. No se cuenta aparte porque ocupa exactamente lo mismo
 * que una familia — lo único que lo distingue es el relleno y el aro.
 */
export function familyBarHeight(
  buttonCount: number,
  columns: number = FAMILY_BAR_COLUMNS,
  buttonHeight: number = FAMILY_BUTTON_PX,
): number {
  if (buttonCount <= 0 || columns <= 0) return 0;
  const rows = Math.ceil(buttonCount / columns);
  return rows * buttonHeight + (rows - 1) * GRID_GAP;
}

/**
 * Alto útil de la cuadrícula de productos: el viewport menos el padding
 * de la columna, la barra de familias, el filete, la fila de cantidad y
 * los tres huecos entre bloques.
 *
 * Medido a 1443 × 812 con diez botones de familia: 812 − 32 (padding)
 * − 160 (dos filas de familia) − 14 − 1 − 14 − 56 (cantidad) − 14 = 521.
 */
export function gridHeight(
  viewportHeight: number,
  familyButtonCount: number,
  columns: number = FAMILY_BAR_COLUMNS,
): number {
  return Math.max(
    0,
    viewportHeight -
      2 * CATALOG_PADDING -
      familyBarHeight(familyButtonCount, columns) -
      BLOCK_GAP -
      DIVIDER_HEIGHT -
      BLOCK_GAP -
      QTY_KEY_HEIGHT_PX -
      BLOCK_GAP,
  );
}

// ──────────────────────────────────────────────────────────────────────
// El reparto de la cuadrícula
// ──────────────────────────────────────────────────────────────────────

/**
 * Cuántas filas de producto caben, con el alto mínimo.
 *
 * `minHeight` se pasa a propósito en vez de leerse de la constante: es
 * lo que permite escribir el test del sabotaje sin tocar el módulo.
 * La última fila no arrastra hueco detrás, de ahí el `+ gap`.
 */
export function maxGridRows(
  availableHeight: number,
  minHeight: number = PRODUCT_MIN_HEIGHT,
): number {
  if (availableHeight <= 0 || minHeight <= 0) return 0;
  return Math.max(0, Math.floor((availableHeight + GRID_GAP) / (minHeight + GRID_GAP)));
}

/** Cuántas columnas caben, con el ancho mínimo. */
export function maxGridColumns(
  availableWidth: number,
  minWidth: number = PRODUCT_MIN_WIDTH,
): number {
  if (availableWidth <= 0 || minWidth <= 0) return 0;
  return Math.max(0, Math.floor((availableWidth + GRID_GAP) / (minWidth + GRID_GAP)));
}

/**
 * Tamaño del nombre de producto según lo ancho que acabe el botón.
 *
 * Dos peldaños, no una interpolación: 24 px en la cuadrícula normal y
 * 20 px —el suelo de `tokens.md` §3.1— cuando la familia aprieta. Entre
 * medias, 22. Nunca por debajo de `PRODUCT_NAME_MIN_PX`: la salida a una
 * familia que no cabe es decirlo, no encoger el texto hasta que entre.
 */
export function productNameSize(cardWidth: number): number {
  if (cardWidth >= 200) return PRODUCT_NAME_PX;
  if (cardWidth >= 170) return 22;
  return PRODUCT_NAME_MIN_PX;
}

export interface GridShape {
  columns: number;
  rows: number;
  cardWidth: number;
  cardHeight: number;
  nameSizePx: number;
  /**
   * `false` cuando la familia NO entra entera con el mínimo de 64 px de
   * alto y 150 px de ancho. El bloque no la parte en páginas: lo dice.
   */
  fits: boolean;
}

/**
 * El reparto de la cuadrícula para `productCount` productos en una caja
 * de `availableWidth × availableHeight`.
 *
 * La regla, en orden:
 *
 *   1. Hasta 20 productos, **cuatro columnas** — el 4 × 5 de la maqueta
 *      que Matías revisó. Las filas son las que pidan los productos, no
 *      cinco siempre: una familia de seis son dos filas de botones
 *      cómodos, no cinco filas con catorce huecos.
 *   2. A partir de 21, se busca el MENOR número de columnas con el que
 *      todo cabe en las filas disponibles. Crecer en columnas antes que
 *      en filas es lo correcto en un lienzo apaisado: lo que escasea es
 *      el alto, y un botón más estrecho sigue leyéndose mientras el
 *      nombre no baje de 20 px.
 *   3. Si ni con el máximo de columnas cabe, `fits: false`. Se devuelve
 *      igualmente el mejor reparto posible para que la pantalla pinte
 *      algo, pero la verdad va en el campo.
 */
export function gridShapeFor(
  productCount: number,
  availableWidth: number,
  availableHeight: number,
  minHeight: number = PRODUCT_MIN_HEIGHT,
  minWidth: number = PRODUCT_MIN_WIDTH,
): GridShape {
  const rowCap = maxGridRows(availableHeight, minHeight);
  const colCap = maxGridColumns(availableWidth, minWidth);
  if (productCount <= 0 || rowCap === 0 || colCap === 0) {
    return {
      columns: 1,
      rows: 1,
      cardWidth: Math.max(0, availableWidth),
      cardHeight: Math.max(0, Math.min(availableHeight, PRODUCT_MAX_HEIGHT)),
      nameSizePx: PRODUCT_NAME_MIN_PX,
      fits: productCount <= 0,
    };
  }

  let columns: number;
  if (productCount <= PRODUCT_COUNT_DEFAULT_GRID) {
    columns = Math.min(PRODUCT_COLUMNS_DEFAULT, colCap, productCount);
  } else {
    // El menor número de columnas que mete todo en las filas que hay.
    columns = colCap;
    for (let c = Math.min(PRODUCT_COLUMNS_DEFAULT, colCap); c <= colCap; c += 1) {
      if (Math.ceil(productCount / c) <= rowCap) {
        columns = c;
        break;
      }
    }
  }
  columns = Math.max(1, columns);

  const rows = Math.max(1, Math.ceil(productCount / columns));
  const fits = rows <= rowCap;
  // Si no cabe, las filas se recortan a las que hay: la pantalla pinta
  // lo que puede, y el `fits: false` es quien dice la verdad.
  const paintedRows = Math.max(1, Math.min(rows, rowCap));

  const cardWidth = Math.floor(
    (availableWidth - (columns - 1) * GRID_GAP) / columns,
  );
  const rawHeight = Math.floor(
    (availableHeight - (paintedRows - 1) * GRID_GAP) / paintedRows,
  );
  const cardHeight = Math.max(
    minHeight,
    Math.min(rawHeight, PRODUCT_MAX_HEIGHT),
  );

  return {
    columns,
    rows,
    cardWidth,
    cardHeight,
    nameSizePx: productNameSize(cardWidth),
    fits,
  };
}

/**
 * ¿Entra una familia de `productCount` productos, entera y sin
 * desplazar, en un viewport de `viewportWidth × viewportHeight`?
 *
 * Es el atajo que usa el test del sabotaje «paginar una familia de 31
 * productos»: el caso real de La Maestranza (Licores) a 1443 × 812 y a
 * 1280 × 800.
 */
export function familyFitsWithoutScroll(
  productCount: number,
  familyButtonCount: number,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  return gridShapeFor(
    productCount,
    gridWidth(viewportWidth),
    gridHeight(viewportHeight, familyButtonCount),
  ).fits;
}

/**
 * Cuántos productos caben como mucho en una pantalla, con el mínimo.
 * Sirve para que el `-done` escriba el techo real de cada terminal en
 * vez de un «caben de sobra».
 */
export function familyCapacity(
  familyButtonCount: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  return (
    maxGridRows(gridHeight(viewportHeight, familyButtonCount)) *
    maxGridColumns(gridWidth(viewportWidth))
  );
}

// ── auditoria-sirope (#6 + #7) · QUE EL NOMBRE QUEPA ENTERO ──────────
//
// El 18-10 pasaron las dos cosas a la vez en Sirope:
//
//   · «Croissantysandwich» se salía del botón de familia, que no tenía
//     ni relleno lateral ni recorte (captura 00);
//   · dos desayunos distintos pintaban EXACTAMENTE el mismo texto —
//     «Desayuno 1 · Café + Tostada…»— porque el `line-clamp-2` cortaba
//     justo donde empieza lo que los diferencia: «… mantequilla y
//     mermelada» contra «… (Sin glúten)» (captura 24). Dos botones
//     iguales, dos precios distintos.
//
// La salida no es recortar mejor: es que el nombre quepa. El tamaño baja
// por peldaños hasta que entra, con un SUELO de 15 px —por debajo de ahí
// no se lee a un metro y con prisa, que es como se usa esta pantalla— y
// un techo de tres líneas.
//
// ── Por qué una estimación y no una medida ───────────────────────────
//
// Medir de verdad exige el DOM (`measureText` o un `ResizeObserver` por
// botón), y esto corre para cada producto en cada repintado de la
// rejilla. La estimación usa el ancho medio de glifo de la familia que
// usa el TPV, por lo alto: si se queda corta, el botón baja un peldaño
// de más y se lee igual. Lo que no puede pasar —y es lo que esto
// impide— es que el nombre se corte.

/** El suelo del nombre de producto. Por debajo no se lee con prisa. */
export const PRODUCT_NAME_FLOOR_PX = 15;
/** Hasta tres líneas; a partir de ahí, el botón baja de tamaño. */
export const PRODUCT_NAME_MAX_LINES = 3;
/** Los peldaños, de mayor a menor. */
const PELDANOS_NOMBRE = [24, 22, 20, 18, 16, 15] as const;
/**
 * Ancho medio de glifo como fracción del tamaño de letra, para una sans
 * semibold. Medido a ojo por lo ALTO (0,55): quedarse corto baja un
 * peldaño de más; pasarse corta el nombre, que es el fallo.
 */
const ANCHO_GLIFO = 0.55;

/** Cuántos caracteres caben en una línea de `anchoPx` a `sizePx`. */
function caracteresPorLinea(anchoPx: number, sizePx: number): number {
  return Math.max(1, Math.floor(anchoPx / (sizePx * ANCHO_GLIFO)));
}

/**
 * ¿Cabe `texto` en `lineas` líneas de `anchoPx` a `sizePx`?
 *
 * Reparte por palabras, como hace el navegador: una palabra que no cabe
 * entera en una línea no cabe en ningún sitio, y eso es exactamente lo
 * que le pasaba a «Croissantysandwich».
 */
export function cabeEnLineas(
  texto: string,
  anchoPx: number,
  sizePx: number,
  lineas: number,
): boolean {
  const porLinea = caracteresPorLinea(anchoPx, sizePx);
  let usadas = 1;
  let actual = 0;
  for (const palabra of texto.trim().split(/\s+/)) {
    if (palabra.length > porLinea) return false;
    const necesita = actual === 0 ? palabra.length : actual + 1 + palabra.length;
    if (necesita <= porLinea) {
      actual = necesita;
      continue;
    }
    usadas += 1;
    if (usadas > lineas) return false;
    actual = palabra.length;
  }
  return usadas <= lineas;
}

/**
 * El tamaño con el que `nombre` cabe entero en un botón de `anchoPx`.
 *
 * `anchoPx` es el ancho ÚTIL (sin el relleno lateral y sin el hueco de
 * la insignia `×N`): lo descuenta quien llama, que es quien lo sabe.
 */
export function tamanoNombreProducto(
  nombre: string,
  anchoPx: number,
  maxLineas: number = PRODUCT_NAME_MAX_LINES,
  techoPx: number = PRODUCT_NAME_PX,
): number {
  // El techo es el primer candidato aunque no sea un peldaño: lo pone
  // quien llama (la rejilla con su ancho, la barra de familias con el
  // suyo) y un rótulo que cabe a su tamaño no tiene por qué encoger.
  const peldanos = [techoPx, ...PELDANOS_NOMBRE.filter((p) => p < techoPx)];
  for (const px of peldanos) {
    if (cabeEnLineas(nombre, anchoPx, px, maxLineas)) return px;
  }
  // Ni al suelo cabe. Se devuelve el suelo igualmente: el botón se lee,
  // y el nombre se corta —que es el caso que el catálogo tiene que
  // arreglar, no la rejilla—. Lo canta `nombresQueColisionan`.
  return PRODUCT_NAME_FLOOR_PX;
}

/**
 * auditoria-sirope (#7) · los nombres que, con el tamaño que les toca,
 * se pintarían IGUAL en la rejilla.
 *
 * Es la red del hallazgo: dos botones distintos con el mismo texto
 * visible son dos botones que el camarero no puede distinguir, y en
 * Sirope eran dos desayunos de precio distinto. Devuelve los pares.
 */
export function nombresQueColisionan(
  nombres: readonly string[],
  anchoPx: number,
  maxLineas: number = PRODUCT_NAME_MAX_LINES,
  /** El tamaño FIJO con el que se pintaría. `null` = el adaptativo, que
   *  es lo que hace la rejilla desde este bloque. Se puede pasar para
   *  medir la regla vieja —`line-clamp-2` a 24 px— y enseñar que
   *  colisionaba, que es lo que hace el test. */
  sizeFijoPx: number | null = null,
): Array<[string, string]> {
  const vistos = new Map<string, string>();
  const choques: Array<[string, string]> = [];
  for (const nombre of nombres) {
    const px = sizeFijoPx ?? tamanoNombreProducto(nombre, anchoPx, maxLineas);
    const porLinea = caracteresPorLinea(anchoPx, px);
    // Lo que se vería si el navegador cortara al límite de las líneas.
    const visible = nombre.slice(0, porLinea * maxLineas);
    const otro = vistos.get(visible);
    if (otro != null && otro !== nombre) choques.push([otro, nombre]);
    else vistos.set(visible, nombre);
  }
  return choques;
}

// ──────────────────────────────────────────────────────────────────────
// n1-hosteleria · QUIÉN TIENE EL SITIO EN EL CATÁLOGO (hallazgos 2 y 7)
//
// Los dos hallazgos de la pasada del 18-10 son el MISMO problema: la
// rejilla de familias no cede su sitio.
//
//   · buscando «tost» con el teclado abierto (ventana 360 × 449), las
//     seis familias ocupaban la pantalla y el primero de los 25
//     resultados caía en y=592: cero resultados a la vista (hallazgo 2);
//   · con «Cafe» elegida, el primer producto en y=833 con ventana de 648
//     y sin desplazamiento automático, así que parecía que tocar la
//     familia no había servido de nada (hallazgo 7).
//
// Vive aquí y no en el componente para que un banco pueda recorrer la
// tabla entera sin montar la pantalla: jsdom no mide maquetación, pero
// sí mide qué se decide (`n1-vertical-done` §4.2).
// ──────────────────────────────────────────────────────────────────────

/** La vista del catálogo: «Ahora» o una familia concreta. */
export type VistaDelCatalogo =
  | { kind: "ahora" }
  | { kind: "family"; tag: string };

export interface RepartoDelCatalogo {
  /** ¿Se pinta la rejilla entera de familias? */
  rejilla: boolean;
  /** ¿Se pinta la tira con la familia elegida y «Cambiar»? */
  tira: boolean;
}

/**
 * Qué se pinta por encima de los productos.
 *
 * Las dos reglas, que **sólo** aplican en un aparato de mano:
 *
 *   1. con texto en el buscador, NI rejilla ni tira. Buscando, las
 *      familias no sirven para nada —la lista de productos llega ya
 *      filtrada por la búsqueda, y filtrar además por familia dejaría
 *      «sin resultados» con el producto a la vista en otra— así que su
 *      sitio entero es de los resultados;
 *   2. con familia elegida, la rejilla se pliega a la tira, salvo que el
 *      camarero haya pedido verla otra vez (`rejillaAbierta`).
 *
 * En el terminal la rejilla está siempre: trece familias a seis columnas
 * son dos filas de 76 px y sobra pantalla. Es la restricción del bloque.
 */
export function repartoDelCatalogo(opts: {
  deMano: boolean;
  buscando: boolean;
  vista: VistaDelCatalogo;
  rejillaAbierta: boolean;
}): RepartoDelCatalogo {
  if (!opts.deMano) return { rejilla: true, tira: false };
  if (opts.buscando) return { rejilla: false, tira: false };
  const plegada = opts.vista.kind === "family" && !opts.rejillaAbierta;
  return { rejilla: !plegada, tira: plegada };
}

// ──────────────────────────────────────────────────────────────────────
// n1-hosteleria · LA HOJA DE LA COMANDA NO SOBREVIVE A SALIR (hallazgo 8)
//
// Medido en la pasada del 18-10: abierta la comanda, se va a «Tickets
// pasados», se abre la ficha de un ticket y se vuelve — y la hoja sigue
// abierta debajo, tapando la venta. Durante el recorrido bloqueó DOS
// veces los toques (la búsqueda y las familias) hasta cerrarla a mano.
//
// La causa es que la venta no se desmonta: «Tickets pasados», la ficha y
// el cajón son overlays DENTRO de `SalePage`, así que el `sheetOpen` del
// espacio de trabajo sobrevive intacto.
// ──────────────────────────────────────────────────────────────────────

/**
 * ¿Se pinta la hoja de la comanda?
 *
 * Dos condiciones, y las dos hacen falta:
 *
 *   · que el camarero la haya abierto (`abierta`);
 *   · que no haya nada montado por encima de la venta
 *     (`fueraDeLaVenta`: «Tickets pasados» y la ficha de un ticket, el
 *     cajón del menú, la agenda, «Cerrar el día» y el arqueo X).
 *
 * Que sea derivado y no sólo un `setState` es a propósito: aunque el
 * efecto que apaga `abierta` no llegara a correr —o alguien lo quitara—,
 * la hoja no puede pintarse encima de un overlay. El efecto está
 * ADEMÁS, para que al volver la hoja no reaparezca.
 */
export function hojaDeComandaVisible(opts: {
  abierta: boolean;
  fueraDeLaVenta: boolean;
}): boolean {
  return opts.abierta && !opts.fueraDeLaVenta;
}
