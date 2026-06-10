// v1.4-Precio-Decimales · b30 · el payload enviado a Holded debe
// mantener los 4 decimales del NET. Antes del fix, el truncamiento a 2
// decimales en `formatLineForHolded` causaba que Holded reconstruyera
// el total con la base completa y nos rechazara con silent_reject por
// drift de 1 céntimo en `expectedTotal` vs `stored.total`.
//
// Aquí verificamos:
//   1. `buildTicketSalesreceiptPayload` envía `price` con 4 decimales
//      cuando el NET los tiene (3.8843 → enviado como 3.8843).
//   2. Una línea con override del cajero (lápiz) también preserva los
//      4 decimales.
//   3. Una línea con modificadores estructurados aplica el delta sobre
//      el unitPrice manteniendo precisión.

import { describe, expect, it } from "vitest";

import { buildTicketSalesreceiptPayload } from "../src/tickets/upload-ticket.js";

const baseRegister = { numSerieHolded: "abc" };

describe("v1.4-Precio-Decimales · buildTicketSalesreceiptPayload", () => {
  it("envía price con 4 decimales (3.8843) cuando el NET viene de Holded con esa precisión", () => {
    const payload = buildTicketSalesreceiptPayload({
      externalId: "00000000-0000-4000-8000-000000000001",
      notes: null,
      paidAt: new Date("2026-06-04T10:00:00Z"),
      lines: [
        {
          nameSnapshot: "CORTAR UÑAS SOLO",
          units: 2,
          unitPrice: 3.8843,
          taxRate: 21,
          discountPct: 0,
          sku: "S-CORTAR-UNAS-SOLO",
          product: { kind: "SERVICE", holdedProductId: "h_svc_001" },
        },
      ],
      register: baseRegister,
    });
    expect(payload.items).toHaveLength(1);
    const item = payload.items[0]!;
    // Si el truncamiento a 2dec siguiera vivo, llegaría 3.88 → 4.6948
    // tras IVA → drift 1 céntimo contra Holded. Debe ser 3.8843.
    expect(item.price).toBe(3.8843);
    expect(item.units).toBe(2);
    expect(item.tax).toBe(21);
    expect(item.serviceId).toBe("h_svc_001");
  });

  it("preserva los 4 decimales cuando hay override manual del cajero (lápiz)", () => {
    const payload = buildTicketSalesreceiptPayload({
      externalId: "00000000-0000-4000-8000-000000000002",
      notes: "ajuste cajero",
      paidAt: new Date("2026-06-04T10:00:00Z"),
      lines: [
        {
          nameSnapshot: "Servicio con override",
          units: 1,
          unitPrice: 3.8843,
          // El cajero pulsó el lápiz y forzó un precio con 4 decimales.
          unitPriceOverride: 4.1234,
          taxRate: 21,
          discountPct: 0,
          sku: "TPV-OVR",
          product: { kind: "PRODUCT", holdedProductId: "h_prod_002" },
        },
      ],
      register: baseRegister,
    });
    expect(payload.items[0]!.price).toBe(4.1234);
  });

  it("aplica deltas de modificadores estructurados sin perder precisión del NET base", () => {
    const payload = buildTicketSalesreceiptPayload({
      externalId: "00000000-0000-4000-8000-000000000003",
      notes: null,
      paidAt: new Date("2026-06-04T10:00:00Z"),
      lines: [
        {
          nameSnapshot: "Café con leche",
          units: 1,
          unitPrice: 1.2345,
          taxRate: 10,
          discountPct: 0,
          sku: "P-CAFE",
          product: { kind: "PRODUCT", holdedProductId: "h_prod_003" },
          modifiers: [
            {
              groupId: "g1",
              groupName: "Tipo de leche",
              modifierId: "m1",
              label: "Desnatada",
              priceDeltaCents: 50, // +0.50
            },
          ],
        },
      ],
      register: baseRegister,
    });
    // 1.2345 + 0.50 = 1.7345 → 4 decimales preservados (antes el round2
    // lo dejaba en 1.73 y se perdían los decimales del NET).
    expect(payload.items[0]!.price).toBe(1.7345);
    expect(payload.items[0]!.desc).toBe("(Tipo de leche: Desnatada)");
  });
});
