// A3-distribución · Frente 2 · la versión llega de verdad al menú del cajero.
//
// app-version-label.test.ts cubre el adaptador y el formateador por separado.
// Esto cubre lo que app-version-label NO puede: que la línea se pinte dentro
// del drawer de SalePage, que sólo aparezca cuando hay algo que decir, y que
// en la app Android muestre versionName y versionCode y no sólo el hash. Es el
// criterio de aceptación 6 del bloque.
//
// Mismo patrón sin testing-library que handheld-layout.test.tsx: createRoot +
// act + eventos nativos; módulos pesados mockeados.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});
vi.mock("../src/lib/catalog.js", () => ({
  findByBarcode: () => null,
  fuzzySearch: () => [],
  getCachedBusinessType: () => "HOSPITALITY" as const,
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => false,
  getCachedCreditSalesEnabled: () => false,
  getCachedIconPreset: () => null,
  getCachedTagAliases: () => ({}),
  getCachedTenantId: () => null,
  loadCatalogFromCache: async () => [],
  loadWildcards: async () => [],
  productImageUrl: () => null,
  refreshCatalog: async () => [],
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
  openCashDrawerIfAvailable: vi.fn(),
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));

// El hash de build se resuelve en tiempo de build (vite define). En test
// controlamos la etiqueta desde el adaptador, que es la única pieza que
// depende del entorno nativo.
const infoMock = vi.hoisted(() => ({
  native: null as { versionName: string; versionCode: string } | null,
  hash: "",
}));
vi.mock("../src/platform/AppInfo.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/platform/AppInfo.js")>(
      "../src/platform/AppInfo.js",
    );
  return {
    ...actual,
    getNativeAppInfo: async () => infoMock.native,
    readBuildHash: () => infoMock.hash,
  };
});

import { SalePage } from "../src/pages/SalePage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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
  infoMock.native = null;
  infoMock.hash = "";
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string) => {
    const bg = backgroundRoutes(path);
    if (bg !== undefined) return bg;
    throw new Error(`ruta inesperada: ${path}`);
  });
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function renderSale() {
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

/** El drawer, que es donde vive la línea de versión. */
function drawer(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[aria-label="Menú del TPV"]');
  if (!el) throw new Error("no encuentro el drawer del TPV");
  return el;
}

describe("versión en el menú del cajero", () => {
  it("en la app Android pinta versionName, versionCode y hash", async () => {
    infoMock.native = { versionName: "1.10.2", versionCode: "11002" };
    infoMock.hash = "a1b2c3d";
    await renderSale();
    expect(drawer().textContent).toContain("1.10.2 (11002) · build a1b2c3d");
    expect(drawer().querySelectorAll("p")).toHaveLength(1);
  });

  it("en navegador pinta sólo el hash, sin versionCode inventado", async () => {
    infoMock.native = null;
    infoMock.hash = "a1b2c3d";
    await renderSale();
    const text = drawer().textContent ?? "";
    expect(text).toContain("build a1b2c3d");
    expect(text).not.toContain("(11002)");
    expect(text).not.toContain("1.10.2");
  });

  it("sin nada que decir (web en dev, sin hash) no pinta NI el nodo vacío", async () => {
    infoMock.native = null;
    infoMock.hash = "";
    await renderSale();
    expect(drawer().textContent ?? "").not.toContain("build");
    // El <p> de versión es el único <p> del menú: si sobra uno, es que se
    // está pintando un párrafo vacío que sólo aporta padding.
    expect(drawer().querySelectorAll("p")).toHaveLength(0);
  });

  it("aparece UNA vez y colgando del menú, no suelta en la pantalla de venta", async () => {
    infoMock.native = { versionName: "1.10.2", versionCode: "11002" };
    infoMock.hash = "a1b2c3d";
    await renderSale();
    const label = "1.10.2 (11002) · build a1b2c3d";
    // Todos los nodos del árbol completo que muestran la etiqueta...
    const todos = Array.from(container.querySelectorAll("*")).filter(
      (el) => el.children.length === 0 && el.textContent?.trim() === label,
    );
    expect(todos).toHaveLength(1);
    // ...y el único que hay cuelga del <aside> del menú.
    expect(drawer().contains(todos[0]!)).toBe(true);
  });
});
