// v1.0-pilotos · Lote 3 (#28): desglose del arqueo Z por método.
// computeZBreakdown es pura — sin BD, sin Fastify.

import { describe, expect, it } from "vitest";

import { computeZBreakdown } from "../src/shift/z-breakdown.js";

describe("computeZBreakdown", () => {
  it("turno sin movimientos: filas CASH/CARD a 0 y teórico = fondo", () => {
    const b = computeZBreakdown({
      cashOpening: 100,
      paymentsByMethod: {},
      refundsByMethod: {},
    });
    expect(b.methods.map((m) => m.method)).toEqual(["CASH", "CARD"]);
    expect(b.grossSales).toBe(0);
    expect(b.netSales).toBe(0);
    expect(b.cashTheoretical).toBe(100);
  });

  it("pagos mixtos sin devoluciones: bruto = neto por método", () => {
    const b = computeZBreakdown({
      cashOpening: 50,
      paymentsByMethod: { CASH: 120.5, CARD: 230.25, BIZUM: 15 },
      refundsByMethod: {},
    });
    expect(b.methods).toEqual([
      { method: "CASH", gross: 120.5, refunds: 0, net: 120.5 },
      { method: "CARD", gross: 230.25, refunds: 0, net: 230.25 },
      { method: "BIZUM", gross: 15, refunds: 0, net: 15 },
    ]);
    expect(b.grossSales).toBe(365.75);
    expect(b.refundsTotal).toBe(0);
    expect(b.netSales).toBe(365.75);
    expect(b.cashTheoretical).toBe(170.5);
  });

  it("devoluciones en efectivo restan del teórico de caja (descuadre justo)", () => {
    const b = computeZBreakdown({
      cashOpening: 100,
      paymentsByMethod: { CASH: 200, CARD: 300 },
      refundsByMethod: { CASH: 25.5 },
    });
    const cash = b.methods.find((m) => m.method === "CASH")!;
    expect(cash.gross).toBe(200);
    expect(cash.refunds).toBe(25.5);
    expect(cash.net).toBe(174.5);
    // 100 fondo + 174.50 neto — el cajero devolvió 25,50 € del cajón.
    expect(b.cashTheoretical).toBe(274.5);
    expect(b.netSales).toBe(474.5);
  });

  it("devoluciones por tarjeta no tocan el teórico de caja", () => {
    const b = computeZBreakdown({
      cashOpening: 100,
      paymentsByMethod: { CASH: 200, CARD: 300 },
      refundsByMethod: { CARD: 50 },
    });
    expect(b.cashTheoretical).toBe(300);
    const card = b.methods.find((m) => m.method === "CARD")!;
    expect(card.net).toBe(250);
    expect(b.netSales).toBe(450);
  });

  it("pagos mixtos + devoluciones mixtas: totales agregados correctos", () => {
    const b = computeZBreakdown({
      cashOpening: 80,
      paymentsByMethod: { CASH: 150.1, CARD: 99.95, VOUCHER: 20, OTHER: 5 },
      refundsByMethod: { CASH: 10.1, VOUCHER: 20 },
      counted: { CASH: 218.99 },
    });
    expect(b.grossSales).toBe(275.05);
    expect(b.refundsTotal).toBe(30.1);
    expect(b.netSales).toBe(244.95);
    // 80 + (150.10 − 10.10) = 220
    expect(b.cashTheoretical).toBe(220);
    const cash = b.methods.find((m) => m.method === "CASH")!;
    expect(cash.counted).toBe(218.99);
    // VOUCHER vendido y devuelto entero → neto 0 pero visible.
    const voucher = b.methods.find((m) => m.method === "VOUCHER")!;
    expect(voucher.net).toBe(0);
  });

  it("método desconocido (enum futuro) se añade al final sin romper", () => {
    const b = computeZBreakdown({
      cashOpening: 0,
      paymentsByMethod: { CRYPTO: 10, CASH: 5 },
      refundsByMethod: {},
    });
    expect(b.methods.map((m) => m.method)).toEqual(["CASH", "CARD", "CRYPTO"]);
    expect(b.grossSales).toBe(15);
  });

  it("redondeo a 2 decimales en agregados (sin drift IEEE-754)", () => {
    const b = computeZBreakdown({
      cashOpening: 0.1,
      paymentsByMethod: { CASH: 0.1 + 0.2 },
      refundsByMethod: { CASH: 0.1 },
    });
    expect(b.methods.find((m) => m.method === "CASH")!.net).toBe(0.2);
    expect(b.cashTheoretical).toBe(0.3);
  });

  // v1.8-Fiado · escenario multi-día del prompt (Frente 5):
  //   día 1 → venta fiada de 100 €
  //   día 2 → cobro parcial de 40 € en efectivo
  //   día 3 → resto 60 € en tarjeta
  // El teórico de caja debe cuadrar en cada turno.
  describe("Z multi-día de fiado", () => {
    it("día 1 (venta fiada): no suma a caja, aparece en 'ventas a crédito'", () => {
      const b = computeZBreakdown({
        cashOpening: 100,
        paymentsByMethod: {}, // el fiado NO crea pago
        refundsByMethod: {},
        creditSales: { count: 1, total: 100 },
      });
      expect(b.creditSales).toEqual({ count: 1, total: 100 });
      expect(b.creditCollections).toEqual([]);
      // El fiado no entró en caja: teórico = fondo.
      expect(b.cashTheoretical).toBe(100);
      expect(b.grossSales).toBe(0);
    });

    it("día 2 (cobro parcial efectivo): suma al teórico y a 'cobros de deuda'", () => {
      const b = computeZBreakdown({
        cashOpening: 100,
        paymentsByMethod: {},
        refundsByMethod: {},
        creditCollectionsByMethod: { CASH: 40 },
      });
      expect(b.creditCollections).toEqual([{ method: "CASH", amount: 40 }]);
      expect(b.creditCollectionsTotal).toBe(40);
      // 100 fondo + 40 efectivo cobrado de la deuda.
      expect(b.cashTheoretical).toBe(140);
      // No es una venta del turno.
      expect(b.grossSales).toBe(0);
    });

    it("día 3 (resto tarjeta): no toca el efectivo, sí la sección de cobros", () => {
      const b = computeZBreakdown({
        cashOpening: 100,
        paymentsByMethod: {},
        refundsByMethod: {},
        creditCollectionsByMethod: { CARD: 60 },
      });
      expect(b.creditCollections).toEqual([{ method: "CARD", amount: 60 }]);
      expect(b.creditCollectionsTotal).toBe(60);
      // Tarjeta no entra al cajón: teórico = fondo.
      expect(b.cashTheoretical).toBe(100);
    });

    it("cobro mixto efectivo+tarjeta el mismo turno: sólo el efectivo al teórico", () => {
      const b = computeZBreakdown({
        cashOpening: 50,
        paymentsByMethod: { CASH: 200 }, // ventas normales del turno
        refundsByMethod: {},
        creditCollectionsByMethod: { CASH: 40, CARD: 60 },
      });
      // 50 fondo + 200 ventas efectivo + 40 cobro deuda efectivo = 290.
      expect(b.cashTheoretical).toBe(290);
      expect(b.creditCollectionsTotal).toBe(100);
      expect(b.creditCollections).toEqual([
        { method: "CASH", amount: 40 },
        { method: "CARD", amount: 60 },
      ]);
    });
  });
});
