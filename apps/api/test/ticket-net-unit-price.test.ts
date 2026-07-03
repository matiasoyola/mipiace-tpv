// v1.8-Fiado · regresión precio unitario neto en ticket PDF y térmico.
//
// Cuando una línea lleva `unitPriceOverride` (el cajero editó el precio
// con el lápiz), el precio unitario IMPRESO debe ser el neto efectivo
// (override ?? catálogo), no el de catálogo. El bug: se imprimía
// "1 x 5,12 → 4,13" (unit del catálogo, total con override) — confuso e
// incoherente. Cubrimos los dos renderers:
//   - térmico ESC/POS: apps/api/src/tickets/print.ts (ticketToEscposInput)
//   - PDF / ticket digital: build-document.ts (loadTicketDocument)

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";

import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@mipiacetpv/db";

import { ticketToEscposInput } from "../src/tickets/print.js";
import { loadTicketDocument } from "../src/tickets/build-document.js";

// Escenario del bug: catálogo 5,12 €, override 4,13 €, 1 unidad.
const CATALOG_UNIT = 5.12;
const OVERRIDE_UNIT = 4.13;

describe("precio unitario neto (override) en impresión", () => {
  it("térmico: ticketToEscposInput usa el override, no el catálogo", () => {
    const input = ticketToEscposInput(
      {
        id: "t1",
        registerId: "r1",
        internalNumber: "000123",
        publicSlug: "slug1",
        total: 4.13,
        cashAmount: null,
        notes: null,
        paidAt: new Date("2026-07-03T10:00:00Z"),
        createdAt: new Date("2026-07-03T10:00:00Z"),
        table: null,
        user: { email: "ana@bar.es", alias: null },
        register: { name: "Caja 1", store: { name: "Tienda", fiscalAddress: null } },
        tenant: { name: "Comercio", receiptFooter: null, fiscalProfile: null },
        lines: [
          {
            nameSnapshot: "Producto X",
            units: 1,
            unitPrice: CATALOG_UNIT,
            unitPriceOverride: OVERRIDE_UNIT,
            total: 4.13,
          },
        ],
        payments: [{ method: "CASH", amount: 4.13 }],
      },
      "https://tickets.example",
    );

    expect(input.lines[0]!.unitPrice).toBe(OVERRIDE_UNIT);
    expect(input.lines[0]!.lineTotal).toBe(4.13);
  });

  it("térmico: sin override cae al precio de catálogo", () => {
    const input = ticketToEscposInput(
      {
        id: "t2",
        registerId: "r1",
        internalNumber: "000124",
        publicSlug: "slug2",
        total: 5.12,
        cashAmount: null,
        notes: null,
        paidAt: new Date("2026-07-03T10:00:00Z"),
        createdAt: new Date("2026-07-03T10:00:00Z"),
        table: null,
        user: { email: "ana@bar.es", alias: null },
        register: { name: "Caja 1", store: { name: "Tienda", fiscalAddress: null } },
        tenant: { name: "Comercio", receiptFooter: null, fiscalProfile: null },
        lines: [
          {
            nameSnapshot: "Producto X",
            units: 1,
            unitPrice: CATALOG_UNIT,
            unitPriceOverride: null,
            total: 5.12,
          },
        ],
        payments: [{ method: "CASH", amount: 5.12 }],
      },
      "https://tickets.example",
    );

    expect(input.lines[0]!.unitPrice).toBe(CATALOG_UNIT);
  });

  it("PDF: loadTicketDocument mapea el override al unitPrice de la línea", async () => {
    const fakeTicket = {
      id: "t1",
      tenantId: "tenant1",
      contactHoldedId: null,
      internalNumber: "000123",
      publicSlug: "slug1",
      paidAt: new Date("2026-07-03T10:00:00Z"),
      createdAt: new Date("2026-07-03T10:00:00Z"),
      cashAmount: null,
      total: 4.13,
      attendedBy: null,
      emailIntent: null,
      tenant: {
        name: "Comercio",
        fiscalProfile: null,
        businessType: "RETAIL",
        receiptFooter: null,
      },
      register: { name: "Caja 1", store: { name: "Tienda", fiscalAddress: null } },
      user: { email: "ana@bar.es" },
      lines: [
        {
          nameSnapshot: "Producto X",
          sku: "SKU-X",
          units: 1,
          unitPrice: CATALOG_UNIT,
          unitPriceOverride: OVERRIDE_UNIT,
          discountPct: 0,
          taxRate: 21,
          subtotal: 3.41,
          total: 4.13,
        },
      ],
      payments: [{ method: "CASH", amount: 4.13 }],
    };

    const prisma = {
      ticket: { findFirst: async () => fakeTicket },
      contact: { findFirst: async () => null },
    } as unknown as PrismaClient;

    const doc = await loadTicketDocument({ prisma, ticketId: "t1" });
    expect(doc).not.toBeNull();
    expect(doc!.lines[0]!.unitPrice).toBe(OVERRIDE_UNIT);
  });
});
