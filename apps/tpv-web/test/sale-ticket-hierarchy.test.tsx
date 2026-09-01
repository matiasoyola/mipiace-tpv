// v1.14-la-comanda-se-ve · el panel del ticket con la jerarquía dada la
// vuelta (hallazgo C1, crítico, de la auditoría del 2026-09-01).
//
// El reparto medido en el AP11 era: cabecera ~90 px, siete acciones
// secundarias ~135, totales ~120, "Enviar comanda" ~67 y "Cobrar" ~67
// sobre 573 px → **20 px para el desglose de artículos**. Al tocar un
// producto la línea nacía fuera de la vista, no había confirmación de
// nada, y en hora punta eso es doble pulsación y un café cobrado de más.
//
// Estos tests fijan lo que se puede fijar en jsdom: el ORDEN de los
// bloques en el documento, qué contenedor es el flexible, qué bloque
// queda fuera del área que scrollea, y que al añadir un producto la
// línea se destaca y el panel hace scroll hasta ella.
//
// Lo que NO cubren: los píxeles. jsdom no hace layout, así que "Cobrar
// termina en y=744 de 800" sólo lo puede decir el bucle visual con
// Playwright a 1280×800 (`docs/blocks/v1-14-comanda-shots/`) y, en
// última instancia, el terminal físico.
//
// Mismo patrón sin testing-library que table-sale-flow.test.tsx.

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

