// v1.9.5-formacion · Frente 3: el checkbox «cerrar el turno igualmente»
// del cierre Z sólo aparece si HAY un motivo, y el copy dice CUÁL es
// (n documentos pendientes de subir / m cobros en la cola local). Si no
// hay nada pendiente, no hay checkbox (bug B3 del mapa de simulaciones
// 2026-07-05: aparecía siempre, sin explicar el motivo).
//
// v1.11-cierre-de-dia · el modal arranca ahora en la TARJETA DE RESUMEN y
// no en la tabla de denominaciones, así que el test tiene que servirle el
// GET /shift/:id/summary. La regla del checkbox no cambia: se comprueba
// en las dos fases, porque el cierre puede confirmarse sin contar
// (`/close-day`) o contando (`/cash-count` kind Z) y las dos pasan por los
// mismos guards del server.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
const outboxMock = vi.hoisted(() => ({
  outboxCounts: vi.fn(),
  outboxList: vi.fn(),
  outboxAdd: vi.fn(),
}));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});
vi.mock("../src/lib/outbox.js", () => ({
  outboxCounts: outboxMock.outboxCounts,
  outboxList: outboxMock.outboxList,
  outboxAdd: outboxMock.outboxAdd,
}));
vi.mock("../src/lib/offlineShift.js", () => ({
  getLocalShift: vi.fn(async () => null),
  closeLocalShift: vi.fn(async () => undefined),
}));

import { ApiError } from "../src/api.js";
import { CloseShiftModal } from "../src/pages/CloseShiftModal.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const summary = {
  shift: {
    id: "shift-1",
    registerId: "reg-1",
    registerName: "Caja 1",
    storeName: "Cafetería Sirope",
    openedAt: "2026-08-19T07:00:00.000Z",
    closedAt: null,
    closeReason: "MANUAL" as const,
    cashOpening: 50,
    cashCounted: null,
    zReportPdfPath: null,
    zReportStale: false,
    summaryAckAt: null,
    cashierLabel: "Sole",
    closedByLabel: null,
  },
  ticketsCount: 12,
  refundsCount: 0,
  breakdown: {
    methods: [
      { method: "CASH", gross: 120, refunds: 0, net: 120 },
      { method: "CARD", gross: 300, refunds: 0, net: 300 },
    ],
    grossSales: 420,
    refundsTotal: 0,
    netSales: 420,
    cashTheoretical: 170,
  },
  cashTheoretical: 170,
  descuadre: null,
};

function syncPendingError(pendingSync: number, failed = 0) {
  return new ApiError(409, "Hay tickets sin sincronizar con Holded.", "SYNC_PENDING", {
    pendingSync,
    failed,
    failedTickets: [],
    failedRefunds: [],
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  apiMock.apiWithCashier.mockReset();
  outboxMock.outboxCounts.mockReset();
  outboxMock.outboxList.mockReset();
  outboxMock.outboxCounts.mockResolvedValue({ pending: 0, rejected: 0 });
  outboxMock.outboxList.mockResolvedValue([]);
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderModal(opts: { requireCashCountOnClose?: boolean } = {}) {
  // GET /shift/:id/summary — la previsualización que abre el modal.
  apiMock.apiWithCashier.mockResolvedValueOnce(summary);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <CloseShiftModal
        shiftId="shift-1"
        cashierRole="MANAGER"
        requireCashCountOnClose={opts.requireCashCountOnClose}
        onClose={vi.fn()}
        onClosed={vi.fn()}
      />,
    );
  });
}

function checkbox(): HTMLInputElement | null {
  return container.querySelector('input[type="checkbox"]');
}

function submitButton(): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Cerrar turno"),
  );
  if (!btn) throw new Error("botón Cerrar turno no encontrado");
  return btn as HTMLButtonElement;
}

describe("Cierre Z · checkbox con motivo (Frente 3)", () => {
  it("sin nada pendiente: NO hay checkbox", async () => {
    await renderModal();
    // Y el resumen SÍ está: la tarjeta es la pantalla (v1.11).
    expect(container.textContent).toContain("Ventas del día");
    expect(checkbox()).toBeNull();
  });

  it("con cobros en la cola local: checkbox con el motivo del outbox", async () => {
    outboxMock.outboxCounts.mockResolvedValue({ pending: 2, rejected: 0 });
    await renderModal();
    expect(checkbox()).not.toBeNull();
    expect(container.textContent).toContain("2 cobros en la cola local del dispositivo");
  });

  it("tras 409 SYNC_PENDING: checkbox con el número de documentos pendientes", async () => {
    await renderModal();
    expect(checkbox()).toBeNull();
    apiMock.apiWithCashier.mockRejectedValueOnce(syncPendingError(3));
    await act(async () => {
      submitButton().click();
    });
    expect(checkbox()).not.toBeNull();
    expect(container.textContent).toContain("3 documentos pendientes de subir a Holded");
  });

  it("con arqueo obligatorio el modal entra por la tabla, y el checkbox sigue igual", async () => {
    outboxMock.outboxCounts.mockResolvedValue({ pending: 1, rejected: 0 });
    await renderModal({ requireCashCountOnClose: true });
    expect(container.textContent).toContain("Denominación");
    expect(checkbox()).not.toBeNull();
    expect(container.textContent).toContain("1 cobro en la cola local del dispositivo");
  });
});
