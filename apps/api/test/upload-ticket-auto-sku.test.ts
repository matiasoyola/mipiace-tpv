// v1.5-hotfix1 · silent_reject en PRODUCT con SKU autogenerado.
//
// Visto el 2026-06-10 en Peluquería Sole (ticket 000022): el builder
// excluía los SKU `AUTO-*` (resto del hotfix7, que era para servicios)
// y la línea iba SIN identificador → Holded la pone a price=0 → total
// 17,50 € vs 27,40 € esperados → silent_reject.
//
// Los `AUTO-*` los asigna runAutoSku y los SUBE a Holded con GET-back
// (needs_sku_review=true si Holded los silencia), así que para un
// producto operativo el AUTO-* es el SKU canónico en Holded y DEBE
// mandarse como cualquier otro.

import { describe, expect, it } from "vitest";

import { buildTicketSalesreceiptPayload } from "../src/tickets/upload-ticket.js";

const baseRegister = { numSerieHolded: "abc" };

function buildPayloadForLine(line: Record<string, unknown>) {
  return buildTicketSalesreceiptPayload({
    externalId: "00000000-0000-4000-8000-0000000000aa",
    notes: null,
    paidAt: new Date("2026-06-10T09:21:00Z"),
    lines: [
      {
        nameSnapshot: "SPRAY  Nº2  SALERM 250ml",
        units: 1,
        unitPrice: 8.18,
        taxRate: 21,
        discountPct: 0,
        ...line,
      } as never,
    ],
    register: baseRegister,
  });
}

describe("v1.5-hotfix1 · SKU AUTO-* en líneas PRODUCT", () => {
  it("PRODUCT con SKU AUTO-* manda el sku (es canónico en Holded tras runAutoSku)", () => {
    const payload = buildPayloadForLine({
      sku: "AUTO-6819ba02",
      product: { kind: "PRODUCT", holdedProductId: "6819ba02f51229758b009fd0" },
    });
    expect(payload.items[0]).toMatchObject({ sku: "AUTO-6819ba02" });
    expect(payload.items[0]).not.toHaveProperty("serviceId");
  });

  it("PRODUCT con SKU normal sigue mandando el sku", () => {
    const payload = buildPayloadForLine({
      sku: "SPRAY-N2-250",
      product: { kind: "PRODUCT", holdedProductId: "6819ba02f51229758b009fd0" },
    });
    expect(payload.items[0]).toMatchObject({ sku: "SPRAY-N2-250" });
  });

  it("SERVICE sigue mandando serviceId y nunca sku (hotfix8 intacto)", () => {
    const payload = buildPayloadForLine({
      sku: "AUTO-67d734e0",
      product: { kind: "SERVICE", holdedProductId: "67d734e07946caaa5e00338a" },
    });
    expect(payload.items[0]).toMatchObject({ serviceId: "67d734e07946caaa5e00338a" });
    expect(payload.items[0]).not.toHaveProperty("sku");
  });

  it("PRODUCT sin sku (string vacío) va sin identificador (caso degradado, sin cambio)", () => {
    const payload = buildPayloadForLine({
      sku: "",
      product: { kind: "PRODUCT", holdedProductId: "6819ba02f51229758b009fd0" },
    });
    expect(payload.items[0]).not.toHaveProperty("sku");
    expect(payload.items[0]).not.toHaveProperty("serviceId");
  });
});