describe("v1.14 · C1 · jerarquía del panel del ticket", () => {
  it("SABOTAJE `flex-1` · la lista de artículos ocupa el espacio flexible", async () => {
    await renderTableSale([serverLine(0), serverLine(1)]);

    const box = linesBox();
    // Las tres a la vez: sin `flex-1` no crece, sin `min-h-0` el flex
    // item no puede encoger por debajo de su contenido (y el scroll
    // interno no llega a existir), y sin `overflow-y-auto` desborda.
    expect(box.className).toContain("flex-1");
    expect(box.className).toContain("min-h-0");
    expect(box.className).toContain("overflow-y-auto");
    // Y nadie más se lleva el espacio flexible del aside: si la
    // cabecera o el pie fuesen `flex-1`, la lista volvería a los 20 px.
    const flexibles = Array.from(aside().children).filter((el) =>
      el.className.includes("flex-1"),
    );
    expect(flexibles).toHaveLength(1);
    expect(flexibles[0]).toBe(box);
  });

  it("el orden es cabecera → líneas → totales, no al revés", async () => {
    await renderTableSale([serverLine(0)]);

    const hijos = Array.from(aside().children);
    const iLineas = hijos.indexOf(linesBox());
    const iPie = hijos.indexOf(footerBox());
    expect(iLineas).toBeGreaterThanOrEqual(0);
    expect(iPie).toBeGreaterThan(iLineas);
    // La cabecera (nombre de mesa) va primera, antes de las líneas.
    expect(hijos[0]!.textContent).toContain("Mesa M1");
  });

  it("SABOTAJE 12 líneas · Total y Cobrar quedan FUERA de lo que scrollea", async () => {
    await renderTableSale(CATALOGO.map((_, i) => serverLine(i)));

    // Las 12 líneas están y viven dentro del contenedor con scroll.
    const filas = linesBox().querySelectorAll("[data-line-id]");
    expect(filas).toHaveLength(12);

    const pie = footerBox();
    // El pie NO cuelga de NADA que scrollee: con 12 líneas, si colgase,
    // el Total y "Cobrar" se irían de la vista al bajar. No basta con
    // mirar el contenedor de líneas —envolver los dos bloques en un
    // scroll común también rompe el invariante y pasaba esa versión del
    // test—, así que se recorre la cadena hasta el aside.
    expect(linesBox().contains(pie)).toBe(false);
    let ancestro: HTMLElement | null = pie.parentElement;
    while (ancestro && ancestro !== aside().parentElement) {
      expect(ancestro.className).not.toContain("overflow-y-auto");
      expect(ancestro.className).not.toContain("overflow-y-scroll");
      expect(ancestro.className).not.toContain("overflow-auto");
      ancestro = ancestro.parentElement;
    }
    // Anclado abajo con fondo sólido y borde superior. `sticky` es lo
    // que lo sostiene cuando el aside vuelve al flujo natural en
    // ventanas de menos de 700 px de alto (v1.5-hotfix4).
    expect(pie.className).toContain("sticky");
    expect(pie.className).toContain("bottom-0");
    expect(pie.className).toContain("bg-white");
    expect(pie.className).toContain("border-t");
    expect(pie.className).toContain("shrink-0");
    // Y lleva lo que no puede perderse de vista.
    expect(pie.textContent).toContain("Total");
    expect(pie.textContent).toContain("Cobrar");
    expect(pie.textContent).toContain("Enviar comanda");
  });

  it("m2 · la CTA primaria está a 64 px (`touch-lg`), no a 56", async () => {
    await renderTableSale([serverLine(0)]);

    const cobrar = Array.from(footerBox().querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").startsWith("Cobrar"),
    )!;
    expect(cobrar.className).toContain("h-touch-lg");
    // Ni un `h-[52px]` suelto ni la vieja escala de 12/14 (48/56 px).
    expect(cobrar.className).not.toMatch(/h-\d/);
  });

  // v1.14.1-el-catalogo-manda §4 · "Cobrar" manda en el pie.
  //
  // v1.14 puso las dos acciones en fila, las dos a `touch-lg` y a mitad
  // y mitad. En la captura del AP11 se ve el resultado: pesan casi lo
  // mismo, y no lo son. "Cobrar" es LA acción de la pantalla y "Enviar
  // comanda" es de trámite.
  //
  // La jerarquía se construye con las tres variables a la vez, y el test
  // fija las tres: ancho (dos tercios contra uno), alto (64 contra 48) y
  // relleno (coral pleno contra borde neutro). Con una sola no basta —
  // dos botones del mismo alto y el mismo ancho con distinto color se
  // siguen leyendo como una pareja de iguales.
  it("§4 · SABOTAJE · 'Cobrar' pesa más que 'Enviar comanda' en las tres variables", async () => {
    await renderTableSale([serverLine(0)]);

    const botones = Array.from(footerBox().querySelectorAll("button"));
    const cobrar = botones.find((b) => (b.textContent ?? "").startsWith("Cobrar"))!;
    const comanda = botones.find((b) =>
      (b.textContent ?? "").includes("Enviar comanda"),
    )!;

    // 1 · Alto: la primaria en el tope de la escala táctil, la
    // secundaria un peldaño por debajo. Nada fuera de la escala.
    expect(cobrar.className).toContain("h-touch-lg");
    expect(comanda.className).toContain("h-touch");
    expect(comanda.className).not.toContain("h-touch-lg");
    expect(comanda.className).not.toMatch(/h-\d/);

    // 2 · Ancho: la rejilla del pie NO reparte a mitades.
    const rejilla = cobrar.parentElement!;
    expect(rejilla).toBe(comanda.parentElement);
    expect(rejilla.className).not.toContain("grid-cols-2");
    expect(rejilla.className).toContain("grid-cols-[1fr_1.6fr]");

    // 3 · Relleno: el coral pleno es de "Cobrar", y la secundaria ya no
    // lleva ni borde coral.
    expect(cobrar.className.split(/\s+/)).toContain("bg-mipiace-coral");
    expect(comanda.className).not.toContain("coral");
  });
});

