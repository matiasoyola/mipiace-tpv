// v1.5-hotfix2 · ShiftForceCloseScreen + SYNC_PENDING.
//
// Bug (2026-06-11, Peluquería Sole): con un turno colgado Y tickets
// SYNC_FAILED, la API devolvía 409 SYNC_PENDING y la pantalla solo
// pintaba el mensaje, sin lista, sin checkbox de aceptación y sin
// reenviar `syncFailureAccepted` → imposible cerrar el turno y por
// tanto imposible abrir caja. El negocio quedaba bloqueado, justo lo
// que ADR-007 prohíbe.
//
// Verificamos: panel con los tickets fallidos, botón deshabilitado
// hasta marcar la aceptación, y reenvío con syncFailureAccepted: true.
//
// Mismo patrón sin testing-library que error-boundary.test.tsx:
// createRoot + act + eventos nativos.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

import { ApiError } from "../src/api.js";
import { ShiftForceCloseScreen } from "../src/pages/ShiftForceCloseScreen.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const shift = {
  id: "shift-1",
  openedAt: "2026-06-10T07:22:25.000Z",
  lastActivityAt: "2026-06-10T10:15:31.000Z",
  cashOpening: "0",
};

function makeSyncPendingError() {
  return new ApiError(
    409,
    "Hay tickets sin sincronizar con Holded. Pide autorización del encargado y vuelve a confirmar.",
    "SYNC_PENDING",
    {
      failedTickets: [
        {
          id: "t-22",
          kind: "ticket",
          internalNumber: "000022",
          total: 27.4,
          createdAt: "2026-06-10T09:21:23.000Z",
          errorSummary: "silent_reject",
        },
      ],
      failedRefunds: [],
    },
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  apiMock.apiWithCashier.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderScreen(onClosed = vi.fn()) {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ShiftForceCloseScreen shift={shift} cashierRole="MANAGER" onClosed={onClosed} />,
    );
  });
  return onClosed;
}

function cashInput(): HTMLInputElement {
  const el = container.querySelector('input[placeholder="0,00"]');
  if (!el) throw new Error("input de efectivo no encontrado");
  return el as HTMLInputElement;
}

function closeButton(): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("button"));
  const btn = buttons.find((b) => b.textContent?.includes("Cerrar turno colgado"));
  if (!btn) throw new Error("botón de cierre no encontrado");
  return btn;
}

// Setter nativo para que React registre el cambio del input controlado.
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function typeCashAndSubmit() {
  await act(async () => {
    setInputValue(cashInput(), "0");
  });
  await act(async () => {
    closeButton().click();
  });
}

describe("v1.5-hotfix2 · turno colgado con SYNC_PENDING", () => {
  it("muestra el panel con los tickets fallidos y NO deja reenviar sin aceptar", async () => {
    apiMock.apiWithCashier.mockRejectedValueOnce(makeSyncPendingError());
    await renderScreen();
    await typeCashAndSubmit();

    expect(container.textContent).toContain("Puedes cerrar el turno igualmente");
    expect(container.textContent).toContain("#000022");
    expect(container.textContent).toContain("27.40 €");
    expect(closeButton().disabled).toBe(true);
    expect(apiMock.apiWithCashier).toHaveBeenCalledTimes(1);
  });

  it("tras marcar la aceptación reenvía con syncFailureAccepted: true", async () => {
    apiMock.apiWithCashier
      .mockRejectedValueOnce(makeSyncPendingError())
      .mockResolvedValueOnce({});
    await renderScreen();
    await typeCashAndSubmit();

    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    await act(async () => {
      (checkbox as HTMLInputElement).click();
    });
    expect(closeButton().disabled).toBe(false);
    await act(async () => {
      closeButton().click();
    });

    expect(apiMock.apiWithCashier).toHaveBeenCalledTimes(2);
    const secondBody = apiMock.apiWithCashier.mock.calls[1]![1].body;
    expect(secondBody.syncFailureAccepted).toBe(true);
  });

  it("el flujo sin problemas de sync no cambia: un solo POST y onClosed", async () => {
    apiMock.apiWithCashier.mockResolvedValueOnce({});
    const onClosed = await renderScreen();
    await typeCashAndSubmit();

    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(apiMock.apiWithCashier).toHaveBeenCalledTimes(1);
    const body = apiMock.apiWithCashier.mock.calls[0]![1].body;
    expect(body.syncFailureAccepted).toBeUndefined();
  });
});
