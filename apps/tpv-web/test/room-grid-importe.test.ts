// El importe de una mesa ocupada no se corta nunca.
//
// Hallazgo del hierro (AP13, 07-10-2026 22:08): en la tarjeta de M2 el
// «37,30 €» salía cortado por la derecha, compartiendo fila con el
// camarero «m.oyola+mae…». Medido con PIL sobre la captura del propio
// terminal a 1443 × 812: el borde derecho de la tarjeta caía en x=1006
// (físicos) y la tinta del importe llegaba a x=1031 — 25 px físicos,
// 19 px CSS, de dinero fuera de la tarjeta. Lo mismo en M2 (26 px).
//
// Este fichero fija la aritmética del arreglo con los DOS anchos de
// tarjeta reales del bucle visual:
//
//   · 1443 × 812 (D8 / AP13) → tarjeta de 168 px
//   · 390 × 844 (handheld)   → tarjeta de 153 px
//
// y con el importe más largo que la tarjeta tiene que aguantar.

import { describe, expect, it } from "vitest";

import { formatEur } from "../src/lib/money.js";
import {
  LONGEST_TABLE_AMOUNT,
  TABLE_AMOUNT_CHAR_WIDTH,
  TABLE_CARD_CHROME_X,
  TABLE_CARD_WIDTH,
  handheldCardWidth,
  tableAmountFits,
  tableAmountWidth,
  tableCardContentWidth,
} from "../src/lib/roomGrid.js";

/** La tarjeta del handheld a 390 px, por la misma vía que el componente. */
const HANDHELD_CARD = handheldCardWidth(390);

describe("El importe de la mesa cabe en la tarjeta", () => {
  it("el handheld de 390 px sigue dando una tarjeta de 153", () => {
    // Si esto cambia, los números de abajo dejan de ser los del bucle
    // visual y hay que volver a medir, no ajustar el umbral.
    expect(HANDHELD_CARD).toBe(153);
    expect(TABLE_CARD_WIDTH).toBe(168);
  });

  it("el importe más largo es el que de verdad pinta formatEur", () => {
    // Si el formateador empieza a separar millares, el importe gana un
    // carácter y esta medida se queda corta. Que salte aquí.
    expect(formatEur(1234.5)).toBe(LONGEST_TABLE_AMOUNT);
  });

  it("1443 × 812 (D8): el importe más largo cabe entero", () => {
    expect(tableAmountFits(LONGEST_TABLE_AMOUNT, TABLE_CARD_WIDTH)).toBe(true);
  });

  it("390 × 844 (handheld): el importe más largo cabe entero", () => {
    expect(tableAmountFits(LONGEST_TABLE_AMOUNT, HANDHELD_CARD)).toBe(true);
  });

  it("el importe del hallazgo (37,30 €) cabe en las dos", () => {
    expect(tableAmountFits("37,30 €", TABLE_CARD_WIDTH)).toBe(true);
    expect(tableAmountFits("37,30 €", HANDHELD_CARD)).toBe(true);
  });

  it("la cuenta es ancho útil = tarjeta − cromo, y el cromo son 32 px", () => {
    // p-3.5 (14 por lado) + border-2 (2 por lado).
    expect(TABLE_CARD_CHROME_X).toBe(32);
    expect(tableCardContentWidth(168)).toBe(136);
    expect(tableCardContentWidth(153)).toBe(121);
  });

  it("queda margen de sobra en la más estrecha, no cabe por los pelos", () => {
    // Si el margen se comiera entero, el siguiente retoque tipográfico
    // volvería a sacar el dinero de la tarjeta sin que nadie se entere.
    const holgura =
      tableCardContentWidth(HANDHELD_CARD) -
      tableAmountWidth(LONGEST_TABLE_AMOUNT);
    expect(holgura).toBeGreaterThanOrEqual(5);
  });

  it("un importe absurdo NO cabe: la función mide, no dice que sí siempre", () => {
    // El contrapunto del test anterior. Sin esto, un `return true`
    // pasaría todo lo de arriba.
    expect(tableAmountFits("1.234.567,89 €", HANDHELD_CARD)).toBe(false);
    expect(tableAmountFits("1.234.567,89 €", TABLE_CARD_WIDTH)).toBe(false);
  });

  it("el ancho por carácter no subestima el dígito tabular del D8", () => {
    // Medido sobre la captura: ~11,4 px por dígito a 19 px / 700.
    expect(TABLE_AMOUNT_CHAR_WIDTH).toBeGreaterThanOrEqual(11.4);
  });
});
