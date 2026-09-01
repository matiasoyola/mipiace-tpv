// v1.14.1-el-catalogo-manda · §3. El desglose ha pasado de 20 px a un
// desierto.
//
// v1.14 recuperó el espacio del desglose (de 20 px a 304) y ahí se paró.
// En la captura del AP11 con v1.14 desplegado y UNA línea en el ticket,
// esos 304 px son 90 de línea y ~214 de nada: el panel no parece un
// ticket, parece roto.
//
// La jerarquía de v1.14 no se toca —la lista sigue siendo el único
// bloque flexible y el pie sigue anclado—; lo que se hace es llenar el
// hueco con lo único que ahí sirve, que es el atajo para añadir lo
// siguiente. Añadir el segundo café sin volver a buscarlo en la rejilla
// de la izquierda es el gesto de la barra en hora punta.
//
// Y se va en cuanto el ticket crece: **el atajo desaparece en cuanto
// compite con las líneas**, que son el contenido.

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
  productImageUrl: () => null,
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
import {
  clearTopSellersCache,
  topSellersSlotsFor,
} from "../src/lib/topSellers.js";

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
    return {
      source: "shift",
      items: [
        { productId: CATALOGO[10]!.id, units: 48 },
        { productId: CATALOGO[8]!.id, units: 41 },
        { productId: CATALOGO[4]!.id, units: 33 },
        { productId: CATALOGO[6]!.id, units: 27 },
        { productId: CATALOGO[2]!.id, units: 22 },
      ],
    };
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
  clearTopSellersCache();
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


describe("v1.14.1 · §3 · el hueco del desglose", () => {
  // SABOTAJE del bloque: ticket con 1 línea.
  it("SABOTAJE 1 línea · se pintan los más vendidos en el hueco", async () => {
    await renderTableSale([serverLine(0)]);

    expect(linesBox().querySelectorAll("[data-line-id]")).toHaveLength(1);
    const hueco = linesBox().querySelector(
      '[data-testid="ticket-top-sellers-filler"]',
    ) as HTMLElement;
    expect(hueco).not.toBeNull();
    // Cuelga DEBAJO de la lista, no en su lugar: la línea del ticket
    // sigue siendo lo primero que se lee.
    const orden = Array.from(linesBox().children);
    expect(orden.indexOf(hueco)).toBe(orden.length - 1);
    // Y son los que caben, ni uno más: v1.14 ya cortó por abajo el
    // quinto atajo del estado vacío por pintar más de los que entran.
    const atajos = Array.from(hueco.querySelectorAll("button"));
    expect(atajos).toHaveLength(topSellersSlotsFor(1));
    expect(hueco.textContent).toContain("Lo que más sale este turno");
  });

  it("el atajo del hueco añade la línea de verdad", async () => {
    await renderTableSale([serverLine(0)]);

    const hueco = linesBox().querySelector(
      '[data-testid="ticket-top-sellers-filler"]',
    ) as HTMLElement;
    await click(hueco.querySelectorAll("button")[0]!);

    expect(linesBox().querySelectorAll("[data-line-id]")).toHaveLength(2);
    // Y al pasar de una a dos líneas, el hueco desaparece solo: ya no
    // sobra sitio. El atajo se retira en cuanto estorba.
    expect(
      linesBox().querySelector('[data-testid="ticket-top-sellers-filler"]'),
    ).toBeNull();
  });

  // SABOTAJE del bloque: ticket con 8 líneas.
  it("SABOTAJE 8 líneas · NO se pintan y la lista se queda el espacio", async () => {
    await renderTableSale([0, 1, 2, 3, 4, 5, 6, 7].map(serverLine));

    expect(linesBox().querySelectorAll("[data-line-id]")).toHaveLength(8);
    expect(
      linesBox().querySelector('[data-testid="ticket-top-sellers-filler"]'),
    ).toBeNull();
    expect(
      linesBox().querySelector('[data-testid="ticket-top-sellers"]'),
    ).toBeNull();

    // Y la lista sigue siendo el bloque que se queda el espacio: la
    // jerarquía de v1.14 no se toca.
    expect(linesBox().className).toContain("flex-1");
    expect(linesBox().className).toContain("min-h-0");
    expect(linesBox().className).toContain("overflow-y-auto");
  });

  it("con dos líneas tampoco se pinta: no cabe, y medio atajo no es un atajo", async () => {
    await renderTableSale([serverLine(0), serverLine(1)]);

    expect(linesBox().querySelectorAll("[data-line-id]")).toHaveLength(2);
    expect(
      linesBox().querySelector('[data-testid="ticket-top-sellers-filler"]'),
    ).toBeNull();
  });

  it("el ticket vacío sigue siendo el estado vacío de v1.14, no el hueco", async () => {
    await renderTableSale([]);

    // Los cinco, y por la vía del estado vacío: sin lista debajo de la
    // que colgar, no hay hueco que llenar.
    const zona = linesBox().querySelector(
      '[data-testid="ticket-top-sellers"]',
    ) as HTMLElement;
    expect(zona).not.toBeNull();
    expect(
      linesBox().querySelector('[data-testid="ticket-top-sellers-filler"]'),
    ).toBeNull();
    expect(zona.querySelectorAll("button")).toHaveLength(topSellersSlotsFor(0));
  });
});
