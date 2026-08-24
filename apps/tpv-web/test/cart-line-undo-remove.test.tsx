// Borrado de línea con deshacer de 4 s (v1.10.3-barra · hallazgo #2 de
// la simulación de hora punta del 2026-08-20).
//
// El bug: la papelera se "armaba" al primer toque y sólo borraba con un
// SEGUNDO toque dentro de 1,5 s. Pasada la ventana se desarmaba sin
// decir nada — con la mano ocupada y prisa, parecía un botón muerto.
//
// Salida elegida (la que prefería producto): borrado directo al primer
// toque + banner "Deshacer" de 4 s, que es el patrón UX de la casa y no
// exige puntería cronometrada sobre un target de 44 px.
//
// Mismo patrón sin testing-library que sale-search-empty-state:
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
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => false,
  // v1.8-fiado añadió este export a catalog.ts DESPUÉS de escribirse
  // este mock (conflicto semántico del merge v1.9.1 × v1.8, CI #45):
  // SalePage lo importa, así que el mock debe declararlo.
  getCachedCreditSalesEnabled: () => false,
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
  openCashDrawerIfAvailable: vi.fn(),
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

function buttonByLabel(label: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.getAttribute("aria-label") === label,
  );
  if (!btn) throw new Error(`botón con aria-label "${label}" no encontrado`);
  return btn as HTMLButtonElement;
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined;
}

async function click(btn: HTMLButtonElement) {
  await act(async () => {
    btn.click();
  });
  await settle();
}

// Mete un café en el ticket pulsando su tarjeta del grid.
async function addCafe() {
  const card = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Café solo"),
  );
  if (!card) throw new Error("tarjeta de producto no encontrada");
  await click(card as HTMLButtonElement);
}

describe("v1.10.3-barra · papelera de línea sin trampa de tiempo", () => {
  it("un solo toque borra la línea (no hace falta un segundo)", async () => {
    await renderSalePage();
    await addCafe();
    expect(container.textContent).toContain("Café solo");

    await click(buttonByLabel("Eliminar Café solo"));

    // La línea se ha ido con UN toque. Lo que queda del texto "Café
    // solo" es la tarjeta del catálogo, no la línea del ticket: el
    // total del ticket vuelve a 0,00 €.
    expect(buttonByText("Deshacer")).toBeTruthy();
    expect(container.textContent).toContain("Línea eliminada · Café solo");
  });

  it("«Deshacer» devuelve la línea al ticket", async () => {
    await renderSalePage();
    await addCafe();
    await click(buttonByLabel("Eliminar Café solo"));

    await click(buttonByText("Deshacer")!);

    expect(buttonByText("Deshacer")).toBeUndefined();
    // La línea vuelve: su papelera existe otra vez.
    expect(() => buttonByLabel("Eliminar Café solo")).not.toThrow();
  });

  it("el aviso de deshacer se retira solo a los 4 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await renderSalePage();
      await addCafe();
      await click(buttonByLabel("Eliminar Café solo"));
      expect(buttonByText("Deshacer")).toBeTruthy();

      // A mitad de ventana el deshacer sigue disponible…
      // (`shouldAdvanceTime` deja correr también el reloj real, así que
      // dejamos margen en vez de rozar los 4 000 ms exactos).
      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });
      expect(buttonByText("Deshacer")).toBeTruthy();

      // …y pasada la ventana desaparece solo, sin tocar nada.
      await act(async () => {
        vi.advanceTimersByTime(2_500);
      });
      expect(buttonByText("Deshacer")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("la papelera ya no anuncia un segundo toque en su aria-label", async () => {
    await renderSalePage();
    await addCafe();
    const trash = buttonByLabel("Eliminar Café solo");
    expect(trash.getAttribute("aria-label")).not.toContain("de nuevo");
    // Sigue siendo un target de 44 px (h-11/w-11 de Tailwind).
    expect(trash.className).toContain("h-11");
    expect(trash.className).toContain("w-11");
  });
});
