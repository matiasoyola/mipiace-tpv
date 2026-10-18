// auditoria-sirope (#25) · LA VENTA DE MOSTRADOR QUE SÍ LLEGA A COCINA.
//
// El 18-10, en Cafetería Sirope, «Enviar» en venta rápida no mandaba
// nada: `SalePage.sendToKitchen` empezaba con `if
// (!tableContext?.activeTicketId) return;` y el botón seguía encendido.
// Sirope trabaja casi todo en mostrador.
//
// Las filas de la tabla de sabotajes que viven aquí:
//
//   | Volver a poner el `return` sin mesa | el envío desde venta rápida
//   | Cobrar venta rápida sin enviar antes | el cobro manda la comanda
//   | En una MESA, cobrar sin enviar NO manda solo: pregunta
//
// Banco igual que `kds-tpv-cocina.test.tsx`: doble de `apiWithCashier`
// con un DRAFT en memoria.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import type * as React from "react";
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

const CATALOGO = vi.hoisted(() => [
  {
    id: "00000000-0000-0000-0000-000000000001",
    holdedProductId: "h-1",
    sku: "TOS1",
    name: "Tostada con tomate",
    basePrice: 2.2,
    priceGross: 2.42,
    taxRate: 10,
    barcode: null,
    imageMime: null,
    tags: ["tostadas"],
    kind: "PRODUCT" as const,
    allergens: ["GLUTEN"] as string[],
  },
]);

