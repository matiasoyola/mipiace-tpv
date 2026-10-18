// auditoria-sirope (#17) · el botón «Iniciar devolución» en las dos
// cuentas que el 18-10 no podían devolver nada: la que no usa Holded (sus
// tickets nacen PAID) y la que está en ensayo (nacen TEST).
//
// El botón lo decide ahora `motivoNoDevolvible`, la misma función que mira
// el servidor. Y cuando dice que no, se dice: antes el botón desaparecía
// sin explicación y el cajero se quedaba mirando la ficha.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testModeMock = vi.hoisted(() => ({ isTestModeActive: vi.fn() }));

vi.mock("../src/lib/test-mode.js", () => ({
  isTestModeActive: testModeMock.isTestModeActive,
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

import { setCachedEnsayo } from "../src/lib/catalog.js";
import { TicketDetailDrawer } from "../src/pages/TicketsHistoryPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function makeTicket(status: string) {
  return {
    id: "t-1",
    internalNumber: "000023",
    externalId: "ext-1",
    status,
    total: 3,
    createdAt: "2026-10-18T13:42:00.000Z",
    emailIntent: null,
    holdedDocNumber: null,
    holdedDocumentId: null,
    notes: null,
    syncError: null,
    lines: [],
    payments: [],
    refunds: [],
  } as never;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  testModeMock.isTestModeActive.mockReturnValue(false);
  localStorage.clear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
});

async function renderDrawer(status: string) {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <TicketDetailDrawer
        ticket={makeTicket(status)}
        businessType="HOSPITALITY"
        onClose={vi.fn()}
        onRefund={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
  });
}

function botonDevolucion(): HTMLElement | null {
  return container.querySelector('[data-testid="iniciar-devolucion"]');
}

function avisoNoDevolvible(): HTMLElement | null {
  return container.querySelector('[data-testid="devolucion-no-disponible"]');
}

describe("Devolución en la cuenta de Sirope (#17)", () => {
  it("ticket PAID (cuenta sin Holded) → botón visible", async () => {
    // Era el agujero: sin Holded no hay SYNCED nunca, y el botón sólo
    // miraba SYNCED.
    await renderDrawer("PAID");
    expect(botonDevolucion()).not.toBeNull();
    expect(avisoNoDevolvible()).toBeNull();
  });

  it("ticket TEST con la cuenta EN ENSAYO → botón visible", async () => {
    setCachedEnsayo(true);
    await renderDrawer("TEST");
    expect(botonDevolucion()).not.toBeNull();
  });

  it("ticket TEST con la cuenta ya facturando → sin botón, pero con motivo", async () => {
    setCachedEnsayo(false);
    await renderDrawer("TEST");
    expect(botonDevolucion()).toBeNull();
    const aviso = avisoNoDevolvible();
    expect(aviso).not.toBeNull();
    expect(aviso!.textContent).toMatch(/prueba anterior/i);
  });

  it("ticket DRAFT → el motivo no menciona Holded", async () => {
    setCachedEnsayo(true);
    await renderDrawer("DRAFT");
    expect(botonDevolucion()).toBeNull();
    expect(avisoNoDevolvible()!.textContent).not.toMatch(/Holded/i);
  });
});
