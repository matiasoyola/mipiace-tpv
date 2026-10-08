// v1.23-las-mesas-miden-lo-mismo · la aritmética del mapa de sala, en un
// módulo puro para que sea testeable sin navegador. Mismo patrón que
// `catalogGrid.ts`: constantes MEDIDAS en el bucle visual, el componente
// pinta con ellas, y las funciones puras las comen para que un sabotaje
// cambie el número que entra y el test caiga.
//
// El problema que resuelve: hasta v1.22 el tamaño de una mesa no lo
// decidía ni el número de mesas ni su uso, sino **un ancho fijado de
// antemano por zona**. El lienzo era
// `lg:grid-cols-[minmax(0,1fr)_300px]` —Salón se llevaba todo el ancho
// sobrante, Terraza y Reservados iban en una columna de 300 px— y dentro
// de cada marco un `grid-cols-2` fijo. Dos columnas en 1050 px y dos
// columnas en 300 px dan el mismo objeto a cuatro tamaños distintos:
// medido en el AP13 a 1443 × 812, la misma mesa de 4 personas era
// 508 × 118 en Salón, 124 × 118 en Terraza y un círculo de 84 px en
// Barra. 7,1× de diferencia de área para la misma cosa (E1 de la
// auditoría del 2026-09-02).
//
// Lo que hace ahora: la tarjeta tiene UN tamaño, el mismo en las cuatro
// zonas y en las dos vistas. Las zonas son cajas `flex-wrap` que miden lo
// que piden sus mesas, y el número de columnas sale del ancho disponible
// dividido por ese tamaño — no de un `grid-cols-N` escrito a mano.

/**
 * Ancho de la tarjeta de mesa, en px. **El mismo en Salón, Terraza,
 * Reservados y Barra**, en la vista «Todas» y en la filtrada.
 *
 * De dónde sale el 168: es el mayor ancho con el que La Maestranza
 * (6 Salón + 6 Terraza + 4 Barra) entra entera sin desplazar a
 * 1280 × 800, que es el suelo del bucle visual. A 1280 el lienzo útil
 * son 1224 px y una banda de 6 mesas pide `6·W + 5·14 + 36`; con 168 son
 * 1114, y las tres bandas suman 546 px de alto sobre los 560
 * disponibles. Con 184 la banda cabría por 14 px y con 200 ya no cabe.
 *
 * No es un número de diseño "bonito": es el techo del caso real. Si
 * mañana una sala pide más mesas por banda, lo que cede es el número de
 * columnas (las mesas bajan de fila), nunca el tamaño de la tarjeta.
 */
export const TABLE_CARD_WIDTH = 168;

/**
 * Alto de la tarjeta de mesa, en px. Se conserva el 118 de v1.9.3: era
 * ya el alto de TODAS las tarjetas (lo que variaba era el ancho) y la
 * tarjeta sigue enseñando lo mismo —nombre, PAX, minutos, cajero,
 * importe—. Muy por encima del mínimo táctil de 64 px de `tokens.md`.
 */
export const TABLE_CARD_HEIGHT = 118;

/**
 * La clase de Tailwind que pinta ese tamaño. Literal a propósito: el JIT
 * no compila `w-[${W}px]`, así que el número vive dos veces. Para que no
 * se separen, `room-grid.test.ts` comprueba que la clase y las
 * constantes dicen lo mismo.
 *
 * `w-full` por debajo de `sm`: en handheld la tarjeta llena **su celda**
 * de la rejilla de dos columnas (ver `ROOM_GRID_CLASS`), no la pantalla.
 * A 390 px eso son 153 px de ancho por tarjeta — el mismo para todas, en
 * todas las zonas, que es la invariante del bloque: lo que cambia con el
 * tamaño de pantalla es cuánto vale ese "lo mismo", nunca que dos mesas
 * midan distinto a la vez.
 *
 * El alto NO cambia con la pantalla: 118 px en handheld igual que en el
 * terminal. Una mesa no es más baja por mirarla en un móvil.
 *
 * **Una sola clase para toda mesa.** Si una zona necesitara su propio
 * tamaño, el sitio donde discutirlo es este fichero, no un `className`
 * suelto en el componente.
 */
export const TABLE_CARD_SIZE_CLASS = "h-[118px] w-full sm:w-[168px]";

