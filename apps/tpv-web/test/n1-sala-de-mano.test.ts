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
import {
  LONGEST_TABLE_AMOUNT,
  REPARTO_MANO,
  REPARTO_TERMINAL,
  repartoDeSala,
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

/** La sala de Sirope: barra, salón y terraza. */
const SIROPE: RoomZone[] = [
  { tables: 3, isBar: true },
  { tables: 6 },
  { tables: 4 },
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
