// Tests del builder de TicketDocument. Cubren los escenarios listados
// en B-Print fase 1 §Frente 1: cabecera fiscal, descuentos, IVA múltiple,
// devoluciones, customer sin email.

import { describe, expect, it } from "vitest";

import {
  assertTicketDocument,
  buildTicketDocument,
  type BuildTicketDocumentInput,
} from "../src/index.js";

function baseInput(): BuildTicketDocumentInput {
  return {
    tenant: {
      name: "Bar Thalia",
      fiscalProfile: {
        legalName: "Thalia Hospitality SL",
        taxId: "B12345678",
        address: "Calle Mayor 10, 28013 Madrid",
        phone: "+34 911 234 567",
      },
    },
    store: {
      name: "Bar Thalia · Centro",
      fiscalAddress: { address: "Calle Mayor 10", phone: "+34 911 234 567" },
    },
    register: { name: "Caja 1" },
    cashier: { email: "ana@thalia.es", name: "Ana" },
    ticket: {
      internalNumber: "000042",
      publicSlug: "abcd1234efgh5678",
      paidAt: new Date("2026-05-14T10:30:00Z"),
      createdAt: new Date("2026-05-14T10:29:50Z"),
      cashAmount: 10,
      total: 6.93,
      lines: [
        {
          nameSnapshot: "Café con leche",
          sku: "CAFE-1",
          units: 2,
          unitPrice: 1.5,
          discountPct: 0,
          taxRate: 10,
        },
        {
          nameSnapshot: "Caña",
          sku: "CANA-1",
          units: 1,
          unitPrice: 3,
          discountPct: 0,
          taxRate: 21,
        },
      ],
      payments: [{ method: "CASH", amount: 10 }],
    },
  };
}

describe("buildTicketDocument", () => {
  it("monta cabecera fiscal y store", () => {
    const doc = buildTicketDocument(baseInput());
    expect(doc.fiscal.legalName).toBe("Thalia Hospitality SL");
    expect(doc.fiscal.taxId).toBe("B12345678");
    expect(doc.store.name).toBe("Bar Thalia · Centro");
    expect(doc.ticket.internalNumber).toBe("000042");
    expect(doc.ticket.cashierName).toBe("Ana");
    assertTicketDocument(doc);
  });

  it("aplica descuento por línea (subtotal calculado neto)", () => {
    const input = baseInput();
    input.ticket.lines = [
      {
        nameSnapshot: "Menú del día",
        sku: "MENU-1",
        units: 1,
        unitPrice: 12,
        discountPct: 25,
        taxRate: 10,
      },
    ];
    input.ticket.payments = [{ method: "CASH", amount: 9.9 }];
    input.ticket.total = 9.9;
    input.ticket.cashAmount = 10;
    const doc = buildTicketDocument(input);
    expect(doc.lines[0]!.subtotal).toBe(9); // 12 * 1 * (1 - 25%) = 9
    expect(doc.lines[0]!.discount).toBe(25);
    expect(doc.totals.subtotal).toBe(9);
    expect(doc.totals.taxBreakdown).toEqual([
      { rate: 10, base: 9, tax: 0.9 },
    ]);
  });

  it("desglosa IVA múltiple (10% comida + 21% bebida)", () => {
    const doc = buildTicketDocument(baseInput());
    // Comida: 2 * 1.5 = 3 base @ 10% → tax 0.30 → total 3.30
    // Bebida: 1 * 3   = 3 base @ 21% → tax 0.63 → total 3.63
    expect(doc.totals.taxBreakdown).toEqual([
      { rate: 10, base: 3, tax: 0.3 },
      { rate: 21, base: 3, tax: 0.63 },
    ]);
    expect(doc.totals.subtotal).toBe(6);
    expect(doc.payment.method).toBe("CASH");
    expect(doc.payment.change).toBe(3.07); // 10 - 6.93
  });

  it("marca devolución con referencia al ticket original", () => {
    const input = baseInput();
    input.refund = { originalTicketNumber: "000040", reason: "Café frío" };
    const doc = buildTicketDocument(input);
    expect(doc.refund?.originalTicketNumber).toBe("000040");
    expect(doc.refund?.reason).toBe("Café frío");
  });

  it("omite customer si no hay name/taxId/email", () => {
    const input = baseInput();
    input.customer = { name: "", email: "", taxId: "" };
    const doc = buildTicketDocument(input);
    expect(doc.customer).toBeUndefined();
  });

  it("conserva customer con name pero sin email", () => {
    const input = baseInput();
    input.customer = { name: "María García" };
    const doc = buildTicketDocument(input);
    expect(doc.customer).toEqual({ name: "María García" });
  });

  it("BIZUM se mapea a TRANSFER y VOUCHER a OTHER", () => {
    const input = baseInput();
    input.ticket.payments = [{ method: "BIZUM", amount: 6.93 }];
    input.ticket.cashAmount = 0;
    expect(buildTicketDocument(input).payment.method).toBe("TRANSFER");

    input.ticket.payments = [{ method: "VOUCHER", amount: 6.93 }];
    expect(buildTicketDocument(input).payment.method).toBe("OTHER");
  });

  it("acepta Decimal-like en lugar de number", () => {
    const input = baseInput();
    input.ticket.lines = [
      {
        nameSnapshot: "X",
        sku: "X",
        units: { toString: () => "2.000" },
        unitPrice: { toString: () => "1.50" },
        discountPct: { toString: () => "0" },
        taxRate: { toString: () => "10.00" },
        subtotal: { toString: () => "3.00" },
      },
    ];
    const doc = buildTicketDocument(input);
    expect(doc.lines[0]!.quantity).toBe(2);
    expect(doc.lines[0]!.unitPrice).toBe(1.5);
    expect(doc.lines[0]!.subtotal).toBe(3);
  });

  it("cae al nombre del tenant si fiscalProfile vacío y mantiene render", () => {
    const input = baseInput();
    input.tenant.fiscalProfile = null;
    const doc = buildTicketDocument(input);
    expect(doc.fiscal.legalName).toBe("Bar Thalia");
    expect(doc.fiscal.taxId).toBe("");
  });
});
