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

// ──────────────────────────────────────────────────────────────────────
// v2-H1-venta-y-sala · lo que v1.23 dejaba aquí y este bloque retira
//
// v1.23 pintaba la mesa con `TABLE_CARD_WIDTH = 168` /
// `TABLE_CARD_HEIGHT = 118` y con `TABLE_CARD_SIZE_CLASS`, la clase
// literal de Tailwind que repetía esos números —el JIT no compila
// `w-[${W}px]`— con un test que vigilaba que la clase y las constantes
// no se separaran. Y pintaba la rejilla con `ROOM_GRID_CLASS`, que metía
// un `grid-cols-2` para handheld y su `sm:flex sm:flex-wrap` detrás.
//
// Todo eso se va, y se va porque la sala oscura lo hace mejor:
//
//   · El tamaño entra por `style` con `TABLE_SHAPE_SIZE`, así que el
//     número vive UNA vez. Desaparece la clase, desaparece el test que
//     vigilaba la copia y desaparece el hueco por el que un
//     `[&>*]:!w-[124px]` colado en un envoltorio se escapaba de jsdom
//     (lo dejó anotado v1.23 como «una variante del cuarto sabotaje se
//     escapa»).
//   · El `grid-cols-2` de handheld ya no hace falta: con una mesa
//     cuadrada de 144 px, el `flex-wrap` da DOS columnas a 390 px por la
//     regla general (312 px útiles ÷ 158 = 1,97), que es el reparto que
//     v1.23 tuvo que escribir a mano. Una excepción menos.
//
// Lo que SÍ se queda es la aritmética del lienzo —`roomColumnsFor`,
// `zoneOuterWidth`, `roomCanvasHeight`—, porque el motor de reparto
// sigue siendo el mismo `flex-wrap` de marcos de zona. Sus valores por
// defecto pasan a ser `TABLE_SHAPE_SIZE`: una sola medida en el módulo,
// que es la regla que v1.23 vino a imponer.
// ──────────────────────────────────────────────────────────────────────

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

// v2-H1 · aquí vivían `ROOM_TOP_CHROME = 212` y `ROOM_BOTTOM_CHROME`,
// el chrome de la sala CLARA: barra de app (77), `p-7` del main, fila
// «Sala · N abiertas…» con sus chips (64) y la leyenda intercalada (43).
// La cabecera oscura mete todo eso en UNA fila de 80 px y la leyenda se
// va al pie, así que los 212 px dejan de describir nada. Los reemplazan
// `ROOM_HEADER_DARK` y compañía, más abajo, y los 108 px recuperados son
// los que permiten que la mesa crezca de 19.824 a 20.736 px².

// ──────────────────────────────────────────────────────────────────────
// v2-H1-venta-y-sala · decisión 8 · las mesas como FORMAS del local
//
// La maqueta revisada con Matías pinta la sala en oscuro y con formas:
// taburetes redondos sobre una franja de barra, mesas rectangulares en
// el salón, redondas en la terraza. Y pinta cada forma de un tamaño
// distinto (128 el taburete, 190 × 132 la del salón, 168 la de terraza).
//
// EL CONFLICTO, Y CÓMO SE RESUELVE
//
// Esos tres tamaños son exactamente el bug que v1.23 vino a matar: la
// misma mesa de cuatro personas medía 509 × 118 en Salón, 124 × 118 en
// Terraza y un círculo de 84 en Barra —7,1× de diferencia de área para
// el mismo objeto— y el prompt de este bloque prohíbe regresar nada de
// v1.23. El propio prompt lo zanja en su §2: «las formas se colocan por
// zona con el layout que mida v1.23 (**mismo tamaño de mesa en todas las
// zonas**…)».
//
// Así que la maqueta manda en la FORMA y v1.23 manda en el TAMAÑO: **una
// sola caja para toda mesa**, y lo que cambia por zona es el radio. Las
// posiciones absolutas de la maqueta (que están colocadas a mano para la
// sala concreta de La Maestranza) se quedan como ilustración: el reparto
// lo sigue haciendo el `flex-wrap` de v1.23, que es lo que funciona con
// la sala de cualquier comercio y sin editor de posiciones.
//
// Una caja CUADRADA, y no la de 168 × 118 de v1.23, porque un círculo en
// una caja 7:5 es una elipse: el taburete de la barra y la mesa redonda
// de la terraza dejarían de ser «formas del local» para ser óvalos.
// ──────────────────────────────────────────────────────────────────────