vi.mock("../src/lib/catalog.js", () => ({
  findByBarcode: () => null,
  fuzzySearch: () => CATALOGO,
  getCachedBusinessType: () => "HOSPITALITY",
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => false,
  getCachedHoldedEnabled: () => false,
  getCachedCreditSalesEnabled: () => false,
  getCachedIconPreset: () => null,
  getCachedTagAliases: () => ({}),
  getCachedTenantId: () => "tenant-sirope",
  getCachedEnsayo: () => true,
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
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));
vi.mock("../src/lib/escposPrint.js", () => ({
  printEscposUsb: vi.fn(async () => ({ ok: true })),
  isWebUsbSupported: () => false,
  getPairedUsbPrinter: async () => null,
  printTicketUsb: vi.fn(),
  printTicketWifi: vi.fn(),
  fetchTicketEscposBinary: vi.fn(),
  fetchCreditReceiptEscpos: vi.fn(),
  openCashDrawerIfAvailable: vi.fn(),
  openUsbCashDrawer: vi.fn(),
  pairUsbPrinter: vi.fn(),
  forgetPairedUsbPrinter: vi.fn(),
  syncUsbPairingWithServerConfig: vi.fn(),
}));

import { SalePage, type TableContext } from "../src/pages/SalePage.js";
import { mapServerDraftLines } from "../src/lib/tableDraft.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const MESA = "00000000-0000-0000-0000-0000000000a5";
const TICKET_MESA = "00000000-0000-0000-0000-0000000000t5";
const TICKET_MOSTRADOR = "00000000-0000-0000-0000-0000000000m3";

const mesa: TableContext = {
  id: MESA,
  name: "T6",
  zone: "SALON",
  capacity: 4,
  diners: 2,
  openedAt: new Date().toISOString(),
  openedByEmail: "caja1@sirope.es",
  openedByAlias: "Gemma",
  activeTicketId: TICKET_MESA,
};

interface BancoOpts {
  /** El POST que crea el borrador de mostrador falla. */
  borradorFalla?: boolean;
  /** auditoria-sirope (#19) · la sección no tiene pantalla NI impresora:
   *  la línea se marca enviada pero nadie la ve. */
  sinDestino?: boolean;
  /** Unidades ya en cocina, por id de línea (para la mesa). */
  enviadas?: Record<string, number>;
  lineasDeMesa?: Array<{ id: string; units: number }>;
}

function banco(opts: BancoOpts = {}) {
  const llamadas: string[] = [];
  const borradores: Array<Record<string, unknown>> = [];
  const envios: Array<{ ticketId: string; body: Record<string, unknown> }> = [];
  const enviadas = new Map<string, number>(Object.entries(opts.enviadas ?? {}));
  const lineasMesa = (opts.lineasDeMesa ?? []).slice();
  /** Las líneas que el borrador de mostrador llegó a tener, para que el
   *  estado de cocina pueda decir cuáles ya salieron. */
  const lineasMostrador: Array<{ id: string; units: number }> = [];

  /** El borrador de mostrador tal como lo devuelve el servidor. */
  function draftDeMostrador() {
    return {
      id: TICKET_MOSTRADOR,
      status: "DRAFT",
      externalId: "ext-m3",
      tableId: null,
      table: null,
      diners: null,
      total: "2.42",
      totalTax: "0.22",
      totalDiscount: "0",
      createdAt: new Date().toISOString(),
      lastSentAt: null,
      lastSentRevision: 0,
      lines: lineasMostrador.map((l) => ({
        id: l.id,
        productId: CATALOGO[0]!.id,
        variantId: null,
        holdedProductId: null,
        sku: "TOS1",
        nameSnapshot: "Tostada con tomate",
        units: String(l.units),
        unitPrice: "2.2",
        discountPct: "0",
        taxRate: "10",
        subtotal: "2.2",
        total: "2.42",
        modifiers: null,
      })),
    };
  }

  apiMock.apiWithCashier.mockImplementation(
    async (
      path: string,
      o?: { method?: string; body?: Record<string, unknown> },
    ) => {
      llamadas.push(`${o?.method ?? "GET"} ${path}`);
      if (path === "/shift/current") return { shift: null };
      if (path === "/tpv/tables") {
        return { storeId: "store-1", registerId: "reg-1", tables: [] };
      }
      if (path.startsWith("/shift/") && path.includes("/tickets-count")) {
        return { count: 0, total: 0 };
      }
      if (path.startsWith("/tpv/catalog/now")) {
        return { source: "families", bandHours: 1, windowDays: 28, items: [] };
      }
      if (path.startsWith("/tpv/catalog/top-sellers")) {
        return { source: "month", items: [] };
      }
      if (path === "/mostrador/draft" && o?.method === "POST") {
        if (opts.borradorFalla) throw new Error("sin red");
        const body = o.body as { lines: Array<Record<string, unknown>> };
        borradores.push(o.body ?? {});
        for (const [i, l] of body.lines.entries()) {
          lineasMostrador.push({
            id: String(l.lineExternalId ?? `l-${i}`),
            units: Number(l.units),
          });
        }
        return {
          ticket: draftDeMostrador(),
          counterNumber: 3,
          counterLabel: "Mostrador nº 3",
        };
      }
      // auditoria-sirope (#25) · desde que la venta tiene borrador, lo
      // que se marca va al servidor por su ruta propia.
      if (path.startsWith("/mostrador/") && path.endsWith("/lines")) {
        const b = o!.body as Record<string, unknown>;
        lineasMostrador.push({
          id: String(b.lineExternalId),
          units: Number(b.units),
        });
        return { ticket: draftDeMostrador() };
      }
      if (path.includes("/lines/") && o?.method === "PATCH") {
        const id = path.split("/lines/")[1]!;
        const l = lineasMostrador.find((x) => x.id === id);
        if (l && o.body?.units !== undefined) l.units = Number(o.body.units);
        return { ticket: draftDeMostrador() };
      }
      if (path.includes("/send-to-kitchen/escpos")) {
        const ticketId = path.split("/tickets/")[1]!.split("/")[0]!;
        envios.push({ ticketId, body: o?.body ?? {} });
        for (const l of lineasMesa) enviadas.set(l.id, l.units);
        for (const l of lineasMostrador) enviadas.set(l.id, l.units);
        return {
          revision: 1,
          sentAt: "2026-10-18T13:42:00.000Z",
          nothingNew: false,
          replayed: false,
          sections: [
            opts.sinDestino
              ? {
                  section: "SALON",
                  destino: "NINGUNO",
                  ok: true,
                  lineCount: 3,
                  units: 3,
                }
              : {
                  section: "COCINA",
                  destino: "PANTALLA",
                  ok: true,
                  lineCount: 1,
                  units: 1,
                  orderId: "order-1",
                },
          ],
        };
      }
      if (path.endsWith("/allergies")) return { diners: 2, allergies: [] };
      if (path.endsWith("/kitchen") && (o?.method ?? "GET") === "GET") {
        return {
          diners: 2,
          revision: 1,
          lines: [...lineasMesa, ...lineasMostrador].map((l) => ({
            id: l.id,
            units: l.units,
            sentUnits: enviadas.get(l.id) ?? 0,
            course: 1,
            seat: null,
            section: "COCINA",
          })),
          firedCourses: [],
          allergies: [],
          orders: [],
          destinations: {
            BARRA: { screen: true, printer: false, canCorrectSent: true },
            COCINA: { screen: true, printer: false, canCorrectSent: true },
            SALON: { screen: true, printer: false, canCorrectSent: true },
          },
        };
      }
      if (path === "/kitchen/estado") {
        return {
          heartbeatWindowMs: 90000,
          screens: [],
          sections: [
            {
              section: "COCINA",
              screen: true,
              printer: false,
              canCorrectSent: true,
              needsPaperFallback: false,
            },
          ],
        };
      }
      if (path === "/kitchen/listas") return { ready: [] };
      if (path.startsWith("/tickets/") && (o?.method ?? "GET") === "GET") {
        return { ticket: { id: TICKET_MOSTRADOR, lines: [] } };
      }
      throw new Error(`ruta inesperada: ${path}`);
    },
  );
  return { llamadas, borradores, envios };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  localStorage.clear();
  sessionStorage.clear();
  apiMock.apiWithCashier.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  try {
    await act(async () => root.unmount());
  } catch {
    /* ya estaba desmontado */
  }
  container.remove();
});

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

