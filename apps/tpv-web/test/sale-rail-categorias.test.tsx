// v1.22-el-terminal-del-bar · §4 · hallazgo N2.
//
// Dos SABOTAJES tienen que caer aquí:
//
//   · Volver al chip «Más (N)» en tablet → el test de que en tablet
//     TODAS las categorías están en el rail.
//   · Elegir una categoría del sheet en handheld y que el chip siga
//     diciendo «Más (N)» → el test de que el chip nombra la activa.
//
// jsdom no hace layout ni aplica media queries, así que el rail y la
// fila de chips están los DOS en el árbol: lo que distingue tablet de
// handheld es la clase (`hidden lg:flex` contra `lg:hidden`), y eso es
// lo que se comprueba. Que el reparto se vea bien a 1443, 1280 y 390 lo
// dice el bucle visual, y las capturas están en el `-done`.

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
    findBySku: () => null,
    fuzzySearch: () => build(),
    getCachedBusinessType: () => "HOSPITALITY" as const,
    getCachedCrmEnabled: () => false,
    getCachedAgendaEnabled: () => false,
    getCachedHoldedEnabled: () => false,
    getCachedCreditSalesEnabled: () => false,
    getCachedIconPreset: () => null,
    getCachedTagAliases: () => ({}),
    getCachedTenantId: () => "tenant-maestranza",
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

import { CATEGORY_RAIL_WIDTH } from "../src/components/CategoryRail.js";
import { SalePage } from "../src/pages/SalePage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Las nueve de La Maestranza, tal y como llegan del catálogo.
const MAESTRANZA = [
  "cafés",
  "desayunos",
  "refrescos",
  "cervezas",
  "vinos",
  "licores",
  "raciones",
  "bocadillos",
  "platos",
];

function backgroundRoutes(path: string): unknown | undefined {
  if (path === "/tpv/health/holded") {
    return {
      level: "ok",
      reason: "",
      hasHoldedKey: false,
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

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render(tags: string[] = MAESTRANZA) {
  state.tags = tags;
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SalePage
        shiftId="shift-1"
        cashierLabel="caja1@lamaestranza.es"
        cashierRole="MANAGER"
        registerName="Caja 1"
        registerId="reg-1"
        storeName="La Maestranza"
        onBackToMap={vi.fn()}
        onLogoutCashier={vi.fn()}
        onCloseShift={vi.fn()}
      />,
    );
  });
  await settle();
}

async function click(el: Element) {
  await act(async () => {
    (el as HTMLButtonElement).click();
  });
  await settle();
}

function rail(): HTMLElement {
  const el = container.querySelector('[data-testid="category-rail"]');
  if (!el) throw new Error("rail de categorías no encontrado");
  return el as HTMLElement;
}

function railBotones(): HTMLButtonElement[] {
  return Array.from(rail().querySelectorAll("button"));
}

function filaChips(): HTMLElement {
  const el = container.querySelector('[data-testid="category-chips"]');
  if (!el) throw new Error("fila de chips no encontrada");
  return el as HTMLElement;
}

function chips(): HTMLButtonElement[] {
  return Array.from(filaChips().querySelectorAll("button"));
}

function etiquetas(bs: HTMLButtonElement[]): string[] {
  return bs.map((b) => (b.textContent ?? "").trim());
}

