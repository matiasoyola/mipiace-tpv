// n1-hosteleria · LA ARITMÉTICA DE LA SALA EN UN APARATO DE MANO.
//
// El hallazgo 1 de la pasada del 18-10 (`docs/qa/2026-10-18-n1-sirope.md`,
// 🔴): a 360 px las mesas se pintaban de 144 y se veían 3 de las 23 de
// Sirope, con «Salón» y «Terraza» fuera de la pantalla.
//
// Lo que jsdom SÍ puede medir es esto: los números que entran en el
// reparto. Lo que NO —si una mesa cae dentro de la pantalla— va en la
// tabla de medidas del navegador del `-done` (`n1-vertical-done` §4.2
// dejó dicho por qué).
//
// Las dos filas de la tabla de sabotajes que viven aquí:
//
//   | La mesa en estrecho vuelve a 144 px   | columnas a 360 ≠ 3
//   | El umbral de estrecho se aplica a 1280 | el banco del AP11

import { describe, expect, it } from "vitest";

import {
  esAparatoDeMano,
  UMBRAL_MANO_PX,
} from "../src/lib/aparatoDeMano.js";
import { MIN_TOUCH_PX } from "../src/lib/hospitalityTheme.js";
import {
  COBRAR_AMOUNT_FONT_PX_MANO,
  COBRAR_BOTTOM_MANO,
  cobrarMaxWidth,
  COBRAR_HEIGHT,
  COBRAR_HEIGHT_MANO,
  COBRAR_MARGEN_MANO,
  COBRAR_PADDING_X_MANO,
} from "../src/pages/TableMapScreen.js";
import {
  LONGEST_TABLE_AMOUNT,
  TABLE_AMOUNT_CHAR_WIDTH,
  TABLE_AMOUNT_FONT_PX,
  REPARTO_MANO,
  REPARTO_TERMINAL,
  repartoDeSala,
  mesasALaVistaDeMano,
  roomAvailableHeightDark,
  roomAvailableWidthDark,
  roomCanvasHeight,
  roomColumnsFor,
  roundTableAmountFits,
  TABLE_AMOUNT_FONT_PX_MANO,
  TABLE_SHAPE_MIN_MANO,
  TABLE_SHAPE_SIZE,
  tamanoDeMesaPara,
  type RoomZone,
} from "../src/lib/roomGrid.js";

/** El N1 en vertical. */
const N1 = { w: 360, h: 720 };
/** El AP11 como caja, que es el peor caso de la restricción. */
const AP11 = { w: 1280, h: 800 };
/** El D8 de Sirope. */
const D8 = { w: 1442, h: 811 };

/**
 * La sala de Sirope, **contada en producción el 18-10-2026**: BARRA 8,
 * SALÓN 7, TERRAZA 8 = 23 mesas, ninguna agrupada. En el orden en que
 * las pinta el lienzo (`ZONE_ORDER`, Barra primero).
 *
 * El 3 + 6 + 4 que había aquí eran 13 y no cuadraban con la pasada del
 * 18-10, que midió 23 sobre la cuenta real (hallazgo 1). Las
 * conclusiones de #13 no cambian: en el D8 sigue eligiendo 152, que es
 * lo que este banco afirma.
 */
const SIROPE: RoomZone[] = [
  { tables: 8, isBar: true },
  { tables: 7 },
  { tables: 8 },
];
/** La Maestranza, que es el caso que fijó el 144. */
const MAESTRANZA: RoomZone[] = [
  { tables: 4, isBar: true },
  { tables: 6 },
  { tables: 6 },
];

describe("n1-hosteleria · el umbral de mano, una sola vez", () => {
  it("el N1 es de mano y los terminales no", () => {
    expect(esAparatoDeMano(N1.w)).toBe(true);
    expect(esAparatoDeMano(AP11.w)).toBe(false);
    expect(esAparatoDeMano(D8.w)).toBe(false);
    // 1443 del AP13 y 1280 del AP11 quedan lejísimos; el borde se
    // comprueba aquí porque `max-width` es inclusivo y el `−1` de
    // `MEDIA_MANO` depende de ello.
    expect(esAparatoDeMano(UMBRAL_MANO_PX - 1)).toBe(true);
    expect(esAparatoDeMano(UMBRAL_MANO_PX)).toBe(false);
  });

  it("`repartoDeSala` no inventa un tercer juego", () => {
    expect(repartoDeSala(true)).toBe(REPARTO_MANO);
    expect(repartoDeSala(false)).toBe(REPARTO_TERMINAL);
  });
});

