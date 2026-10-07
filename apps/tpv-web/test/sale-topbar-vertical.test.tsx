// v1.14-la-comanda-se-ve · la barra superior se ordena por vertical
// (hallazgos M3 y M4 de la auditoría del 2026-09-01), y el estado vacío
// del ticket deja de ser una pantalla en blanco (§4 del bloque).
//
// M3 · la búsqueda medía 768 × 56 px sobre 1280 —el 60 % de la franja
// más valiosa— en una pantalla de bar donde casi no se usa: se toca
// categoría y producto. En retail (Cachitos, Thalía) sí es primaria.
//
// M4 · "Mapa" era un chip pequeño DENTRO del panel del ticket,
// compitiendo con el nombre de la mesa, siendo la navegación más
// frecuente del turno: cada mesa atendida termina volviendo al mapa.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
const state = vi.hoisted(() => ({
  businessType: "HOSPITALITY" as "HOSPITALITY" | "RETAIL" | "SERVICES",
}));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

const CATALOGO = vi.hoisted(() =>
  ["Café solo", "Croissant", "Coca-Cola"].map((name, i) => ({
    id: `00000000-0000-0000-0000-00000000000${i + 1}`,
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
  })),
);

vi.mock("../src/lib/catalog.js", () => ({
  findByBarcode: () => null,
  fuzzySearch: () => CATALOGO,
  getCachedBusinessType: () => state.businessType,
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => false,
  // catalogo-local (addendum 3) · default TRUE, como en la caché real:
  // un TPV que no ha refrescado se comporta como antes del bloque.
  getCachedHoldedEnabled: () => true,
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

import type { ServerDraftLine } from "../src/lib/tableDraft.js";
import { clearTopSellersCache } from "../src/lib/topSellers.js";
import { SalePage, type TableContext } from "../src/pages/SalePage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const MESA_1 = "00000000-0000-0000-0000-0000000000a1";

const tableContext: TableContext = {
  id: MESA_1,
  name: "M1",
  zone: "SALON",
  capacity: 4,
  diners: 2,
  openedAt: new Date().toISOString(),
  openedByEmail: "caja1@bar.es",
  activeTicketId: "00000000-0000-0000-0000-0000000000t1",
};

let topSellersResponse: unknown = { source: "shift", items: [] };

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
  if (path.startsWith("/tpv/catalog/top-sellers")) return topSellersResponse;
  if (path.startsWith("/tickets?")) return { items: [] };
  return undefined;
}

let container: HTMLDivElement;
let root: Root;
let onBackToMap: ReturnType<typeof vi.fn>;
let draftLines: ServerDraftLine[];

beforeEach(() => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  localStorage.clear();
  sessionStorage.clear();
  clearTopSellersCache();
  topSellersResponse = { source: "shift", items: [] };
  state.businessType = "HOSPITALITY";
  onBackToMap = vi.fn();
  draftLines = [];
  apiMock.apiWithCashier.mockReset();
  // El DRAFT de mesa vive en el servidor y `tableCreateLine` reconcilia
  // con la respuesta: el doble tiene que devolver un ticket de verdad o
  // la línea optimista se revertiría. El backend reutiliza el
  // `lineExternalId` del cliente como id (`tables/operativa.ts`).
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
        return { ticket: { id: tableContext.activeTicketId, lines: draftLines } };
      }
      return {};
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(opts: { table?: boolean } = {}) {
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
        tableContext={opts.table ? tableContext : undefined}
        initialDraftLines={opts.table ? [] : undefined}
        onBackToMap={onBackToMap}
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

function header(): HTMLElement {
  return container.querySelector("header") as HTMLElement;
}

function mapButton(): HTMLButtonElement | null {
  return (
    Array.from(header().querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "Mapa",
    ) ?? null
  );
}

function searchInput(): HTMLInputElement {
  return container.querySelector('input[type="search"]') as HTMLInputElement;
}

// v2-H1-venta-y-sala · M4 sigue vigente en el FONDO y cambia de FORMA.
//
// Lo que M4 arregló es que volver al mapa —la navegación nº 1 del turno—
// estaba enterrado en un chip de 9 px dentro del panel del ticket. Subió
// a la barra superior como CTA grande.
//
// v2-H1 quita la barra superior de la venta de hostelería (la maqueta no
// la tiene, y conservarla costaba 68 px de alto del catálogo con los que
// los 31 Licores dejaban de caber a 1280 × 800). El ancla se va a la
// cabecera de la comanda, como flecha de volver: sigue arriba a la
// izquierda, sigue a UN toque y sigue por encima del suelo táctil.
//
// Lo que se afirma es eso, y no el rótulo: un toque, `onBackToMap`, 56 px
// y arriba a la izquierda. El hallazgo —que no esté enterrado en el panel—
// se guarda igual.
describe("v2-H1 · M4 · volver a la sala es el ancla de la pantalla", () => {
  it("HOSPITALITY · la flecha de volver abre el mapa, a 56 px y la primera", async () => {
    await render();

    const atras = container.querySelector(
      '[data-testid="comanda-back"]',
    ) as HTMLButtonElement;
    expect(atras).not.toBeNull();
    expect(atras.getAttribute("aria-label")).toBe("Volver a la sala");
    expect(atras.querySelector("svg")).not.toBeNull();
    // El suelo táctil del bloque. Entra por `style` con la constante que
    // el test lee, no por una clase suelta.
    expect(atras.style.width).toBe("56px");
    expect(atras.style.height).toBe("56px");

    // La primera de la pantalla: nada se pulsa antes que ella.
    const botones = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    );
    expect(botones.indexOf(atras)).toBe(0);

    await click(atras);
    expect(onBackToMap).toHaveBeenCalled();
  });

  it("HOSPITALITY en MESA · el ancla sigue fuera de la lista de líneas", async () => {
    await render({ table: true });

    const atras = container.querySelector('[data-testid="comanda-back"]');
    expect(atras).not.toBeNull();
    // El hallazgo de M4 era que vivía DENTRO del panel, compitiendo con
    // el nombre de la mesa. La lista de líneas no puede volver a
    // contenerlo.
    const lineas = container.querySelector(
      '[data-testid="comanda-lineas"]',
    ) as HTMLElement;
    expect(lineas.contains(atras!)).toBe(false);
  });
});

describe("v1.14 · M3 · la búsqueda según el vertical", () => {
  it("SABOTAJE businessType=RETAIL · el botón Mapa NO se pinta", async () => {
    state.businessType = "RETAIL";
    await render();

    expect(mapButton()).toBeNull();
    // Y ningún otro botón de la barra lleva al mapa por otro rótulo:
    // en retail no hay mesas (`App.tsx` ni siquiera pinta el mapa).
    expect(
      Array.from(header().querySelectorAll("button")).some(
        (b) => (b.textContent ?? "").trim() === "Mesas",
      ),
    ).toBe(false);
  });

  it("RETAIL · la búsqueda se queda ancha y visible (ahí sí es primaria)", async () => {
    state.businessType = "RETAIL";
    await render();

    const input = searchInput();
    expect(input.getAttribute("aria-hidden")).toBeNull();
    const wrapper = input.parentElement!.parentElement!;
    expect(wrapper.className).toContain("lg:flex-1");
    expect(wrapper.className).toContain("lg:max-w-3xl");
    // Sin lupa que desplegar: el campo ya está.
    expect(
      container.querySelector(
        'button[aria-label="Buscar producto o escanear código"]',
      ),
    ).toBeNull();
  });

  it("SERVICES · igual que retail, con el copy de servicios", async () => {
    state.businessType = "SERVICES";
    await render();

    expect(mapButton()).toBeNull();
    expect(searchInput().placeholder).toContain("servicio");
    expect(searchInput().parentElement!.parentElement!.className).toContain(
      "lg:flex-1",
    );
  });

  it("HOSPITALITY · la búsqueda se pliega en una lupa y se despliega al pulsarla", async () => {
    // v2-H1 · misma conducta y misma etiqueta accesible; la lupa vive
    // ahora en el chrome de la comanda, a 56 px. Plegado, el campo sigue
    // fuera de cuadro con `aria-hidden` — que es N1 de v1.22: ahí es
    // donde aterriza el lector USB-HID sin que Android saque el teclado.
    await render();

    const lupa = container.querySelector(
      'button[aria-label="Buscar producto o escanear código"]',
    ) as HTMLButtonElement;
    expect(lupa).not.toBeNull();
    expect(lupa.style.width).toBe("56px");
    expect(searchInput().getAttribute("aria-hidden")).toBe("true");
    expect(searchInput().getAttribute("inputmode")).toBe("none");

    await click(lupa);
    expect(searchInput().getAttribute("aria-hidden")).toBeNull();
    expect(searchInput().getAttribute("inputmode")).toBe("search");
  });

  it("al plegar la lupa se limpia la búsqueda (no deja un filtro invisible)", async () => {
    await render();

    const lupa = container.querySelector(
      'button[aria-label="Buscar producto o escanear código"]',
    ) as HTMLButtonElement;
    await click(lupa);
    const input = searchInput();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "croiss");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(searchInput().value).toBe("croiss");

    await click(lupa);
    expect(searchInput().value).toBe("");
  });
});

// v2-H1-venta-y-sala · este bloque se re-apunta a RETAIL.
//
// El estado vacío con los más vendidos es del PANEL DEL TICKET, y en
// hostelería ese panel ya no existe: la comanda oscura lo sustituye y su
// vacío dice «Toca una familia y luego el producto», porque ahí el atajo
// útil ya está en pantalla — es «Ahora», que son los veinte más pedidos
// de esta franja ocupando el centro entero (decisión 4).
//
// El panel claro con sus atajos sigue vivo y sigue siendo el de Thalía,
// Cachictos y Sole, así que la cobertura se queda apuntando ahí en vez de
// borrarse.
describe("v1.14 · §4 · estado vacío del ticket (RETAIL)", () => {
  beforeEach(() => {
    state.businessType = "RETAIL";
  });

  it("mesa recién abierta · pinta los más vendidos del turno, tocables", async () => {
    topSellersResponse = {
      source: "shift",
      items: [
        { productId: CATALOGO[0]!.id, units: 42 },
        { productId: CATALOGO[1]!.id, units: 31 },
      ],
    };
    await render({ table: true });

    const zona = container.querySelector(
      '[data-testid="ticket-top-sellers"]',
    ) as HTMLElement;
    expect(zona).not.toBeNull();
    expect(zona.textContent).toContain("Lo que más sale este turno");
    const atajos = Array.from(zona.querySelectorAll("button"));
    expect(atajos).toHaveLength(2);
    expect(atajos[0]!.textContent).toContain("Café solo");
    // Mínimo táctil: son botones de añadir, se pulsan con prisa.
    for (const a of atajos) expect(a.className).toContain("min-h-touch");

    // Y añaden de verdad.
    await click(atajos[0]!);
    const lineas = container.querySelectorAll(
      '[data-testid="ticket-lines"] [data-line-id]',
    );
    expect(lineas.length).toBeGreaterThan(0);
    // v1.14.1 §3 · con UNA línea los atajos NO desaparecen: se quedan
    // llenando el hueco que quedaba debajo, que con una sola línea eran
    // ~220 px de desierto. Lo que sí cambia es que ahora cuelgan bajo la
    // lista y no en su lugar. (Que se van del todo con el ticket
    // crecido lo fija `sale-ticket-filler.test.tsx`.)
    expect(
      container.querySelector('[data-testid="ticket-top-sellers-filler"]'),
    ).not.toBeNull();
  });

  it("turno recién abierto · el ranking del mes se rotula como tal", async () => {
    topSellersResponse = {
      source: "month",
      items: [{ productId: CATALOGO[2]!.id, units: 300 }],
    };
    await render({ table: true });

    const zona = container.querySelector(
      '[data-testid="ticket-top-sellers"]',
    ) as HTMLElement;
    expect(zona.textContent).toContain("Lo que más sale este mes");
    expect(zona.textContent).toContain("Coca-Cola");
  });

  it("sin ranking (offline o sin histórico) cae a la frase, nunca a un hueco", async () => {
    topSellersResponse = { source: "shift", items: [] };
    await render({ table: true });

    expect(
      container.querySelector('[data-testid="ticket-top-sellers"]'),
    ).toBeNull();
    const lista = container.querySelector(
      '[data-testid="ticket-lines"]',
    ) as HTMLElement;
    expect(lista.textContent).toContain("Pulsa un producto");
  });

  it("un producto del ranking que ya no está en el catálogo no deja hueco", async () => {
    topSellersResponse = {
      source: "shift",
      items: [
        { productId: "00000000-0000-0000-0000-00000000dead", units: 99 },
        { productId: CATALOGO[0]!.id, units: 42 },
      ],
    };
    await render({ table: true });

    const zona = container.querySelector(
      '[data-testid="ticket-top-sellers"]',
    ) as HTMLElement;
    expect(zona.querySelectorAll("button")).toHaveLength(1);
    expect(zona.textContent).toContain("Café solo");
  });

  it("un fallo de red del ranking no rompe la pantalla", async () => {
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      if (path.startsWith("/tpv/catalog/top-sellers")) {
        throw new Error("sin conexión");
      }
      const bg = backgroundRoutes(path);
      if (bg !== undefined) return bg;
      return {};
    });
    await render({ table: true });

    expect(
      container.querySelector('[data-testid="ticket-lines"]')!.textContent,
    ).toContain("Pulsa un producto");
    // El panel sigue entero: el pie con el Total no se ha ido a ningún
    // lado por un 500 del ranking.
    expect(
      container.querySelector('[data-testid="ticket-footer"]')!.textContent,
    ).toContain("Total");
  });
});
