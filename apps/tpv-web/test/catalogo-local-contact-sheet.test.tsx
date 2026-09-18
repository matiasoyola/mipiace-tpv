// catalogo-local · el ContactSheet de la venta no existe sin Holded.
//
// El panel "Cliente" del ticket adjunta un contacto DE HOLDED para la
// factura (ADR-010). En un comercio con `holdedEnabled = false` no hay
// factura que emitir, y tampoco hay contactos que buscar: la tabla
// `Contact` se puebla SÓLO desde Holded —el sync inicial, el cron de 15
// min, el fallback por teléfono de `/contacts/search` y el import CSV— y
// los cuatro exigen la API key (`POST /contacts` responde
// `409 NO_HOLDED_KEY` sin ella). El buscador devolvía vacío siempre y
// "Crear contacto" fallaba siempre.
//
// Lo que este banco fija:
//
//   1. La entrada "Cliente" NO está en el menú de acciones sin Holded.
//   2. El ContactSheet NO se monta sin Holded, ni aunque algo pida
//      abrirlo. La entrada es la cortesía; esto es la puerta.
//   3. El botón "Fiado" se va con él: el fiado exige deudor
//      (`contactHoldedId`) y el deudor salía de ese panel. Sin esto el
//      callejón sin salida que ya existía se volvería MUDO.
//   4. Con Holded, TODO sigue exactamente igual — el criterio 4 del
//      bloque. Cada caso de arriba lleva su gemelo "como master".
//   5. El picker de clientes del CRM (F1) NO se toca: es otra lista y es
//      lo único que le queda a este comercio para saber a quién atiende.
//
// Sabotaje que pone rojo este fichero: devolver el ContactSheet o su
// entrada de menú sin mirar `getCachedHoldedEnabled()`.

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

// Los dos flags que este banco mueve. Mutables porque el mock de un
// módulo es de fichero y aquí hacen falta las dos configuraciones.
const flags = vi.hoisted(() => ({ holded: true, credit: true }));

const CATALOGO = vi.hoisted(() => [
  {
    id: "00000000-0000-0000-0000-0000000000a0",
    // catalogo-local · nacido en la BD: sin enlace con Holded.
    holdedProductId: null,
    sku: "CORTE-01",
    name: "Corte de pelo",
    basePrice: 15,
    priceGross: 18.15,
    taxRate: 21,
    barcode: null,
    imageMime: null,
    tags: ["servicios"],
    kind: "SERVICE" as const,
  },
]);

vi.mock("../src/lib/catalog.js", () => ({
  findByBarcode: () => null,
  fuzzySearch: () => CATALOGO,
  getCachedBusinessType: () => "SERVICES" as const,
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => false,
  getCachedHoldedEnabled: () => flags.holded,
  getCachedCreditSalesEnabled: () => flags.credit,
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

import { SalePage } from "../src/pages/SalePage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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
  flags.holded = true;
  flags.credit = true;
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string) => {
    const bg = backgroundRoutes(path);
    if (bg !== undefined) return bg;
    return {};
  });
  if (!Element.prototype.scrollIntoView) {
    (Element.prototype as unknown as { scrollIntoView: () => void })
      .scrollIntoView = () => {};
  }
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

async function render() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SalePage
        shiftId="shift-1"
        cashierLabel="caja1@peluqueria.es"
        cashierRole="CASHIER"
        registerName="Caja 1"
        registerId="reg-1"
        storeName="Peluquería Test"
        tableContext={null}
        initialDraftLines={null}
        onBackToMap={vi.fn()}
        onTicketMovedToTable={null}
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

function botonPorTexto(texto: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").trim().startsWith(texto),
    ) ?? null
  );
}

/**
 * Mete una línea en el ticket y abre el cobro. Hace falta para ver el
 * botón "Fiado": vive dentro del overlay de cobro, y sin línea no hay
 * overlay — afirmar que no está sin abrirlo sería una tautología.
 */
async function abrirCobro(): Promise<void> {
  const tile = container.querySelector<HTMLElement>(
    '[data-testid="product-tile"]',
  );
  if (!tile) throw new Error("no hay fichas en la rejilla");
  await click(tile);
  const cobrar = botonPorTexto("Cobrar");
  if (!cobrar) throw new Error('botón "Cobrar" no encontrado');
  await click(cobrar);
}

/** Abre el sheet "Más acciones" del panel del ticket. */
async function abrirMas(): Promise<void> {
  const mas = botonPorTexto("Más");
  if (!mas) throw new Error('botón "Más" no encontrado');
  await click(mas);
}