describe("n1-hosteleria · tres mesas por fila a 360", () => {
  it("el lienzo de mano deja 328 px y el marco de zona 304", () => {
    expect(roomAvailableWidthDark(N1.w, REPARTO_MANO)).toBe(328);
    expect(
      roomAvailableWidthDark(N1.w, REPARTO_MANO) - 2 * REPARTO_MANO.zonePadding,
    ).toBe(304);
  });

  it("con la mesa de mano caben TRES por fila", () => {
    const dentroDelMarco =
      roomAvailableWidthDark(N1.w, REPARTO_MANO) - 2 * REPARTO_MANO.zonePadding;
    expect(roomColumnsFor(dentroDelMarco, TABLE_SHAPE_MIN_MANO)).toBe(3);
  });

  it("SABOTAJE · con la mesa de 144 vuelven a caber DOS, no tres", () => {
    // La fila de la tabla: «La mesa en estrecho vuelve a 144 px».
    const dentroDelMarco =
      roomAvailableWidthDark(N1.w, REPARTO_MANO) - 2 * REPARTO_MANO.zonePadding;
    expect(roomColumnsFor(dentroDelMarco, TABLE_SHAPE_SIZE)).not.toBe(3);
    expect(roomColumnsFor(dentroDelMarco, TABLE_SHAPE_SIZE)).toBe(2);
  });

  it("y la fila de tres deja holgura de sobra sobre el error de la cuenta", () => {
    // `roomCanvasHeight` REPRODUCE la regla de corte de flexbox, no la
    // mide: v2-H1 dejó escrito que 5 px caen dentro de ese error. Doce,
    // no.
    const dentroDelMarco =
      roomAvailableWidthDark(N1.w, REPARTO_MANO) - 2 * REPARTO_MANO.zonePadding;
    const fila = 3 * TABLE_SHAPE_MIN_MANO + 2 * 14;
    expect(dentroDelMarco - fila).toBeGreaterThanOrEqual(8);
  });

  it("la sala de Sirope en el N1 se queda en el suelo de mano", () => {
    // 23 mesas no caben sin desplazar a ningún tamaño, así que
    // `tamanoDeMesaPara` cae al suelo — que es justo el que da 3 por
    // fila.
    expect(tamanoDeMesaPara(SIROPE, N1.w, N1.h, REPARTO_MANO)).toBe(
      TABLE_SHAPE_MIN_MANO,
    );
  });

  it("con «Todas» y las 23 de Sirope se ven al menos NUEVE", () => {
    // El criterio de cierre del §1. La pasada del 18-10 midió TRES.
    const vistas = mesasALaVistaDeMano(
      SIROPE,
      roomAvailableWidthDark(N1.w, REPARTO_MANO),
      roomAvailableHeightDark(N1.h, REPARTO_MANO),
    );
    expect(vistas).toBeGreaterThanOrEqual(9);
  });

  it("SABOTAJE · con la mesa de 144 se ven menos de nueve", () => {
    // Es el estado que midió la pasada: 144 px y tres mesas.
    const vistas = mesasALaVistaDeMano(
      SIROPE,
      roomAvailableWidthDark(N1.w, REPARTO_MANO),
      roomAvailableHeightDark(N1.h, REPARTO_MANO),
      TABLE_SHAPE_SIZE,
    );
    expect(vistas).toBeLessThan(9);
  });

  it("con el chip de una zona, esa zona entra en la primera pantalla", () => {
    const anchoUtil = roomAvailableWidthDark(N1.w, REPARTO_MANO);
    const altoUtil = roomAvailableHeightDark(N1.h, REPARTO_MANO);
    for (const zona of SIROPE) {
      const alto = roomCanvasHeight(
        [zona],
        anchoUtil,
        TABLE_SHAPE_MIN_MANO,
        TABLE_SHAPE_MIN_MANO,
        REPARTO_MANO.zonePadding,
      );
      expect(alto).toBeLessThanOrEqual(altoUtil);
      // Y no sólo cabe el lienzo: se ven TODAS sus mesas.
      expect(
        mesasALaVistaDeMano([zona], anchoUtil, altoUtil),
      ).toBe(zona.tables);
    }
  });
});

