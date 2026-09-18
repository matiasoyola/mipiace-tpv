// S1-sello · el sello del Z, en su parte pura.
//
// El desglose deja de vivir sólo en un PDF de disco. Lo que se congela
// tiene que hashearse igual siempre: el `ZBreakdown` viene con arrays de
// métodos y objetos anidados, y si el hash dependiera del orden de las
// claves el sello del Z valdría lo mismo que el PDF que sustituye.

import { describe, expect, it } from "vitest";

import { computeZHash, type FrozenZ } from "../src/shift/z-seal.js";
import { computeZBreakdown } from "../src/shift/z-breakdown.js";

function frozen(over: Partial<FrozenZ> = {}): FrozenZ {
  const breakdown = computeZBreakdown({
    cashOpening: 100,
    paymentsByMethod: { CASH: 24.1, CARD: 10 },
    refundsByMethod: {},
    counted: { CASH: 124.1 },
  });
  return {
    cashOpening: 100,
    cashCounted: 124.1,
    cashTheoretical: breakdown.cashTheoretical,
    ticketsCount: 2,
    refundsCount: 0,
    breakdown,
    ...over,
  };
}

describe("S1-sello · el Z congelado", () => {
  it("el mismo desglose da siempre el mismo hash", () => {
    expect(computeZHash(frozen())).toBe(computeZHash(frozen()));
    expect(computeZHash(frozen())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("el hash no depende del orden de las claves del objeto congelado", () => {
    const a = frozen();
    // Mismo contenido, claves insertadas al revés.
    const b: FrozenZ = {
      breakdown: a.breakdown,
      refundsCount: a.refundsCount,
      ticketsCount: a.ticketsCount,
      cashTheoretical: a.cashTheoretical,
      cashCounted: a.cashCounted,
      cashOpening: a.cashOpening,
    };
    expect(computeZHash(b)).toBe(computeZHash(a));
  });

  it("una venta más cambia el hash: es exactamente lo que tiene que detectar", () => {
    const antes = frozen();
    const despues = frozen({
      ticketsCount: 3,
      breakdown: computeZBreakdown({
        cashOpening: 100,
        // Entra una venta tardía de 44,00 € en efectivo.
        paymentsByMethod: { CASH: 68.1, CARD: 10 },
        refundsByMethod: {},
        counted: { CASH: 124.1 },
      }),
    });
    expect(computeZHash(despues)).not.toBe(computeZHash(antes));
  });

  it("distingue 'nadie contó' de 'se contó y dio cero'", () => {
    // El corte de día cierra sin nadie delante: `cashCounted` es null, no
    // un cero. Un cero contado afirma un arqueo que no existió.
    expect(computeZHash(frozen({ cashCounted: null }))).not.toBe(
      computeZHash(frozen({ cashCounted: 0 })),
    );
  });
});
