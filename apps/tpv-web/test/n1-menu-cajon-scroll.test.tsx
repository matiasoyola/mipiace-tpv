// n1-vertical · «Declaración responsable» tiene que ser ALCANZABLE en el
// menú lateral.
//
// En el N1 (viewport de 360×648) la línea quedaba en y=354, fuera de
// pantalla, y al deslizar se movía la pantalla de venta de detrás
// (capturas `23-menu` y `24-menu-scroll`). El cajón es `flex flex-col` de
// alto completo, pero su lista no tenía ni `flex-1` ni `overflow`.
//
// Lo que fija este banco: la línea cuelga de un contenedor que SE
// DESPLAZA SOLO dentro del cajón, con las cuatro piezas que hacen falta
// para que eso sea verdad en el aparato:
//
//   · `overflow-y-auto` — que recorte y desplace;
//   · `flex-1` — que ocupe el hueco que sobra en la columna;
//   · `min-h-0` — sin él el mínimo de contenido de un hijo flex es su
//     alto intrínseco, la lista desborda el cajón y `overflow-y-auto` no
//     tiene nada que recortar. Es el fallo clásico de flexbox y es el que
//     había;
//   · `overscroll-contain` — sin él, al llegar al final de la lista el
//     gesto sigue hacia la página de detrás (scroll chaining), que es
//     exactamente lo que se vio.
//
// Y la cabecera y el pie de versión son `shrink-0`: lo que se encoge
// tiene que ser la lista, no ellos.
//
// Por qué se miran CLASES y no píxeles: jsdom no aplica hojas de estilo
// ni calcula layout, así que `getBoundingClientRect` devuelve ceros y no
// hay forma de medir aquí. La medida de verdad está en la pasada del
// bloque (`docs/blocks/n1-vertical-done.md`), hecha con el navegador a
// 360×640 y en el aparato. Lo que este banco impide es la regresión en
// el código, que es lo que se rompió.
//
// Sabotajes que este fichero pone en rojo (tabla del done):
//   · el cajón sin `overflow-y-auto`
//   · el cajón sin `min-h-0` (desborda y no recorta)
//   · el cajón sin `overscroll-contain` (arrastra la venta de detrás)
//
// Mismo montaje que drawer-version.test.tsx.

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
  getCachedBusinessType: () => "SERVICES" as const,
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => false,
  getCachedHoldedEnabled: () => true,
  getCachedCreditSalesEnabled: () => false,
  getCachedIconPreset: () => null,
  getCachedTagAliases: () => ({}),
  getCachedTenantId: () => null,
  getCachedEnsayo: () => false,
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
        cashierLabel="caja1@tienda.es"
        cashierRole="CASHIER"
        registerName="Caja 1"
        registerId="reg-1"
        storeName="Tienda Test"
        onLogoutCashier={vi.fn()}
        onCloseShift={vi.fn()}
      />,
    );
  });
  await settle();
}

function cajon(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[aria-label="Menú del TPV"]');
  if (!el) throw new Error("no encuentro el cajón del TPV");
  return el;
}

/** La línea del art. 15, que es la última de la lista y la que se perdía. */
function declaracion(): HTMLElement {
  const el = Array.from(cajon().querySelectorAll<HTMLElement>("a, button")).find(
    (n) => (n.textContent ?? "").includes("Declaración responsable"),
  );
  if (!el) throw new Error("no encuentro «Declaración responsable» en el cajón");
  return el;
}

/**
 * El contenedor que desplaza entre un nodo y el cajón, si hay alguno.
 *
 * Se busca por la cadena de ancestros y no por el `<nav>` a propósito: lo
 * que el bloque promete es que la línea ESTÁ DENTRO de algo que desplaza,
 * no que ese algo sea una etiqueta concreta.
 */
function contenedorQueDesplaza(desde: HTMLElement): HTMLElement | null {
  let n: HTMLElement | null = desde;
  const tope = cajon();
  while (n && n !== tope) {
    if (n.classList.contains("overflow-y-auto")) return n;
    n = n.parentElement;
  }
  return null;
}

describe("n1-vertical · el menú lateral se desplaza solo", () => {
  it("«Declaración responsable» cuelga de un contenedor que desplaza", async () => {
    await renderSale();
    const scroller = contenedorQueDesplaza(declaracion());
    expect(scroller).not.toBeNull();
    expect(scroller!.contains(declaracion())).toBe(true);
  });

  it("ese contenedor tiene las cuatro piezas que hacen falta", async () => {
    await renderSale();
    const clases = contenedorQueDesplaza(declaracion())!.classList;
    // Que recorte y desplace.
    expect(clases.contains("overflow-y-auto")).toBe(true);
    // Que ocupe el hueco de la columna...
    expect(clases.contains("flex-1")).toBe(true);
    // ...y que pueda encogerse por debajo de su contenido. Sin esto,
    // `overflow-y-auto` no recorta nada: era el fallo del aparato.
    expect(clases.contains("min-h-0")).toBe(true);
    // Que el gesto no siga hacia la pantalla de venta de detrás.
    expect(clases.contains("overscroll-contain")).toBe(true);
  });

  it("el cajón sigue siendo una columna de alto completo", async () => {
    await renderSale();
    const clases = cajon().classList;
    expect(clases.contains("flex")).toBe(true);
    expect(clases.contains("flex-col")).toBe(true);
    // `inset-y-0` es lo que le da el alto de la pantalla: sin alto fijo,
    // `flex-1` no tiene nada que repartir y la lista no desplaza.
    expect(clases.contains("inset-y-0")).toBe(true);
  });

  it("lo que se encoge es la lista, no la cabecera ni la versión", async () => {
    await renderSale();
    const scroller = contenedorQueDesplaza(declaracion())!;
    const hermanos = Array.from(cajon().children).filter(
      (n) => n !== scroller,
    ) as HTMLElement[];
    // Cabecera (logo + cerrar) y, si está, la línea de versión: todos
    // `shrink-0`. Si alguno cede, la lista deja de ser la que se come el
    // hueco y vuelve a desbordar.
    expect(hermanos.length).toBeGreaterThan(0);
    for (const h of hermanos) {
      expect(h.classList.contains("shrink-0")).toBe(true);
    }
  });
});