describe("v1.22 §4 · tablet: todas las categorías en el rail", () => {
  it("el rail lleva TODAS las categorías y no hay 'Más (N)' dentro", async () => {
    await render();
    const labels = etiquetas(railBotones());
    expect(labels[0]).toBe("Todos");
    for (const tag of MAESTRANZA) {
      const esperado = tag.charAt(0).toUpperCase() + tag.slice(1);
      expect(labels).toContain(esperado);
    }
    expect(labels).toHaveLength(MAESTRANZA.length + 1);
    expect(labels.join(" ")).not.toContain("Más (");
  });

  it("con VEINTE categorías tampoco esconde ninguna", async () => {
    const veinte = Array.from({ length: 20 }, (_, i) => `categoria-${i + 1}`);
    await render(veinte);
    expect(railBotones()).toHaveLength(21);
    expect(etiquetas(railBotones()).join(" ")).not.toContain("Más (");
  });

  it("el rail es de tablet y la fila de chips de handheld, por clase", async () => {
    await render();
    // El criterio de "tablet" es el MISMO que usa el layout para decidir
    // panel lateral contra handheld: `lg`. No se inventa otro.
    expect(rail().className).toContain("lg:flex");
    expect(rail().className).toContain("hidden");
    expect(filaChips().className).toContain("lg:hidden");
  });

  it("si no caben en alto, el rail scrollea en VERTICAL — nunca en horizontal", async () => {
    await render(Array.from({ length: 30 }, (_, i) => `categoria-${i + 1}`));
    // `ux-principles` §1.8: el scroll horizontal está prohibido en táctil.
    expect(rail().className).toContain("overflow-y-auto");
    expect(rail().className).toContain("overflow-x-hidden");
    expect(rail().className).not.toContain("overflow-x-auto");
    let padre: HTMLElement | null = rail().parentElement;
    while (padre && padre !== container) {
      expect(padre.className).not.toContain("overflow-x-auto");
      expect(padre.className).not.toContain("overflow-x-scroll");
      padre = padre.parentElement;
    }
  });

  it("la categoría activa se ve en el rail en todo momento", async () => {
    await render();
    // "Todos" al entrar.
    const activaInicial = railBotones().filter(
      (b) => b.getAttribute("aria-pressed") === "true",
    );
    expect(etiquetas(activaInicial)).toEqual(["Todos"]);

    const refrescos = railBotones().find((b) =>
      (b.textContent ?? "").trim() === "Refrescos",
    )!;
    await click(refrescos);

    const activa = railBotones().filter(
      (b) => b.getAttribute("aria-pressed") === "true",
    );
    expect(etiquetas(activa)).toEqual(["Refrescos"]);
    // Y en coral SUAVE, que es el lenguaje de selección de la casa.
    expect(activa[0]!.className).toContain("bg-mipiace-coral-soft");
  });

  it("los items del rail llegan al mínimo táctil de 48 px", async () => {
    await render();
    for (const b of railBotones()) expect(b.className).toContain("h-touch");
  });

  it("el rail tiene ancho propio y declarado, no uno suelto en el JSX", async () => {
    await render();
    expect(CATEGORY_RAIL_WIDTH).toBe(144);
    expect(rail().style.width).toBe("144px");
  });

  it("elegir en el rail filtra de verdad", async () => {
    await render();
    await click(
      railBotones().find((b) => (b.textContent ?? "").trim() === "Vinos")!,
    );
    const seccion = container.querySelector("section")!;
    const tiles = Array.from(
      seccion.querySelectorAll<HTMLButtonElement>('[data-testid="product-tile"]'),
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.textContent).toContain("Producto de vinos");
  });

  it("no cambia el orden de las categorías: sigue siendo el de la fila de chips", async () => {
    // C6 (ordenar por frecuencia) es otro bloque. El rail hereda el
    // orden que ya tenía la fila —alfabético, con Bocadillos antes que
    // Cafés, como se vio en el AP13— y no lo toca.
    await render();
    const esperado = [...MAESTRANZA]
      .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
      .sort((a, b) => a.localeCompare(b, "es"));
    expect(etiquetas(railBotones()).slice(1)).toEqual(esperado);
    // Y lo que se ve en la fila de chips de handheld es el principio de
    // esa misma lista, sin reordenar.
    const enLaFila = etiquetas(chips()).filter(
      (t) => t !== "Todos" && !t.startsWith("Más ("),
    );
    expect(enLaFila).toEqual(esperado.slice(0, enLaFila.length));
  });
});

describe("v1.22 §4 · handheld: el chip dice en qué categoría estás", () => {
  it("al elegir una del sheet, el chip de desbordamiento lleva SU nombre", async () => {
    await render();
    const mas = chips().find((c) => (c.textContent ?? "").startsWith("Más ("));
    expect(mas).toBeDefined();

    await click(mas!);
    const hoja = container.querySelector(
      '[role="dialog"][aria-label="Más categorías"]',
    ) as HTMLElement;
    const opcion = Array.from(hoja.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") !== "Cerrar",
    )!;
    const nombre = (opcion.textContent ?? "").trim();
    await click(opcion);

    const ahora = etiquetas(chips());
    expect(ahora).toContain(nombre);
    expect(ahora.join(" ")).not.toContain("Más (");
    const activa = chips().filter(
      (c) => c.getAttribute("aria-pressed") === "true",
    );
    expect(etiquetas(activa)).toEqual([nombre]);
  });

  it("si la activa SÍ cabe en la fila, el chip de desbordamiento vuelve a contar", async () => {
    await render();
    // Primero una del sheet…
    const mas = chips().find((c) => (c.textContent ?? "").startsWith("Más ("))!;
    await click(mas);
    const hoja = container.querySelector(
      '[role="dialog"][aria-label="Más categorías"]',
    ) as HTMLElement;
    await click(
      Array.from(hoja.querySelectorAll("button")).find(
        (b) => b.getAttribute("aria-label") !== "Cerrar",
      )!,
    );
    expect(etiquetas(chips()).join(" ")).not.toContain("Más (");

    // …y luego "Todos", que está siempre a la vista.
    await click(chips().find((c) => (c.textContent ?? "").trim() === "Todos")!);
    expect(etiquetas(chips()).join(" ")).toContain("Más (");
  });
});
