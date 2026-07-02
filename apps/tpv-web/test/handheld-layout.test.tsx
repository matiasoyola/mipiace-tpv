// v1.0-handheld · Lote 3: layout móvil de SalePage en jsdom.
//
//   - la barra inferior fija renderiza el nº de líneas y el total
//     correcto al añadir productos desde el catálogo.
//   - el bottom-sheet del ticket abre y cierra sin perder líneas (el
//     estado vive en SalePage, el sheet es sólo presentación).
//   - estructura del layout clásico (≥1024px) intacta: aside `hidden
//     lg:flex`, barra `lg:hidden`, footer `hidden lg:grid` (snapshot
//     ligero de clases, no píxeles — jsdom no aplica media queries).
//   - Lote 0: guardas anti-overflow del header (min-w-0 en el wrapper
//     del buscador, header flex-wrap a dos filas en estrecho).
//   - contexto mesa: "Comanda" accesible desde la barra inferior →
//     POST /tickets/:id/send-to-kitchen/escpos.
//
// Mismo patrón sin testing-library que table-sale-flow.test.tsx:
// createRoot + act + eventos nativos; módulos pesados mockeados.

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
vi.mock("../src/lib/catalog.js", () => {
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
  return {
    findByBarcode: () => null,
    fuzzySearch: () => [CAFE],
    getCachedBusinessType: () => "HOSPITALITY" as const,
    getCachedIconPreset: () => null,
    getCachedTagAliases: () => ({}),
    getCachedTenantId: () => null,
    loadCatalogFromCache: async () => [CAFE],
    loadWildcards: async () => [],
    productImageUrl: () => null,
    refreshCatalog: async () => [CAFE],
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
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));

import {
  mapServerDraftLines,
  type ServerDraft,
  type ServerDraftLine,
} from "../src/lib/tableDraft.js";
import { SalePage, type TableContext } from "../src/pages/SalePage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const MESA_1 = "00000000-0000-0000-0000-0000000000a1";
const TICKET_1 = "00000000-0000-0000-0000-0000000000t1";

const tableContext: TableContext = {
  id: MESA_1,
  name: "Mesa 1",
  zone: "SALON",
  capacity: 4,
  diners: 2,
  openedAt: new Date().toISOString(),
  openedByEmail: "caja1@bar.es",
  activeTicketId: TICKET_1,
};

function serverLine(over: Partial<ServerDraftLine> = {}): ServerDraftLine {
  return {
    id: "00000000-0000-0000-0000-0000000000l1",
    productId: "00000000-0000-0000-0000-0000000000p1",
    variantId: null,
    holdedProductId: "h-cafe",
    sku: "CAFE",
    nameSnapshot: "Café solo",
    units: "1",
    unitPrice: "1.5",
    discountPct: "0",
    taxRate: "10",
    subtotal: "1.5",
    total: "1.65",
    modifiers: null,
    ...over,
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

async function renderQuickSale() {
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

async function renderTableSale(initialLines: ServerDraftLine[]) {
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
        initialTableLines={mapServerDraftLines(initialLines)}
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

function productTile(): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes("Café solo"),
  );
  if (!btn) throw new Error("tile de producto no encontrado");
  return btn as HTMLButtonElement;
}

function mobileBarButton(): HTMLButtonElement {
  const btn = container.querySelector('button[aria-label="Abrir ticket"]');
  if (!btn) throw new Error("barra inferior no encontrada");
  return btn as HTMLButtonElement;
}

function ticketSheet(): HTMLElement | null {
  return container.querySelector('[role="dialog"][aria-label="Ticket"]');
}

async function click(el: HTMLElement) {
  await act(async () => {
    (el as HTMLButtonElement).click();
  });
  await settle();
}

describe("SalePage · layout handheld", () => {
  it("la barra inferior muestra nº de líneas y total al añadir productos", async () => {
    await renderQuickSale();

    expect(mobileBarButton().textContent).toContain("0 líneas");
    expect(mobileBarButton().textContent).toContain("0,00 €");

    await click(productTile());
    await click(productTile()); // mismo producto → agrupa en 1 línea, 2 uds

    const bar = mobileBarButton();
    expect(bar.textContent).toContain("1 línea");
    // 2 × 1,65 € (priceGross del mock con IVA 10%)
    expect(bar.textContent).toContain("3,30 €");
  });

  it("el bottom-sheet abre y cierra sin perder líneas", async () => {
    await renderQuickSale();
    await click(productTile());

    expect(ticketSheet()).toBeNull();
    await click(mobileBarButton());

    const sheet = ticketSheet();
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain("Café solo");
    expect(sheet!.textContent).toContain("1,65");

    const close = sheet!.querySelector(
      'button[aria-label="Cerrar ticket"]',
    ) as HTMLButtonElement;
    await click(close);

    expect(ticketSheet()).toBeNull();
    // El estado no se perdió: la barra sigue contando la línea y al
    // reabrir el sheet la línea sigue dentro.
    expect(mobileBarButton().textContent).toContain("1 línea");
    await click(mobileBarButton());
    expect(ticketSheet()!.textContent).toContain("Café solo");
  });

  it("estructura ≥1024px intacta: aside lg, barra y sheet sólo móvil", async () => {
    await renderQuickSale();

    // El aside del ticket existe y sólo se pinta en escritorio.
    const aside = container.querySelector("aside.rounded-3xl");
    expect(aside).not.toBeNull();
    expect(aside!.className).toContain("hidden");
    expect(aside!.className).toContain("lg:flex");
    // Dentro del aside vive el panel clásico (totales + listado).
    expect(aside!.textContent).toContain("Subtotal");
    expect(aside!.textContent).toContain("Total");

    // La barra inferior es exclusiva del layout estrecho.
    const bar = mobileBarButton().parentElement!;
    expect(bar.className).toContain("lg:hidden");
    expect(bar.className).toContain("fixed");

    // El footer informativo de página desaparece en estrecho.
    const footer = container.querySelector("footer");
    expect(footer).not.toBeNull();
    expect(footer!.className).toContain("hidden");
    expect(footer!.className).toContain("lg:grid");

    // El catálogo sigue siendo una sección normal del flujo.
    expect(container.querySelector("section")).not.toBeNull();
  });

  it("Lote 0 · guardas anti-overflow del header presentes", async () => {
    await renderQuickSale();

    const search = container.querySelector(
      'input[type="search"]',
    ) as HTMLInputElement;
    expect(search).not.toBeNull();
    // El input puede encoger por debajo de su min-width intrínseco
    // (causa del overflow horizontal en 360px, visto 2026-06-12).
    expect(search.className).toContain("min-w-0");
    const relative = search.parentElement!;
    expect(relative.className).toContain("min-w-0");
    // El wrapper baja a fila propia a ancho completo en estrecho.
    const wrapper = relative.parentElement!;
    expect(wrapper.className).toContain("order-last");
    expect(wrapper.className).toContain("w-full");
    expect(wrapper.className).toContain("min-w-0");
    // El header envuelve a dos filas en vez de desbordar.
    const header = wrapper.closest("header")!;
    expect(header.className).toContain("flex-wrap");
  });

  it("mesa · enviar comanda desde la barra inferior", async () => {
    let kitchenCalls = 0;
    apiMock.apiWithCashier.mockImplementation(
      async (path: string, opts?: { method?: string }) => {
        if (
          path === `/tickets/${TICKET_1}/send-to-kitchen/escpos` &&
          opts?.method === "POST"
        ) {
          kitchenCalls += 1;
          return {
            revision: 1,
            sentAt: new Date().toISOString(),
            sections: [{ section: "COCINA", ok: true, lineCount: 1 }],
          };
        }
        const bg = backgroundRoutes(path);
        if (bg !== undefined) return bg;
        throw new Error(`ruta inesperada: ${path}`);
      },
    );

    await renderTableSale([serverLine()]);

    const bar = mobileBarButton().parentElement!;
    const comanda = Array.from(bar.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Comanda",
    ) as HTMLButtonElement;
    expect(comanda).not.toBeUndefined();
    expect(mobileBarButton().textContent).toContain("Mesa 1");

    await click(comanda);
    expect(kitchenCalls).toBe(1);
    // Tras el primer envío el botón rotula reenvío.
    expect(
      Array.from(bar.querySelectorAll("button")).some(
        (b) => b.textContent?.trim() === "Reenviar",
      ),
    ).toBe(true);
  });
});