describe("n1-hosteleria · el importe de la mesa pequeña no se corta", () => {
  it("el peor importe entra en la mesa de 88 a 14 px", () => {
    // `principio-cobro-en-mesa`: la mesa pequeña CONSERVA el importe. Si
    // no entrara, el arreglo sería otro, no quitarlo.
    expect(
      roundTableAmountFits(
        LONGEST_TABLE_AMOUNT,
        TABLE_SHAPE_MIN_MANO,
        TABLE_AMOUNT_FONT_PX_MANO,
      ),
    ).toBe(true);
  });

  it("y a 16 px ya no entra: de ahí el 14, y no es gusto", () => {
    expect(
      roundTableAmountFits(LONGEST_TABLE_AMOUNT, TABLE_SHAPE_MIN_MANO, 16),
    ).toBe(false);
    // Los 22 del terminal piden más que el diámetro entero.
    expect(
      roundTableAmountFits(LONGEST_TABLE_AMOUNT, TABLE_SHAPE_MIN_MANO, 22),
    ).toBe(false);
  });
});

describe("n1-hosteleria · la restricción: los terminales no se mueven", () => {
  it("SABOTAJE · el reparto de mano aplicado al AP11 encoge la mesa", () => {
    // La fila de la tabla: «El umbral de estrecho se aplica a 1280».
    // Esto es lo que NO debe pasar, y se mide para que el día que
    // alguien pase `REPARTO_MANO` de más, el banco lo diga.
    const bien = tamanoDeMesaPara(MAESTRANZA, AP11.w, AP11.h);
    const mal = tamanoDeMesaPara(MAESTRANZA, AP11.w, AP11.h, REPARTO_MANO);
    expect(bien).toBeGreaterThanOrEqual(TABLE_SHAPE_SIZE);
    expect(mal).toBeLessThan(bien);
  });

  it("el AP11 y el D8 siguen dando lo de auditoria-sirope (#13)", () => {
    // Sin pasar reparto: el de siempre. Son los mismos asertos que
    // `sala-sirope.test.ts`, repetidos aquí a propósito — si este bloque
    // cambiara el valor por defecto, caerían LOS DOS bancos.
    expect(tamanoDeMesaPara(MAESTRANZA, AP11.w, AP11.h)).toBeGreaterThanOrEqual(
      TABLE_SHAPE_SIZE,
    );
    expect(tamanoDeMesaPara(SIROPE, D8.w, D8.h)).toBeGreaterThan(
      TABLE_SHAPE_SIZE,
    );
  });

  it("el alto y el ancho útiles del terminal no se mueven", () => {
    // El reparto por defecto tiene que seguir siendo el de v2-H1: una
    // cabecera de 80 y `px-5`.
    expect(roomAvailableWidthDark(AP11.w)).toBe(AP11.w - 40);
    expect(roomAvailableHeightDark(AP11.h)).toBe(AP11.h - 80 - 24 - 55);
    expect(REPARTO_TERMINAL.headerHeight).toBe(80);
    expect(REPARTO_TERMINAL.zonePadding).toBe(18);
  });
});