type Props = React.ComponentProps<typeof SalePage>;

async function render(
  opts: {
    tableContext?: TableContext | null;
    lineasDeMesa?: unknown[];
    /** auditoria-sirope (#12) · el módulo «Cocina» del tenant. */
    cocina?: boolean;
  } = {},
) {
  root = createRoot(container);
  const props = {
    shiftId: "shift-1",
    cashierLabel: "caja1@sirope.es",
    cashierRole: "CASHIER",
    registerName: "Caja 1",
    registerId: "reg-1",
    storeName: "Cafetería Sirope",
    tableContext: opts.tableContext ?? null,
    initialDraftLines: mapServerDraftLines(
      (opts.lineasDeMesa ?? []) as Parameters<typeof mapServerDraftLines>[0],
    ),
    initialKitchen: null,
    kitchenDisplayEnabled: opts.cocina ?? true,
    kitchenSettings: {
      courseMode: "ESPERA" as const,
      seatMode: "ALERGIA" as const,
      greenMaxMin: 10,
      amberMaxMin: 20,
      readyBeep: false,
    },
    avisosListo: [],
    onBackToMap: opts.tableContext ? vi.fn() : undefined,
    onExitToMap: vi.fn(),
    onTicketMovedToTable: null,
    onLogoutCashier: vi.fn(),
    onCloseShift: vi.fn(),
  } as unknown as Props;
  await act(async () => {
    root.render(<SalePage {...props} />);
  });
  await settle();
}

async function click(el: Element | null | undefined) {
  if (!el) throw new Error("elemento no encontrado");
  await act(async () => {
    (el as HTMLButtonElement).click();
  });
  await settle();
}

const $$ = <T extends HTMLElement>(sel: string): T[] => [
  ...container.querySelectorAll<T>(sel),
];
const $ = <T extends HTMLElement>(sel: string): T | null =>
  container.querySelector<T>(sel);

function producto(nombre: string): HTMLButtonElement {
  const el = $$<HTMLButtonElement>('[data-testid="product-button"]').find(
    (b) =>
      b.querySelector('[data-testid="product-name"]')?.textContent?.trim() ===
      nombre,
  );
  if (!el) throw new Error(`producto «${nombre}» no encontrado`);
  return el;
}

// ──────────────────────────────────────────────────────────────────────

describe("#25 · venta de mostrador → cocina", () => {
  it("«Enviar» sin mesa crea el borrador y manda la comanda", async () => {
    // EL SABOTAJE: volver a poner `if (!tableContext?.activeTicketId)
    // return;` deja los dos arrays vacíos.
    const b = banco();
    await render();
    await click(producto("Tostada con tomate"));
    await click($('[data-testid="comanda-enviar"]'));

    expect(b.borradores).toHaveLength(1);
    const lineas = b.borradores[0]!.lines as Array<Record<string, unknown>>;
    expect(lineas).toHaveLength(1);
    expect(lineas[0]!.nameSnapshot).toBe("Tostada con tomate");
    expect(b.envios).toHaveLength(1);
    expect(b.envios[0]!.ticketId).toBe(TICKET_MOSTRADOR);
  });

  it("y el aviso de «comanda enviada» se queda en pantalla", async () => {
    // El borrador NACE con este mismo envío, así que `activeTicketId`
    // pasa de null a un id en mitad del gesto. El efecto que limpia el
    // estado de comanda al cambiar de cuenta se llevaba por delante el
    // aviso de la comanda que acababa de salir: se pulsaba «Enviar», la
    // comanda salía, y en pantalla no pasaba nada.
    banco();
    await render();
    await click(producto("Tostada con tomate"));
    await click($('[data-testid="comanda-enviar"]'));

    const toast = $('[data-testid="comanda-toast"]');
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toMatch(/enviada/i);
  });

  it("la segunda comanda reusa el borrador: un solo número de mostrador", async () => {
    const b = banco();
    await render();
    await click(producto("Tostada con tomate"));
    await click($('[data-testid="comanda-enviar"]'));
    await click(producto("Tostada con tomate"));
    await click($('[data-testid="comanda-enviar"]'));

    expect(b.borradores).toHaveLength(1);
    expect(b.envios).toHaveLength(2);
    expect(b.envios.every((e) => e.ticketId === TICKET_MOSTRADOR)).toBe(true);
  });

  it("si el borrador no se puede crear, lo dice: nunca un botón mudo", async () => {
    banco({ borradorFalla: true });
    await render();
    await click(producto("Tostada con tomate"));
    await click($('[data-testid="comanda-enviar"]'));

    expect(container.textContent).toMatch(/no ha salido|no se pudo/i);
  });

  it("COBRAR con líneas sin mandar las manda antes (en mostrador se paga primero)", async () => {
    // EL SABOTAJE: cobrar sin enviar deja `envios` vacío.
    const b = banco();
    await render();
    await click(producto("Tostada con tomate"));
    await click($('[data-testid="comanda-cobrar"]'));

    expect(b.envios).toHaveLength(1);
    expect(b.envios[0]!.ticketId).toBe(TICKET_MOSTRADOR);
  });
});

