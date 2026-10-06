// v1.23-las-mesas-miden-lo-mismo · la aritmética del mapa de sala.
//
// jsdom no hace layout (`getBoundingClientRect` devuelve ceros), así que
// "caben las 16 mesas sin desplazar" no se comprueba montando el
// componente. Lo que sí se puede es comprobar la aritmética que alimenta
// al componente — mismo trato que `catalog-grid.test.ts` —, y dejar los
// rects de verdad para el bucle visual con Playwright.
//
// Lo que NO cubre este fichero (está en el `-done` del bloque): que el
// navegador reparta las zonas como dice `roomCanvasHeight`, y que dos
// mesas de zonas distintas acaben con el mismo rect en pantalla.

import { describe, expect, it } from "vitest";

import {
  ROOM_GRID_GAP,
  TABLE_CARD_HEIGHT,
  TABLE_CARD_SIZE_CLASS,
  TABLE_CARD_WIDTH,
  ZONE_PADDING,
  roomCanvasHeight,
  roomColumnsFor,
  roomFitsWithoutScroll,
  zoneOuterWidth,
} from "../src/lib/roomGrid.js";

/** La Maestranza, el caso real del AP13: 6 Salón + 6 Terraza + 4 Barra. */
const MAESTRANZA = [
  { tables: 6 },
  { tables: 6 },
  { tables: 4, isBar: true },
];

/** Sirope: cuatro mesas, tres de salón y una de terraza. */
const SIROPE = [{ tables: 3 }, { tables: 1 }];

describe("roomGrid · tamaño único de tarjeta", () => {
  it("la clase que pinta y las constantes que miden dicen lo mismo", () => {
    // El JIT de Tailwind no compila `w-[${W}px]`, así que el número vive
    // en la clase Y en la constante. Si alguien toca uno de los dos, el
    // bloque entero deja de medir lo que dice medir.
    expect(TABLE_CARD_SIZE_CLASS).toContain(`h-[${TABLE_CARD_HEIGHT}px]`);
    expect(TABLE_CARD_SIZE_CLASS).toContain(`sm:w-[${TABLE_CARD_WIDTH}px]`);
    // Handheld: una columna a ancho completo.
    expect(TABLE_CARD_SIZE_CLASS).toContain("w-full");
  });

  it("respeta el mínimo táctil de tokens.md (64 × 64)", () => {
    expect(TABLE_CARD_WIDTH).toBeGreaterThanOrEqual(64);
    expect(TABLE_CARD_HEIGHT).toBeGreaterThanOrEqual(64);
  });

  it("una mesa de barra no puede tener menos área que una de salón", () => {
    // El taburete de v1.9.3 era un círculo de 84 × 84 px: 7.056 px² de
    // caja contra los 59.944 de una mesa de Salón en el AP13. Ahora la
    // barra pinta LA MISMA tarjeta, así que el área es la misma —
    // nunca menor.
    const areaMesa = TABLE_CARD_WIDTH * TABLE_CARD_HEIGHT;
    const areaTaburete84 = 84 * 84;
    expect(areaMesa).toBeGreaterThanOrEqual(areaTaburete84);
  });
});

describe("roomGrid · las columnas salen del ancho, no de un grid-cols-N", () => {
  it("una zona de 6 mesas en 1443 px usa más de dos columnas", () => {
    // Lienzo útil a 1443: 1443 - 2·28 (el `p-7` del main) = 1387.
    // Ancho interior del marco de zona: 1387 - 2·18 = 1351.
    const columnas = roomColumnsFor(1443 - 2 * 28 - 2 * ZONE_PADDING);
    expect(columnas).toBeGreaterThan(2);
    expect(columnas).toBe(7);
  });

  it("a 1280 px también caben las 6 mesas de una banda en una fila", () => {
    const columnas = roomColumnsFor(1280 - 2 * 28 - 2 * ZONE_PADDING);
    expect(columnas).toBeGreaterThanOrEqual(6);
  });

  it("con la tarjeta de 508 px de Salón (AP13) la banda se queda en dos columnas", () => {
    // El sabotaje de verdad: si la tarjeta vuelve a medir lo que medía
    // en Salón, el ancho disponible sólo da para dos.
    expect(roomColumnsFor(1443 - 2 * 28 - 2 * ZONE_PADDING, 508)).toBe(2);
  });

  it("la zona pide el ancho de sus mesas, no uno fijado de antemano", () => {
    // 6 mesas: 6·168 + 5·14 + 2·18 = 1114. La Terraza de v1.9.3 vivía en
    // una columna de 300 px pasara lo que pasara.
    expect(zoneOuterWidth(6)).toBe(
      6 * TABLE_CARD_WIDTH + 5 * ROOM_GRID_GAP + 2 * ZONE_PADDING,
    );
    expect(zoneOuterWidth(6)).not.toBe(300);
    expect(zoneOuterWidth(4)).toBeLessThan(zoneOuterWidth(6));
  });
});

describe("roomGrid · la sala entera se ve sin desplazar", () => {
  it("La Maestranza cabe a 1443 × 812 y a 1280 × 800", () => {
    expect(roomFitsWithoutScroll(MAESTRANZA, 1443, 812)).toBe(true);
    expect(roomFitsWithoutScroll(MAESTRANZA, 1280, 800)).toBe(true);
  });

  it("Sirope cabe en los dos tamaños", () => {
    expect(roomFitsWithoutScroll(SIROPE, 1443, 812)).toBe(true);
    expect(roomFitsWithoutScroll(SIROPE, 1280, 800)).toBe(true);
  });

  it("con la tarjeta de 508 px de Salón NO cabía: eso es lo que se arregla", () => {
    expect(roomFitsWithoutScroll(MAESTRANZA, 1443, 812, 508)).toBe(false);
  });

  it("las zonas bajan de línea en vez de encogerse hasta no caber", () => {
    // Tres bandas de 6/6/4 a 1443: Salón no deja sitio a Terraza en su
    // línea (1114 + 18 + 1114 > 1387), así que son tres líneas.
    const alto = roomCanvasHeight(MAESTRANZA, 1443 - 2 * 28);
    // 154 (Salón) + 18 + 154 (Terraza) + 18 + 196 (Barra, con mostrador).
    expect(alto).toBe(540);
  });

  it("una sala grande no se sale: las mesas pasan a varias filas", () => {
    // 20 mesas en una sola zona a 1280: 6 columnas → 4 filas.
    const alto = roomCanvasHeight([{ tables: 20 }], 1280 - 2 * 28);
    const filas = Math.ceil(20 / roomColumnsFor(1280 - 2 * 28 - 2 * ZONE_PADDING));
    expect(alto).toBe(
      2 * ZONE_PADDING +
        filas * TABLE_CARD_HEIGHT +
        (filas - 1) * ROOM_GRID_GAP,
    );
  });
});
