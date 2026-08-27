// v1.12-manos-de-camarero · reglas de escritura del CashPad.
//
// Son las reglas que evitan que el cajero teclee un importe imposible
// sin que nadie se lo diga. Cada una sale de cómo se teclea de verdad
// en barra: con prisa, con una mano y sin mirar.

import { describe, expect, it } from "vitest";

import { applyKey } from "../src/components/CashPad.js";
import { parseAmount } from "../src/lib/money.js";

// Teclea una secuencia entera de pulsaciones sobre un valor inicial.
function type(keys: string[], start = "", maxDecimals = 2): string {
  return keys.reduce((v, k) => applyKey(v, k, maxDecimals), start);
}

describe("v1.12 · CashPad · escritura de importes", () => {
  it("teclea en euros con coma decimal", () => {
    expect(type(["1", "2", ",", "5", "0"])).toBe("12,50");
    expect(parseAmount(type(["1", "2", ",", "5", "0"]))).toBe(12.5);
  });

  it("ignora el tercer decimal en vez de redondear", () => {
    expect(type(["3", ",", "9", "9", "9"])).toBe("3,99");
    expect(type(["3", ",", "9", "9", "1", "2", "3"])).toBe("3,99");
  });

  it("sólo admite una coma", () => {
    expect(type(["5", ",", ",", "2", ","])).toBe("5,2");
  });

  it("la coma sobre campo vacío arranca en 0,", () => {
    expect(type([","])).toBe("0,");
    expect(parseAmount(type([",", "5", "0"]))).toBe(0.5);
  });

  it("`00` no antepone ceros a un campo vacío", () => {
    expect(type(["00"])).toBe("");
    // Y tampoco los deja al empezar por 0: "0" + "5" es 5, no 05.
    expect(type(["0", "5"])).toBe("5");
    expect(type(["0", "00"])).toBe("0");
  });

  it("`00` con hueco para un solo decimal mete un cero, no dos", () => {
    expect(type(["7", ",", "5", "00"])).toBe("7,50");
    expect(type(["7", ",", "00"])).toBe("7,00");
  });

  it("`00` en la parte entera son dos ceros de verdad", () => {
    expect(type(["1", "00"])).toBe("100");
    expect(type(["5", "00", "00"])).toBe("50000");
  });

  it("⌫ borra el último carácter y C limpia entero", () => {
    expect(type(["1", "2", ",", "5", "back"])).toBe("12,");
    expect(type(["1", "2", ",", "5", "back", "back"])).toBe("12");
    expect(type(["1", "2", ",", "5", "C"])).toBe("");
  });

  it("campo vacío no es 0,00: se queda vacío", () => {
    // Borrar hasta el fondo deja "" — no "0", no "0,00". El formulario
    // distingue "no introducido" de "cero" para bloquear su botón.
    expect(type(["9", "back"])).toBe("");
    expect(type(["9", "back", "back"])).toBe("");
    expect(type(["9", "C"])).toBe("");
  });

  it("no acepta teclas que no existen en el pad", () => {
    expect(applyKey("12", ".")).toBe("12");
    expect(applyKey("12", "€")).toBe("12");
    expect(applyKey("12", "a")).toBe("12");
  });
});

describe("v1.12 · CashPad · conteos enteros del arqueo (maxDecimals = 0)", () => {
  it("no deja meter coma", () => {
    expect(type([",", "5"], "", 0)).toBe("5");
    expect(type(["1", ",", "2"], "", 0)).toBe("12");
  });

  it("cuenta unidades, no euros", () => {
    expect(type(["1", "2"], "", 0)).toBe("12");
    expect(type(["00"], "", 0)).toBe("");
    expect(type(["3", "00"], "", 0)).toBe("300");
  });
});
