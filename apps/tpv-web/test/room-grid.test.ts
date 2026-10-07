// v1.23-las-mesas-miden-lo-mismo · la aritmética del mapa de sala.
//
// jsdom no hace layout (`getBoundingClientRect` devuelve ceros), así que
// "caben las 16 mesas sin desplazar" no se comprueba montando el
// componente. Lo que sí se puede es comprobar la aritmética que alimenta
// al componente — mismo trato que `catalog-grid.test.ts` —, y dejar los
// rects de verdad para el bucle visual con Playwright.
//
// v2-H1-venta-y-sala · la invariante de v1.23 sigue siendo la misma y la
// aritmética del lienzo también (el motor de reparto sigue siendo el
// `flex-wrap` de marcos de zona). Lo que cambia son dos cosas:
//
//   1. **La mesa es cuadrada y mide 144**, porque la decisión 8 pide
//      formas —taburete redondo, mesa rectangular, mesa redonda— y un
//      círculo en una caja 7:5 es una elipse. El tamaño sigue siendo UNO
//      para toda mesa, que es lo que v1.23 vino a imponer, y el área
//      sube: 20.736 px² contra 19.824.
//   2. **El tamaño ya no vive en una clase de Tailwind.** Entra por
//      `style` con `TABLE_SHAPE_SIZE`, así que el número existe una sola
//      vez y los dos tests que vigilaban la copia (la clase contra la
//      constante, y el `grid-cols-2` de handheld) dejan de tener objeto.
//      Lo que los sustituye es más fuerte: `table-map-tamano-unico`
//      afirma el píxel que cada forma lleva PUESTO.
//
// Lo que NO cubre este fichero (está en el `-done` del bloque): que el
// navegador reparta las zonas como dice `roomCanvasHeight`, y que dos
// mesas de zonas distintas acaben con el mismo rect en pantalla.

import { describe, expect, it } from "vitest";

import {
  LONGEST_TABLE_AMOUNT,
  ROOM_GRID_GAP,
  TABLE_SHAPE_RADIUS,
  TABLE_SHAPE_SIZE,
  ZONE_BORDER,
  ZONE_PADDING,
  roomAvailableHeightDark,
  roomAvailableWidthDark,
  roomCanvasHeight,
  roomColumnsFor,
  roomFitsWithoutScrollDark,
  roundTableAmountFits,
  roundTableChordWidth,
  zoneOuterWidth,
} from "../src/lib/roomGrid.js";

/**
 * La Maestranza, el caso real del AP13: 4 Barra + 6 Salón + 6 Terraza.
 *
 * v2-H1 · la Barra va PRIMERA (decisión 8), así que el orden de esta
 * lista es el de `ZONE_ORDER` y no el de v1.23. Importa para el cálculo:
 * la zona que va primera es la que abre línea.
 */
const MAESTRANZA = [
  { tables: 4, isBar: true },
  { tables: 6 },
  { tables: 6 },
];

/** Sirope: cuatro mesas, tres de salón y una de terraza. */
const SIROPE = [{ tables: 3 }, { tables: 1 }];

describe("roomGrid · tamaño único de mesa", () => {
  it("es UN solo tamaño, y cuadrado", () => {
    // Cuadrado porque la decisión 8 pide círculos en Barra y Terraza, y
    // un círculo en una caja 7:5 sale elipse.
    expect(TABLE_SHAPE_SIZE).toBe(144);
  });

  it("respeta el mínimo táctil de tokens.md, y con holgura", () => {
    // La escala táctil se abre en 48 y esta pantalla usa 56 de suelo.
    expect(TABLE_SHAPE_SIZE).toBeGreaterThanOrEqual(56);
  });

  it("ninguna mesa pierde área respecto a v1.23", () => {
    // v1.23 dejó toda mesa en 168 × 118 = 19.824 px², viniendo del
    // taburete de 84 × 84 (7.056) que era la séptima parte de una mesa
    // de Salón. Este bloque cambia la FORMA, y la forma no puede ser la
    // excusa para que la mesa vuelva a encogerse.
    const area = TABLE_SHAPE_SIZE * TABLE_SHAPE_SIZE;
    expect(area).toBeGreaterThanOrEqual(168 * 118);
    expect(area).toBeGreaterThanOrEqual(84 * 84);
  });

  it("la forma cambia por zona: círculo en Barra y Terraza", () => {
    // Un círculo es radio = mitad del lado. El Salón y los Reservados
    // son rectángulos de esquina blanda, así que su radio es MENOR.
    expect(TABLE_SHAPE_RADIUS.BARRA).toBe(TABLE_SHAPE_SIZE / 2);
    expect(TABLE_SHAPE_RADIUS.TERRAZA).toBe(TABLE_SHAPE_SIZE / 2);
    expect(TABLE_SHAPE_RADIUS.SALON).toBeLessThan(TABLE_SHAPE_SIZE / 2);
    expect(TABLE_SHAPE_RADIUS.RESERVADO).toBeLessThan(TABLE_SHAPE_SIZE / 2);
  });
});