// v1.14.1-el-catalogo-manda · §5. El punto medio que colgaba.
//
// En el AP11 la meta de la cabecera salía como
// "10 h 42 m · mipiacetpv-test-2e5c19f9 ·": el separador colgando y sin
// puntos suspensivos. La causa es `truncate` sobre un contenedor FLEX —
// `text-overflow: ellipsis` sólo actúa sobre el contenido EN LÍNEA de un
// bloque; en un flex container los hijos son items, no texto, y el
// navegador se limita a recortar por donde toque, que fue justo detrás
// de un separador.
describe("v1.14.1 · §5 · la meta del ticket trunca con elipsis", () => {
  it("la meta es un bloque con contenido en línea, no un flex", async () => {
    await renderTableSale([serverLine(0)]);

    const meta = aside().querySelector(
      '[data-testid="ticket-meta"]',
    ) as HTMLElement;
    expect(meta).not.toBeNull();
    expect(meta.className).toContain("truncate");
    // El sabotaje: devolver el `flex` que impedía la elipsis.
    expect(meta.className).not.toContain("flex");
  });

  it("no queda un separador suelto al final de la meta", async () => {
    await renderTableSale([serverLine(0)]);

    const meta = aside().querySelector(
      '[data-testid="ticket-meta"]',
    ) as HTMLElement;
    const texto = (meta.textContent ?? "").trim();
    expect(texto.length).toBeGreaterThan(0);
    expect(texto.endsWith("·")).toBe(false);
    expect(texto).not.toMatch(/·\s*$/);
  });

  it("el alias va el último: es lo primero que se corta, no las unidades", async () => {
    await renderTableSale([serverLine(0)]);

    const meta = aside().querySelector(
      '[data-testid="ticket-meta"]',
    ) as HTMLElement;
    const texto = meta.textContent ?? "";
    // v1.14 decidió que lo primero en caer fuera el alias de quien abrió
    // la mesa —está también en el mapa—, pero lo dejó DELANTE de las
    // unidades, así que en la práctica lo primero en caer eran las
    // unidades. El orden del texto es el orden del recorte.
    const alias = texto.indexOf("caja1");
    const unidades = texto.indexOf("ud.");
    expect(unidades).toBeGreaterThanOrEqual(0);
    expect(alias).toBeGreaterThan(unidades);
  });
});

describe("v1.14 · C1 · confirmación visual al añadir", () => {
  it("SABOTAJE añadir producto · la línea se destaca y el panel hace scroll", async () => {
    await renderTableSale([]);

    await click(productTile("Café solo"));

    const fila = linesBox().querySelector('[data-line-id]') as HTMLElement;
    expect(fila).not.toBeNull();
    expect(fila.getAttribute("data-highlighted")).toBe("true");
    expect(fila.className).toContain("bg-mipiace-coral-soft");
    // El destaque ENTRA sin transición. Con `transition-colors` también
    // al encenderse, el coral se desvanecía HACIA DENTRO durante 700 ms
    // y a los 150 ms del toque el alfa iba por 0,004 (medido en el
    // navegador): invisible justo cuando hay que confirmar. El principio
    // §1.3 pide feedback claro en menos de 100 ms.
    expect(fila.className).toContain("transition-none");
    expect(fila.className).not.toContain("transition-colors");
    // Y la vista ha ido hasta ELLA, no hasta otra.
    expect(scrollCalls).toContain(fila.getAttribute("data-line-id"));
  });

  it("el destaque se apaga solo (~1 s) y se desvanece, no salta", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderTableSale([]);
    await click(productTile("Café solo"));

    const fila = () => linesBox().querySelector("[data-line-id]") as HTMLElement;
    expect(fila().getAttribute("data-highlighted")).toBe("true");

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(fila().getAttribute("data-highlighted")).toBeNull();
    // La transición vive en la clase, no en un `key` que remonte el
    // nodo: remontar perdería el scroll del listado.
    expect(fila().className).toContain("transition-colors");
    expect(fila().className).toContain("duration-700");
  });

  it("tocar DOS veces el mismo café vuelve a destacar (el caso de la doble pulsación)", async () => {
    await renderTableSale([]);

    await click(productTile("Café solo"));
    const primeraFila = linesBox().querySelector("[data-line-id]") as HTMLElement;
    const id = primeraFila.getAttribute("data-line-id");

    // El segundo toque AGRUPA en la misma línea (2 uds.). Sin la señal
    // por contador, no habría segundo destaque — y ese silencio es
    // justo lo que produce la tercera pulsación y el café de más.
    scrollCalls = [];
    await click(productTile("Café solo"));

    const filas = linesBox().querySelectorAll("[data-line-id]");
    expect(filas).toHaveLength(1);
    expect(filas[0]!.getAttribute("data-line-id")).toBe(id);
    expect(filas[0]!.getAttribute("data-highlighted")).toBe("true");
    expect(scrollCalls).toContain(id);
  });

  it("el destaque no espera al servidor (principio §1.1)", async () => {
    // La API de líneas se queda colgada: el feedback tiene que haber
    // salido igual. Offline el POST no llega NUNCA.
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      const bg = backgroundRoutes(path);
      if (bg !== undefined) return bg;
      return new Promise(() => {});
    });
    await renderTableSale([]);

    await click(productTile("Café solo"));

    const fila = linesBox().querySelector("[data-line-id]") as HTMLElement;
    expect(fila.getAttribute("data-highlighted")).toBe("true");
  });
});