/**
 * El lado de la caja de una mesa en la sala de hostelería, en px. **El
 * mismo en Barra, Salón, Terraza y Reservados**, y el mismo en la vista
 * «Todas» y en la filtrada.
 *
 * De dónde sale el 144. La restricción dura es la de v1.23: La
 * Maestranza (4 Barra + 6 Salón + 6 Terraza) entera y **sin desplazar**
 * a 1280 × 800 y a 1443 × 812. Con la cabecera oscura de 80 px y la
 * leyenda al pie, el lienzo dispone de 641 px a 800 y 653 a 812, y tres
 * bandas de una fila piden `3·S + 192`:
 *
 * | S | alto | 1443 × 812 (653) | 1280 × 800 (641) | área |
 * |---|---|---|---|---|
 * | 144 | 624 | cabe, 29 de sobra | cabe, **17 de sobra** | 20.736 |
 * | 148 | 636 | cabe, 17 de sobra | cabe, **5 de sobra** | 21.904 |
 * | 152 | 648 | cabe, 5 de sobra | **NO cabe** | 23.104 |
 *
 * El techo del caso real es 148, y v1.23 habría cogido el techo. Aquí se
 * coge 144 a propósito: `roomCanvasHeight` **reproduce** la regla de
 * corte de flexbox, no la mide, y v1.23 ya dejó escrito que el borde de
 * `1.5px` lo cuantiza el navegador a 1 px por lado. Cinco píxeles de
 * margen están dentro del error de esa reproducción; diecisiete, no. Lo
 * confirma el bucle visual.
 *
 * Y no es una regresión de v1.23: **20.736 px² contra los 19.824** de la
 * tarjeta de 168 × 118. Toda mesa crece y toda mesa sigue midiendo lo
 * mismo que sus vecinas.
 */
export const TABLE_SHAPE_SIZE = 144;

/**
 * El radio por zona. Es lo ÚNICO que distingue una zona de otra.
 *
 * Barra y Terraza son círculos (el taburete y la mesa redonda de la
 * maqueta); Salón y Reservados son rectángulos de esquina blanda. La
 * identidad de la Barra la refuerza además el mostrador dibujado encima,
 * que v1.23 ya conservaba.
 */
export const TABLE_SHAPE_RADIUS: Record<
  "SALON" | "TERRAZA" | "BARRA" | "RESERVADO",
  number
> = {
  BARRA: TABLE_SHAPE_SIZE / 2,
  TERRAZA: TABLE_SHAPE_SIZE / 2,
  SALON: 20,
  RESERVADO: 20,
};

/** Alto de la cabecera oscura de la sala. Medido en la maqueta. */
export const ROOM_HEADER_DARK = 80;

/** `pt-6` del lienzo oscuro. */
export const ROOM_TOP_PADDING_DARK = 24;

/** La leyenda al pie más su separación. Medido en la maqueta. */
export const ROOM_LEGEND_DARK = 55;

/** `px-5` del lienzo oscuro, a cada lado. */
export const ROOM_SIDE_PADDING_DARK = 20;

/**
 * Alto disponible para el lienzo en la sala oscura.
 *
 * Reemplaza a `ROOM_TOP_CHROME`/`ROOM_BOTTOM_CHROME` —que medían la
 * cabecera clara con su fila «Sala · N abiertas…» y su leyenda
 * intercalada, 212 px en total— porque la cabecera oscura mete el
 * título, el contador, los filtros de zona y «Venta rápida» en UNA fila
 * de 80 px. Esos 108 px recuperados son los que permiten que la mesa
 * crezca de 19.824 a 20.736 px² sin que la sala empiece a desplazar.
 */
export function roomAvailableHeightDark(viewportHeight: number): number {
  return Math.max(
    0,
    viewportHeight -
      ROOM_HEADER_DARK -
      ROOM_TOP_PADDING_DARK -
      ROOM_LEGEND_DARK,
  );
}

/** Ancho disponible para el lienzo en la sala oscura. */
export function roomAvailableWidthDark(viewportWidth: number): number {
  return Math.max(0, viewportWidth - 2 * ROOM_SIDE_PADDING_DARK);
}

