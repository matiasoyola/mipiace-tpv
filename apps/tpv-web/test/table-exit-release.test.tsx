// v1.12 addendum · las tres salidas al mapa sueltan la mesa igual.
//
// El fallo que corrige: la limpieza del DRAFT vacío vivía envuelta en
// `SalePage.onBackToMap`, así que sólo la hacía el botón "Mapa". El
// guardia del Atrás de Android (`setBackFallback` en `App.tsx`) y el
// "Mesas" del historial de tickets cambiaban de vista por su cuenta —y
// salir con el Atrás dejaba la mesa ocupada con un ticket sin líneas:
// exactamente la mesa zombi que v1.12-B vino a matar.
//
// Por eso estos tests se montan sobre `TpvHome`, que es donde vive
// `goToMap()`: si mañana alguien añade una cuarta salida y la cablea a
// `setView` a pelo, la fuga vuelve. La única defensa es que la limpieza
// y el cambio de vista sean la misma función.
//
// Quién decide que la mesa está vacía es el SERVIDOR (`onlyIfEmpty=true`
// dentro del WHERE de la reclamación). El cliente pregunta siempre; si
// otra caja comandó, el 409 es la respuesta correcta y se traga.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});
vi.mock("../src/lib/catalog.js", () => {
  const CAFE = {
    id: "00000000-0000-0000-0000-0000000000p1",
    holdedProductId: "h-cafe",
    sku: "CAFE",
    name: "Café solo",
    basePrice: 1.5,
    priceGross: 1.65,
    taxRate: 10,
    tags: [] as string[],
    kind: "PRODUCT" as const,
  };
  return {
    findByBarcode: () => null,
    fuzzySearch: () => [CAFE],
    getCachedBusinessType: () => "HOSPITALITY" as const,
    getCachedCrmEnabled: () => false,
    getCachedAgendaEnabled: () => false,
    getCachedCreditSalesEnabled: () => false,
    getCachedIconPreset: () => null,
    getCachedTagAliases: () => ({}),
    getCachedTenantId: () => null,
    loadCatalogFromCache: async () => [CAFE],
    loadWildcards: async () => [],
    productImageUrl: () => null,
    refreshCatalog: async () => [CAFE],
  };
});
vi.mock("../src/lib/modifiers.js", () => ({
  loadModifierGroups: async () => [],
  buildGroupsByProduct: () => new Map(),
}));
vi.mock("../src/hooks/useStoreEventStream.js", () => ({
  useStoreEventStream: () => "open",
}));
vi.mock("@mipiacetpv/ticket-pdf", () => ({
  renderTicketPdf: vi.fn(async () => new Uint8Array()),
}));
vi.mock("../src/lib/escposPrint.js", () => ({
  fetchTicketEscposBinary: vi.fn(),
  getPairedUsbPrinter: vi.fn(async () => null),
  isWebUsbSupported: () => false,
  pairUsbPrinter: vi.fn(),
  printEscposUsb: vi.fn(),
  printTicketWifi: vi.fn(),
  openCashDrawerIfAvailable: vi.fn(),
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));

import { ApiError } from "../src/api.js";
import { TpvHome } from "../src/App.js";
import {
  __resetBackGuardForTests,
  installBackGuard,
} from "../src/hooks/useBackGuard.js";
import { __resetOutboxForTests } from "../src/lib/outbox.js";
import type { ApiTable } from "../src/pages/TableMapScreen.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const MESA_1 = "00000000-0000-0000-0000-0000000000a1";
const TICKET_1 = "00000000-0000-0000-0000-0000000000t1";
const STORE = "00000000-0000-0000-0000-0000000000s1";

const MESA_LIBRE: ApiTable = {
  id: MESA_1,
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

// El DRAFT que devuelve POST /tables/:id/open: mesa recién abierta, sin
// una sola línea. Es el que hay que soltar al salir.
const DRAFT_VACIO = {
  id: TICKET_1,
  status: "DRAFT",
  externalId: "ext-1",
  tableId: MESA_1,
  diners: 2,
  createdAt: new Date().toISOString(),
  lines: [] as unknown[],
};

let container: HTMLDivElement;
let root: Root;
let calls: Array<{ path: string; method?: string }>;

// Rutas de fondo que las pantallas piden solas (catálogo, salud, turno).
function backgroundRoutes(path: string): unknown {
  if (path === "/tpv/tables") {
    return { storeId: STORE, registerId: "reg-1", tables: [MESA_LIBRE] };
  }
  if (path.startsWith("/tpv/health")) {
    return {
      level: "ok",
      reason: "",
      hasHoldedKey: true,
      lastIncrementalSyncAt: null,
      lastSyncAgeMs: null,
      blockedAt: null,
      pendingSyncCount: 0,
      syncFailedCount: 0,
    };
  }
  if (path.startsWith("/shift/")) return { tickets: [], count: 0 };
  if (path.startsWith("/tickets?")) return { items: [] };
  if (path.startsWith("/tpv/catalog")) return { items: [], nextCursor: null };
  if (path.startsWith("/tickets/") && path.includes("/lines")) return {};
  return undefined;
}

function mockApi(
  onDelete: (path: string) => unknown = () => undefined,
): void {
  apiMock.apiWithCashier.mockImplementation(
    async (path: string, opts?: { method?: string }) => {
      calls.push({ path, method: opts?.method });
      if (opts?.method === "DELETE") return onDelete(path);
      if (path === `/tables/${MESA_1}/open`) return { ticket: DRAFT_VACIO };
      const bg = backgroundRoutes(path);
      if (bg !== undefined) return bg;
      if (path.startsWith("/tickets/")) return { ticket: DRAFT_VACIO };
      throw new Error(`ruta inesperada: ${path}`);
    },
  );
}

beforeEach(async () => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  await __resetOutboxForTests();
  __resetBackGuardForTests();
  apiMock.apiWithCashier.mockReset();
  calls = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  __resetBackGuardForTests();
});

async function settle(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function renderHome() {
  // `App` instala el guardia del Atrás al montar; `TpvHome` sólo pone el
  // guardia de fondo, así que en el test lo instalamos igual que en
  // producción.
  installBackGuard();
  await act(async () => {
    root.render(
      <TpvHome
        cashier={{
          userId: "u-1",
          email: "caja1@bar.es",
          alias: "Matías",
          role: "MANAGER",
        }}
        shiftId="shift-1"
        registerName="Caja 1"
        registerId="reg-1"
        storeName="Bar Test"
        onLogoutCashier={vi.fn()}
        onCloseShift={vi.fn()}
      />,
    );
  });
  await settle();
}

function buttonIncluding(text: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
  if (!btn) throw new Error(`botón "${text}" no encontrado`);
  return btn as HTMLButtonElement;
}

async function click(btn: HTMLButtonElement) {
  await act(async () => {
    btn.click();
  });
  await settle();
}

// Entra en la mesa: toca la tarjeta del mapa y espera al DRAFT.
async function entrarEnLaMesa() {
  await click(buttonIncluding("Mesa 1"));
  expect(container.textContent).toContain("Mesa 1");
}

// El Atrás del sistema llega como `popstate`.
async function pulsarAtras() {
  await act(async () => {
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });
  await settle();
}

function deleteCall() {
  return calls.find((c) => c.method === "DELETE");
}

function enElMapa(): boolean {
  return (container.textContent ?? "").includes("Nueva venta rápida");
}

describe("v1.12 addendum · salir de una mesa vacía la suelta", () => {
  it("con el Atrás de Android: DELETE con onlyIfEmpty y vuelta al mapa", async () => {
    mockApi();
    await renderHome();
    await entrarEnLaMesa();
    expect(enElMapa()).toBe(false);

    await pulsarAtras();

    const del = deleteCall();
    expect(del).toBeDefined();
    expect(del!.path.startsWith(`/tickets/${TICKET_1}`)).toBe(true);
    // Sin este parámetro, salir al mapa borraría una comanda real de
    // otra caja en silencio.
    expect(del!.path).toContain("onlyIfEmpty=true");
    expect(enElMapa()).toBe(true);
  });

  it("con el botón «Mapa»: exactamente lo mismo que antes del addendum", async () => {
    mockApi();
    await renderHome();
    await entrarEnLaMesa();

    await click(buttonIncluding("Mapa"));

    expect(deleteCall()!.path).toContain("onlyIfEmpty=true");
    expect(enElMapa()).toBe(true);
  });

  it("desde «Mesas» del historial de tickets: la tercera salida, misma limpieza", async () => {
    // Era la segunda fuga: el historial llamaba al cambio de vista a
    // pelo, así que salir por ahí dejaba la mesa ocupada.
    mockApi();
    await renderHome();
    await entrarEnLaMesa();

    await click(buttonIncluding("Tickets"));
    await click(buttonIncluding("Mesas"));

    expect(deleteCall()!.path).toContain("onlyIfEmpty=true");
    expect(enElMapa()).toBe(true);
  });

  it("el Atrás no inventa limpieza en venta rápida (no hay mesa que soltar)", async () => {
    mockApi();
    await renderHome();
    await click(buttonIncluding("Nueva venta rápida"));
    expect(enElMapa()).toBe(false);

    await pulsarAtras();

    expect(deleteCall()).toBeUndefined();
    expect(enElMapa()).toBe(true);
  });
});

describe("v1.12 addendum · con líneas de otra caja NO se suelta", () => {
  it("el servidor responde 409 y la mesa se queda como está, sin ruido", async () => {
    // La proyección local dice "vacía" —este device no se ha enterado de
    // la caña que pidió la otra caja—, así que el cliente pregunta. El
    // servidor rechaza dentro del WHERE y no toca nada.
    mockApi(() => {
      throw new ApiError(
        409,
        "La mesa tiene líneas: no se vacía al salir.",
        "TICKET_NOT_EMPTY",
      );
    });
    await renderHome();
    await entrarEnLaMesa();

    await pulsarAtras();

    expect(deleteCall()!.path).toContain("onlyIfEmpty=true");
    // El cajero sale al mapa igual y no ve un error que no es suyo.
    expect(enElMapa()).toBe(true);
    expect(container.textContent).not.toContain("no se vacía");
  });

  it("si el DELETE se cae (sin red), se sale al mapa igual", async () => {
    mockApi(() => {
      throw new Error("network down");
    });
    await renderHome();
    await entrarEnLaMesa();

    await pulsarAtras();

    expect(deleteCall()).toBeDefined();
    expect(enElMapa()).toBe(true);
  });
});