describe("n1-hosteleria · el cobro desde la forma pequeña", () => {
  // `principio-cobro-en-mesa`: «cobrar directo desde la tarjeta de mesa,
  // sin entrar a la venta». El bloque añade el objetivo de 44 px. Las dos
  // cosas se miden aquí, porque en jsdom no hay layout que medir.
  const anchoPorCaracter = (fontPx: number) =>
    (TABLE_AMOUNT_CHAR_WIDTH * fontPx) / TABLE_AMOUNT_FONT_PX;
  const anchoDelImporte = (fontPx: number) =>
    LONGEST_TABLE_AMOUNT.length * anchoPorCaracter(fontPx);

  it("el botón llega al suelo táctil de la casa, no sólo a los 44 del bloque", () => {
    // El bloque pide 44. `hospitalityTheme.ts` fija 56 para la venta y la
    // sala, y es el que manda por ser el más exigente.
    expect(COBRAR_HEIGHT_MANO).toBeGreaterThanOrEqual(44);
    expect(COBRAR_HEIGHT_MANO).toBe(MIN_TOUCH_PX);
    // Y es MÁS que el del terminal, que se quedó en 36.
    expect(COBRAR_HEIGHT_MANO).toBeGreaterThan(COBRAR_HEIGHT);
  });

  it("el botón y el nombre caben en los 88 px de la forma", () => {
    // 6 de abajo + 56 de botón = 62; el nombre anclado arriba mide 18 y
    // empieza a 6, así que acaba en 24. Entre 24 y 26 no se tocan.
    expect(COBRAR_BOTTOM_MANO + COBRAR_HEIGHT_MANO).toBeLessThan(
      TABLE_SHAPE_MIN_MANO - 18,
    );
  });

  it("el peor importe entra en el botón de una mesa REDONDA", () => {
    // Barra y Terraza son círculos: lo que limita es la cuerda a la
    // altura del centro del botón, no el lado.
    const ancho = cobrarMaxWidth(
      "BARRA",
      TABLE_SHAPE_MIN_MANO,
      COBRAR_HEIGHT_MANO,
      COBRAR_BOTTOM_MANO,
      COBRAR_MARGEN_MANO,
    );
    expect(
      anchoDelImporte(COBRAR_AMOUNT_FONT_PX_MANO) + 2 * COBRAR_PADDING_X_MANO,
    ).toBeLessThanOrEqual(ancho);
  });

  it("y también en una mesa RECTANGULAR, que es más estrecha de margen", () => {
    const ancho = cobrarMaxWidth(
      "SALON",
      TABLE_SHAPE_MIN_MANO,
      COBRAR_HEIGHT_MANO,
      COBRAR_BOTTOM_MANO,
      COBRAR_MARGEN_MANO,
    );
    expect(
      anchoDelImporte(COBRAR_AMOUNT_FONT_PX_MANO) + 2 * COBRAR_PADDING_X_MANO,
    ).toBeLessThanOrEqual(ancho);
  });

  it("SABOTAJE · a 14 px el importe se sale del botón", () => {
    // A 13 entra por 2,2 px, que es menos de lo que vale fiarse de una
    // estimación de ancho por carácter; a 14 ya no entra de calle. De ahí
    // el 12, con 7,6 px de margen.
    const ancho = cobrarMaxWidth(
      "BARRA",
      TABLE_SHAPE_MIN_MANO,
      COBRAR_HEIGHT_MANO,
      COBRAR_BOTTOM_MANO,
      COBRAR_MARGEN_MANO,
    );
    expect(anchoDelImporte(14) + 2 * COBRAR_PADDING_X_MANO).toBeGreaterThan(
      ancho,
    );
  });

  it("SABOTAJE · con los márgenes del terminal tampoco entra", () => {
    // 16 px de margen en el rectángulo se llevan el 18% del ancho útil
    // de una forma de 88.
    const ancho = cobrarMaxWidth(
      "SALON",
      TABLE_SHAPE_MIN_MANO,
      COBRAR_HEIGHT_MANO,
      COBRAR_BOTTOM_MANO,
    );
    expect(
      anchoDelImporte(COBRAR_AMOUNT_FONT_PX_MANO) + 2 * COBRAR_PADDING_X_MANO,
    ).toBeGreaterThan(ancho);
  });

  it("en el terminal el botón sigue siendo el de v2-H1", () => {
    expect(COBRAR_HEIGHT).toBe(36);
    expect(cobrarMaxWidth("SALON", TABLE_SHAPE_SIZE)).toBe(
      TABLE_SHAPE_SIZE - 16,
    );
  });
});