describe("v1.14 · C1 · las siete secundarias tras 'Más'", () => {
  it("no ocupan sitio en el panel: sólo hay un botón 'Más'", async () => {
    await renderTableSale([serverLine(0)]);

    const rotulos = Array.from(aside().querySelectorAll("button")).map((b) =>
      (b.textContent ?? "").trim(),
    );
    expect(rotulos).toContain("Más");
    for (const oculta of [
      "Cliente",
      "Descuento",
      "Observaciones",
      "Mover mesa",
      "Partir cuenta",
      "Agrupar",
    ]) {
      expect(rotulos).not.toContain(oculta);
    }
    // Y el "Mapa" se ha ido del panel a la barra superior (M4).
    expect(rotulos).not.toContain("Mapa");
    expect(aside().querySelector('button[title="Volver al mapa de sala"]')).toBeNull();
  });

  it("el sheet las tiene todas, con 'Vaciar mesa' apartada (m1)", async () => {
    await renderTableSale([serverLine(0)]);

    await click(
      Array.from(aside().querySelectorAll("button")).find(
        (b) => (b.textContent ?? "").trim() === "Más",
      )!,
    );

    const hoja = container.querySelector(
      '[role="dialog"][aria-label="Más acciones"]',
    ) as HTMLElement;
    expect(hoja).not.toBeNull();
    const rotulos = Array.from(hoja.querySelectorAll("button")).map((b) =>
      (b.textContent ?? "").trim(),
    );
    for (const accion of [
      "Cliente",
      "Descuento",
      "Observaciones",
      "Mover mesa",
      "Partir cuenta",
      "Agrupar",
    ]) {
      expect(rotulos.some((r) => r.startsWith(accion))).toBe(true);
    }
    // La destructiva no se mezcla en la rejilla: va en su propia zona,
    // separada por un borde, y con la consecuencia escrita al lado.
    const vaciar = Array.from(hoja.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").startsWith("Vaciar mesa"),
    )!;
    expect(vaciar.className).toContain("bg-red-50");
    expect(vaciar.parentElement!.className).toContain("border-t");
    expect(vaciar.textContent).toContain("libera la mesa");
    // Y todos los targets de la hoja llegan al mínimo de 48 px.
    for (const b of Array.from(hoja.querySelectorAll("button"))) {
      const cls = b.className;
      const esCerrar = b.getAttribute("aria-label") === "Cerrar";
      expect(cls.includes("min-h-touch") || esCerrar).toBe(true);
    }
  });
});