/**
 * La rejilla de mesas de una zona, en dos regímenes:
 *
 * - **Por debajo de `sm`**: `grid grid-cols-2`. DOS columnas fijas, con
 *   la tarjeta a `w-full` de su celda. A 390 px —el handheld del bucle
 *   visual— la celda mide 153 px: el main deja 358, el marco de zona se
 *   lleva 36 de `p-[18px]` más 2 de borde, y el hueco de 14 se reparte.
 *   Una sola columna daba tarjetas de 320 px y un mapa de 2.614 px de
 *   scroll para 16 mesas; con dos, el camarero ve el doble de sala por
 *   pantallazo sin bajar del objetivo táctil (153 × 118, muy por encima
 *   de los 64 × 64 de `tokens.md`) — y el mapa baja a 1.481 px.
 * - **Desde `sm`**: `flex flex-wrap` con la tarjeta a 168 px. Ahí el
 *   número de columnas NO está escrito en ninguna parte: sale del ancho
 *   disponible dividido por el tamaño de tarjeta (7 a 1443 px, 6 a
 *   1280). Ése es el punto del bloque, y por eso el `grid-cols-2` de
 *   handheld lleva siempre su `sm:flex sm:flex-wrap` detrás.
 *
 * Las dos mitades se comprueban por separado en `table-map-tamano-unico`:
 * quitar el `grid-cols-2` devuelve el handheld a una columna, y quitar
 * el `sm:flex-wrap` devuelve el terminal a dos.
 */
export const ROOM_GRID_CLASS = "grid grid-cols-2 gap-3.5 sm:flex sm:flex-wrap";

/**
 * Columnas de la rejilla de mesas por debajo de `sm`.
 *
 * No es un número de estilo: es el que hace que `handheldCardWidth` dé
 * un ancho utilizable. Si sube a 3, a 390 px la tarjeta baja a 98.
 */
export const ROOM_GRID_HANDHELD_COLUMNS = 2;

/** `p-4` del main por debajo de `md`, a cada lado. Medido: 16 px. */
export const ROOM_PADDING_HANDHELD = 16;

/** `gap-3.5` entre tarjetas dentro de una zona. Medido: 14 px. */
export const ROOM_GRID_GAP = 14;

/** `p-[18px]` del marco de zona, a cada lado. */
export const ZONE_PADDING = 18;

/** Separación entre marcos de zona (`gap-[18px]` del lienzo). */
export const ZONE_GAP = 18;

/**
 * Lo que el borde del marco de zona añade al alto, sumando los dos
 * lados. El borde es `border-[1.5px]` discontinuo, pero el navegador lo
 * cuantiza a 1 px por lado: medido en el bucle visual, un marco de una
 * fila mide 156 px (18 + 118 + 18 + 2), no 157.
 */
export const ZONE_BORDER = 2;

/**
 * Lo que la zona BARRA añade por encima de su fila de mesas: el
 * mostrador dibujado (26 px) más el `mb-4` que lo separa (16), y el
 * reparto vertical propio del marco (`pt-4 pb-5` = 36 en vez de los 36
 * del `p-[18px]`, que coinciden). Medido en el bucle visual.
 */
export const BAR_COUNTER_HEIGHT = 26 + 16;

/**
 * Lo que hay encima del lienzo y no es suyo, a 1280 × 800: cabecera de
 * la app (77), `p-7` superior del main (28), fila «Sala · N abiertas…»
 * con los chips de zona (48 + 16 de `mb-4`) y la leyenda de colores
 * (19 + 24 de `mb-6`). Medido en el navegador: el lienzo empieza en
 * y=212.
 */
export const ROOM_TOP_CHROME = 212;

/** `p-7` inferior del main. Medido: el lienzo termina a 28 px del borde. */
export const ROOM_BOTTOM_CHROME = 28;

/**
 * Ancho de una tarjeta en handheld, donde no mide 168 sino lo que le
 * toque de su celda. Sirve para afirmar en un test que a 390 px sigue
 * siendo un objetivo tocable y no una miniatura.
 */
export function handheldCardWidth(
  viewportWidth: number,
  columns: number = ROOM_GRID_HANDHELD_COLUMNS,
  gap: number = ROOM_GRID_GAP,
): number {
  // El marco de zona es `border-box`: su borde sale del ancho interior,
  // igual que el padding. Sin contarlo la cuenta daba 154 y el navegador
  // medía 153.
  const inner =
    viewportWidth - 2 * ROOM_PADDING_HANDHELD - 2 * ZONE_PADDING - ZONE_BORDER;
  return Math.floor((inner - (columns - 1) * gap) / columns);
}

