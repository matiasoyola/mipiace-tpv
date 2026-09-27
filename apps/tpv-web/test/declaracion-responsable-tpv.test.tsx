// declaracion-responsable · la línea del art. 15 en el menú del cajero.
//
// El art. 15 de la Orden HAC/1177/2024 pide que la declaración responsable
// esté disponible «dentro del propio sistema informático». El terminal es la
// parte del sistema que el cliente tiene delante, así que tiene su línea.
//
// Lo que este banco fija:
//
//   1. La línea está en el drawer del TPV y apunta al PDF público.
//   2. Está SIEMPRE: con Holded y sin Holded. El documento es del productor.
//   3. No toca la pantalla de venta. Es un <a>, no un botón con estado, y no
//      aparece suelta fuera del menú.
//
// Sabotajes que este fichero pone en rojo (tabla del done):
//   · quitar la línea del drawer
//   · gatearla por `getCachedHoldedEnabled` o por rol
//   · apuntarla a una ruta con sesión en vez de al endpoint público
//   · sacarla del menú y dejarla suelta en la pantalla de venta
//
// Mismo montaje que drawer-version.test.tsx: createRoot + act, módulos
// pesados mockeados.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
const catalogMock = vi.hoisted(() => ({ holdedEnabled: true }));

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
  getCachedHoldedEnabled: () => catalogMock.holdedEnabled,
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

import { SalePage } from "../src/pages/SalePage.js";
import {
  RUTA_DECLARACION_RESPONSABLE,
  urlDeclaracionResponsable,
} from "../src/lib/declaracionResponsable.js";

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
// Los tests puros de la URL no montan nada, así que el root es opcional.
let root: Root | null = null;

beforeEach(() => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  catalogMock.holdedEnabled = true;
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
  if (root) {
    const actual = root;
    root = null;
    await act(async () => actual.unmount());
  }
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

function drawer(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[aria-label="Menú del TPV"]');
  if (!el) throw new Error("no encuentro el drawer del TPV");
  return el;
}

function enlace(): HTMLAnchorElement | null {
  return container.querySelector<HTMLAnchorElement>(
    `a[href="${urlDeclaracionResponsable()}"]`,
  );
}

describe("la URL del documento", () => {
  it("es el endpoint público, no una ruta con sesión", () => {
    expect(RUTA_DECLARACION_RESPONSABLE).toBe(
      "/legal/declaracion-responsable.pdf",
    );
    expect(urlDeclaracionResponsable("/api")).toBe(
      "/api/legal/declaracion-responsable.pdf",
    );
  });

  it("respeta la base absoluta que la APK lleva embebida", () => {
    // En la app Android el origen del WebView es mipiacetpv.com y la API
    // vive en api.mipiacetpv.com: sin la base absoluta, la línea abriría un
    // 404 del frontend.
    expect(urlDeclaracionResponsable("https://api.mipiacetpv.com")).toBe(
      "https://api.mipiacetpv.com/legal/declaracion-responsable.pdf",
    );
  });

  it("no duplica la barra si la base trae una al final", () => {
    expect(urlDeclaracionResponsable("https://api.mipiacetpv.com/")).toBe(
      "https://api.mipiacetpv.com/legal/declaracion-responsable.pdf",
    );
  });
});

describe("la línea en el menú del cajero", () => {
  it("está, y abre el PDF en otra pestaña", async () => {
    await renderSale();
    const a = enlace();
    expect(a, "no hay línea de declaración responsable en el menú").not.toBeNull();
    expect(a!.textContent).toContain("Declaración responsable");
    expect(a!.target).toBe("_blank");
    expect(a!.rel).toContain("noreferrer");
  });

  it("cuelga del menú, no anda suelta por la pantalla de venta", async () => {
    await renderSale();
    expect(drawer().contains(enlace()!)).toBe(true);
    // Y sólo hay una.
    expect(
      container.querySelectorAll(`a[href="${urlDeclaracionResponsable()}"]`),
    ).toHaveLength(1);
  });

  it("está también en un comercio SIN Holded", async () => {
    // El documento es del productor del sistema. Que el comercio haya dejado
    // Holded (ADR-020) no cambia quién produce el software ni qué declara.
    catalogMock.holdedEnabled = false;
    await renderSale();
    expect(enlace()).not.toBeNull();
  });

  it("no mete un botón con estado en el menú del cobro", async () => {
    // Es un <a>: no hay handler async, no hay spinner, no hay nada que
    // pueda quedarse a medias delante de un cliente esperando el cobro.
    await renderSale();
    expect(enlace()!.tagName).toBe("A");
  });
});
