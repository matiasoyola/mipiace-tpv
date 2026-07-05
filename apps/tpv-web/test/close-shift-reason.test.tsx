// v1.9.5-formacion · Frente 3: el checkbox «cerrar el turno igualmente»
// del cierre Z sólo aparece si HAY un motivo, y el copy dice CUÁL es
// (n documentos pendientes de subir / m cobros en la cola local). Si no
// hay nada pendiente, no hay checkbox (bug B3 del mapa de simulaciones
// 2026-07-05: aparecía siempre, sin explicar el motivo).

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
const outboxMock = vi.hoisted(() => ({ outboxCounts: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});
vi.mock("../src/lib/outbox.js", () => ({
  outboxCounts: outboxMock.outboxCounts,
}));

import { ApiError } from "../src/api.js";
import { CloseShiftModal } from "../src/pages/CloseShiftModal.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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
  outboxMock.outboxCounts.mockResolvedValue({ pending: 0, rejected: 0 });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderModal() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <CloseShiftModal
        shiftId="shift-1"
        cashierRole="MANAGER"
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
    expect(checkbox()).toBeNull();
  });

  it("con cobros en la cola local: checkbox con el motivo del outbox", async () => {
    outboxMock.outboxCounts.mockResolvedValue({ pending: 2, rejected: 0 });
    await renderModal();
    expect(checkbox()).not.toBeNull();
    expect(container.textContent).toContain("2 cobros en la cola local del dispositivo");
  });

  it("tras 409 SYNC_PENDING: checkbox con el número de documentos pendientes", async () => {
    apiMock.apiWithCashier.mockRejectedValueOnce(syncPendingError(3));
    await renderModal();
    expect(checkbox()).toBeNull();
    await act(async () => {
      submitButton().click();
    });
    expect(checkbox()).not.toBeNull();
    expect(container.textContent).toContain("3 documentos pendientes de subir a Holded");
  });
});
