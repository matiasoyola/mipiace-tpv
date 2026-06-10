// v1.4-Precio-Decimales · b30 · tests del cálculo de línea y de ticket
// con precisión 4 decimales en el NET (Peluquería Sole 2026-06-04).
//
// El bug original: con `Decimal(10,2)` truncábamos el NET de Holded
// (3.8843 → 3.88) al sincronizar y el TPV calculaba el gross con esa
// base truncada. Resultado: gross por unidad 4.69 en TPV vs 4.70 en
// Holded → 1 céntimo de drift por línea, multiplicado por la cantidad
// y por las líneas del ticket. Tras la migración b30 + el redondeo
// agregado-al-final, el TPV reproduce la aritmética de Holded.
//
// Casos:
//   1. NET 3.8843 × 1 unidad × IVA 21% → gross display 4.70 (matchea Holded).
//   2. NET 3.8843 × 2 unidades × IVA 21% → total del ticket coincide con
//      Holded y NO coincide con el 9.38 que produciría una multiplicación
//      naïve del display redondeado (4.69 × 2). Sobre 3.8843 con redondeo
//      al final, 3.8843·1.21·2 = 9.400006 → 9.40, NO 9.38.
//   3. Agregación por bucket de IVA: dos líneas con tipos de IVA
//      distintos (10% y 21%) se calculan y redondean independientemente
//      antes de sumar.

import { describe, expect, it } from "vitest";

import { computeLine, computeTicket } from "../src/tickets/totals.js";

describe("v1.4-Precio-Decimales · computeLine con NET de 4 decimales", () => {
  it("CASO 1 · 3.8843 NET × 1 unidad × 21% IVA → gross display 4.70 (matchea Holded)", () => {
    const t = computeLine({
      units: 1,
      unitPrice: 3.8843,
      discountPct: 0,
      taxRate: 21,
    });
    // Con la base truncada a 3.88 (antes de b30): gross = 3.88·1.21 = 4.6948
    // → 4.69 en el TPV. Holded factura 3.8843·1.21 = 4.700003 → 4.70.
    // Tras b30 el TPV mantiene los 4 decimales y reproduce el 4.70.
    expect(t.total).toBe(4.7);
    expect(t.total).not.toBe(4.69); // valor bugueado antes de b30
    expect(t.subtotal).toBe(3.88); // display del NET es 2 dec (3.8843 ≈ 3.88)
  });

  it("CASO 2 · 3.8843 NET × 2 unidades × 21% IVA → 9.40 (matchea Holded; NO produce el 9.38 del bug naïve)", () => {
    const ticket = computeTicket([
      {
        units: 2,
        unitPrice: 3.8843,
        discountPct: 0,
        taxRate: 21,
      },
    ]);
    // El prompt v1.4-Precio-Decimales describe este caso como "9.39 NOT
    // 9.38". La aritmética estricta con la fórmula que pide el propio
    // prompt ("agregar netos, aplicar IVA al agregado, redondear UNA
    // VEZ al final") da 9.40, no 9.39:
    //
    //   netAgregado = 3.8843 × 2     = 7.7686
    //   grossRaw    = 7.7686 × 1.21  = 9.400006
    //   round2(grossRaw)             = 9.40
    //
    // 9.40 es el importe que Holded factura por usar también los 4
    // decimales internamente. Lo crítico es que NO produce el 9.38 del
    // bug naïve ("4.69 truncado por unidad × 2" o
    // "round2(round2(3.88·1.21)·2)"), demostrando que el drift que
    // veía el cliente Sole se eliminó.
    expect(ticket.total).toBe(9.4);
    expect(ticket.total).not.toBe(9.38);
    expect(ticket.subtotal).toBe(7.77); // 7.7686 → round2 = 7.77
    expect(ticket.tax).toBeCloseTo(1.63, 2); // 7.7686·0.21 = 1.631406 → 1.63
  });

  it("CASO 3 · agregación por bucket de IVA — cada tipo se calcula independientemente y se redondea una sola vez al final", () => {
    // Mezcla 4 líneas con tipos de IVA distintos: 4 / 10 / 21.
    const ticket = computeTicket([
      // Bucket 21%: 3.8843·2 = 7.7686 → gross 9.400006
      { units: 2, unitPrice: 3.8843, discountPct: 0, taxRate: 21 },
      // Bucket 10%: 1.2345·3 = 3.7035 → gross 4.07385
      { units: 3, unitPrice: 1.2345, discountPct: 0, taxRate: 10 },
      // Bucket 4%: 0.9876·1 = 0.9876 → gross 1.027104
      { units: 1, unitPrice: 0.9876, discountPct: 0, taxRate: 4 },
    ]);
    // subtotal agregado = 7.7686 + 3.7035 + 0.9876 = 12.4597 → 12.46
    expect(ticket.subtotal).toBe(12.46);
    // total = 9.400006 + 4.07385 + 1.027104 = 14.50096 → 14.50
    expect(ticket.total).toBe(14.5);
    // El IVA agregado: 7.7686·0.21 + 3.7035·0.10 + 0.9876·0.04
    //               = 1.631406 + 0.37035 + 0.039504 = 2.04126 → 2.04
    expect(ticket.tax).toBeCloseTo(2.04, 2);
  });

  it("CASO 4 · descuento de línea aplicado antes del IVA y descuento agregado del ticket reportado correctamente", () => {
    const ticket = computeTicket([
      // Sin descuento — línea de control.
      { units: 1, unitPrice: 10, discountPct: 0, taxRate: 21 },
      // Con 50% descuento. Net efectivo por unidad = 5 (el descuento se
      // aplica al unitPrice antes del IVA).
      { units: 2, unitPrice: 10, discountPct: 50, taxRate: 21 },
    ]);
    // subtotalAgg = 10 + (10·0.5·2) = 10 + 10 = 20
    expect(ticket.subtotal).toBe(20);
    expect(ticket.total).toBe(24.2); // 20 × 1.21
    // grossNoDiscount = 10·1 + 10·2 = 30 → discount = 30 − 20 = 10
    expect(ticket.discount).toBe(10);
  });
});

describe("v1.4-Precio-Decimales · consistencia entre línea y ticket", () => {
  it("una sola línea: total del ticket == total de la línea (no introducimos drift al reagregar)", () => {
    const lineInput = {
      units: 2,
      unitPrice: 3.8843,
      discountPct: 0,
      taxRate: 21,
    };
    const line = computeLine(lineInput);
    const ticket = computeTicket([lineInput]);
    expect(ticket.total).toBe(line.total);
    expect(ticket.subtotal).toBe(line.subtotal);
  });

  it("varias líneas mismo IVA: el bucket suma netos crudos antes de aplicar IVA (no suma totales redondeados)", () => {
    // 3 líneas con NET 3.8843 a 21% son equivalentes a una línea
    // 3.8843×3 a 21%. La aritmética agregada por bucket debe dar el
    // mismo total que la línea-equivalente.
    const three = computeTicket([
      { units: 1, unitPrice: 3.8843, discountPct: 0, taxRate: 21 },
      { units: 1, unitPrice: 3.8843, discountPct: 0, taxRate: 21 },
      { units: 1, unitPrice: 3.8843, discountPct: 0, taxRate: 21 },
    ]);
    const one = computeTicket([
      { units: 3, unitPrice: 3.8843, discountPct: 0, taxRate: 21 },
    ]);
    expect(three.total).toBe(one.total);
    expect(three.subtotal).toBe(one.subtotal);
  });
});