describe("#25 · en una MESA, cobrar sin enviar PREGUNTA", () => {
  const LINEA = {
    id: "00000000-0000-0000-0000-00000000l001",
    productId: CATALOGO[0]!.id,
    variantId: null,
    holdedProductId: null,
    sku: "TOS1",
    nameSnapshot: "Tostada con tomate",
    units: "1",
    unitPrice: "2.2",
    discountPct: "0",
    taxRate: "10",
    subtotal: "2.2",
    total: "2.42",
    modifiers: null,
  };

  it("no manda sola: sale la pregunta con sus tres salidas", async () => {
    const b = banco({
      lineasDeMesa: [{ id: LINEA.id, units: 1 }],
      enviadas: {},
    });
    await render({ tableContext: mesa, lineasDeMesa: [LINEA] });
    await click($('[data-testid="comanda-cobrar"]'));

    // Nada ha salido hacia cocina todavía.
    expect(b.envios).toHaveLength(0);
    const dialogo = $('[role="dialog"]');
    expect(dialogo).not.toBeNull();
    expect(dialogo!.textContent).toMatch(/sin mandar a cocina/i);
    expect(dialogo!.textContent).toMatch(/Enviar y cobrar/);
    expect(dialogo!.textContent).toMatch(/Cobrar sin enviar/);
  });
});

describe("#19 · una línea sin sección NO se da por enviada", () => {
  it("el aviso dice cuántas líneas se quedaron sin destino", async () => {
    // EL SABOTAJE: contar las secciones `NINGUNO` como enviadas devuelve
    // el «Comanda nº 1 enviada · SALÓN: 3 líneas» del 18-10, con la
    // cocina sin ver nada.
    banco({ sinDestino: true });
    await render();
    await click(producto("Tostada con tomate"));
    await click($('[data-testid="comanda-enviar"]'));

    const aviso = $('[data-testid="comanda-sin-destino"]');
    expect(aviso).not.toBeNull();
    expect(aviso!.textContent).toMatch(/3 líneas sin destino/i);
    expect(aviso!.textContent).toMatch(/Nadie las ha visto/i);
    // Y el aviso NO dice «enviada».
    expect($('[data-testid="comanda-toast"]')!.textContent).toMatch(
      /sin destino/i,
    );
    expect($('[data-testid="comanda-toast"]')!.textContent).not.toMatch(
      /nº 1 enviada/i,
    );
  });
});

describe("#12 · con Cocina apagada el TPV no habla de cocina", () => {
  it("sin pantalla ni impresora no hay botón «Enviar» ni rótulos de cocina", async () => {
    // EL SABOTAJE: pintar el botón pase lo que pase devuelve el «EN
    // COCINA · Comanda nº 1 enviada · Reenviar (nº 2)» de la captura 27,
    // con nadie al otro lado.
    banco();
    await render({ cocina: false });
    await click(producto("Tostada con tomate"));

    expect($('[data-testid="comanda-enviar"]')).toBeNull();
    expect($('[data-testid="comanda-eyebrow-sin-enviar"]')).toBeNull();
    expect($('[data-testid="comanda-eyebrow-cocina"]')).toBeNull();
    // Y la línea sigue en pantalla: lo que se va es el rótulo, no el
    // pedido.
    expect(container.textContent).toMatch(/Tostada con tomate/);
  });

  it("con Cocina encendida el botón está", async () => {
    banco();
    await render();
    await click(producto("Tostada con tomate"));
    expect($('[data-testid="comanda-enviar"]')).not.toBeNull();
  });

  it("«Reenviar» no se ofrece sin líneas nuevas", async () => {
    banco();
    await render();
    await click(producto("Tostada con tomate"));
    await click($('[data-testid="comanda-enviar"]'));
    // El banco devuelve el estado de cocina con la línea ya enviada, así
    // que no queda nada nuevo: reenviar lo mismo gastaría un número de
    // comanda y pintaría una tarjeta vacía en la pantalla del cocinero.
    expect($('[data-testid="comanda-enviar"]')).toBeNull();
  });
});
