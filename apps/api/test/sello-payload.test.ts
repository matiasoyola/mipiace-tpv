// S1-sello · el payload del sello, en su parte pura.
//
// Un hash que dependa del orden en que Postgres devolvió las filas, o de
// si un importe llegó como `12.3` o como `12.3000`, no sirve para nada:
// el mismo ticket daría dos sellos distintos y la verificación posterior
// sería un volado. Esto fija esa parte.
//
// Lo que NO se prueba aquí es que el motor rechace nada: eso vive en
// `test-e2e/sello-de-la-venta.e2e.ts`, contra Postgres de verdad, porque
// con un doble se estaría probando lo contrario de lo que cierra el
// bloque.

import { describe, expect, it } from "vitest";

import {
  buildSealPayload,
  canonicalize,
  computeSealHash,
  sealDecimal,
  SEAL_VERSION,
  type SealableTicket,
} from "../src/tickets/seal.js";

function ticket(over: Partial<SealableTicket> = {}): SealableTicket {
  return {
    internalNumber: "000042",
    shiftId: "dddddddd-0000-4000-8000-000000000001",
    total: 12.1,
    totalTax: 1.1,
    totalDiscount: 0,
    cashAmount: 20,
    paidAt: new Date("2026-09-09T10:00:00.000Z"),
    lines: [
      {
        id: "bbbbbbbb-0000-4000-8000-000000000002",
        productId: null,
        variantId: null,
        holdedProductId: null,
        sku: "TPV-CAFE",
        nameSnapshot: "Café",
        units: 1,
        unitPrice: 11,
        unitPriceOverride: null,
        discountPct: 0,
        taxRate: 10,
        subtotal: 11,
        total: 12.1,
        modifiers: null,
      },
    ],
    payments: [
      {
        id: "cccccccc-0000-4000-8000-000000000002",
        method: "CASH",
        amount: 12.1,
        meta: null,
        externalId: null,
        collectedInShiftId: null,
      },
    ],
    ...over,
  };
}

describe("S1-sello · payload del sello", () => {
  it("formatea cada importe con la escala de su columna", () => {
    // 12.3 y 12.3000 son el mismo dinero. Si el sello los distinguiera,
    // el hash dependería de por dónde entró el dato.
    expect(sealDecimal(12.3, "total")).toBe("12.3000");
    expect(sealDecimal("12.3000", "total")).toBe("12.3000");
    expect(sealDecimal(1, "units")).toBe("1.000");
    expect(sealDecimal(21, "tax_rate")).toBe("21.00");
    expect(sealDecimal(null, "cash_amount")).toBeNull();
  });

  it("revienta si se le pide sellar una columna sin escala declarada", () => {
    // El guardia de la lista: una columna de importe nueva que no pase
    // por `SEALED_DECIMAL_SCALE` no se cuela con un formato cualquiera.
    expect(() => sealDecimal(1, "columna_inventada")).toThrow(/escala decimal/);
  });

  it("ordena claves de los JSON anidados: modifiers y meta no dependen del motor", () => {
    expect(JSON.stringify(canonicalize({ b: 1, a: { d: 2, c: 3 } }))).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
    expect(JSON.stringify(canonicalize([{ z: 1, a: 2 }]))).toBe('[{"a":2,"z":1}]');
  });

  it("el mismo ticket con las líneas en otro orden da el MISMO hash", () => {
    const base = ticket({
      lines: [
        { ...ticket().lines[0]!, id: "aaaa0000-0000-4000-8000-000000000001", sku: "A" },
        { ...ticket().lines[0]!, id: "aaaa0000-0000-4000-8000-000000000002", sku: "B" },
      ],
    });
    const reversed = ticket({ lines: [...base.lines].reverse() });
    expect(computeSealHash(reversed)).toBe(computeSealHash(base));
    // Y el orden canónico es por `id` ascendente, no el de llegada.
    const payload = JSON.parse(buildSealPayload(reversed));
    expect(payload.lines.map((l: { sku: string }) => l.sku)).toEqual(["A", "B"]);
  });

  it("el mismo ticket con los pagos en otro orden da el MISMO hash", () => {
    const base = ticket({
      payments: [
        { ...ticket().payments[0]!, id: "cccc0000-0000-4000-8000-000000000001", method: "CASH" },
        { ...ticket().payments[0]!, id: "cccc0000-0000-4000-8000-000000000002", method: "CARD" },
      ],
    });
    const reversed = ticket({ payments: [...base.payments].reverse() });
    expect(computeSealHash(reversed)).toBe(computeSealHash(base));
  });

  it("un céntimo de diferencia en cualquier importe cambia el hash", () => {
    const base = computeSealHash(ticket());
    expect(computeSealHash(ticket({ total: 12.11 }))).not.toBe(base);
    expect(computeSealHash(ticket({ totalTax: 1.11 }))).not.toBe(base);
    expect(computeSealHash(ticket({ totalDiscount: 0.01 }))).not.toBe(base);
    expect(computeSealHash(ticket({ cashAmount: 20.01 }))).not.toBe(base);
    expect(
      computeSealHash(
        ticket({ lines: [{ ...ticket().lines[0]!, unitPrice: 11.01 }] }),
      ),
    ).not.toBe(base);
    expect(
      computeSealHash(
        ticket({ payments: [{ ...ticket().payments[0]!, amount: 12.11 }] }),
      ),
    ).not.toBe(base);
  });

  it("cambiar el SKU cambia el hash: el sello dice QUÉ se vendió", () => {
    // Por esto `edit-line-sku` pasa por la vía de corrección y no escribe
    // la columna a pelo.
    expect(
      computeSealHash(ticket({ lines: [{ ...ticket().lines[0]!, sku: "OTRO" }] })),
    ).not.toBe(computeSealHash(ticket()));
  });

  it("el número interno y la fecha de cobro entran en el sello", () => {
    const base = computeSealHash(ticket());
    expect(computeSealHash(ticket({ internalNumber: "000043" }))).not.toBe(base);
    expect(
      computeSealHash(ticket({ paidAt: new Date("2026-09-09T10:00:01.000Z") })),
    ).not.toBe(base);
  });

  it("el turno entra en el sello: mover la venta de Z cambia el hash", () => {
    // No es un importe, pero `loadShiftBreakdownSums` agrupa los pagos
    // por `ticket.shiftId`: cambiarlo mueve la venta entera de un arqueo
    // a otro sin tocar un euro, y por eso va dentro del sello y no sólo
    // vigilado por el trigger.
    expect(
      computeSealHash(ticket({ shiftId: "dddddddd-0000-4000-8000-000000000002" })),
    ).not.toBe(computeSealHash(ticket()));
  });

  it("la versión del formato va dentro del hash", () => {
    const payload = JSON.parse(buildSealPayload(ticket()));
    expect(payload.v).toBe(SEAL_VERSION);
  });

  it("NO encadena con ningún otro ticket: el sello es por venta (ADR-015 §2)", () => {
    // La frontera con el ámbito SIF. Dos ventas idénticas tienen el mismo
    // sello: no hay nada del ticket anterior dentro del hash.
    const a = ticket({ internalNumber: "000001" });
    const b = ticket({ internalNumber: "000001" });
    expect(computeSealHash(a)).toBe(computeSealHash(b));
    const payload = JSON.parse(buildSealPayload(a));
    expect(Object.keys(payload).sort()).toEqual(["lines", "payments", "ticket", "v"]);
  });
});
