// n1-vertical · la barra inferior del ticket, sólo donde tiene sentido.
//
// La barra (`lg:hidden fixed inset-x-0`) es lo ÚNICO que enseña el total
// en pantalla estrecha, así que no se toca cuando el cajero está
// marcando. Estorba en dos sitios, los dos vistos en el N1 el 2026-10-16:
//
//   · con la AGENDA abierta encima (captura `22-nueva-cita`): la agenda
//     es un overlay que pinta `App`, la venta NO se desmonta, y la barra
//     —`fixed`, z-40, y posterior en el DOM— tapa el botón «Reservar»;
//   · con el TECLADO del sistema abierto (captura `27-busqueda-teclado`):
//     la barra se pega sobre el teclado con `--keyboard-offset` y ocupa
//     el único hueco que quedaba para los resultados de la búsqueda.
//
// Lo que fija este banco:
//
//   1. Sin agenda y sin teclado la barra está. Es la de siempre.
//   2. Con `agendaAbierta` no se pinta (TPV claro y hostelería handheld).
//   3. Con el viewport visual encogido por el teclado desaparece, y
//      vuelve cuando el teclado se baja.
//   4. Un encogimiento pequeño (barras de sistema, rebote del scroll) NO
//      la quita: nada de parpadeos al desplazar el catálogo.
//
// Sabotajes que este fichero pone en rojo (tabla del done):
//   · la barra sale en la Agenda (quitar la condición `agendaAbierta`)
//   · la barra no se oculta con el teclado (quitar `tecladoAbierto`)
//   · `App` deja de pasar `agendaAbierta` (TS lo ve, pero además esto)
//
// Mismo montaje que drawer-version.test.tsx: createRoot + act, sin
// testing-library, módulos pesados mockeados.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
const vertical = vi.hoisted(() => ({
  actual: "SERVICES" as "HOSPITALITY" | "RETAIL" | "SERVICES",
}));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});
vi.mock("../src/lib/catalog.js", () => ({
  findByBarcode: () => null,
  fuzzySearch: () => [],
  getCachedBusinessType: () => vertical.actual,
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => true,
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

/**
 * Doble de `visualViewport`. jsdom no lo implementa, y es la única señal
 * de "hay teclado" que existe en el WebView.
 *
 * Es un `EventTarget` de verdad para que el `resize` que dispara el test
 * recorra el mismo camino que en el aparato: el hook escucha, lee los
 * valores de ESTE objeto y decide.
 */
class ViewportFalso extends EventTarget {
  height: number;
  offsetTop = 0;
  constructor(height: number) {
    super();
    this.height = height;
  }
  /** El teclado abre y sólo encoge el VIEWPORT VISUAL (el caso de la web). */
  abreElTeclado(px: number) {
    this.height = window.innerHeight - px;
    this.dispatchEvent(new Event("resize"));
  }
  bajaElTeclado() {
    this.height = window.innerHeight;
    this.dispatchEvent(new Event("resize"));
  }
}

let container: HTMLDivElement;
let root: Root;
let vv: ViewportFalso;

/**
 * n1-vertical · `ResizeObserver` de pega que declara UN ancho para la
 * fila de chips.
 *
 * jsdom no lo trae, y sin él la pantalla de venta se queda con el ancho
 * por defecto (el del terminal, 840 px), así que el reparto de chips no
 * se puede probar en estrecho. Éste llama al observador una vez con el
 * ancho que se le diga, que es lo que hace el navegador al montar.
 */
function declaraAnchoDeFila(ancho: number): void {
  class ObservadorFalso {
    constructor(private cb: ResizeObserverCallback) {}
    observe(el: Element) {
      this.cb(
        [{ target: el, contentRect: { width: ancho } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: ObservadorFalso,
  });
}

/** El N1 en vertical: 360×648 CSS px. */
function declaraPantallaDelN1(): void {
  Object.defineProperty(window, "innerHeight", {
    writable: true,
    configurable: true,
    value: 648,
  });
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: 360,
  });
  vv = new ViewportFalso(648);
  Object.defineProperty(window, "visualViewport", {
    writable: true,
    configurable: true,
    value: vv,
  });
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  vertical.actual = "SERVICES";
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string) => {
    const bg = backgroundRoutes(path);
    if (bg !== undefined) return bg;
    throw new Error(`ruta inesperada: ${path}`);
  });
  sessionStorage.clear();
  declaraPantallaDelN1();
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

async function renderSale(opts: { agendaAbierta?: boolean } = {}) {
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
        agendaAbierta={opts.agendaAbierta}
        onOpenAgenda={vi.fn()}
        onLogoutCashier={vi.fn()}
        onCloseShift={vi.fn()}
      />,
    );
  });
  await settle();
}

/** La barra inferior del ticket, si está en el árbol. */
function barra(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="barra-ticket"]');
}

/** La barra inferior de la comanda (hostelería handheld). */
function barraHandheld(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="handheld-bar"]');
}

