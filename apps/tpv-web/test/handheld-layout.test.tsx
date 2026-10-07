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
// v2-H1-venta-y-sala · la venta de hostelería se pinta ahora con su
// propio componente, y el reparto de handheld deja de decidirse SÓLO con
// clases `lg:`: el número de columnas de la barra de familias y de la
// cuadrícula entra por `grid-template-columns` calculado (el JIT de
// Tailwind no compila `grid-cols-${n}`), así que la pantalla pregunta
// por `matchMedia`.
//
// Consecuencia para los tests, y es importante: **jsdom no implementa
// `matchMedia`**, así que sin un doble la pantalla asume terminal y el
// layout de handheld no existe en el árbol. Antes los dos convivían
// (`lg:hidden` contra `hidden lg:flex`) y bastaba leer clases. Ahora se
// monta uno u otro, lo que es mejor —no hay DOM muerto— pero obliga a
// declarar el tamaño. Lo hace `montaHandheld()`.
//
// Dos tests de este fichero se van a RETAIL: la estructura del aside
// clásico y las guardas anti-overflow del header son del TPV claro, y en
// hostelería ya no hay ni aside ni header. Siguen siendo la pantalla de
// Thalía, Cachictos y Sole, así que la cobertura se re-apunta en vez de
// borrarse.
//
// Mismo patrón sin testing-library que table-sale-flow.test.tsx:
// createRoot + act + eventos nativos; módulos pesados mockeados.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
const vertical = vi.hoisted(() => ({
  actual: "HOSPITALITY" as "HOSPITALITY" | "RETAIL" | "SERVICES",
}));

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
    getCachedBusinessType: () => vertical.actual,
    getCachedCrmEnabled: () => false,
    getCachedAgendaEnabled: () => false,
    // catalogo-local (addendum 3) · default TRUE, como en la caché real:
    // un TPV que no ha refrescado se comporta como antes del bloque.
    getCachedHoldedEnabled: () => true,
    getCachedCreditSalesEnabled: () => false,
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
  openCashDrawerIfAvailable: vi.fn(),
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
  vertical.actual = "HOSPITALITY";
  // Por defecto, handheld: es de lo que va este fichero.
  declaraPantalla(true);
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
        initialDraftLines={mapServerDraftLines(initialLines)}
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

function searchToggle(): HTMLButtonElement {
  const btn = container.querySelector(
    'button[aria-label="Buscar producto o escanear código"]',
  );
  if (!btn) throw new Error("lupa de búsqueda no encontrada");
  return btn as HTMLButtonElement;
}

function ticketSheet(): HTMLElement | null {
  return container.querySelector('[role="dialog"][aria-label="Ticket"]');
}

/** El botón grande de la barra inferior de la comanda oscura. */
function barraDeComanda(): HTMLButtonElement {
  const btn = container.querySelector('button[aria-label="Abrir la comanda"]');
  if (!btn) throw new Error("barra inferior de la comanda no encontrada");
  return btn as HTMLButtonElement;
}

/** El bottom-sheet de la comanda oscura. */
function comandaSheet(): HTMLElement | null {
  return container.querySelector('[role="dialog"][aria-label="Comanda"]');
}

/**
 * Declara el tamaño de pantalla para `useIsHandheld`.
 *
 * jsdom no trae `matchMedia`, y sin él la venta de hostelería asume
 * terminal. El doble es mínimo a propósito: contesta a la consulta y
 * acepta listeners que nunca se disparan, porque ningún test de este
 * fichero cambia de tamaño a mitad.
 */
