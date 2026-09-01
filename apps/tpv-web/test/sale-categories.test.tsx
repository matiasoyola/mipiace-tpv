// v1.14-la-comanda-se-ve · la fila de categorías (hallazgos M1, M2 y m2
// de la auditoría del 2026-09-01).
//
// M1: los ocho chips vivían en un `overflow-x-auto` y el último terminaba
// en x=1876 de 1920 — tocando el borde, sin gradiente, sin flecha. Un
// scroll horizontal sin affordance en táctil es una función que no
// existe, y `docs/ux-principles.md` §1.8 lo prohíbe de plano.
//
// M2: ocho rectángulos idénticos con texto, obligando a leer, con los
// seis tonos del sistema visual sin usar.
//
// m2: el coral lo llevaba "Todos" de forma fija y le robaba la señal a
// la selección real.

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

// El catálogo del banco: un producto por categoría. `tagsPorProducto` se
// reasigna en cada test para simular lo que devuelve el backend.
const state = vi.hoisted(() => ({ tags: [] as string[] }));

vi.mock("../src/lib/catalog.js", () => {
  const build = () =>
    state.tags.map((tag, i) => ({
      id: `00000000-0000-0000-0000-00000000${String(i).padStart(4, "0")}`,
      holdedProductId: `h-${i}`,
      sku: `SKU${i}`,
      name: `Producto de ${tag}`,
      basePrice: 1.5,
      priceGross: 1.65,
      taxRate: 10,
      barcode: null,
      imageMime: null,
      tags: [tag],
      kind: "PRODUCT" as const,
    }));
  return {
    findByBarcode: () => null,
    fuzzySearch: () => build(),
    getCachedBusinessType: () => "HOSPITALITY" as const,
    getCachedCrmEnabled: () => false,
    getCachedAgendaEnabled: () => false,
    getCachedCreditSalesEnabled: () => false,
    getCachedIconPreset: () => null,
    getCachedTagAliases: () => ({}),
    getCachedTenantId: () => "tenant-sirope",
    loadCatalogFromCache: async () => build(),
    loadWildcards: async () => [],
    productImageUrl: () => null,
    refreshCatalog: async () => build(),
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

import { CATEGORY_TONES } from "../src/lib/categoryTones.js";
import { SalePage } from "../src/pages/SalePage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Las ocho de Sirope, tal cual llegan de Holded (sin tildes, pegadas).
const OCHO = [
  "cafes",
  "bolleria",
  "refrescos",
  "cervezas",
  "vinos",
  "tostadas",
  "bocadillos",
  "postres",
];

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
  if (path.startsWith("/tpv/catalog/top-sellers")) {
    return { source: "shift", items: [] };
  }
  if (path.startsWith("/tickets?")) return { items: [] };
  return undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  localStorage.clear();
  sessionStorage.clear();
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string) => {
    const bg = backgroundRoutes(path);
    if (bg !== undefined) return bg;
    return {};
  });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(tags: string[]) {
  state.tags = tags;
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SalePage
        shiftId="shift-1"
        cashierLabel="caja1@bar.es"
        cashierRole="CASHIER"
        registerName="Caja 1"
        registerId="reg-1"
        storeName="Cafetería Sirope"
        onBackToMap={vi.fn()}
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

async function click(el: Element) {
  await act(async () => {
    (el as HTMLButtonElement).click();
  });
  await settle();
}

function chipRow(): HTMLElement {
  const el = container.querySelector('[data-testid="category-chips"]');
  if (!el) throw new Error("fila de chips no encontrada");
  return el as HTMLElement;
}

function chips(): HTMLButtonElement[] {
  return Array.from(chipRow().querySelectorAll("button"));
}

function chipByText(text: string): HTMLButtonElement {
  const b = chips().find((c) => (c.textContent ?? "").trim().startsWith(text));
  if (!b) throw new Error(`chip "${text}" no encontrado`);
  return b;
}

describe("v1.14 · M1 · sin scroll horizontal", () => {
  it("SABOTAJE 20 categorías · no aparece scroll horizontal y sale 'Más (N)'", async () => {
    const veinte = Array.from({ length: 20 }, (_, i) => `categoria-${i + 1}`);
    await render(veinte);

    // 1 · La fila no desliza: envuelve. Ni `overflow-x-auto` ni ningún
    // primo suyo, ni en la fila ni en sus ancestros del catálogo.
    expect(chipRow().className).not.toContain("overflow-x");
    expect(chipRow().className).toContain("flex-wrap");
    let padre: HTMLElement | null = chipRow().parentElement;
    while (padre && padre !== container) {
      expect(padre.className).not.toContain("overflow-x-auto");
      expect(padre.className).not.toContain("overflow-x-scroll");
      padre = padre.parentElement;
    }

    // 2 · Sale el chip de desbordamiento, y lo que anuncia cuadra: los
    // chips de categoría a la vista más los del sheet suman 20.
    const mas = chipByText("Más (");
    const anunciados = Number(/Más \((\d+)\)/.exec(mas.textContent ?? "")![1]);
    const visibles = chips().filter(
      (c) => c.getAttribute("data-tone") !== null,
    ).length;
    expect(visibles + anunciados).toBe(20);
    expect(anunciados).toBeGreaterThan(0);
  });

  it("el chip 'Más (N)' abre un sheet con TODAS las que no caben", async () => {
    const veinte = Array.from({ length: 20 }, (_, i) => `categoria-${i + 1}`);
    await render(veinte);

    const mas = chipByText("Más (");
    const anunciados = Number(/Más \((\d+)\)/.exec(mas.textContent ?? "")![1]);
    await click(mas);

    const hoja = container.querySelector(
      '[role="dialog"][aria-label="Más categorías"]',
    ) as HTMLElement;
    expect(hoja).not.toBeNull();
    // Menos el botón de cerrar.
    const opciones = Array.from(hoja.querySelectorAll("button")).filter(
      (b) => b.getAttribute("aria-label") !== "Cerrar",
    );
    expect(opciones).toHaveLength(anunciados);
    // Y todas llegan al mínimo táctil de 48 px.
    for (const b of opciones) expect(b.className).toContain("min-h-touch");
  });

  it("elegir una categoría del sheet la selecciona y cierra la hoja", async () => {
    const veinte = Array.from({ length: 20 }, (_, i) => `categoria-${i + 1}`);
    await render(veinte);

    await click(chipByText("Más ("));
    const hoja = container.querySelector(
      '[role="dialog"][aria-label="Más categorías"]',
    ) as HTMLElement;
    const opcion = Array.from(hoja.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") !== "Cerrar",
    )!;
    // El chip rotula el tag capitalizado ("Categoria 17"); el producto
    // del catálogo lleva el slug crudo ("categoria-17").
    const numero = /(\d+)/.exec(opcion.textContent ?? "")![1];
    await click(opcion);

    expect(
      container.querySelector('[role="dialog"][aria-label="Más categorías"]'),
    ).toBeNull();
    // La selección se ve sin abrir el sheet: el chip "Más (N)" se pone
    // en coral cuando la categoría activa se ha quedado dentro.
    const mas = chipByText("Más (");
    expect(mas.getAttribute("aria-pressed")).toBe("true");
    expect(mas.className).toContain("bg-mipiace-coral");
    // Y el grid ha filtrado de verdad: queda un solo producto, el suyo.
    const seccion = container.querySelector("section")!;
    expect(seccion.textContent).toContain(`Producto de categoria-${numero}`);
    const tiles = Array.from(seccion.querySelectorAll("button")).filter((b) =>
      (b.textContent ?? "").startsWith("Producto de"),
    );
    expect(tiles).toHaveLength(1);
  });

  it("las ocho de Sirope caben: sin chip de desbordamiento", async () => {
    await render(OCHO);
    expect(chips().some((c) => (c.textContent ?? "").startsWith("Más ("))).toBe(
      false,
    );
    expect(chips().filter((c) => c.getAttribute("data-tone"))).toHaveLength(8);
  });
});

describe("v1.14 · M2 · color e icono por categoría", () => {
  it("cada chip lleva tono del sistema visual e icono", async () => {
    await render(OCHO);

    const conTono = chips().filter((c) => c.getAttribute("data-tone"));
    expect(conTono).toHaveLength(8);
    for (const chip of conTono) {
      const tone = chip.getAttribute("data-tone")!;
      expect(CATEGORY_TONES).toContain(tone);
      // Icono Lucide dentro del chip (svg), no sólo texto.
      expect(chip.querySelector("svg")).not.toBeNull();
    }
    // Y se usan varios tonos: ocho chips del mismo color no arreglan M2.
    const usados = new Set(conTono.map((c) => c.getAttribute("data-tone")));
    expect(usados.size).toBeGreaterThan(1);
  });

  it("el reparto de tonos se persiste por tenant entre sesiones", async () => {
    await render(OCHO);
    const primera = chips()
      .filter((c) => c.getAttribute("data-tone"))
      .map((c) => c.getAttribute("data-tone"));
    expect(localStorage.getItem("mipiacetpv-category-tones:tenant-sirope")).not
      .toBeNull();

    await act(async () => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    await render(OCHO);

    const segunda = chips()
      .filter((c) => c.getAttribute("data-tone"))
      .map((c) => c.getAttribute("data-tone"));
    expect(segunda).toEqual(primera);
  });
});

describe("v1.14 · m2 · el coral es de la selección", () => {
  it("'Todos' no es coral ni siquiera estando activo", async () => {
    await render(OCHO);

    const todos = chipByText("Todos");
    expect(todos.getAttribute("aria-pressed")).toBe("true");
    expect(todos.className).not.toContain("coral");
    expect(todos.className).toContain("bg-mipiace-ink");
    // Con "Todos" activo, NINGÚN chip lleva coral: sin selección real de
    // categoría, no hay a qué apuntar.
    for (const c of chips()) expect(c.className).not.toContain("bg-mipiace-coral");
  });

  it("al elegir una categoría, el coral es sólo suyo", async () => {
    await render(OCHO);

    await click(chipByText("Cafes"));

    const corales = chips().filter((c) =>
      c.className.includes("bg-mipiace-coral"),
    );
    expect(corales).toHaveLength(1);
    expect(corales[0]!.textContent).toContain("Cafes");
    expect(corales[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(chipByText("Todos").className).not.toContain("coral");
  });

  it("los chips llegan al mínimo táctil de 48 px", async () => {
    await render(OCHO);
    for (const c of chips()) expect(c.className).toContain("h-touch");
  });
});
