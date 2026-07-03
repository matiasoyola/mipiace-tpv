// v1.9.1 · Frente 4: empty states del grid del SalePage.
//
// Bug: con búsqueda activa sin resultados el TPV mostraba "Aún no has
// cargado productos…" (mensaje de catálogo vacío, alarmante y falso con
// catálogo poblado). `products` llega a SaleWorkspace YA filtrado por la
// búsqueda, así que el empty state no podía distinguir los dos casos.
// Desde v1.9.1 SaleWorkspace recibe `searchQuery` y separa:
//
//   - catálogo vacío de verdad  → "Aún no has cargado productos…"
//   - búsqueda sin coincidencias → "Sin resultados para «…»."
//
// Mismo patrón sin testing-library que table-sale-flow.test.tsx:
// createRoot + act + eventos nativos; módulos pesados mockeados.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

// Catálogo configurable por test: catalogMock.items se lee en los mocks
// de loadCatalogFromCache/refreshCatalog/fuzzySearch.
const catalogMock = vi.hoisted(() => ({
  items: [] as Array<{
    id: string;
    holdedProductId: string;
    sku: string;
    name: string;
    basePrice: number;
    priceGross: number;
    taxRate: number;
    tags: string[];
    kind: "PRODUCT";
  }>,
}));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});
vi.mock("../src/lib/catalog.js", () => ({
  findByBarcode: () => null,
  // Búsqueda "real" simplificada: substring sobre el nombre, para que
  // una query sin coincidencias devuelva [] como fuzzySearch de verdad.
  fuzzySearch: (catalog: Array<{ name: string }>, q: string) =>
    catalog.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())),
  getCachedBusinessType: () => "HOSPITALITY" as const,
  getCachedIconPreset: () => null,
  getCachedTagAliases: () => ({}),
  getCachedTenantId: () => null,
  loadCatalogFromCache: async () => catalogMock.items,
  loadWildcards: async () => [],
  productImageUrl: () => null,
  refreshCatalog: async () => catalogMock.items,
}));
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
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));

import { SalePage } from "../src/pages/SalePage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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

function backgroundRoutes(path: string): unknown | undefined {
  if (path === "/tpv/health/holded") {
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
  if (path === "/shift/current") return { shift: null };
  if (path === "/tpv/tables") {
    return { storeId: "store-1", registerId: "reg-1", tables: [] };
  }
  return undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string) => {
    const bg = backgroundRoutes(path);
    if (bg !== undefined) return bg;
    throw new Error(`ruta inesperada: ${path}`);
  });
  catalogMock.items = [CAFE];
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderSalePage() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SalePage
        shiftId="shift-1"
        cashierLabel="caja1@bar.es"
        cashierRole="CASHIER"
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

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function typeSearch(text: string) {
  const input = container.querySelector<HTMLInputElement>(
    'input[type="search"]',
  );
  if (!input) throw new Error("buscador no encontrado");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

describe("SalePage · empty states del grid (v1.9.1)", () => {
  it("búsqueda sin coincidencias con catálogo poblado → 'Sin resultados', no el mensaje de catálogo vacío", async () => {
    await renderSalePage();
    await typeSearch("zzz-no-existe");

    expect(container.textContent).toContain("Sin resultados para «zzz-no-existe»");
    expect(container.textContent).toContain(
      "Prueba con otro nombre o escanea el código",
    );
    expect(container.textContent).not.toContain("Aún no has cargado productos");
  });

  it("catálogo vacío de verdad sin búsqueda → mensaje de catálogo vacío", async () => {
    catalogMock.items = [];
    await renderSalePage();

    expect(container.textContent).toContain("Aún no has cargado productos");
    expect(container.textContent).not.toContain("Sin resultados para");
  });

  it("búsqueda con coincidencias → grid con el producto y sin empty states", async () => {
    await renderSalePage();
    await typeSearch("café");

    expect(container.textContent).toContain("Café solo");
    expect(container.textContent).not.toContain("Sin resultados para");
    expect(container.textContent).not.toContain("Aún no has cargado productos");
  });
});