function declaraPantalla(handheld: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: handheld && query.includes("max-width"),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

async function click(el: HTMLElement) {
  await act(async () => {
    (el as HTMLButtonElement).click();
  });
  await settle();
}

describe("SalePage · layout handheld", () => {
  it("la barra inferior muestra nº de líneas y total al añadir productos", async () => {
    // v2-H1 · misma barra y mismo contenido, en oscuro. El rótulo
    // accesible pasa de «Abrir ticket» a «Abrir la comanda», que es como
    // se llama en un bar lo que hay dentro.
    await renderQuickSale();

    expect(barraDeComanda().textContent).toContain("0 líneas");
    expect(barraDeComanda().textContent).toContain("0,00 €");

    await click(productTile());
    await click(productTile()); // mismo producto → agrupa en 1 línea, 2 uds

    const bar = barraDeComanda();
    expect(bar.textContent).toContain("1 línea");
    // 2 × 1,65 € (priceGross del mock con IVA 10%)
    expect(bar.textContent).toContain("3,30 €");
  });

  it("el bottom-sheet abre y cierra sin perder líneas", async () => {
    await renderQuickSale();
    await click(productTile());

    expect(comandaSheet()).toBeNull();
    await click(barraDeComanda());

    const sheet = comandaSheet();
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain("Café solo");
    expect(sheet!.textContent).toContain("1,65");

    const close = sheet!.querySelector(
      'button[aria-label="Cerrar la comanda"]',
    ) as HTMLButtonElement;
    await click(close);

    expect(comandaSheet()).toBeNull();
    // El estado no se perdió: la barra sigue contando la línea y al
    // reabrir la hoja la línea sigue dentro. Las líneas viven en
    // `SalePage`, así que la hoja es sólo presentación.
    expect(barraDeComanda().textContent).toContain("1 línea");
    await click(barraDeComanda());
    expect(comandaSheet()!.textContent).toContain("Café solo");
  });

  it("la comanda existe UNA vez en el árbol: o columna o hoja", async () => {
    // Antes el aside y la barra convivían con clases `lg:`. Ahora se
    // monta uno u otro, y eso es lo que impide que un sabotaje deje dos
    // comandas con estados distintos en la misma pantalla.
    await renderQuickSale();
    expect(container.querySelectorAll('[data-testid="comanda"]')).toHaveLength(
      0,
    );
    await click(barraDeComanda());
    expect(container.querySelectorAll('[data-testid="comanda"]')).toHaveLength(
      1,
    );

    await act(async () => root.unmount());
    container.remove();
    declaraPantalla(false);
    container = document.createElement("div");
    document.body.appendChild(container);
    await renderQuickSale();
    // En terminal: la comanda es la columna y no hay barra inferior.
    expect(container.querySelectorAll('[data-testid="comanda"]')).toHaveLength(
      1,
    );
    expect(container.querySelector('[data-testid="handheld-bar"]')).toBeNull();
  });

  it("RETAIL · estructura ≥1024px intacta: aside lg, barra y sheet sólo móvil", async () => {
    // v2-H1 · este test describe el layout del TPV CLARO (aside con
    // Subtotal/Total, barra `lg:hidden`, footer `hidden lg:grid`). En
    // hostelería no hay ninguno de los tres, pero sigue siendo el layout
    // de Thalía, Cachictos y Sole — el que el bloque se compromete a no
    // cambiar—, así que se comprueba ahí.
    vertical.actual = "RETAIL";
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

  // v1.14-la-comanda-se-ve (hallazgo M3): en HOSPITALITY la búsqueda
  // arranca plegada tras una lupa —ocupaba el 60 % del ancho en una
  // pantalla donde casi no se usa—, así que las guardas anti-overflow se
  // comprueban con el campo desplegado, que es cuando puede desbordar.
  it("RETAIL · Lote 0 · guardas anti-overflow del header presentes", async () => {
    // v2-H1 · las guardas son del HEADER, y la venta de hostelería no
    // tiene header: su buscador es un bloque dentro de una columna de
    // 420 px, no un `flex-1` compitiendo por el ancho con un cluster de
    // botones, que era la causa del desborde de 360 px. El header sigue
    // existiendo en RETAIL y la guarda sigue haciendo falta ahí.
    vertical.actual = "RETAIL";
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

  // v1.14 · el campo plegado NO se desmonta. Es donde aterriza el lector
  // de códigos USB-HID (el refoco de SalePage escribe en `searchRef`):
  // desmontarlo dejaría sin escáner a los tenants con lector USB, que es
  // peor que el 60 % de ancho que el pliegue viene a arreglar.
  it("M3 · la búsqueda plegada sigue montada y fuera de cuadro", async () => {
    // Sigue siendo N1 de v1.22, y sigue vigente en la pantalla oscura:
    // el campo plegado vive fuera de cuadro, enfocable, con
    // `inputMode="none"`. Es donde aterriza el lector USB-HID.
    await renderQuickSale();

    const search = container.querySelector(
      'input[type="search"]',
    ) as HTMLInputElement;
    expect(search).not.toBeNull();
    expect(search.getAttribute("aria-hidden")).toBe("true");
    expect(search.tabIndex).toBe(-1);
    // Fuera de cuadro, no oculto: `display:none` no recibiría el foco.
    expect(search.parentElement!.className).toContain("-left-[9999px]");
    // `hidden` a secas (display:none) impediría el foco; el
    // `overflow-hidden` del recorte fuera de cuadro no. Token exacto.
    expect(search.parentElement!.classList.contains("hidden")).toBe(false);

    await click(searchToggle());
    expect(search.getAttribute("aria-hidden")).toBeNull();
    expect(search.parentElement!.className).not.toContain("-left-[9999px]");
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

    const bar = container.querySelector(
      '[data-testid="handheld-bar"]',
    ) as HTMLElement;
    const comanda = Array.from(bar.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Comanda",
    ) as HTMLButtonElement;
    expect(comanda).not.toBeUndefined();
    expect(barraDeComanda().textContent).toContain("Mesa 1");

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
