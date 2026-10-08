// v1.22-el-terminal-del-bar · §1 · hallazgo N1, en la pantalla.
//
// Tres SABOTAJES tienen que caer aquí:
//
//   · Volver el buscador plegado a `inputMode="search"` → el test de que,
//     plegado, el input no pide teclado.
//   · Volver la detección de táctil a sólo `(pointer: coarse)` → el test
//     del recorrido con el entorno del D8: ningún toque deja el foco en
//     un input que abra teclado.
//   · Quitar el refoco del input del buscador → el test del lector
//     USB-HID: ráfaga + Enter con el buscador plegado añade el producto.
//
// Lo que esta suite NO puede comprobar: que Android no saque el teclado.
// El IME del sistema no existe ni en jsdom ni en Playwright. Lo que se
// prueba es el FOCO y el `inputMode`, que son las dos cosas que lo
// disparan. La confirmación es la pasada en el hierro.

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

// Dos productos de la carta de La Maestranza, uno con código de barras
// para el lector.
const PRODUCTOS = vi.hoisted(() => [
  {
    id: "00000000-0000-0000-0000-000000000001",
    holdedProductId: "h-1",
    sku: "CER-002",
    name: "Caña mediana",
    basePrice: 1.5455,
    priceGross: 1.7,
    taxRate: 10,
    barcode: "8400000000017",
    imageMime: null,
    tags: ["cervezas"],
    kind: "PRODUCT" as const,
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    holdedProductId: "h-2",
    sku: "BOC-006",
    name: "Hamburguesa normal",
    basePrice: 4.5455,
    priceGross: 5,
    taxRate: 10,
    barcode: null,
    imageMime: null,
    tags: ["bocadillos"],
    kind: "PRODUCT" as const,
  },
]);

vi.mock("../src/lib/catalog.js", () => ({
  findByBarcode: (items: typeof PRODUCTOS, code: string) =>
    items.find((p) => p.barcode === code) ?? null,
  findBySku: (items: typeof PRODUCTOS, sku: string) =>
    items.find((p) => p.sku === sku) ?? null,
  fuzzySearch: (items: typeof PRODUCTOS, q: string) =>
    items.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())),
  getCachedBusinessType: () => "HOSPITALITY" as const,
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => false,
  getCachedHoldedEnabled: () => false,
  getCachedCreditSalesEnabled: () => false,
  getCachedIconPreset: () => null,
  getCachedTagAliases: () => ({}),
  getCachedTenantId: () => "tenant-maestranza",
  loadCatalogFromCache: async () => PRODUCTOS,
  loadWildcards: async () => [],
  productImageUrl: () => null,
  refreshCatalog: async () => PRODUCTOS,
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

// El entorno EXACTO del Kozen D8, interrogado por CDP el 2026-10-06:
// pantalla táctil que dice que su puntero es fino.
function montaEntornoD8(): () => void {
  const previoMatchMedia = window.matchMedia;
  const previoTouch = Object.getOwnPropertyDescriptor(
    window.navigator,
    "maxTouchPoints",
  );
  const respuestas: Record<string, boolean> = {
    "(pointer: coarse)": false,
    "(pointer: fine)": true,
    "(any-pointer: coarse)": false,
    "(hover: none)": true,
    "(hover: hover)": false,
  };
  window.matchMedia = ((q: string) =>
    ({
      matches: respuestas[q] === true,
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    value: 5,
    configurable: true,
  });
  return () => {
    window.matchMedia = previoMatchMedia;
    if (previoTouch) {
      Object.defineProperty(window.navigator, "maxTouchPoints", previoTouch);
    }
  };
}

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
let restauraEntorno: (() => void) | null = null;

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
  restauraEntorno?.();
  restauraEntorno = null;
});

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
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

function buscador(): HTMLInputElement {
  const el = container.querySelector('input[type="search"]');
  if (!el) throw new Error("buscador no encontrado");
  return el as HTMLInputElement;
}

function lupa(): HTMLButtonElement {
  const el = container.querySelector(
    'button[aria-label="Buscar producto o escanear código"]',
  );
  if (!el) throw new Error("lupa no encontrada");
  return el as HTMLButtonElement;
}

/** Todo input que, enfocado, haría salir el teclado del sistema. */
function pidenTeclado(): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("input, textarea"),
  ).filter((el) => el.getAttribute("inputmode") !== "none");
}

