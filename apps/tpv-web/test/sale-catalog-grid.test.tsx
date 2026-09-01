// v1.14.1-el-catalogo-manda · §1. La tarjeta de producto y cuántas filas
// caben.
//
// El bloque nace de mirar la captura del AP11 con v1.14 ya desplegado
// (`docs/qa/2026-09-01-ap11-v1-14/07-venta-v114-mesa.png`): v1.14 arregló
// lo que la auditoría había MEDIDO —el panel del ticket— y no arregló lo
// que se VE, que es el catálogo, porque ocupa dos tercios del ancho.
//
// Cada tarjeta dedicaba ~125 de sus 206 px a un icono de taza genérico
// IDÉNTICO en las diez de la pantalla. No distinguía un café de un
// botellín y se comía la fila de productos que el camarero necesita ver:
// a 1280 × 800 con el panel del ticket abierto sólo cabían DOS filas.
//
// Cómo se testea "caben tres filas" sin navegador: jsdom no hace layout
// (`getBoundingClientRect` devuelve ceros), así que la aritmética vive en
// `lib/catalogGrid.ts` como función pura sobre constantes medidas, y la
// tarjeta declara su alto CON LA MISMA constante. Los dos tests de abajo
// cierran el circuito: uno comprueba la cuenta, el otro que la pantalla
// usa el número de la cuenta. Sin el segundo, alguien podría engordar la
// tarjeta y dejar la aritmética mintiendo en verde.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
// Qué productos tienen foto en Holded. Se rellena por test: el bloque
// exige que la tarjeta mida lo MISMO con foto y sin ella.
const fotos = vi.hoisted(() => ({ con: new Set<string>() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

const CATALOGO = vi.hoisted(() => {
  const nombres = [
    "Café solo",
    "Café con leche",
    "Cortado",
    "Colacao",
    "Zumo de naranja",
    "Tostada de tomate",
    "Croissant a la plancha",
    "Bocadillo de tortilla",
    "Caña de Mahou",
    "Copa de vino tinto",
    "Coca-Cola",
    "Agua mineral",
  ];
  return nombres.map((name, i) => ({
    id: `00000000-0000-0000-0000-0000000000${String(i + 10)}`,
    holdedProductId: `h-${i}`,
    sku: `SKU${i}`,
    name,
    basePrice: 1.5,
    priceGross: 1.65,
    taxRate: 10,
    barcode: null,
    imageMime: null,
    tags: ["cafes"],
    kind: "PRODUCT" as const,
  }));
});

vi.mock("../src/lib/catalog.js", () => ({
  findByBarcode: () => null,
  fuzzySearch: () => CATALOGO,
  getCachedBusinessType: () => "HOSPITALITY" as const,
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => false,
  getCachedCreditSalesEnabled: () => false,
  getCachedIconPreset: () => null,
  getCachedTagAliases: () => ({}),
  getCachedTenantId: () => "tenant-1",
  loadCatalogFromCache: async () => CATALOGO,
  loadWildcards: async () => [],
  productImageUrl: (p: { id: string }) =>
    fotos.con.has(p.id) ? `/product-images/tenant-1/${p.id}.jpg` : null,
  refreshCatalog: async () => CATALOGO,
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

import {
  mapServerDraftLines,
  type ServerDraftLine,
} from "../src/lib/tableDraft.js";
import { SalePage, type TableContext } from "../src/pages/SalePage.js";
import { PRODUCT_CARD_MIN_HEIGHT } from "../src/lib/catalogGrid.js";


(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const MESA_1 = "00000000-0000-0000-0000-0000000000a1";
const TICKET_1 = "00000000-0000-0000-0000-0000000000t1";

const tableContext: TableContext = {
  id: MESA_1,
  name: "M1",
  zone: "SALON",
  capacity: 4,
  diners: 2,
  openedAt: new Date().toISOString(),
  openedByEmail: "caja1@bar.es",
  activeTicketId: TICKET_1,
};

function serverLine(i: number): ServerDraftLine {
  const p = CATALOGO[i]!;
  return {
    id: `00000000-0000-0000-0000-0000000001${String(i).padStart(2, "0")}`,
    productId: p.id,
    variantId: null,
    holdedProductId: p.holdedProductId,
    sku: p.sku,
    nameSnapshot: p.name,
    units: "1",
    unitPrice: "1.5",
    discountPct: "0",
    taxRate: "10",
    subtotal: "1.5",
    total: "1.65",
    modifiers: null,
  };
}

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
let scrollCalls: string[];
let draftLines: ServerDraftLine[];

beforeEach(() => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  localStorage.clear();
  fotos.con.clear();
  apiMock.apiWithCashier.mockReset();
  // El DRAFT de la mesa vive en el servidor: `tableCreateLine` reconcilia
  // el carrito con la respuesta, así que el doble no puede devolver `{}`
  // o la línea optimista se revertiría. El backend real reutiliza el
  // `lineExternalId` del cliente como id de la línea
  // (`tables/operativa.ts`), y eso es lo que hace que el destaque
  // sobreviva a la reconciliación: se replica aquí.
  draftLines = [];
  apiMock.apiWithCashier.mockImplementation(
    async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
      const bg = backgroundRoutes(path);
      if (bg !== undefined) return bg;
      if (path.endsWith("/lines") && opts?.method === "POST") {
        const b = opts.body ?? {};
        draftLines.push({
          id: String(b.lineExternalId),
          productId: (b.productId as string) ?? null,
          variantId: null,
          holdedProductId: (b.holdedProductId as string) ?? null,
          sku: String(b.sku),
          nameSnapshot: String(b.nameSnapshot),
          units: String(b.units),
          unitPrice: String(b.unitPrice),
          discountPct: "0",
          taxRate: String(b.taxRate),
          subtotal: "1.5",
          total: "1.65",
          modifiers: null,
        });
        return { ticket: { id: TICKET_1, lines: draftLines } };
      }
      if (/\/lines\/[^/]+$/.test(path) && opts?.method === "PATCH") {
        const id = path.slice(path.lastIndexOf("/") + 1);
        const linea = draftLines.find((l) => l.id === id);
        if (linea && opts.body?.units != null) {
          linea.units = String(opts.body.units);
        }
        return { ticket: { id: TICKET_1, lines: draftLines } };
      }
      return {};
    },
  );
  // jsdom no implementa scrollIntoView. Lo registramos para poder
  // afirmar que el panel LLEVA la vista hasta la línea recién añadida.
  scrollCalls = [];
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
    function (this: Element) {
      scrollCalls.push(this.getAttribute("data-line-id") ?? "?");
    };
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function renderTableSale(initial: ServerDraftLine[]) {
  draftLines = [...initial];
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
        tableContext={tableContext}
        initialTableLines={mapServerDraftLines(initial)}
        onBackToMap={vi.fn()}
        onTicketMovedToTable={null}
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

/** El aside de escritorio, que es el layout del AP11 (1280×800). */
function aside(): HTMLElement {
  const el = container.querySelector("aside.rounded-3xl");
  if (!el) throw new Error("aside del ticket no encontrado");
  return el as HTMLElement;
}

function linesBox(): HTMLElement {
  const el = aside().querySelector('[data-testid="ticket-lines"]');
  if (!el) throw new Error("contenedor de líneas no encontrado");
  return el as HTMLElement;
}

function footerBox(): HTMLElement {
  const el = aside().querySelector('[data-testid="ticket-footer"]');
  if (!el) throw new Error("pie del ticket no encontrado");
  return el as HTMLElement;
}

function productTile(name: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("section button")).find(
    (b) => (b.textContent ?? "").includes(name),
  );
  if (!btn) throw new Error(`tile "${name}" no encontrado`);
  return btn as HTMLButtonElement;
}


describe("v1.14.1 · §1 · la tarjeta de producto", () => {
  it("declara el MISMO alto que usa la aritmética de `catalogRowsVisible`", async () => {
    await renderTableSale([]);

    // El circuito que hace que el sabotaje del placeholder muerda: si el
    // alto pintado y el alto calculado se separan, `catalog-grid.test.ts`
    // calcularía sobre un número que la pantalla no usa y se quedaría
    // verde mintiendo.
    expect(tiles().length).toBeGreaterThan(0);
    for (const tile of tiles()) {
      expect(tile.style.minHeight).toBe(`${PRODUCT_CARD_MIN_HEIGHT}px`);
    }
  });

  it("sin foto: ni imagen ni placeholder, sólo el acento de la categoría", async () => {
    await renderTableSale([]);

    for (const tile of tiles()) {
      // Nada de media: ni `<img>` ni el antiguo bloque de icono. Este es
      // el sabotaje: volver a pintar algo aquí cuando no hay foto.
      expect(tile.querySelector('[data-testid="product-media"]')).toBeNull();
      // Y el acento fino de 4 px con el tono de la categoría, que es lo
      // único que queda de los 125 px.
      const banda = tile.querySelector('[data-testid="product-tone-band"]');
      expect(banda).not.toBeNull();
      expect((banda as HTMLElement).className).toContain("h-1");
    }
  });

  it("con foto: se usa la imagen y la tarjeta NO cambia de alto", async () => {
    fotos.con.add(CATALOGO[0]!.id);
    await renderTableSale([]);

    const conFoto = tiles().filter(
      (t) => t.querySelector('[data-testid="product-media"]') !== null,
    );
    const sinFoto = tiles().filter(
      (t) => t.querySelector('[data-testid="product-media"]') === null,
    );
    expect(conFoto).toHaveLength(1);
    expect(sinFoto.length).toBeGreaterThan(0);

    // La imagen manda: ocupa la tarjeta entera, no una franja.
    const img = conFoto[0]!.querySelector('[data-testid="product-media"]')!;
    expect(img.className).toContain("absolute");
    expect(img.className).toContain("object-cover");
    // Y donde hay foto no se pinta además la banda.
    expect(
      conFoto[0]!.querySelector('[data-testid="product-tone-band"]'),
    ).toBeNull();

    // Lo que el bloque exige: el mismo alto en los dos casos. Si la
    // tarjeta con foto fuera más alta, un catálogo a medio fotografiar
    // dejaría la rejilla con filas rotas.
    expect(conFoto[0]!.style.minHeight).toBe(sinFoto[0]!.style.minHeight);
    expect(conFoto[0]!.style.minHeight).toBe(`${PRODUCT_CARD_MIN_HEIGHT}px`);
  });

  it("el nombre va a dos líneas como máximo y el precio pesa más", async () => {
    await renderTableSale([]);

    const tile = tiles()[0]!;
    const nombre = Array.from(tile.querySelectorAll("span")).find((s) =>
      (s.textContent ?? "").includes(CATALOGO[0]!.name),
    )!;
    expect(nombre.className).toContain("line-clamp-2");
    // Jerarquía: en una barra el nombre se reconoce de memoria y lo que
    // se comprueba de un vistazo es el importe.
    const precio = Array.from(tile.querySelectorAll("span")).find((s) =>
      (s.textContent ?? "").includes("€"),
    )!;
    expect(precio.className).toContain("font-semibold");
    expect(nombre.className).toContain("font-medium");
    expect(precio.className).toContain("tabular-nums");
  });
});

/** Las tarjetas de producto de la rejilla del catálogo. */
function tiles(): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="product-tile"]'),
  );
}
