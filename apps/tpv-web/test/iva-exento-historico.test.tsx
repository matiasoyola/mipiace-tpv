// bloque iva-exento-sanitario · la VISTA DEL HISTÓRICO de una venta
// exenta. El tercero de los tres caminos que pintan un ticket.
//
// Esta ficha nunca ha llevado desglose de IVA y este bloque no se lo
// añade: lo que añade es lo que un documento exento no puede dejar de
// decir —el tramo exento y la leyenda del precepto— y con las MISMAS
// palabras que el papel y el PDF, porque la frase la redacta
// `leyendaExencion` una sola vez para los tres.
//
// Por qué importa que esté aquí y no sólo en el papel: desde esta ficha se
// REIMPRIME. Si el térmico lleva la leyenda y la pantalla desde la que se
// pide la copia no, el cajero no puede comprobar que lo que va a salir es
// lo que tiene que salir.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/test-mode.js", () => ({ isTestModeActive: () => false }));
// @sentry/react no está instalado en el entorno de test (sólo runtime).
vi.mock("../src/lib/sentry.js", () => ({
  isSentryEnabled: () => false,
  initSentry: () => false,
  captureError: () => undefined,
}));
vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return { ...actual, apiWithCashier: vi.fn() };
});

import { TicketDetailDrawer } from "../src/pages/TicketsHistoryPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface LineaDeFixture {
  nameSnapshot: string;
  total: number;
  taxRate: number;
  exemptionCause?: string | null;
}

function makeTicket(lines: LineaDeFixture[], total: number) {
  return {
    id: "t-1",
    internalNumber: "000042",
    externalId: "ext-1",
    status: "SYNCED",
    total,
    createdAt: "2026-10-07T08:42:00.000Z",
    emailIntent: null,
    holdedDocNumber: null,
    holdedDocumentId: null,
    notes: null,
    syncError: null,
    lines: lines.map((l, i) => ({
      id: `l-${i}`,
      nameSnapshot: l.nameSnapshot,
      sku: "LOC-X",
      units: 1,
      unitPrice: l.total,
      total: l.total,
      discountPct: 0,
      taxRate: l.taxRate,
      exemptionCause: l.exemptionCause ?? null,
      modifiers: [],
    })),
    payments: [],
    refunds: [],
  } as never;
}

const QUIROPODIA: LineaDeFixture = {
  nameSnapshot: "Quiropodia",
  total: 35,
  taxRate: 0,
  exemptionCause: "E1",
};
const CREMA: LineaDeFixture = {
  nameSnapshot: "Crema urea 20%",
  total: 12,
  taxRate: 21,
};

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

async function render(lines: LineaDeFixture[], total: number) {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <TicketDetailDrawer
        ticket={makeTicket(lines, total)}
        businessType="SERVICES"
        onClose={vi.fn()}
        onRefund={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
  });
}

const texto = () => container.textContent ?? "";
const leyenda = () =>
  container.querySelector('[data-testid="leyenda-exencion"]')?.textContent ?? null;

describe("iva-exento-sanitario · el histórico de una venta exenta", () => {
  it("pinta el tramo «Exento» con su importe", async () => {
    await render([QUIROPODIA], 35);
    expect(texto()).toContain("Exento");
    expect(texto()).toContain("35,00 €");
  });

  it("y la leyenda, con las mismas palabras que el papel", async () => {
    await render([QUIROPODIA], 35);
    expect(leyenda()).toContain("Operación exenta de IVA");
    expect(leyenda()).toContain("art. 20.Uno.3º Ley 37/1992");
  });

  it("en venta mixta la leyenda lleva el nombre de lo exento delante", async () => {
    await render([QUIROPODIA, CREMA], 47);
    expect(leyenda()).toContain("Quiropodia: operación exenta de IVA");
  });

  it("y el importe exento es SÓLO el de las líneas exentas", async () => {
    // No el total del ticket: en el mixto son 47,00 € y el tramo exento
    // son 35,00 €. Es exacto porque en una línea exenta el neto y el bruto
    // son el mismo número — no hay IVA que sumar — así que Σ de los
    // totales de las líneas exentas ES el importe del tramo.
    await render([QUIROPODIA, CREMA], 47);
    const fila = [...container.querySelectorAll("div")].find(
      (d) => d.children.length === 2 && d.textContent?.startsWith("Exento"),
    );
    expect(fila?.textContent).toBe("Exento35,00 €");
  });

  it("un ticket SIN exención no pinta ni el tramo ni la leyenda", async () => {
    // Los otros catorce tenants: la ficha de siempre, sin una fila de más.
    await render([CREMA], 12);
    expect(leyenda()).toBeNull();
    expect(texto()).not.toContain("Exento");
    expect(texto()).not.toContain("exenta de IVA");
  });

  it("y una línea con un código que no está en la lista L10 NO pinta leyenda", async () => {
    // El CHECK de la base hace que no pueda llegar, pero el TPV cachea
    // respuestas en el Service Worker y una leyenda legal que no se puede
    // respaldar es peor que ninguna.
    await render(
      [{ ...QUIROPODIA, exemptionCause: "E9" }],
      35,
    );
    expect(leyenda()).toBeNull();
  });
});
