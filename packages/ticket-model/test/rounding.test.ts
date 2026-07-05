// v1.9.4 · tests del cuadre al céntimo del desglose IVA.
//
// Invariante bajo prueba: Σ importes impresos (subtotal + IVAs) == TOTAL
// exacto, con el céntimo residual asignado al componente de mayor resto
// decimal (empate → mayor importe). El TOTAL es entrada y no se recalcula.

import { describe, expect, it } from "vitest";

import { allocateRoundingRemainder } from "../src/index.js";

// Suma en céntimos para evitar el error binario al comparar.
function sumCents(parts: { amount: number }[]): number {
  return parts.reduce((acc, p) => acc + Math.round(p.amount * 100), 0);
}

describe("allocateRoundingRemainder", () => {
  it("caso real Sirope #000005: 4,64 + IVA10 s/2,00 + IVA21 s/2,64 → 5,40", () => {
    // Sin cuadrar: 4,64 + 0,20 + round(0,5544)=0,55 = 5,39 (baila 1 cént).
    const out = allocateRoundingRemainder(
      [
        { key: "subtotal", amount: 4.64 },
        { key: "tax:10", amount: 2.0 * 0.1 }, // 0,20 exacto
        { key: "tax:21", amount: 2.64 * 0.21 }, // 0,5544 → mayor resto
      ],
      5.4,
    );
    const byKey = new Map(out.map((p) => [p.key, p.amount]));
    expect(sumCents(out)).toBe(540);
    // El céntimo va al 21% (resto .44), no al subtotal ni al 10%.
    expect(byKey.get("subtotal")).toBeCloseTo(4.64, 5);
    expect(byKey.get("tax:10")).toBeCloseTo(0.2, 5);
    expect(byKey.get("tax:21")).toBeCloseTo(0.56, 5);
  });

  it("un solo bucket que ya cuadra: no cambia nada", () => {
    const out = allocateRoundingRemainder(
      [
        { key: "subtotal", amount: 10.0 },
        { key: "tax:21", amount: 2.1 },
      ],
      12.1,
    );
    const byKey = new Map(out.map((p) => [p.key, p.amount]));
    expect(sumCents(out)).toBe(1210);
    expect(byKey.get("subtotal")).toBeCloseTo(10.0, 5);
    expect(byKey.get("tax:21")).toBeCloseTo(2.1, 5);
  });

  it("desglose que ya suma el total: importes intactos", () => {
    const out = allocateRoundingRemainder(
      [
        { key: "subtotal", amount: 4.64 },
        { key: "tax:10", amount: 0.2 },
        { key: "tax:21", amount: 0.55 },
      ],
      5.39,
    );
    expect(sumCents(out)).toBe(539);
    expect(out.map((p) => p.amount)).toEqual([4.64, 0.2, 0.55]);
  });

  it("residuo de +2 céntimos: se reparte a los dos de mayor resto", () => {
    // floor: 100 + 33 + 33 + 33 = 199; target 201 → +2 céntimos.
    const out = allocateRoundingRemainder(
      [
        { key: "subtotal", amount: 1.0 }, // resto .00
        { key: "tax:a", amount: 0.339 }, // resto .90 → recibe
        { key: "tax:b", amount: 0.336 }, // resto .60 → recibe
        { key: "tax:c", amount: 0.335 }, // resto .50
      ],
      2.01,
    );
    const byKey = new Map(out.map((p) => [p.key, p.amount]));
    expect(sumCents(out)).toBe(201);
    expect(byKey.get("tax:a")).toBeCloseTo(0.34, 5);
    expect(byKey.get("tax:b")).toBeCloseTo(0.34, 5);
    expect(byKey.get("tax:c")).toBeCloseTo(0.33, 5);
    expect(byKey.get("subtotal")).toBeCloseTo(1.0, 5);
  });

  it("residuo de -2 céntimos: se quita a los dos de menor resto", () => {
    // floor: 100 + 34 + 34 + 34 = 202; target 200 → -2 céntimos.
    const out = allocateRoundingRemainder(
      [
        { key: "subtotal", amount: 1.0 }, // resto .00 → pierde
        { key: "tax:a", amount: 0.341 }, // resto .10 → pierde
        { key: "tax:b", amount: 0.348 }, // resto .80
        { key: "tax:c", amount: 0.349 }, // resto .90
      ],
      2.0,
    );
    const byKey = new Map(out.map((p) => [p.key, p.amount]));
    expect(sumCents(out)).toBe(200);
    expect(byKey.get("subtotal")).toBeCloseTo(0.99, 5);
    expect(byKey.get("tax:a")).toBeCloseTo(0.33, 5);
    expect(byKey.get("tax:b")).toBeCloseTo(0.34, 5);
    expect(byKey.get("tax:c")).toBeCloseTo(0.34, 5);
  });

  it("empate en resto decimal: gana el de mayor importe", () => {
    // 2,125 y 1,125 → rawCents 212,5 y 112,5 (1/8 es exacto en binario),
    // ambos con resto exacto .50. floor 212 + 112 = 324; target 325 → +1.
    const out = allocateRoundingRemainder(
      [
        { key: "big", amount: 2.125 }, // resto .50, importe mayor → recibe
        { key: "small", amount: 1.125 }, // resto .50
      ],
      3.25,
    );
    const byKey = new Map(out.map((p) => [p.key, p.amount]));
    expect(sumCents(out)).toBe(325);
    expect(byKey.get("big")).toBeCloseTo(2.13, 5);
    expect(byKey.get("small")).toBeCloseTo(1.12, 5);
  });

  it("lista vacía devuelve []", () => {
    expect(allocateRoundingRemainder([], 0)).toEqual([]);
  });
});
