// v1.7-alias-cajeros: fallback alias→email en los puntos de display
// del TPV. Cubre:
//   - cashierDisplayLabel (header SalePage, Bloquear, relogin).
//   - Tolerancia de RecentCashier a entradas guardadas sin alias.
//   - Chip de operador en TableMapScreen: iniciales del alias si viene
//     en el snapshot, iniciales del email si no (users legacy o API
//     vieja sin openedByAlias).
//
// Mismo patrón sin testing-library que table-map-offline.test.tsx.

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

import { TableMapScreen, type ApiTable } from "../src/pages/TableMapScreen.js";
import {
  cashierDisplayLabel,
  getRecentCashiers,
  rememberCashier,
} from "../src/storage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe("cashierDisplayLabel", () => {
  it("con alias → alias", () => {
    expect(cashierDisplayLabel({ alias: "María", email: "m.g@x.es" })).toBe("María");
  });

  it("sin alias / alias vacío → email (sesiones y entradas legacy)", () => {
    expect(cashierDisplayLabel({ email: "m.g@x.es" })).toBe("m.g@x.es");
    expect(cashierDisplayLabel({ alias: null, email: "m.g@x.es" })).toBe("m.g@x.es");
    expect(cashierDisplayLabel({ alias: "   ", email: "m.g@x.es" })).toBe("m.g@x.es");
  });
});

describe("RecentCashier · tolerancia a shape antigua", () => {
  beforeEach(() => localStorage.clear());

  it("entradas viejas sin alias conviven con nuevas con alias", () => {
    // Entrada pre-v1.7 escrita a mano en localStorage (sin alias).
    localStorage.setItem(
      "mipiacetpv-recent-cashiers",
      JSON.stringify([{ email: "vieja@bar.es", lastSeenAt: "2026-06-01T00:00:00Z" }]),
    );
    rememberCashier({
      email: "nueva@bar.es",
      alias: "María",
      lastSeenAt: "2026-07-01T00:00:00Z",
    });
    const list = getRecentCashiers();
    expect(list).toHaveLength(2);
    expect(cashierDisplayLabel(list[0]!)).toBe("María");
    expect(cashierDisplayLabel(list[1]!)).toBe("vieja@bar.es");
  });
});

// ─── Chip de operador en el mapa de mesas ────────────────────────────

const MESA_BASE: Omit<ApiTable, "id" | "name" | "state" | "activeTicket"> = {
  capacity: 4,
  zone: "SALON",
  positionX: null,
  positionY: null,
  width: null,
  height: null,
  barSeatIndex: null,
  groupedIntoTableId: null,
  createdAt: new Date().toISOString(),
};

let mesaSeq = 0;
function mesaOcupada(
  name: string,
  openedByEmail: string | null,
  openedByAlias: string | null,
): ApiTable {
  mesaSeq += 1;
  return {
    ...MESA_BASE,
    id: `00000000-0000-0000-0000-0000000000a${mesaSeq}`,
    name,
    state: "OPEN",
    activeTicket: {
      id: `10000000-0000-0000-0000-0000000000b${mesaSeq}`,
      total: "10.00",
      diners: null,
      openedAt: new Date().toISOString(),
      openedByEmail,
      openedByAlias,
      lineCount: 1,
    },
  };
}

let container: HTMLDivElement;
let root: Root;

function defaultProps() {
  return {
    cashierLabel: "María",
    storeName: "Bar Test",
    registerName: "Caja 1",
    onPickTable: vi.fn(),
    onQuickSale: vi.fn(),
    onLogoutCashier: vi.fn(),
    onCloseShift: vi.fn(),
    pickBusyTableId: null,
    pickError: null,
  };
}

describe("TableMapScreen · operador con alias", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
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

  // v2-H1 · el alias del camarero sale de la FORMA de la mesa y se queda
  // en su `title`.
  //
  // El motivo está en `TableCard`: en una forma de 144 px caben tres
  // líneas —nombre a 28, importe a 22 y la meta a 15— y la decisión 8
  // pide exactamente esas tres. El avatar de dos letras competía con el
  // importe, que es el dato que se comprueba. Lo que este test guarda
  // sigue siendo lo de v1.7: que manda el ALIAS y no el local-part del
  // email, y que un usuario legacy sin alias no se queda sin nada.
  it("la mesa nombra al camarero por su ALIAS, no por su email", async () => {
    apiMock.apiWithCashier.mockResolvedValue({
      storeId: "00000000-0000-0000-0000-0000000000s1",
      registerId: "00000000-0000-0000-0000-0000000000r1",
      tables: [
        // Alias "maria.garcia" → iniciales MG (no las del email).
        mesaOcupada("Mesa 1", "zz@bar.es", "maria.garcia"),
        // Legacy sin alias → iniciales del email caja1@... → C.
        mesaOcupada("Mesa 2", "caja1@bar.es", null),
      ],
    });
    await act(async () => {
      root.render(<TableMapScreen {...defaultProps()} />);
    });

    const formas = [
      ...container.querySelectorAll<HTMLElement>('[data-testid="table-shape"]'),
    ];
    const mesa1 = formas.find((b) => b.textContent?.includes("Mesa 1"));
    const mesa2 = formas.find((b) => b.textContent?.includes("Mesa 2"));
    // Manda el alias: "maria.garcia", no el "zz" del email.
    expect(mesa1?.getAttribute("title")).toContain("maria.garcia");
    expect(mesa1?.getAttribute("title")).not.toContain("zz");
    // Legacy sin alias: el local-part del email como respaldo.
    expect(mesa2?.getAttribute("title")).toContain("caja1");

    // El botón del header muestra el label del cajero logueado (alias).
    expect(container.textContent).toContain("María");
  });
});