describe("roomGrid · handheld", () => {
  it("a 390 px el flex-wrap da DOS columnas sin tener que escribirlo", () => {
    // v1.23 necesitaba un `grid-cols-2` a mano por debajo de `sm`:
    // con la tarjeta de 168 px, a 390 sólo cabía una columna y el mapa
    // se iba a 2.614 px de scroll.
    //
    // Con 144 px el reparto general ya da dos: el main deja 390 − 2·20 =
    // 350, el marco de zona se lleva 2·18 + 2 de borde = 38, y en los
    // 312 restantes entran dos mesas de 144 con su hueco de 14 (302).
    // Una excepción menos que mantener.
    const interior = 390 - 2 * 20 - 2 * ZONE_PADDING - ZONE_BORDER;
    expect(roomColumnsFor(interior)).toBe(2);
  });

  it("y cada una sigue siendo un objetivo tocable de sobra", () => {
    // No hace falta `handheldCardWidth`: la mesa mide 144 en handheld
    // igual que en el terminal, porque el tamaño ya no depende de la
    // celda. Una mesa no es más pequeña por mirarla en un móvil.
    expect(TABLE_SHAPE_SIZE).toBeGreaterThanOrEqual(144);
  });

  it("a 320 px —el estrecho de verdad— baja a una columna, no a una miniatura", () => {
    // Lo correcto cuando no hay ancho es que BAJE DE FILA, nunca que la
    // mesa se encoja. Es la regla que v1.23 dejó escrita: «si mañana una
    // sala pide más mesas por banda, lo que cede es el número de
    // columnas, nunca el tamaño de la tarjeta».
    const interior = 320 - 2 * 20 - 2 * ZONE_PADDING - ZONE_BORDER;
    expect(roomColumnsFor(interior)).toBe(1);
  });
});

describe("roomGrid · las columnas salen del ancho, no de un grid-cols-N", () => {
  it("una zona de 6 mesas en 1443 px usa más de dos columnas", () => {
    const columnas = roomColumnsFor(
      roomAvailableWidthDark(1443) - 2 * ZONE_PADDING,
    );
    expect(columnas).toBeGreaterThan(2);
    expect(columnas).toBeGreaterThanOrEqual(6);
  });

  it("a 1280 px también caben las 6 mesas de una banda en una fila", () => {
    const columnas = roomColumnsFor(
      roomAvailableWidthDark(1280) - 2 * ZONE_PADDING,
    );
    expect(columnas).toBeGreaterThanOrEqual(6);
  });

  it("con la tarjeta de 508 px de Salón (AP13) la banda se queda en dos columnas", () => {
    // El sabotaje de verdad: si la mesa vuelve a medir lo que medía en
    // Salón antes de v1.23, el ancho disponible sólo da para dos.
    expect(
      roomColumnsFor(roomAvailableWidthDark(1443) - 2 * ZONE_PADDING, 508),
    ).toBe(2);
  });

  it("la zona pide el ancho de sus mesas, no uno fijado de antemano", () => {
    // 6 mesas: 6·144 + 5·14 + 2·18 = 970. La Terraza de v1.9.3 vivía en
    // una columna de 300 px pasara lo que pasara.
    expect(zoneOuterWidth(6)).toBe(
      6 * TABLE_SHAPE_SIZE + 5 * ROOM_GRID_GAP + 2 * ZONE_PADDING,
    );
    expect(zoneOuterWidth(6)).not.toBe(300);
    expect(zoneOuterWidth(4)).toBeLessThan(zoneOuterWidth(6));
  });
});

