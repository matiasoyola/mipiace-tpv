// v1.0-mesas-frontend · Lote 3: flujo de mesa completo en el SalePage
// con la API mockeada.
//
//   - añadir línea → POST /tables/:id/lines con lineExternalId y
//     reconciliación con la respuesta del servidor.
//   - retomar mesa "desde otra sesión" → pinta el DRAFT del servidor,
//     NUNCA el carrito local de sessionStorage (reservado a venta rápida).
//   - editar desde caja no propietaria → 403 REGISTER_MISMATCH: revert
//     del optimista + toast.
//   - agrupar una mesa ya agrupada → 409 TABLE_ALREADY_GROUPED: toast.
//   - cobrar → POST /tickets/:id/checkout con externalId de idempotencia
//     y vuelta al mapa.
//   - mapa: una mesa con checkout pendiente en el outbox local queda
//     bloqueada ("cobro pendiente") en ESTE dispositivo.
//
// Mismo patrón sin testing-library que checkout-outbox.test.tsx:
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
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));

import { ApiError } from "../src/api.js";
import {
  __resetOutboxForTests,
  outboxAdd,
  outboxList,
} from "../src/lib/outbox.js";
import {
  mapServerDraftLines,
  type ServerDraft,
  type ServerDraftLine,
} from "../src/lib/tableDraft.js";
import { SalePage, type TableContext } from "../src/pages/SalePage.js";
import { TableMapScreen, type ApiTable } from "../src/pages/TableMapScreen.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const MESA_1 = "00000000-0000-0000-0000-0000000000a1";
const MESA_2 = "00000000-0000-0000-0000-0000000000a2";
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

function serverDraft(lines: ServerDraftLine[]): ServerDraft {
  return {
    id: TICKET_1,
    status: "DRAFT",
    externalId: "00000000-0000-0000-0000-0000000000e1",
    tableId: MESA_1,
    table: { id: MESA_1, name: "Mesa 1", zone: "SALON", capacity: 4 },
    diners: 2,
    total: "1.65",
    createdAt: new Date().toISOString(),
    lines,
  };
}

// Rutas de fondo que SalePage dispara al montar (salud, contador de
// turno, storeId del WS). Cada test añade encima sus rutas de mesa.
function backgroundRoutes(
  path: string,
  tables: unknown[] = [],
): unknown | undefined {
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
    return { storeId: "store-1", registerId: "reg-1", tables };
  }
  return undefined;
}

let container: HTMLDivElement;
let root: Root;
const onBackToMap = vi.fn();

