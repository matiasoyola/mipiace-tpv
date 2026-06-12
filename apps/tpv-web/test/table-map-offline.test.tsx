// v1.0-pilotos · Lote 1: modo degradado online-only del mapa de mesas.
//
// Sin conexión, el TPV debe BLOQUEAR la operativa de mesas entera
// (abrir, retomar) con un mensaje claro, y dejar la venta rápida
// disponible. Antes del fix sólo se deshabilitaban las mesas libres:
// tocar una ocupada llevaba a un SalePage que fallaba a mitad de flujo.
//
// Mismo patrón sin testing-library que error-boundary.test.tsx:
// createRoot + act + eventos nativos.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
const streamMock = vi.hoisted(() => ({ status: "open" as string }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});
vi.mock("../src/hooks/useStoreEventStream.js", () => ({
  useStoreEventStream: () => streamMock.status,
}));

import { ApiError } from "../src/api.js";
import { TableMapScreen, type ApiTable } from "../src/pages/TableMapScreen.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const MESA_LIBRE: ApiTable = {
  id: "00000000-0000-0000-0000-0000000000a1",
  name: "Mesa 1",
  capacity: 4,
  zone: "SALON",
  positionX: null,
  positionY: null,
  width: null,
  height: null,
  barSeatIndex: null,
  groupedIntoTableId: null,
  state: "FREE",
  activeTicket: null,
  createdAt: new Date().toISOString(),
};

const MESA_OCUPADA: ApiTable = {
  ...MESA_LIBRE,
  id: "00000000-0000-0000-0000-0000000000a2",
  name: "Mesa 2",
  state: "OPEN",
  activeTicket: {
    id: "00000000-0000-0000-0000-0000000000b1",
    total: "12.50",
    diners: 2,
    openedAt: new Date().toISOString(),
    openedByEmail: "caja1@bar.es",
    lineCount: 3,
  },
};

const TABLES_RESPONSE = {
  storeId: "00000000-0000-0000-0000-0000000000s1",
  registerId: "00000000-0000-0000-0000-0000000000r1",
  tables: [MESA_LIBRE, MESA_OCUPADA],
};

let container: HTMLDivElement;
let root: Root;
const onPickTable = vi.fn();
const onQuickSale = vi.fn();

function defaultProps() {
  return {
    cashierEmail: "caja1@bar.es",
    storeName: "Bar Test",
    registerName: "Caja 1",
    onPickTable,
    onQuickSale,
    onLogoutCashier: vi.fn(),
    onCloseShift: vi.fn(),
  };
}

async function render() {
  await act(async () => {
    root.render(<TableMapScreen {...defaultProps()} />);
  });
}

function tableButton(name: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(name),
  );
  if (!btn) throw new Error(`botón de ${name} no encontrado`);
  return btn as HTMLButtonElement;
}

function quickSaleButton(): HTMLButtonElement {
  const btn = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Nueva venta rápida"),
  );
  if (!btn) throw new Error("botón de venta rápida no encontrado");
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onPickTable.mockClear();
  onQuickSale.mockClear();
  apiMock.apiWithCashier.mockReset();
  streamMock.status = "open";
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe("TableMapScreen · modo degradado offline", () => {
  it("online: mesas libres y ocupadas clicables, sin banner", async () => {
    apiMock.apiWithCashier.mockResolvedValue(TABLES_RESPONSE);
    await render();

    expect(container.textContent).not.toContain("Sin conexión");

    await act(async () => {
      tableButton("Mesa 1").click();
    });
    await act(async () => {
      tableButton("Mesa 2").click();
    });
    expect(onPickTable).toHaveBeenCalledTimes(2);
  });

  it("offline (red caída al cargar): banner claro + TODAS las mesas bloqueadas", async () => {
    apiMock.apiWithCashier
      .mockResolvedValueOnce(TABLES_RESPONSE)
      .mockRejectedValue(new ApiError(0, "Network error"));
    await render();
    // Segundo load (polling) cae offline.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(container.textContent).toContain(
      "Sin conexión · operativa de mesas bloqueada",
    );
    expect(container.textContent).toContain("La venta rápida sigue disponible");

    // Mesa libre Y mesa ocupada deshabilitadas — antes del fix la
    // ocupada seguía clicable y rompía a mitad de flujo.
    expect(tableButton("Mesa 1").disabled).toBe(true);
    expect(tableButton("Mesa 2").disabled).toBe(true);
    await act(async () => {
      tableButton("Mesa 2").click();
    });
    expect(onPickTable).not.toHaveBeenCalled();
  });

  it("offline: la venta rápida sigue habilitada y navega", async () => {
    apiMock.apiWithCashier
      .mockResolvedValueOnce(TABLES_RESPONSE)
      .mockRejectedValue(new ApiError(0, "Network error"));
    await render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    const quick = quickSaleButton();
    expect(quick.disabled).toBe(false);
    await act(async () => {
      quick.click();
    });
    expect(onQuickSale).toHaveBeenCalledTimes(1);
  });

  it("al volver la red, el siguiente polling desbloquea las mesas", async () => {
    apiMock.apiWithCashier
      .mockResolvedValueOnce(TABLES_RESPONSE)
      .mockRejectedValueOnce(new ApiError(0, "Network error"))
      .mockResolvedValue(TABLES_RESPONSE);
    await render();

    // Polling 1 cae → bloqueo.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.textContent).toContain(
      "Sin conexión · operativa de mesas bloqueada",
    );
    expect(tableButton("Mesa 2").disabled).toBe(true);

    // Polling 2 recupera → banner fuera, mesas operables.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.textContent).not.toContain(
      "Sin conexión · operativa de mesas bloqueada",
    );
    expect(tableButton("Mesa 2").disabled).toBe(false);
    await act(async () => {
      tableButton("Mesa 2").click();
    });
    expect(onPickTable).toHaveBeenCalledTimes(1);
  });
});