/**
 * Cuántas tarjetas caben a lo ancho en una caja de `innerWidth` px.
 *
 * `cardWidth` se pasa a propósito en vez de leerse de la constante: es lo
 * que permite escribir el test del sabotaje sin tocar el módulo.
 *
 * La última columna no arrastra hueco detrás, de ahí el `+ gap`.
 */
export function roomColumnsFor(
  innerWidth: number,
  cardWidth: number = TABLE_CARD_WIDTH,
  gap: number = ROOM_GRID_GAP,
): number {
  if (innerWidth <= 0 || cardWidth <= 0) return 0;
  return Math.max(1, Math.floor((innerWidth + gap) / (cardWidth + gap)));
}

/**
 * Ancho que pide una zona para poner `columns` mesas en una fila
 * (tarjetas + huecos + el `p-[18px]` del marco). Es el `max-content` del
 * marco, que es exactamente lo que el `flex-wrap` del lienzo usa para
 * decidir si la zona cabe en la fila o baja a la siguiente.
 */
export function zoneOuterWidth(
  columns: number,
  cardWidth: number = TABLE_CARD_WIDTH,
  gap: number = ROOM_GRID_GAP,
): number {
  if (columns <= 0) return 2 * ZONE_PADDING;
  return columns * cardWidth + (columns - 1) * gap + 2 * ZONE_PADDING;
}

export interface RoomZone {
  /** Cuántas mesas tiene la zona. */
  tables: number;
  /** La BARRA mide más de alto: lleva el mostrador dibujado encima. */
  isBar?: boolean;
}

/**
 * Alto del lienzo entero, en px, con las zonas repartidas como las
 * reparte el `flex-wrap` del navegador: cada zona pide sus mesas en una
 * fila; si no cabe en la línea en curso, baja a la siguiente; si no cabe
 * ni sola, se encoge y sus mesas pasan a varias filas.
 *
 * Reproduce la regla de corte de flexbox (que mide por `max-content` y
 * NO mete una zona a medias en una línea llena) para poder afirmar en un
 * test lo que de otro modo sólo se vería en el navegador.
 */
export function roomCanvasHeight(
  zones: RoomZone[],
  availableWidth: number,
  cardWidth: number = TABLE_CARD_WIDTH,
  cardHeight: number = TABLE_CARD_HEIGHT,
): number {
  const maxColumns = roomColumnsFor(
    availableWidth - 2 * ZONE_PADDING,
    cardWidth,
  );
  let total = 0;
  let lineWidth = 0;
  let lineHeight = 0;
  let lines = 0;

  const flush = () => {
    if (lines > 0) total += ZONE_GAP;
    total += lineHeight;
    lines += 1;
    lineWidth = 0;
    lineHeight = 0;
  };

  for (const zone of zones) {
    const columns = Math.max(1, Math.min(zone.tables, maxColumns));
    const width = zoneOuterWidth(columns, cardWidth);
    const rows = Math.max(1, Math.ceil(zone.tables / columns));
    const height =
      2 * ZONE_PADDING +
      ZONE_BORDER +
      rows * cardHeight +
      (rows - 1) * ROOM_GRID_GAP +
      (zone.isBar ? BAR_COUNTER_HEIGHT : 0);

    const next = lineWidth === 0 ? width : lineWidth + ZONE_GAP + width;
    if (lineWidth > 0 && next > availableWidth) flush();
    lineWidth = lineWidth === 0 ? width : lineWidth + ZONE_GAP + width;
    lineHeight = Math.max(lineHeight, height);
  }
  if (lineWidth > 0) flush();
  return total;
}

/**
 * ¿Cabe la sala entera sin desplazar en un viewport de
 * `viewportWidth × viewportHeight`?
 *
 * `availableWidth` es el ancho del main menos su `p-7` a cada lado.
 */
export function roomFitsWithoutScroll(
  zones: RoomZone[],
  viewportWidth: number,
  viewportHeight: number,
  cardWidth: number = TABLE_CARD_WIDTH,
  cardHeight: number = TABLE_CARD_HEIGHT,
): boolean {
  const availableWidth = viewportWidth - 2 * 28;
  const availableHeight = viewportHeight - ROOM_TOP_CHROME - ROOM_BOTTOM_CHROME;
  return (
    roomCanvasHeight(zones, availableWidth, cardWidth, cardHeight) <=
    availableHeight
  );
}

