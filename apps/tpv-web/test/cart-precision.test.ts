// v1.4-Precio-Decimales · b30 · cálculo del carrito en el cliente con
// NET de 4 decimales (Peluquería Sole 2026-06-04). Verifica que el TPV
// reproduce la aritmética de Holded: la base NET conserva los 4
// decimales (3.8843) y el redondeo agregado al final del bucket de IVA
// produce el mismo gross que Holded factura.

import { describe, expect, it } from "vitest";

import {
  computeCart,
  computeLine,
  type CartLine,
} from "../src/lib/cart.js";

function makeCartLine(overrides: Partial<CartLine>): CartLine {
  return {
    id: "cart-line-1",
    productId: null,
    variantId: null,
    holdedProductId: null,
    sku: "S",
    nameSnapshot: "Test",
    units: 1,
    unitPrice: 0,
    unitPriceOverride: null,
    priceGross: 0,
    discountPct: 0,
    taxRate: 21,
    modifiers: [],
    ...overrides,
  };
}

describe("v1.4-Precio-Decimales · cart.ts computeLine", () => {
  it("CASO 1 · 1 unidad de 3.8843 con IVA 21% → gross display 4.70 (matchea Holded)", () => {
    const t = computeLine(
      makeCartLine({ units: 1, unitPrice: 3.8843, taxRate: 21 }),
    );
    // Antes del fix (base truncada a 3.88): gross = round2(3.88·1.21) = 4.69.
    // Tras el fix: gross = round2(3.8843·1.21) = round2(4.700003) = 4.70.
    expect(t.totalGross).toBe(4.7);
    expect(t.totalGross).not.toBe(4.69);
  });

  it("override del cajero con 4 decimales (lápiz) se respeta sin perder precisión", () => {
    const t = computeLine(
      makeCartLine({
        units: 1,
        unitPrice: 3.0,
        unitPriceOverride: 4.1234,
        taxRate: 21,
      }),
    );
    // 4.1234 × 1.21 = 4.989314 → round2 = 4.99
    expect(t.totalGross).toBe(4.99);
  });
});

describe("v1.4-Precio-Decimales · cart.ts computeCart (agregación por bucket de IVA)", () => {
  it("CASO 2 · 2 unidades de 3.8843 a 21% → 9.40 (matchea Holded; NO el 9.38 del bug naïve)", () => {
    const t = computeCart([
      makeCartLine({ units: 2, unitPrice: 3.8843, taxRate: 21 }),
    ]);
    // El prompt v1.4-Precio-Decimales describe este caso como "9.39 NOT
    // 9.38". La aritmética estricta con la fórmula del prompt da 9.40,
    // que es el importe que Holded factura realmente:
    //
    //   netAgregado = 3.8843 × 2     = 7.7686
    //   grossRaw    = 7.7686 × 1.21  = 9.400006
    //   round2(grossRaw)             = 9.40
    //
    // Lo crítico es que ya NO se produce el 9.38 del cálculo naïve
    // "4.69 truncado por unidad × 2 unidades" — el drift de Sole queda
    // resuelto.
    expect(t.total).toBe(9.4);
    expect(t.total).not.toBe(9.38);
    expect(t.subtotalNet).toBe(7.77);
    expect(t.tax).toBeCloseTo(1.63, 2);
  });

  it("CASO 3 · agregación por bucket de IVA — varios tipos se calculan independientemente", () => {
    const t = computeCart([
      makeCartLine({ id: "a", units: 2, unitPrice: 3.8843, taxRate: 21 }),
      makeCartLine({ id: "b", units: 3, unitPrice: 1.2345, taxRate: 10 }),
      makeCartLine({ id: "c", units: 1, unitPrice: 0.9876, taxRate: 4 }),
    ]);
    // bucket 21: 7.7686 → gross = 9.400006
    // bucket 10: 3.7035 → gross = 4.07385
    // bucket 4 : 0.9876 → gross = 1.027104
    // total = 14.50096 → round = 14.50
    expect(t.total).toBe(14.5);
    expect(t.subtotalNet).toBe(12.46);
    expect(t.tax).toBeCloseTo(2.04, 2);
  });

  it("consistencia: tres líneas con mismo NET e IVA == una línea con 3× unidades", () => {
    const three = computeCart([
      makeCartLine({ id: "a", units: 1, unitPrice: 3.8843, taxRate: 21 }),
      makeCartLine({ id: "b", units: 1, unitPrice: 3.8843, taxRate: 21 }),
      makeCartLine({ id: "c", units: 1, unitPrice: 3.8843, taxRate: 21 }),
    ]);
    const one = computeCart([
      makeCartLine({ id: "a", units: 3, unitPrice: 3.8843, taxRate: 21 }),
    ]);
    expect(three.total).toBe(one.total);
    expect(three.subtotalNet).toBe(one.subtotalNet);
  });
});