/**
 * ¿Cabe la sala oscura entera sin desplazar?
 *
 * Es `roomFitsWithoutScroll` con el chrome de la pantalla nueva. La
 * aritmética del lienzo (`roomCanvasHeight`) **no cambia**: sigue siendo
 * la de v1.23, porque el motor de reparto sigue siendo el mismo
 * `flex-wrap` de marcos de zona. Lo único que cambia es cuánto alto hay
 * y cuánto mide una mesa.
 */
export function roomFitsWithoutScrollDark(
  zones: RoomZone[],
  viewportWidth: number,
  viewportHeight: number,
  cardSize: number = TABLE_SHAPE_SIZE,
): boolean {
  return (
    roomCanvasHeight(
      zones,
      roomAvailableWidthDark(viewportWidth),
      cardSize,
      cardSize,
    ) <= roomAvailableHeightDark(viewportHeight)
  );
}

/**
 * Ancho de la línea de texto disponible a `offset` px del centro de una
 * mesa REDONDA de lado `size`.
 *
 * Existe porque el importe de una mesa no se corta nunca (la lección de
 * v1.22 en la tarjeta de mesa), y en un círculo el ancho útil **no es el
 * lado**: en el centro vale el diámetro y a 20 px por debajo —donde va
 * el importe, con el nombre encima— vale la cuerda. Medir contra el lado
 * daría «cabe» a un importe que el círculo recorta por los lados.
 *
 * Cuerda a distancia `d` del centro de una circunferencia de radio `r`:
 * `2·√(r² − d²)`.
 */
export function roundTableChordWidth(
  offsetFromCenter: number,
  size: number = TABLE_SHAPE_SIZE,
): number {
  const r = size / 2;
  const d = Math.min(Math.abs(offsetFromCenter), r);
  return 2 * Math.sqrt(r * r - d * d);
}

/** Tamaño del importe en la tarjeta oscura, en px. */
export const TABLE_AMOUNT_FONT_PX_DARK = 22;

/**
 * Distancia del importe al centro de la mesa, en px. El nombre va encima
 * y el importe debajo; medido sobre la maqueta.
 */
export const TABLE_AMOUNT_OFFSET_DARK = 20;

/**
 * ¿Cabe el importe entero en una mesa REDONDA de la sala oscura?
 *
 * `TABLE_AMOUNT_CHAR_WIDTH` está calibrado a 19 px (v1.22), así que se
 * escala al tamaño de aquí en vez de medir otra cota: es la misma fuente
 * con `tabular-nums` y el ancho por carácter es lineal con el tamaño.
 */
export function roundTableAmountFits(
  amount: string = LONGEST_TABLE_AMOUNT,
  size: number = TABLE_SHAPE_SIZE,
  fontPx: number = TABLE_AMOUNT_FONT_PX_DARK,
): boolean {
  const charWidth = (TABLE_AMOUNT_CHAR_WIDTH * fontPx) / TABLE_AMOUNT_FONT_PX;
  return (
    amount.length * charWidth <=
    roundTableChordWidth(TABLE_AMOUNT_OFFSET_DARK, size)
  );
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
  cardWidth: number = TABLE_SHAPE_SIZE,
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
  cardWidth: number = TABLE_SHAPE_SIZE,
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
  cardWidth: number = TABLE_SHAPE_SIZE,
  cardHeight: number = TABLE_SHAPE_SIZE,
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

// v2-H1 · aquí vivía `TABLE_CARD_CHROME_X` (el `p-3.5` más el
// `border-2` que la tarjeta clara se comía antes del contenido). La
// forma oscura centra su contenido sin padding, así que el cromo
// horizontal es cero y lo que limita es la geometría del círculo: ver
// `roundTableChordWidth`.

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

// v2-H1 · y aquí vivían `tableAmountWidth`, `tableCardContentWidth` y
// `tableAmountFits`, la cuenta rectangular de v1.22. Las sustituye
// `roundTableAmountFits`, que mide contra la CUERDA del círculo: es
// estrictamente más estrecha que el lado, así que un importe que entra
// en la mesa redonda entra también en la rectangular del Salón. Una sola
// cuenta, y la más exigente de las dos.