// ──────────────────────────────────────────────────────────────────────
// El importe de una mesa ocupada no se corta nunca
//
// Hallazgo del hierro (AP13, 07-10-2026, 22:08): en la tarjeta de M2 el
// «37,30 €» salía cortado por la derecha. Medido sobre la captura del
// propio terminal, la tinta del importe acababa 25 px físicos (19 px
// CSS) MÁS ALLÁ del borde derecho de la tarjeta.
//
// La causa: el pie era una sola fila `flex-wrap` donde el camarero pedía
// `min-w-[92px]` y el importe iba `shrink-0`. Con 136 px de hueco útil,
// 92 + 8 de hueco + el importe no caben, y lo que sobresalía era el
// dinero. El arreglo de v1.10.3 (hallazgo #5) le dio al importe el
// `shrink-0` para que no se partiera en dos líneas, pero compartir fila
// con el camarero seguía siendo el problema: `shrink-0` no recorta, se
// desborda.
//
// Ahora el importe tiene su propia línea. El camarero va encima y se
// trunca; el importe no cede nunca. Estas constantes son las que el
// componente pinta y las que el test mide.
// ──────────────────────────────────────────────────────────────────────

/**
 * Lo que la tarjeta se come antes del contenido: `p-3.5` (14 px por
 * lado) y `border-2` (2 px por lado). El hueco útil de una tarjeta de
 * ancho W es `W - TABLE_CARD_CHROME_X`.
 */
export const TABLE_CARD_CHROME_X = 2 * 14 + 2 * 2;

/** Tamaño del importe en la tarjeta, en px. `text-[19px]`. */
export const TABLE_AMOUNT_FONT_PX = 19;

/**
 * Ancho por carácter del importe: DM Sans a 19 px, peso 700, con
 * `tabular-nums`.
 *
 * Como en `lineName.ts` y `chipRows.ts`, es una cota SUPERIOR medida, no
 * el ancho medio: con `tabular-nums` todos los dígitos ocupan lo mismo
 * (~11,4 px medidos sobre la captura del D8 a 1443 × 812) y el resto de
 * glifos de un importe —`.`, `,`, el espacio y el `€`— son más
 * estrechos. 11,5 no subestima ningún importe.
 *
 * El error tiene un solo lado que importa: subestimar devuelve «cabe» a
 * un importe que el navegador acaba cortando, que es justo el fallo que
 * este bloque arregla. Sobrestimar sólo haría saltar el test antes de
 * tiempo.
 */
export const TABLE_AMOUNT_CHAR_WIDTH = 11.5;

/**
 * El importe más largo que la tarjeta tiene que aguantar.
 *
 * Cuatro cifras de euros es el techo realista de una mesa de bar (La
 * Maestranza cerró la M4 del ensayo en 55,00 €); si algún día hiciera
 * falta una quinta, lo que cambia es esta constante y el test dice si
 * sigue cabiendo.
 *
 * **Sin separador de millares, a propósito**: `formatEur` no lo pone
 * (`formatAmount(n) + " €"`), así que meterlo aquí habría inflado la
 * cuenta en un carácter que el TPV no pinta. `room-grid-importe.test.ts`
 * ata esta constante a `formatEur` para que, si el formateador cambiara
 * y empezara a separar millares, el test lo diga en vez de dejar la
 * medida corta en silencio.
 */
export const LONGEST_TABLE_AMOUNT = "1234,50 €";

/** Ancho que ocupa un importe pintado en la tarjeta, en px. */
export function tableAmountWidth(amount: string): number {
  return amount.length * TABLE_AMOUNT_CHAR_WIDTH;
}

/**
 * Hueco útil para el contenido dentro de una tarjeta de mesa, en px.
 */
export function tableCardContentWidth(
  cardWidth: number = TABLE_CARD_WIDTH,
): number {
  return cardWidth - TABLE_CARD_CHROME_X;
}

/**
 * ¿Cabe el importe entero en la tarjeta, en su propia línea?
 *
 * Esto es lo que el test mide en 1443 × 812 (tarjeta de 168) y en
 * 390 × 844 (tarjeta de 153). Se pregunta por el importe SOLO: desde
 * este bloque no comparte línea con nadie, así que no entra en la cuenta
 * ni el avatar del camarero ni su alias.
 */
export function tableAmountFits(
  amount: string,
  cardWidth: number = TABLE_CARD_WIDTH,
): boolean {
  return tableAmountWidth(amount) <= tableCardContentWidth(cardWidth);
}