/** La entrada "Cliente" del menú de acciones, si está. */
function entradaCliente(): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll("button")).find((b) =>
      (b.getAttribute("title") ?? "").startsWith("Asignar cliente al ticket"),
    ) ?? null
  );
}

/**
 * El ContactSheet, reconocible por su buscador: `#contactSearch` es suyo
 * y de nadie más. NO vale mirar el texto "Cliente" —el panel del ticket
 * ya lo dice— ni el placeholder genérico: el picker del CRM tiene otro
 * campo de búsqueda muy parecido y confundirlos haría que este test
 * pasara con el sheet en pantalla.
 */
function sheetDeContacto(): boolean {
  return container.querySelector("#contactSearch") !== null;
}

// ── Sin Holded ────────────────────────────────────────────────────────

describe("catalogo-local · sin Holded, el panel de contacto NO existe", () => {
  it("la entrada «Cliente» no está en el menú de acciones", async () => {
    flags.holded = false;
    await render();
    await abrirMas();
    expect(entradaCliente()).toBeNull();
  });

  it("y las otras acciones del menú SIGUEN estando: no se ha vaciado el menú", async () => {
    flags.holded = false;
    await render();
    await abrirMas();
    const txt = container.textContent ?? "";
    expect(txt).toContain("Descuento");
    expect(txt).toContain("Observaciones");
  });

  it("EL SABOTAJE: se pulsa TODO el menú y el sheet no aparece por ninguna", async () => {
    // Afirmar "el sheet no está" sin tocar nada sería una tautología:
    // claro que no está, no lo ha abierto nadie. Lo que de verdad hay que
    // impedir es que alguien devuelva la entrada al menú sin su puerta,
    // así que aquí se pulsan TODAS las acciones no destructivas una a una
    // y se comprueba que ninguna abre el panel.
    flags.holded = false;
    await render();
    // Los botones del topbar ya tienen `title` ("Deudas", "Tickets"…), así
    // que se fotografía la pantalla ANTES de abrir el menú y sólo se
    // pulsan los que aparecen DESPUÉS: los del sheet y nada más.
    const antes = new Set(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button[title]")),
    );
    await abrirMas();
    const delSheet = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button[title]"),
    ).filter((b) => !antes.has(b) && !(b.textContent ?? "").includes("Cancelar"));
    expect(delSheet.length).toBeGreaterThan(0);
    const etiquetas = delSheet.map((b) => b.getAttribute("title") ?? "");
    for (const t of etiquetas) {
      await abrirMas();
      const b = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button[title]"),
      ).find((x) => !antes.has(x) && x.getAttribute("title") === t);
      if (!b) continue;
      await click(b);
      expect(sheetDeContacto()).toBe(false);
      // Cada acción abre lo suyo (descuento, observaciones…). Se cierra
      // con Escape para volver a un estado limpio antes de la siguiente.
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      await settle();
    }
  });

  it("el botón «Fiado» se va con él: su deudor salía de ese panel", async () => {
    flags.holded = false;
    flags.credit = true;
    await render();
    await abrirCobro();
    // El overlay de cobro SÍ está abierto — si no, este `toBeNull` no
    // probaría nada.
    expect(botonPorTexto("Cobrar")).not.toBeNull();
    expect(botonPorTexto("Fiado")).toBeNull();
  });
});

// ── Con Holded · el criterio 4 del bloque ─────────────────────────────

describe("catalogo-local · con Holded, TODO sigue igual que en master", () => {
  it("la entrada «Cliente» está donde estaba", async () => {
    flags.holded = true;
    await render();
    await abrirMas();
    expect(entradaCliente()).not.toBeNull();
  });

  it("y abre el panel de contacto", async () => {
    flags.holded = true;
    await render();
    await abrirMas();
    const entrada = entradaCliente();
    expect(entrada).not.toBeNull();
    await click(entrada!);
    expect(sheetDeContacto()).toBe(true);
  });

  it("y el botón «Fiado» sigue donde estaba", async () => {
    flags.holded = true;
    flags.credit = true;
    await render();
    await abrirCobro();
    expect(botonPorTexto("Fiado")).not.toBeNull();
  });

  it("EL DEFAULT ES ASIMÉTRICO: un TPV que no ha refrescado se comporta como antes", async () => {
    // `getCachedHoldedEnabled()` es true sin dato, así que este caso ES
    // el de arriba — se deja escrito porque invertir el default dejaría
    // a los cinco comercios de producción sin el panel a la vez.
    flags.holded = true;
    await render();
    await abrirMas();
    expect(entradaCliente()).not.toBeNull();
  });
});