beforeEach(async () => {
  await __resetOutboxForTests();
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  apiMock.apiWithCashier.mockReset();
  onBackToMap.mockReset();
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderSalePage(initialLines: ServerDraftLine[]) {
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
        onBackToMap={onBackToMap}
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

function buttonByText(text: string, exact = true): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => {
    const t = b.textContent?.trim() ?? "";
    return exact ? t === text : t.startsWith(text);
  });
  if (!btn) throw new Error(`botón "${text}" no encontrado`);
  return btn as HTMLButtonElement;
}

async function click(btn: HTMLButtonElement) {
  await act(async () => {
    btn.click();
  });
  await settle();
}

describe("SalePage · mesa cableada a la API", () => {
  it("añadir línea: POST /tables/:id/lines con lineExternalId + reconciliación", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    apiMock.apiWithCashier.mockImplementation(
      async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === `/tables/${MESA_1}/lines` && opts?.method === "POST") {
          capturedBody = opts.body!;
          return {
            ticket: serverDraft([
              serverLine({ id: opts.body!.lineExternalId as string }),
            ]),
          };
        }
        const bg = backgroundRoutes(path);
        if (bg !== undefined) return bg;
        throw new Error(`ruta inesperada: ${path}`);
      },
    );

    await renderSalePage([]);
    await click(buttonByText("Café solo", false));

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.sku).toBe("CAFE");
    expect(capturedBody!.unitPrice).toBe(1.5);
    expect(typeof capturedBody!.lineExternalId).toBe("string");
    // La línea reconciliada del servidor se pinta en el panel.
    expect(container.textContent).toContain("Café solo");
    expect(container.textContent).toContain("1 ud.");
  });

  it("retomar mesa ocupada: pinta el DRAFT del servidor, no el carrito local", async () => {
    // Carrito local de venta rápida con basura — NO debe filtrarse.
    sessionStorage.setItem(
      "mipiacetpv-cart-in-progress:quick-sale",
      JSON.stringify([
        {
          id: "junk",
          productId: null,
          variantId: null,
          holdedProductId: null,
          sku: "JUNK",
          nameSnapshot: "Producto fantasma",
          units: 9,
          unitPrice: 99,
          unitPriceOverride: null,
          priceGross: 99,
          discountPct: 0,
          taxRate: 21,
          modifiers: [],
        },
      ]),
    );
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      const bg = backgroundRoutes(path);
      if (bg !== undefined) return bg;
      throw new Error(`ruta inesperada: ${path}`);
    });

    await renderSalePage([
      serverLine(),
      serverLine({
        id: "00000000-0000-0000-0000-0000000000l2",
        sku: "TOSTADA",
        nameSnapshot: "Tostada",
        unitPrice: "2.5",
        total: "2.75",
      }),
    ]);

    expect(container.textContent).toContain("Café solo");
    expect(container.textContent).toContain("Tostada");
    expect(container.textContent).not.toContain("Producto fantasma");
    expect(container.textContent).toContain("2 uds.");
  });

  it("editar desde otra caja → 403 REGISTER_MISMATCH: revert + toast", async () => {
    apiMock.apiWithCashier.mockImplementation(
      async (path: string, opts?: { method?: string }) => {
        if (path.includes("/lines/") && opts?.method === "PATCH") {
          throw new ApiError(
            403,
            "El ticket no pertenece a tu caja.",
            "REGISTER_MISMATCH",
          );
        }
        const bg = backgroundRoutes(path);
        if (bg !== undefined) return bg;
        throw new Error(`ruta inesperada: ${path}`);
      },
    );

    await renderSalePage([serverLine()]);
    expect(container.textContent).toContain("1 ud.");

    const plus = container.querySelector(
      'button[aria-label="Sumar una unidad"]',
    ) as HTMLButtonElement;
    expect(plus).not.toBeNull();
    await click(plus);

    // Toast con el mensaje del backend y unidades revertidas.
    expect(container.textContent).toContain("El ticket no pertenece a tu caja.");
    expect(container.textContent).toContain("1 ud.");
    expect(container.textContent).not.toContain("2 uds.");
  });

  it("agrupar una mesa ya agrupada → 409 TABLE_ALREADY_GROUPED: toast en español", async () => {
    apiMock.apiWithCashier.mockImplementation(
      async (path: string, opts?: { method?: string }) => {
        if (path === `/tables/${MESA_1}/group` && opts?.method === "POST") {
          throw new ApiError(
            409,
            "Alguna de las mesas ya pertenece a otro grupo. Desagrupa primero.",
            "TABLE_ALREADY_GROUPED",
          );
        }
        const bg = backgroundRoutes(path, [
          {
            id: MESA_2,
            name: "Mesa 2",
            zone: "SALON",
            capacity: 4,
            state: "OPEN",
            activeTicket: { id: "t2", total: "3.30" },
            groupedIntoTableId: null,
          },
        ]);
        if (bg !== undefined) return bg;
        throw new Error(`ruta inesperada: ${path}`);
      },
    );

    await renderSalePage([serverLine()]);
    await click(buttonByText("Agrupar"));
    // Picker: marcar Mesa 2 y confirmar.
    await click(buttonByText("Mesa 2", false));
    await click(buttonByText("Agrupar 1 mesa", false));

    expect(container.textContent).toContain(
      "Alguna de las mesas ya pertenece a otro grupo",
    );
  });

  it("cobrar mesa → POST /tickets/:id/checkout con externalId; vuelta al mapa", async () => {
    let checkoutPath: string | null = null;
    let checkoutBody: Record<string, unknown> | null = null;
    apiMock.apiWithCashier.mockImplementation(
      async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === `/tickets/${TICKET_1}/checkout` && opts?.method === "POST") {
          checkoutPath = path;
          checkoutBody = opts.body!;
          return {
            ticket: {
              id: TICKET_1,
              internalNumber: "000007",
              status: "PENDING_SYNC",
              holdedDocNumber: null,
            },
            syncStatus: "PENDING_SYNC",
          };
        }
        // GETs del SuccessOverlay (polling Holded, digital, printer).
        if (path.includes("/digital")) throw new Error("offline");
        if (path.includes("printer-info")) throw new Error("offline");
        if (path === `/tickets/${TICKET_1}` && (!opts?.method || opts.method === "GET")) {
          return { ticket: { holdedDocNumber: null, status: "PENDING_SYNC" } };
        }
        const bg = backgroundRoutes(path);
        if (bg !== undefined) return bg;
        throw new Error(`ruta inesperada: ${path}`);
      },
    );

    await renderSalePage([serverLine()]);
    // Abre el overlay de cobro (botón del panel: "Cobrar 1,65 €").
    await click(buttonByText("Cobrar", false));
    // Confirma dentro del overlay (botón exacto "Cobrar").
    await click(buttonByText("Cobrar"));

    expect(checkoutPath).toBe(`/tickets/${TICKET_1}/checkout`);
    expect(checkoutBody).not.toBeNull();
    expect(typeof checkoutBody!.externalId).toBe("string");
    expect(checkoutBody!.payments).toEqual([{ method: "CASH", amount: 1.65 }]);
    // El body de mesa NO lleva líneas (viven en el DRAFT server-side).
    expect(checkoutBody!.lines).toBeUndefined();
    expect(container.textContent).toContain("Ticket emitido");
    // 2xx confirmado → el outbox queda limpio (la mesa no se bloquea).
    expect(await outboxList()).toHaveLength(0);

    await click(buttonByText("Nueva venta"));
    expect(onBackToMap).toHaveBeenCalled();
  });
});

