// v1.9.5-formacion · Frente 1: el botón «Iniciar devolución» se ofrece
// sobre tickets TEST (venta en modo prueba) SÓLO cuando la sesión es de
// cajero técnico (modo prueba). Fuera de modo prueba, un ticket TEST no
// muestra el botón. Un ticket SYNCED lo muestra siempre.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testModeMock = vi.hoisted(() => ({ isTestModeActive: vi.fn() }));

vi.mock("../src/lib/test-mode.js", () => ({
  isTestModeActive: testModeMock.isTestModeActive,
}));
// @sentry/react no está instalado en el entorno de test (sólo runtime);
// stub del wrapper para no arrastrar el módulo por el grafo de imports.
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

function makeTicket(status: string) {
  return {
    id: "t-1",
    internalNumber: "000005",
    externalId: "ext-1",
    status,
    total: 5.4,
    createdAt: "2026-07-05T10:00:00.000Z",
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
  testModeMock.isTestModeActive.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
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

function hasRefundButton(): boolean {
  return Array.from(container.querySelectorAll("button")).some((b) =>
    /Iniciar/i.test(b.textContent ?? ""),
  );
}

describe("Botón devolución en modo prueba (Frente 1)", () => {
  it("ticket TEST + modo prueba activo → botón visible", async () => {
    testModeMock.isTestModeActive.mockReturnValue(true);
    await renderDrawer("TEST");
    expect(hasRefundButton()).toBe(true);
  });

  it("ticket TEST SIN modo prueba → botón oculto", async () => {
    testModeMock.isTestModeActive.mockReturnValue(false);
    await renderDrawer("TEST");
    expect(hasRefundButton()).toBe(false);
  });

  it("ticket SYNCED → botón visible siempre (modo prueba irrelevante)", async () => {
    testModeMock.isTestModeActive.mockReturnValue(false);
    await renderDrawer("SYNCED");
    expect(hasRefundButton()).toBe(true);
  });
});
