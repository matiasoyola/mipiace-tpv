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
export function roomAvailableHeightDark(
  viewportHeight: number,
  // n1-hosteleria · en la mano la cabecera son DOS filas (112 px, no
  // 80). El reparto por defecto es el del terminal, así que los quince
  // terminales en producción no notan este parámetro.
  reparto: RepartoDeSala = REPARTO_TERMINAL,
): number {
  return Math.max(
    0,
    viewportHeight -
      reparto.headerHeight -
      reparto.topPadding -
      reparto.legendHeight,
  );
}

/** Ancho disponible para el lienzo en la sala oscura. */
export function roomAvailableWidthDark(
  viewportWidth: number,
  reparto: RepartoDeSala = REPARTO_TERMINAL,
): number {
  return Math.max(0, viewportWidth - 2 * reparto.sidePadding);
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
  reparto: RepartoDeSala = REPARTO_TERMINAL,
): boolean {
  return (
    roomCanvasHeight(
      zones,
      roomAvailableWidthDark(viewportWidth, reparto),
      cardSize,
      cardSize,
      reparto.zonePadding,
    ) <= roomAvailableHeightDark(viewportHeight, reparto)
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
  // n1-hosteleria · el relleno del marco entra por parámetro porque en
  // un aparato de mano vale 12 y no 18 (`ZONE_PADDING_MANO`). El valor
  // por defecto es el de siempre, así que el terminal no se mueve.
  zonePadding: number = ZONE_PADDING,
): number {
  if (columns <= 0) return 2 * zonePadding;
  return columns * cardWidth + (columns - 1) * gap + 2 * zonePadding;
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
  // n1-hosteleria · ver la nota de `zoneOuterWidth`.
  zonePadding: number = ZONE_PADDING,
): number {
  const maxColumns = roomColumnsFor(
    availableWidth - 2 * zonePadding,
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
    const width = zoneOuterWidth(columns, cardWidth, ROOM_GRID_GAP, zonePadding);
    const rows = Math.max(1, Math.ceil(zone.tables / columns));
    const height =
      2 * zonePadding +
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

// ── auditoria-sirope (#13) · LA MESA SALE DEL ANCHO QUE HAY ──────────
//
// `TABLE_SHAPE_SIZE` es un número fijo —144— calculado para el peor caso
// de La Maestranza a 1280 × 800. En el D8 de Sirope, con tres zonas de
// pocas mesas, eso dejaba ≈ 190 px muertos a la derecha del lienzo
// (captura 23) y mesas más pequeñas de lo que la pantalla permite.
//
// La regla de v1.23 que NO se toca: **todas las mesas miden lo mismo**,
// en todas las zonas y en la vista filtrada. Lo que cambia es que el
// número ya no está escrito: se elige el MAYOR tamaño con el que la sala
// entera sigue cabiendo sin desplazar, entre un suelo y un techo.
//
//   · El suelo (120) es el objetivo táctil con holgura: una mesa más
//     pequeña se falla con el dedo en una barra llena.
//   · El techo (200) existe porque una sala de tres mesas no debe pintar
//     tres pantallas táctiles: a partir de ahí la mesa deja de parecer
//     una mesa y el mapa deja de leerse de un golpe.
//
// 144 sigue siendo lo que sale en el caso que lo justificaba (La
// Maestranza a 1280 × 800), así que no es una regresión de nada: es el
// mismo número cuando toca y uno mayor cuando sobra sitio.

/** El lado mínimo de una mesa. Por debajo se falla con el dedo. */
export const TABLE_SHAPE_MIN = 120;
/** El lado máximo. Por encima, el mapa deja de leerse de un golpe. */
export const TABLE_SHAPE_MAX = 200;
/** De cuatro en cuatro: pasos más finos no se ven y multiplican la cuenta. */
const PASO_TAMANO = 4;

/**
 * El lado de mesa para esta sala en este viewport.
 *
 * El mayor múltiplo de 4 entre el suelo y el techo con el que la sala
 * entera cabe sin desplazar. Si ni con el suelo cabe, devuelve el suelo:
 * la sala desplaza —que es lo que hacía— pero las mesas no se encogen
 * por debajo de lo que un dedo acierta.
 */
export function tamanoDeMesaPara(
  zones: RoomZone[],
  viewportWidth: number,
  viewportHeight: number,
  // n1-hosteleria · el suelo y el techo salen del reparto: en la mano
  // son 88 y 144 (ver `TABLE_SHAPE_MIN_MANO`), en el terminal los 120 y
  // 200 de auditoria-sirope (#13), que es el valor por defecto.
  reparto: RepartoDeSala = REPARTO_TERMINAL,
): number {
  if (zones.length === 0) return TABLE_SHAPE_SIZE;
  for (
    let s = reparto.tableMax;
    s >= reparto.tableMin;
    s -= PASO_TAMANO
  ) {
    if (
      roomFitsWithoutScrollDark(zones, viewportWidth, viewportHeight, s, reparto)
    ) {
      return s;
    }
  }
  return reparto.tableMin;
}

/**
 * Lo que sobra a la derecha del lienzo con este tamaño de mesa.
 *
 * No lo usa la pantalla: lo usa el TEST, que es quien tiene que poder
 * decir «en el D8 sobran 190 px» sin pintar nada. Es la medida del
 * hallazgo, y tenerla escrita es lo que impide que vuelva.
 */
export function huecoALaDerecha(
  zones: RoomZone[],
  viewportWidth: number,
  cardSize: number = TABLE_SHAPE_SIZE,
): number {
  const disponible = roomAvailableWidthDark(viewportWidth);
  // El marco de zona más ancho manda: las zonas se reparten con
  // `flex-wrap`, así que lo que sobra es lo que le sobra a la fila más
  // llena.
  let masAncho = 0;
  for (const z of zones) {
    const columnas = Math.min(
      z.tables,
      roomColumnsFor(disponible - 2 * ZONE_PADDING, cardSize),
    );
    masAncho = Math.max(masAncho, zoneOuterWidth(columnas, cardSize));
  }
  return Math.max(0, disponible - masAncho);
}

// ──────────────────────────────────────────────────────────────────────
// n1-hosteleria · EL REPARTO DE LA SALA, EN DOS JUEGOS Y NI UNO MÁS
//
// Todo lo que cambia en un aparato de mano vive aquí, junto, y se elige
// con UN booleano que sale de `useAparatoDeMano` (umbral único,
// `lib/aparatoDeMano.ts`). Antes de esto las pantallas mezclaban
// constantes del módulo con `sm:` del CSS; cualquier número nuevo era
// una tercera forma de decidir lo mismo.
//
// La restricción del bloque se cumple por construcción: `REPARTO_MANO`
// sólo se usa por debajo del umbral, y `REPARTO_TERMINAL` toma sus
// valores de las constantes de siempre, así que el AP11, el AP13 y el D8
// no pueden moverse ni un píxel sin cambiar aquellas.
// ──────────────────────────────────────────────────────────────────────

export interface RepartoDeSala {
  /** `px-5` / `px-4` del lienzo, a cada lado. */
  sidePadding: number;
  /** `pt-6` del lienzo. */
  topPadding: number;
  /** Alto de la cabecera (una fila en el terminal, DOS en la mano). */
  headerHeight: number;
  /** La leyenda al pie más su separación. */
  legendHeight: number;
  /** El `p-[18px]` del marco de zona, a cada lado. */
  zonePadding: number;
  /** Suelo y techo del lado de mesa que elige `tamanoDeMesaPara`. */
  tableMin: number;
  tableMax: number;
  /** Tamaño y posición del importe dentro de la forma. */
  amountFontPx: number;
  amountOffsetPx: number;
}

/** Lo de siempre: los quince terminales en producción. */
export const REPARTO_TERMINAL: RepartoDeSala = {
  sidePadding: ROOM_SIDE_PADDING_DARK,
  topPadding: ROOM_TOP_PADDING_DARK,
  headerHeight: ROOM_HEADER_DARK,
  legendHeight: ROOM_LEGEND_DARK,
  zonePadding: ZONE_PADDING,
  tableMin: TABLE_SHAPE_MIN,
  tableMax: TABLE_SHAPE_MAX,
  amountFontPx: TABLE_AMOUNT_FONT_PX_DARK,
  amountOffsetPx: TABLE_AMOUNT_OFFSET_DARK,
};

/**
 * La cabecera de mano, en DOS filas de 56 px.
 *
 * La de una fila es la causa medida del hallazgo 1 de la pasada del
 * 18-10: con todos sus hijos en `shrink-0` su ancho de contenido mínimo
 * era ~845 px, y el WebView de Android ensancha el viewport de
 * maquetación hasta ese mínimo —`innerWidth` 845 con
 * `documentElement.clientWidth` 360—, dejando 485 px fuera y los chips
 * «Salón» y «Terraza» inalcanzables. Dos filas, y que la de los chips
 * desplace sola, es lo que devuelve `innerWidth` a 360.
 *
 * 56 = objetivo táctil de 44 más 6 arriba y 6 abajo.
 */
export const ROOM_HEADER_MANO = 2 * 56;

/**
 * El suelo del lado de mesa en la mano: **88 px**.
 *
 * El suelo del terminal son 120 y su razón es «por debajo se falla con
 * el dedo» (auditoria-sirope #13) — medida pensada para una pantalla de
 * 10–15" **vista desde el mostrador**. El N1 va EN LA MANO, a 30–40 cm,
 * y 88 px siguen siendo el DOBLE del mínimo táctil de la casa (44).
 *
 * Y 88 es el número que hace falta, no uno cualquiera: el objetivo del
 * bloque es **tres mesas por fila a 360**. Con `sidePadding` 16 el
 * lienzo dispone de 328 y el marco de zona se come 2 × 12, así que
 * quedan 304 para las mesas:
 *
 *   roomColumnsFor(304, 88, 14) = ⌊(304 + 14) / (88 + 14)⌋ = 3
 *
 * y la fila mide 3 × 88 + 2 × 14 = 292, con **12 px de holgura** sobre
 * los 304. Doce y no cinco a propósito: `roomCanvasHeight` *reproduce*
 * la regla de corte de flexbox en vez de medirla, y v2-H1 ya dejó
 * escrito que cinco píxeles caen dentro del error de esa reproducción.
 *
 * Con 92 habría 3 columnas pero 4 px de holgura; con 94 harían falta
 * marcos de 8 px, y el marco de zona lleva borde discontinuo y rótulo
 * flotante: a 8 px las mesas se le meten debajo.
 */
export const TABLE_SHAPE_MIN_MANO = 88;

/**
 * El techo en la mano. Con 23 mesas nunca se alcanza —la sala no cabe
 * sin desplazar a ningún tamaño, así que `tamanoDeMesaPara` cae al
 * suelo—, pero una sala de tres mesas no debe pintar tres pantallas
 * táctiles. 144 es el lado del terminal: en la mano es ya el máximo
 * razonable, no el caso normal.
 */
export const TABLE_SHAPE_MAX_MANO = 144;

/**
 * El importe de la mesa en la mano: **14 px a 10 px del centro**.
 *
 * El importe no se corta NUNCA (la lección de v1.22), y en un círculo lo
 * que limita es la cuerda, no el lado. Para el peor importe
 * (`LONGEST_TABLE_AMOUNT`, 9 caracteres) y una mesa de 88:
 *
 *   cuerda a 10 px del centro = 2·√(44² − 10²) = 85,7 px
 *   lo que pide a 14 px        = 9 · 11,5 · 14/19 = 76,3 px
 *   margen                     = 9,4 px
 *
 * A 15 px el margen baja a 3,9 y a 16 ya no entra. Los 22 px del
 * terminal piden 119,8: más que el diámetro entero de la mesa pequeña,
 * así que aquí no era cuestión de gusto.
 *
 * Catorce píxeles leídos a 30–40 cm, que es donde se tiene el aparato,
 * es lo que en el terminal serían ~26 a un metro. El espíritu de
 * `principio-venta-bajo-estres` se mantiene; su cifra no se copia.
 */
export const TABLE_AMOUNT_FONT_PX_MANO = 14;
export const TABLE_AMOUNT_OFFSET_MANO = 10;

/** El relleno del marco de zona en la mano. Ver `TABLE_SHAPE_MIN_MANO`. */
export const ZONE_PADDING_MANO = 12;

/** El `px-4` del lienzo en la mano: los 328 px útiles de la pasada. */
export const ROOM_SIDE_PADDING_MANO = 16;

/** El reparto de un aparato de mano (N1 en vertical, 360 px). */
export const REPARTO_MANO: RepartoDeSala = {
  sidePadding: ROOM_SIDE_PADDING_MANO,
  topPadding: ROOM_TOP_PADDING_DARK,
  headerHeight: ROOM_HEADER_MANO,
  legendHeight: ROOM_LEGEND_DARK,
  zonePadding: ZONE_PADDING_MANO,
  tableMin: TABLE_SHAPE_MIN_MANO,
  tableMax: TABLE_SHAPE_MAX_MANO,
  amountFontPx: TABLE_AMOUNT_FONT_PX_MANO,
  amountOffsetPx: TABLE_AMOUNT_OFFSET_MANO,
};

/** El reparto que toca. `deMano` sale de `useAparatoDeMano`. */
export function repartoDeSala(deMano: boolean): RepartoDeSala {
  return deMano ? REPARTO_MANO : REPARTO_TERMINAL;
}

/**
 * Cuántas mesas se ven SIN DESPLAZAR en un aparato de mano.
 *
 * Es el criterio de cierre del §1 del bloque —«con "Todas" y las 23
 * mesas de Sirope, al menos 9 a la vista»— escrito como aritmética para
 * que lo mida un banco y no sólo el navegador.
 *
 * Modela el reparto de MANO, que es el único en el que la pregunta tiene
 * sentido: por debajo de `sm` el lienzo es `flex flex-col` y las zonas se
 * apilan una debajo de otra (en el terminal es `sm:flex-row
 * sm:flex-wrap` y lo que limita es el ancho, no el alto). Recorre las
 * zonas en el orden en que se pintan —`ZONE_ORDER`, Barra primero— y
 * cuenta fila a fila hasta que una no cabe entera.
 *
 * Una fila cuenta sólo si cabe COMPLETA: media mesa asomando por abajo
 * no es una mesa que el camarero vea y toque.
 */
export function mesasALaVistaDeMano(
  zones: RoomZone[],
  availableWidth: number,
  availableHeight: number,
  cardSize: number = TABLE_SHAPE_MIN_MANO,
  zonePadding: number = ZONE_PADDING_MANO,
): number {
  const maxColumns = roomColumnsFor(availableWidth - 2 * zonePadding, cardSize);
  let y = 0;
  let vistas = 0;
  for (const zone of zones) {
    const columns = Math.max(1, Math.min(zone.tables, maxColumns));
    const rows = Math.max(1, Math.ceil(zone.tables / columns));
    // Lo que la zona mete por encima de su primera fila de mesas.
    const chrome =
      2 * zonePadding + ZONE_BORDER + (zone.isBar ? BAR_COUNTER_HEIGHT : 0);
    for (let r = 0; r < rows; r += 1) {
      const bottom = y + chrome + (r + 1) * cardSize + r * ROOM_GRID_GAP;
      if (bottom > availableHeight) return vistas;
      vistas += Math.min(columns, zone.tables - r * columns);
    }
    y += chrome + rows * cardSize + (rows - 1) * ROOM_GRID_GAP + ZONE_GAP;
  }
  return vistas;
}