describe("TableMapScreen · checkout en tránsito bloquea la mesa local", () => {
  it("mesa con item de outbox (tableId) queda deshabilitada con badge", async () => {
    await outboxAdd({
      externalId: "00000000-0000-0000-0000-0000000000c1",
      kind: "ticket",
      path: `/tickets/${TICKET_1}/checkout`,
      body: { payments: [{ method: "CASH", amount: 1.65 }] },
      label: "Mesa",
      total: 1.65,
      tableId: MESA_1,
    });

    apiMock.apiWithCashier.mockResolvedValue({
      storeId: "store-1",
      registerId: "reg-1",
      tables: [
        {
          id: MESA_1,
          name: "Mesa 1",
          capacity: 4,
          zone: "SALON",
          positionX: null,
          positionY: null,
          width: null,
          height: null,
          barSeatIndex: null,
          groupedIntoTableId: null,
          state: "OPEN",
          activeTicket: {
            id: TICKET_1,
            total: "1.65",
            diners: 2,
            openedAt: new Date().toISOString(),
            openedByEmail: "caja1@bar.es",
            lineCount: 1,
          },
          createdAt: new Date().toISOString(),
        } satisfies ApiTable,
      ],
    });

    const onPickTable = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <TableMapScreen
          cashierLabel="caja1@bar.es"
          storeName="Bar Test"
          registerName="Caja 1"
          onPickTable={onPickTable}
          onQuickSale={vi.fn()}
          onLogoutCashier={vi.fn()}
          onCloseShift={vi.fn()}
        />,
      );
    });
    await settle();

    expect(container.textContent).toContain("cobro pendiente");
    const card = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Mesa 1"),
    ) as HTMLButtonElement;
    expect(card).not.toBeNull();
    expect(card.disabled).toBe(true);

    await click(card);
    expect(onPickTable).not.toHaveBeenCalled();
  });
});
