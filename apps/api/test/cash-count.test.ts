// Tests del helper de denominaciones (v1.3-Thalia Lote 4). Lo crítico:
// el server es la única fuente de verdad para `cashTotal` y debe
// rechazar input malformado o intentos de fabricar un total enviando
// "denominaciones" inventadas.

import { describe, expect, it } from "vitest";

import {
  ALLOWED_DENOMINATIONS,
  validateAndSumDenominations,
} from "../src/shift/cash-count.js";

describe("validateAndSumDenominations", () => {
  it("suma correctamente un arqueo realista", () => {
    const r = validateAndSumDenominations({
      "50": 2,    // 100,00
      "20": 3,    // 60,00
      "10": 1,    // 10,00
      "5": 2,     // 10,00
      "1": 3,     // 3,00
      "0.50": 1,  // 0,50
      "0.10": 3,  // 0,30
    });
    expect(r.ok).toBe(true);
    expect(r.total).toBeCloseTo(183.8, 2);
  });

  it("acepta objeto vacío como total 0", () => {
    const r = validateAndSumDenominations({});
    expect(r.ok).toBe(true);
    expect(r.total).toBe(0);
  });

  it("rechaza denominación no soportada", () => {
    const r = validateAndSumDenominations({ "500": 1, "1000": 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("1000");
  });

  it("rechaza conteo no entero", () => {
    const r = validateAndSumDenominations({ "10": 1.5 });
    expect(r.ok).toBe(false);
  });

  it("rechaza conteo negativo", () => {
    const r = validateAndSumDenominations({ "10": -3 });
    expect(r.ok).toBe(false);
  });

  it("rechaza body no-objeto", () => {
    expect(validateAndSumDenominations(null).ok).toBe(false);
    expect(validateAndSumDenominations("foo" as unknown).ok).toBe(false);
    expect(validateAndSumDenominations(123 as unknown).ok).toBe(false);
  });

  it("evita errores binarios floating en 0.05 * 7", () => {
    const r = validateAndSumDenominations({ "0.05": 7 });
    expect(r.ok).toBe(true);
    // sin Math.round en céntimos da 0.34999999...
    expect(r.total).toBe(0.35);
  });

  it("lista canónica cubre todas las denominaciones euro", () => {
    expect(ALLOWED_DENOMINATIONS).toContain("500");
    expect(ALLOWED_DENOMINATIONS).toContain("0.01");
    expect(ALLOWED_DENOMINATIONS.length).toBe(15);
  });
});
