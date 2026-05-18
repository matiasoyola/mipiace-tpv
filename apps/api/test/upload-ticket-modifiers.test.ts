// Tests del payload Holded para líneas con modifiers (B-Bar-Modifiers
// · Frente 5). Verifica:
//   - Línea sin modifiers: comportamiento legacy intacto (sin `desc`).
//   - Línea con modifiers structured: `desc = "(Grupo: Label; ...)"`
//     y `price` rolled-up incluye los deltas.
//   - Línea con modifiers legacy string[]: `desc = "(string1; string2)"`
//     y `price` se mantiene (las strings ad-hoc no afectan al precio).

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { describe, expect, it } from "vitest";

import { buildTicketSalesreceiptPayload } from "../src/tickets/upload-ticket.js";

const BASE_TICKET = {
  externalId: "11111111-1111-4111-8111-111111111111",
  notes: null,
  paidAt: new Date("2026-05-18T10:00:00Z"),
  register: { numSerieHolded: null },
};

describe("buildTicketSalesreceiptPayload (B-Bar-Modifiers · Frente 5)", () => {
  it("línea sin modifiers: no añade desc, price base", () => {
    const payload = buildTicketSalesreceiptPayload({
      ...BASE_TICKET,
      lines: [
        {
          nameSnapshot: "Cafe",
          sku: "SKU-1",
          units: 1,
          unitPrice: 1.5,
          taxRate: 21,
          discountPct: 0,
        },
      ],
    });
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]!).toMatchObject({
      name: "Cafe",
      price: 1.5,
      sku: "SKU-1",
    });
    expect(payload.items[0]!.desc).toBeUndefined();
  });

  it("modifiers legacy string[]: desc literal, sin alterar price", () => {
    const payload = buildTicketSalesreceiptPayload({
      ...BASE_TICKET,
      lines: [
        {
          nameSnapshot: "Cafe",
          sku: "SKU-1",
          units: 1,
          unitPrice: 1.5,
          taxRate: 21,
          discountPct: 0,
          modifiers: ["sin azúcar", "tibio"],
        },
      ],
    });
    expect(payload.items[0]!.price).toBe(1.5);
    expect(payload.items[0]!.desc).toBe("(sin azúcar; tibio)");
  });

  it("modifiers estructurados: desc desnormalizado y price rolled-up", () => {
    const payload = buildTicketSalesreceiptPayload({
      ...BASE_TICKET,
      lines: [
        {
          nameSnapshot: "Cafe",
          sku: "SKU-1",
          units: 1,
          unitPrice: 1.5,
          taxRate: 21,
          discountPct: 0,
          modifiers: [
            {
              groupId: "g1",
              groupName: "Tipo de leche",
              modifierId: "m1",
              label: "Desnatada",
              priceDeltaCents: 0,
            },
            {
              groupId: "g2",
              groupName: "Tamaño",
              modifierId: "m2",
              label: "Grande",
              priceDeltaCents: 50,
            },
          ],
        },
      ],
    });
    expect(payload.items[0]!.price).toBe(2.0); // 1.5 + 0.50
    expect(payload.items[0]!.desc).toBe(
      "(Tipo de leche: Desnatada; Tamaño: Grande)",
    );
  });

  it("delta negativo: price disminuye, redondeo a 2 decimales", () => {
    const payload = buildTicketSalesreceiptPayload({
      ...BASE_TICKET,
      lines: [
        {
          nameSnapshot: "Cafe",
          sku: "SKU-1",
          units: 1,
          unitPrice: 2.5,
          taxRate: 21,
          discountPct: 0,
          modifiers: [
            {
              groupId: "g1",
              groupName: "Descuento happy",
              modifierId: "m1",
              label: "Happy hour",
              priceDeltaCents: -20,
            },
          ],
        },
      ],
    });
    expect(payload.items[0]!.price).toBe(2.3);
    expect(payload.items[0]!.desc).toBe("(Descuento happy: Happy hour)");
  });

  it("array vacío de modifiers no añade desc", () => {
    const payload = buildTicketSalesreceiptPayload({
      ...BASE_TICKET,
      lines: [
        {
          nameSnapshot: "Cafe",
          sku: "SKU-1",
          units: 1,
          unitPrice: 1.5,
          taxRate: 21,
          discountPct: 0,
          modifiers: [],
        },
      ],
    });
    expect(payload.items[0]!.desc).toBeUndefined();
  });
});