/** Declara el tamaño para `useIsHandheld` de la venta de hostelería. */
function declaraHandheld(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("max-width"),
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

describe("n1-vertical · la barra del ticket y la Agenda", () => {
  it("en la pantalla de venta la barra está, como siempre", async () => {
    await renderSale();
    expect(barra()).not.toBeNull();
    // Y sigue siendo la de abajo pegada sobre el teclado: si alguien la
    // desancla, la compensación de `--keyboard-offset` deja de valer.
    expect(barra()!.className).toContain("fixed");
    expect(barra()!.getAttribute("style") ?? "").toContain("--keyboard-offset");
  });

  it("con la AGENDA abierta encima, la barra no se pinta", async () => {
    await renderSale({ agendaAbierta: true });
    expect(barra()).toBeNull();
  });

  it("en hostelería handheld, la agenda tampoco lleva barra", async () => {
    vertical.actual = "HOSPITALITY";
    declaraHandheld();
    await renderSale({ agendaAbierta: true });
    expect(barraHandheld()).toBeNull();
  });

  it("en hostelería handheld sin agenda, la barra está", async () => {
    vertical.actual = "HOSPITALITY";
    declaraHandheld();
    await renderSale();
    expect(barraHandheld()).not.toBeNull();
  });
});

describe("n1-vertical · las familias se alcanzan en un aparato de mano", () => {
  const fila = () =>
    container.querySelector<HTMLElement>('[data-testid="category-chips"]')!;

  it("en el N1 (fila de 328 px) la fila envuelve a dos líneas", async () => {
    // Con una sola fila, los chips fijos más «Más (N)» suman 437 px y el
    // chip que abre el resto quedaba cortado por `overflow-hidden`, sin
    // forma de tocarlo: las ocho familias, inalcanzables.
    declaraAnchoDeFila(328);
    await renderSale();
    expect(fila().className).toContain("flex-wrap");
    // Y NO puede recortar, que es lo que escondía el chip.
    expect(fila().className).not.toContain("overflow-hidden");
    expect(fila().className).not.toContain("flex-nowrap");
  });

  it("en el terminal (840 px) sigue siendo UNA fila que recorta", async () => {
    // La restricción del bloque: el AP11 se ve idéntico a antes.
    declaraAnchoDeFila(840);
    await renderSale();
    expect(fila().className).toContain("flex-nowrap");
    expect(fila().className).toContain("overflow-hidden");
    expect(fila().className).not.toContain("flex-wrap");
  });

  it("sin medida (primer render) se defiende el reparto del terminal", async () => {
    // jsdom sin `ResizeObserver`: el ancho se queda a 0 y el reparto cae
    // al del viewport de diseño.
    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      configurable: true,
      value: undefined,
    });
    await renderSale();
    expect(fila().className).toContain("flex-nowrap");
  });
});

describe("n1-vertical · los rótulos de familia no se cortan a mitad de palabra", () => {
  it("el azulejo de familia trunca con puntos suspensivos", async () => {
    // Medido en el N1 con la carta de Sirope (azulejos de 104 px):
    // «Croissantysandwich» mide 206 px y se leía «Croissanty», saliéndose
    // además del azulejo porque no había `overflow`.
    vertical.actual = "HOSPITALITY";
    declaraHandheld();
    await renderSale();
    const azulejos = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="family-button"]'),
    );
    expect(azulejos.length).toBeGreaterThan(0);
    for (const a of azulejos) {
      expect(a.className).toContain("truncate");
    }
  });
});

describe("n1-vertical · la barra del ticket y «Cerrar el día»", () => {
  it("con el modal de cierre abierto, la barra no se pinta encima", async () => {
    // Medido a 360×640 el 2026-10-18 (captura `11-cerrar-el-dia-360x640`):
    // la barra se pintaba sobre el «Cancelar» del pie del modal. Es el
    // mismo fallo que el de la agenda —la venta no se desmonta y la barra
    // es `fixed` en z-40— pero este modal sí es de esta pantalla.
    await renderSale();
    expect(barra()).not.toBeNull();

    // Por el menú, como el cajero: «Cerrar turno» abre «Cerrar el día».
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Abrir menú"]')!
        .click();
    });
    await settle();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[title="Cerrar turno"]')!
        .click();
    });
    await settle();

    expect(barra()).toBeNull();
  });
});

describe("n1-vertical · la barra del ticket y el teclado del sistema", () => {
  it("con el teclado abierto desaparece, y vuelve al bajarlo", async () => {
    await renderSale();
    expect(barra()).not.toBeNull();

    // El teclado del N1 se come ~290 px del viewport visual.
    await act(async () => vv.abreElTeclado(290));
    expect(barra()).toBeNull();

    await act(async () => vv.bajaElTeclado());
    expect(barra()).not.toBeNull();
  });

  it("un encogimiento pequeño no la quita (nada de parpadeos)", async () => {
    await renderSale();
    // Las barras de sistema al reaparecer con un swipe: 8 px. Si esto
    // quitara la barra, parpadearía al desplazar el catálogo.
    await act(async () => vv.abreElTeclado(8));
    expect(barra()).not.toBeNull();
  });

  it("si el teclado encoge la VENTANA entera, también desaparece", async () => {
    // El caso del N1, medido el 2026-10-18: `innerHeight` 720 → 449 y el
    // viewport visual encogido lo mismo, así que la resta de
    // `--keyboard-offset` da cero. Con sólo la señal del viewport visual,
    // la barra se quedaba puesta y tapaba los cuatro resultados.
    await renderSale();
    expect(barra()).not.toBeNull();

    await act(async () => {
      Object.defineProperty(window, "innerHeight", {
        writable: true,
        configurable: true,
        value: 449,
      });
      vv.height = 449;
      window.dispatchEvent(new Event("resize"));
    });
    expect(barra()).toBeNull();

    await act(async () => {
      Object.defineProperty(window, "innerHeight", {
        writable: true,
        configurable: true,
        value: 648,
      });
      vv.height = 648;
      window.dispatchEvent(new Event("resize"));
    });
    expect(barra()).not.toBeNull();
  });

  it("sin `visualViewport` la barra se queda puesta", async () => {
    // jsdom, navegadores viejos: nadie pierde el total por una API que
    // no existe.
    Object.defineProperty(window, "visualViewport", {
      writable: true,
      configurable: true,
      value: undefined,
    });
    await renderSale();
    expect(barra()).not.toBeNull();
  });
});
