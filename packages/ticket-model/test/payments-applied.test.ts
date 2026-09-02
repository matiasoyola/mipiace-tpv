// v1.15-la-vuelta-existe §1 · la regla de "aplicado contra entregado",
// que es de donde salen las tres víctimas del hallazgo B1: el Z, el
// ticket térmico y la pantalla de confirmación.

import { describe, expect, it } from "vitest";

import { applyPaymentsToTotal, changeFromCash } from "../src/payments.js";

describe("applyPaymentsToTotal", () => {
  it("el caso de la auditoría: 3,00 € pagados con un billete de 5", () => {
    const r = applyPaymentsToTotal([{ method: "CASH", amount: 5 }], 3);
    expect(r.payments).toEqual([{ method: "CASH", amount: 3 }]);
    expect(r.cashDelivered).toBe(5);
    expect(r.cashApplied).toBe(3);
    expect(r.change).toBe(2);
    expect(r.capped).toBe(true);
    expect(r.nonCashOverflow).toBe(0);
  });

  it("cobro clavado: no toca nada y no hay vuelta", () => {
    const r = applyPaymentsToTotal([{ method: "CASH", amount: 4.7 }], 4.7);
    expect(r.payments).toEqual([{ method: "CASH", amount: 4.7 }]);
    expect(r.change).toBe(0);
    expect(r.capped).toBe(false);
  });

  it("mixto: el exceso se lo come el efectivo y la tarjeta queda intacta", () => {
    // 4,70 € cobrados con 2,70 de tarjeta y un billete de 5.
    const r = applyPaymentsToTotal(
      [
        { method: "CASH", amount: 5 },
        { method: "CARD", amount: 2.7 },
      ],
      4.7,
    );
    expect(r.payments).toEqual([
      { method: "CASH", amount: 2 },
      { method: "CARD", amount: 2.7 },
    ]);
    expect(r.payments.reduce((a, p) => a + p.amount, 0)).toBeCloseTo(4.7, 5);
    expect(r.change).toBe(3);
  });

  it("dos filas de efectivo: se recorta la segunda, no la primera", () => {
    const r = applyPaymentsToTotal(
      [
        { method: "CASH", amount: 5 },
        { method: "CASH", amount: 10 },
      ],
      12,
    );
    expect(r.payments).toEqual([
      { method: "CASH", amount: 5 },
      { method: "CASH", amount: 7 },
    ]);
    expect(r.change).toBe(3);
  });

  it("la fila que el reparto deja en 0,00 € no sale del reparto", () => {
    const r = applyPaymentsToTotal(
      [
        { method: "CASH", amount: 20 },
        { method: "CARD", amount: 0 },
      ],
      14,
    );
    expect(r.payments).toEqual([{ method: "CASH", amount: 14 }]);
    expect(r.change).toBe(6);
  });

  it("exceso en tarjeta: no se puede normalizar y sale marcado", () => {
    // La tarjeta no devuelve cambio: 15 € sobre 14 son 1 € cobrado de
    // más al cliente, no una vuelta.
    const r = applyPaymentsToTotal([{ method: "CARD", amount: 15 }], 14);
    expect(r.nonCashOverflow).toBe(1);
  });

  it("no inventa pagos: si la suma no llega al total, no rellena", () => {
    const r = applyPaymentsToTotal([{ method: "CASH", amount: 3 }], 10);
    expect(r.payments).toEqual([{ method: "CASH", amount: 3 }]);
    expect(r.change).toBe(0);
    expect(r.capped).toBe(false);
  });

  it("conserva el resto de campos de la fila (meta del datáfono)", () => {
    const r = applyPaymentsToTotal(
      [{ method: "CARD", amount: 3, meta: { reference: "1234" } }],
      3,
    );
    expect(r.payments[0]).toEqual({
      method: "CARD",
      amount: 3,
      meta: { reference: "1234" },
    });
  });

  it("un céntimo de más entra sin recortar (tolerancia de pago)", () => {
    const r = applyPaymentsToTotal([{ method: "CARD", amount: 14.01 }], 14);
    expect(r.nonCashOverflow).toBe(0);
  });
});

describe("changeFromCash", () => {
  it("entregado menos aplicado en efectivo", () => {
    expect(changeFromCash([{ method: "CASH", amount: 3 }], 5)).toBe(2);
  });

  it("sin cashAmount no hay vuelta que calcular", () => {
    expect(changeFromCash([{ method: "CASH", amount: 3 }], null)).toBe(0);
  });

  it("sin filas de efectivo no hay vuelta (la tarjeta no devuelve)", () => {
    expect(changeFromCash([{ method: "CARD", amount: 3 }], 5)).toBe(0);
  });

  it("un ticket sin arreglar (payments = entregado) declara vuelta 0", () => {
    // Es el estado del histórico anterior a v1.15 y la razón de que el
    // backfill de §2 no sea opcional si se quiere reimprimir bien.
    expect(changeFromCash([{ method: "CASH", amount: 5 }], 5)).toBe(0);
  });
});