async function click(el: Element) {
  await act(async () => {
    (el as HTMLButtonElement).click();
  });
  await settle();
}

describe("v1.22 §1 · el buscador plegado no pide teclado", () => {
  it("plegado: el input existe, es enfocable y lleva inputMode none", async () => {
    await render();
    const input = buscador();
    // Sigue montado: es donde aterriza el lector USB-HID. Ésa es toda su
    // razón de existir, y desmontarlo dejaría sin escáner a los tenants
    // con lector.
    expect(input).not.toBeNull();
    expect(input.getAttribute("inputmode")).toBe("none");
  });

  it("al desplegar la lupa vuelve a pedir teclado, que es lo que se acaba de pulsar", async () => {
    await render();
    expect(buscador().getAttribute("inputmode")).toBe("none");
    await click(lupa());
    expect(buscador().getAttribute("inputmode")).toBe("search");
  });

  it("al volver a plegarlo deja de pedirlo", async () => {
    await render();
    await click(lupa());
    expect(buscador().getAttribute("inputmode")).toBe("search");
    await click(lupa());
    expect(buscador().getAttribute("inputmode")).toBe("none");
  });

  it("plegado, NINGÚN campo de la pantalla de venta pide teclado", async () => {
    await render();
    expect(pidenTeclado()).toHaveLength(0);
  });
});

describe("v1.22 §1 · el entorno del D8 y el foco", () => {
  it("con el entorno del D8, ningún toque fuera de un campo deja el foco en un input", async () => {
    restauraEntorno = montaEntornoD8();
    await render();

    // El recorrido del criterio: entrar en venta y tocar un producto.
    // v2-H1 · en hostelería el botón de producto es el de la cuadrícula
    // oscura (`product-button`); el `product-tile` del TPV claro sigue
    // vivo y lo cubre `sale-catalog-grid`, ahora apuntado a RETAIL.
    const tiles = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-testid="product-button"]'),
    );
    expect(tiles.length).toBeGreaterThan(0);
    await click(tiles[0]!);

    // Un toque en un hueco: el `click` sobre el documento es lo que
    // disparaba el refoco.
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    const activo = document.activeElement as HTMLElement | null;
    const esCampoDeTexto =
      activo != null &&
      (activo.tagName === "INPUT" || activo.tagName === "TEXTAREA") &&
      activo.getAttribute("inputmode") !== "none";
    expect(esCampoDeTexto).toBe(false);
  });

  it("en escritorio con ratón el refoco permanente SIGUE vivo", async () => {
    // El refoco no se quita para todos: en un mostrador con ratón y
    // lector es exactamente lo que se quiere (`ux-principles` §2.7).
    await render();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(document.activeElement).toBe(buscador());
  });
});

describe("v1.22 §1 · el lector USB-HID sigue funcionando", () => {
  async function rafagaYEnter(texto: string) {
    const input = buscador();
    // El lector escribe el código carácter a carácter y cierra con Enter.
    await act(async () => {
      input.focus();
    });
    for (const ch of texto) {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(input, input.value + ch);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    await settle();
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await settle();
  }

  function lineas(): string[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="cart-line-name"]'),
    ).map((el) => el.textContent ?? "");
  }

  // Consecuencia DECLARADA del §1, no un descuido: en un terminal
  // detectado como táctil el refoco permanente no corre, así que el
  // lector necesita que el campo tenga el foco (lo mismo que pasa en
  // cualquier terminal de puntero grueso desde v1.3; lo nuevo es que el
  // D8 ahora entra en ese grupo). Con el refoco vivo, Android sacaba el
  // teclado en cada toque, que es lo que bloqueaba el cobro mixto.
  it("en táctil el buscador NO se enfoca solo: el lector pide un toque en el campo", async () => {
    restauraEntorno = montaEntornoD8();
    await render();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(document.activeElement).not.toBe(buscador());
  });

  it("ráfaga de código de barras + Enter con el buscador PLEGADO añade el producto", async () => {
    await render();
    expect(buscador().getAttribute("inputmode")).toBe("none");
    await rafagaYEnter("8400000000017");
    expect(lineas()).toContain("Caña mediana");
  });

  it("y el buscador se vacía para el siguiente escaneo", async () => {
    await render();
    await rafagaYEnter("8400000000017");
    expect(buscador().value).toBe("");
  });
});
