// Validación pura del helper de totales (B4 §1.2). Independiente de
// Fastify y Prisma — comprueba el redondeo línea-a-línea, tolerancias
// y el cálculo de descuento agregado.

import { describe, expect, it } from "vitest";

import {
  PAYMENT_TOLERANCE_EUR,
  TOTAL_TOLERANCE_EUR,
  computeLine,
  computeTicket,
  paymentsClose,
  totalsClose,
} from "../src/tickets/totals.js";

describe("computeLine", () => {
  it("redondea a 2 decimales por línea", () => {
    const t = computeLine({ units: 3, unitPrice: 1.333, discountPct: 0, taxRate: 21 });
    // grossPerUnit = 1.333; subtotal = 3.999 → redondeo 4.00; total = 4.84
    expect(t.subtotal).toBe(4.0);
    expect(t.total).toBe(4.84);
    expect(t.tax).toBeCloseTo(0.84, 2);
  });

  it("aplica descuento de línea antes del IVA", () => {
    const t = computeLine({ units: 2, unitPrice: 10, discountPct: 10, taxRate: 21 });
    // subtotal = 2 × 9 = 18; total = 18 × 1.21 = 21.78
    expect(t.subtotal).toBe(18);
    expect(t.total).toBe(21.78);
    expect(t.tax).toBe(3.78);
  });

  it("IVA 0 produce tax 0", () => {
    const t = computeLine({ units: 1, unitPrice: 5, discountPct: 0, taxRate: 0 });
    expect(t.subtotal).toBe(5);
    expect(t.total).toBe(5);
    expect(t.tax).toBe(0);
  });
});

describe("computeTicket", () => {
  it("suma los redondeos por línea — no rec-calcula desde el subtotal", () => {
    const t = computeTicket([
      { units: 3, unitPrice: 1.333, discountPct: 0, taxRate: 21 },
      { units: 1, unitPrice: 2.5, discountPct: 0, taxRate: 10 },
    ]);
    expect(t.subtotal).toBeCloseTo(6.5, 2);
    expect(t.total).toBeCloseTo(7.59, 2);
  });

  it("calcula descuento agregado", () => {
    const t = computeTicket([
      { units: 1, unitPrice: 10, discountPct: 50, taxRate: 0 },
    ]);
    expect(t.discount).toBe(5);
  });

  it("ticket sin líneas tiene total 0", () => {
    const t = computeTicket([]);
    expect(t.total).toBe(0);
    expect(t.tax).toBe(0);
  });
});

describe("tolerancias", () => {
  it("totalsClose tolera 0.05 EUR", () => {
    expect(totalsClose(10.0, 10.04)).toBe(true);
    expect(totalsClose(10.0, 10.06)).toBe(false);
    expect(TOTAL_TOLERANCE_EUR).toBe(0.05);
  });

  it("paymentsClose tolera 0.01 EUR", () => {
    expect(paymentsClose(10.0, 10.005)).toBe(true);
    expect(paymentsClose(10.0, 10.02)).toBe(false);
    expect(PAYMENT_TOLERANCE_EUR).toBe(0.01);
  });
});