describe("roomGrid · la sala entera se ve sin desplazar", () => {
  it("La Maestranza cabe a 1443 × 812 y a 1280 × 800", () => {
    expect(roomFitsWithoutScrollDark(MAESTRANZA, 1443, 812)).toBe(true);
    expect(roomFitsWithoutScrollDark(MAESTRANZA, 1280, 800)).toBe(true);
  });

  it("Sirope cabe en los dos tamaños", () => {
    expect(roomFitsWithoutScrollDark(SIROPE, 1443, 812)).toBe(true);
    expect(roomFitsWithoutScrollDark(SIROPE, 1280, 800)).toBe(true);
  });

  it("con la tarjeta de 508 px de Salón NO cabía: eso es lo que se arregla", () => {
    expect(roomFitsWithoutScrollDark(MAESTRANZA, 1443, 812, 508)).toBe(false);
  });

  it("144 es la medida elegida, y 152 ya no cabría a 1280 × 800", () => {
    // El techo del caso real es 148 y aquí se coge 144 a propósito:
    // `roomCanvasHeight` REPRODUCE la regla de corte de flexbox, no la
    // mide, y 5 px de margen están dentro del error de esa
    // reproducción. Este test fija las dos cosas: que la elegida cabe y
    // que el siguiente peldaño redondo no.
    expect(roomFitsWithoutScrollDark(MAESTRANZA, 1280, 800, 144)).toBe(true);
    expect(roomFitsWithoutScrollDark(MAESTRANZA, 1280, 800, 152)).toBe(false);
  });

  it("las zonas bajan de línea en vez de encogerse hasta no caber", () => {
    // Tres bandas de 4/6/6 a 1443: la Barra (654) y el Salón (970) no
    // caben juntas en los 1.403 útiles, así que son tres líneas.
    const alto = roomCanvasHeight(MAESTRANZA, roomAvailableWidthDark(1443));
    // Barra 224 (38 + 144 + 42 de mostrador) + 18 + Salón 182 + 18 +
    // Terraza 182 = 624.
    expect(alto).toBe(624);
    expect(alto).toBeLessThanOrEqual(roomAvailableHeightDark(800));
  });

  it("una sala grande no se sale: las mesas pasan a varias filas", () => {
    const ancho = roomAvailableWidthDark(1280);
    const alto = roomCanvasHeight([{ tables: 20 }], ancho);
    const filas = Math.ceil(20 / roomColumnsFor(ancho - 2 * ZONE_PADDING));
    expect(alto).toBe(
      2 * ZONE_PADDING +
        ZONE_BORDER +
        filas * TABLE_SHAPE_SIZE +
        (filas - 1) * ROOM_GRID_GAP,
    );
  });
});

describe("roomGrid · el importe cabe DENTRO de la forma redonda", () => {
  it("el ancho útil de un círculo no es el lado: es la cuerda", () => {
    // En el centro vale el diámetro; a 20 px por debajo —donde va el
    // importe, con el nombre encima— vale menos. Medir contra el lado
    // daría «cabe» a un importe que el círculo recorta por los lados.
    expect(roundTableChordWidth(0)).toBe(TABLE_SHAPE_SIZE);
    expect(roundTableChordWidth(20)).toBeLessThan(TABLE_SHAPE_SIZE);
    expect(roundTableChordWidth(20)).toBeCloseTo(138.3, 1);
  });

  it("el importe más largo entra en la mesa redonda", () => {
    expect(roundTableAmountFits(LONGEST_TABLE_AMOUNT)).toBe(true);
  });

  it("y con una mesa bastante más pequeña ya NO entraría", () => {
    // El sabotaje: encoger la mesa «un poco» recorta el dinero, que es
    // el dato que el camarero comprueba. El test dice dónde está el
    // límite en vez de dejarlo a la vista de una captura.
    expect(roundTableAmountFits(LONGEST_TABLE_AMOUNT, 120)).toBe(false);
  });

  it("el separador de millares no está en la cuenta porque no se pinta", () => {
    // Atadura heredada de v1.22: si `formatEur` empezara a separar
    // millares, la medida se quedaría corta en silencio.
    expect(LONGEST_TABLE_AMOUNT).not.toContain(".");
  });
});
