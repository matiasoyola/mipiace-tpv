// N6 · «CASH» / «CARD» en inglés en pantalla.
//
// El desglose de pagos del detalle de un ticket pintaba `p.method` tal
// cual, así que decía "CASH 6,90" y "CARD 2,60" delante del cliente.
// Era el ÚNICO sitio sin traducir: el cierre de día, el resumen y el
// mixto ya usaban `METHOD_LABEL`, y el ticket térmico tiene su propio
// `methodLabel` en la API (`tickets/escpos-input.ts`).
//
// Este fichero fija que el desglose habla en castellano, y que lo hace
// con la tabla compartida y no con una copia suya.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/test-mode.js", () => ({
  isTestModeActive: () => false,
}));
vi.mock("../src/lib/sentry.js", () => ({
  isSentryEnabled: () => false,
  initSentry: () => false,
  captureError: () => undefined,
}));
vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: vi.fn() };
});

import { TicketDetailDrawer } from "../src/pages/TicketsHistoryPage.js";
import { METHOD_LABEL } from "../src/lib/shiftSummary.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// El mixto real de la auditoría del AP13: 6,90 € en dos pagos.
function ticketMixto() {
  return {
    id: "t-1",
    internalNumber: "000001",
    externalId: null,
    status: "PAID",
    total: 6.9,
    createdAt: "2026-10-07T18:00:00.000Z",
    emailIntent: null,
    holdedDocNumber: null,
    holdedDocumentId: null,
    notes: null,
    syncError: null,
    lines: [],
    payments: [
      { id: "p-1", method: "CASH", amount: 4.3 },
      { id: "p-2", method: "CARD", amount: 2.6 },
    ],
    refunds: [],
  } as never;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <TicketDetailDrawer
        ticket={ticketMixto()}
        businessType="HOSPITALITY"
        onClose={vi.fn()}
        onRefund={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
  });
}

function texto(): string {
  return container.textContent ?? "";
}

describe("N6 · el método de pago se lee en castellano", () => {
  it("el desglose dice Efectivo y Tarjeta", async () => {
    await render();
    expect(texto()).toContain("Efectivo");
    expect(texto()).toContain("Tarjeta");
  });

  it("y no deja CASH ni CARD en pantalla", async () => {
    await render();
    expect(texto()).not.toContain("CASH");
    expect(texto()).not.toContain("CARD");
  });

  it("usa la tabla compartida, no una copia", async () => {
    // Si alguien añade un método a `METHOD_LABEL`, el desglose lo hereda.
    expect(METHOD_LABEL.CASH).toBe("Efectivo");
    expect(METHOD_LABEL.CARD).toBe("Tarjeta");
  });

  it("un método que la tabla no conoce se pinta tal cual, no vacío", async () => {
    // `?? p.method`: antes de inventar una traducción es mejor el código
    // crudo que un hueco en blanco donde iba un importe.
    const t = ticketMixto() as unknown as {
      payments: Array<{ id: string; method: string; amount: number }>;
    };
    t.payments = [{ id: "p-9", method: "CRIPTO", amount: 1 }];
    root = createRoot(container);
    await act(async () => {
      root.render(
        <TicketDetailDrawer
          ticket={t as never}
          businessType="HOSPITALITY"
          onClose={vi.fn()}
          onRefund={vi.fn()}
          onChanged={vi.fn()}
        />,
      );
    });
    expect(texto()).toContain("CRIPTO");
  });
});
