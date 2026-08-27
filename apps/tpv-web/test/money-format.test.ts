// Formateador único de importes (v1.10.3-barra · hallazgo #6).
//
// Antes cada pantalla llevaba su copia de formatEur y unas cuantas
// pintaban `n.toFixed(2) + " €"` → "3.50 €" con punto, frente a
// "3,50 €" en el resto de la app.

import { describe, expect, it } from "vitest";

import { formatAmount, formatEur, parseAmount } from "../src/lib/money.js";

describe("formatEur / formatAmount", () => {
  it("usa coma decimal y siempre dos decimales", () => {
    expect(formatEur(3.5)).toBe("3,50 €");
    expect(formatEur(6.5)).toBe("6,50 €");
    expect(formatEur(14)).toBe("14,00 €");
    expect(formatEur(0)).toBe("0,00 €");
    expect(formatAmount(1.5)).toBe("1,50");
  });

  it("redondea como toFixed —el mismo criterio de siempre—", () => {
    // Ni más ni menos que el `toFixed(2)` que llevaba cada pantalla por
    // su cuenta: 1.005 es 1.00499… en binario y baja, no sube. Se deja
    // documentado a propósito para que nadie lo "arregle" y descuadre
    // el arqueo respecto a los importes que ya están emitidos.
    expect(formatAmount(1.005)).toBe("1,00");
    expect(formatAmount(1.015)).toBe("1,01");
    expect(formatAmount(2.675)).toBe("2,67");
  });

  it("normaliza el cero negativo (no existe '−0,00 €')", () => {
    expect(formatEur(-0)).toBe("0,00 €");
    expect(formatEur(-0.001)).toBe("0,00 €");
  });

  it("no inventa importes con entradas rotas", () => {
    expect(formatEur(Number.NaN)).toBe("0,00 €");
    expect(formatEur(Number.POSITIVE_INFINITY)).toBe("0,00 €");
  });

  it("mantiene el signo cuando el importe es de verdad negativo", () => {
    expect(formatEur(-2.5)).toBe("-2,50 €");
  });
});

describe("parseAmount", () => {
  it("acepta coma y punto como separador decimal", () => {
    expect(parseAmount("10")).toBe(10);
    expect(parseAmount("10,5")).toBe(10.5);
    expect(parseAmount("10.5")).toBe(10.5);
    expect(parseAmount("4,00")).toBe(4);
  });

  it("tolera el símbolo y los espacios que deja el teclado", () => {
    expect(parseAmount(" 10,00 € ")).toBe(10);
    expect(parseAmount("10 €")).toBe(10);
  });

  it("resuelve el separador de millares por el ÚLTIMO separador", () => {
    expect(parseAmount("1.234,50")).toBe(1234.5);
    expect(parseAmount("1,234.50")).toBe(1234.5);
  });

  it("devuelve 0 —nunca NaN— para lo que no es un importe", () => {
    // Una fila a medio escribir no puede envenenar la suma de pagos.
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("   ")).toBe(0);
    expect(parseAmount("abc")).toBe(0);
    expect(parseAmount(undefined as unknown as string)).toBe(0);
  });

  it("es la inversa de formatAmount para importes de caja", () => {
    for (const n of [0, 0.05, 1.54, 3.5, 14, 27.4, 214]) {
      expect(parseAmount(formatAmount(n))).toBeCloseTo(n, 2);
    }
  });
});
