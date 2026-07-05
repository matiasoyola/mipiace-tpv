// v1.9.2-mesas-concurrencia · la mesa abierta escucha SU propia realidad
// y los errores del servidor se ven. Cubre los bugs A1/A2/A3/A5 del mapa
// de simulaciones (docs/auditorias/2026-07-05-mapa-simulaciones-bar.md):
//
//   (1) evento de línea remota refresca la proyección del DRAFT.
//   (2) ticket.paid remoto de MI mesa → expulsión al mapa con banner.
//   (3) checkout 400 PAYMENTS_MISMATCH → aviso + "Actualizar" recalcula.
//   (4) checkout 409 TICKET_ALREADY_PAID → cierra modal + banner en mapa.
//   (5) add-line a mesa muerta (TABLE_GROUPED) → banner con CTA al mapa.
//   (6) autocierre del modal de éxito en venta rápida.
//   (7) header: "Mesas" en venta rápida; hamburguesa + "Tickets" en mapa.
//
// Mismo patrón sin testing-library que table-sale-flow.test.tsx:
// createRoot + act + eventos nativos; el WS se mockea capturando el
// callback onEvent para poder disparar eventos a mano.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
// Captura del callback del WS + control del status para poder simular
// eventos remotos y reconexiones desde el test.
const wsMock = vi.hoisted(() => ({
  onEvent: null as ((ev: unknown) => void) | null,
  status: "open" as string,
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
  useStoreEventStream: (_storeId: unknown, onEvent: (ev: unknown) => void) => {
    wsMock.onEvent = onEvent;
    return wsMock.status;
  },
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
  syncUsbPairingWithServerConfig: vi.fn(async () => {}),
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));

import { ApiError } from "../src/api.js";
import { __resetOutboxForTests } from "../src/lib/outbox.js";
import {
  mapServerDraftLines,
  type ServerDraft,
  type ServerDraftLine,
} from "../src/lib/tableDraft.js";
import { SalePage, type TableContext } from "../src/pages/SalePage.js";
import { TableMapScreen } from "../src/pages/TableMapScreen.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const MESA_1 = "00000000-0000-0000-0000-0000000000a1";
const TICKET_1 = "00000000-0000-0000-0000-0000000000t1";

const tableContext: TableContext = {
  id: MESA_1,
  name: "1",
  zone: "SALON",
  capacity: 4,
  diners: 2,
  openedAt: new Date().toISOString(),
  openedByEmail: "caja1@bar.es",
  openedByAlias: null,
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
    table: { id: MESA_1, name: "1", zone: "SALON", capacity: 4 },
    diners: 2,
    total: "1.65",
    createdAt: new Date().toISOString(),
    lines,
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
const onBackToMap = vi.fn();
const onExitToMap = vi.fn();

beforeEach(async () => {
  await __resetOutboxForTests();
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  apiMock.apiWithCashier.mockReset();
  onBackToMap.mockReset();
  onExitToMap.mockReset();
  wsMock.onEvent = null;
  wsMock.status = "open";
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container.remove();
});

async function renderTableSalePage(
  initialLines: ServerDraftLine[],
): Promise<void> {
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
        onExitToMap={onExitToMap}
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

async function fireWs(ev: unknown) {
  await act(async () => {
    wsMock.onEvent?.(ev);
  });
  await settle();
}

describe("Frente 1 · la mesa escucha su propia realidad", () => {
  it("(1) table.lineAdded remoto refresca la proyección del DRAFT", async () => {
    apiMock.apiWithCashier.mockImplementation(
      async (path: string, opts?: { method?: string }) => {
        // Refetch tras el evento remoto: el DRAFT ahora tiene 2 líneas.
        if (path === `/tickets/${TICKET_1}` && (!opts?.method || opts.method === "GET")) {
          return {
            ticket: serverDraft([
              serverLine(),
              serverLine({
                id: "00000000-0000-0000-0000-0000000000l2",
                sku: "TOSTADA",
                nameSnapshot: "Tostada",
                unitPrice: "2.5",
                total: "2.75",
              }),
            ]),
          };
        }
        const bg = backgroundRoutes(path);
        if (bg !== undefined) return bg;
        throw new Error(`ruta inesperada: ${path}`);
      },
    );

    await renderTableSalePage([serverLine()]);
    expect(container.textContent).toContain("Café solo");
    expect(container.textContent).not.toContain("Tostada");

    // Otra caja añadió una línea a MI mesa.
    await fireWs({
      type: "table.lineAdded",
      tableId: MESA_1,
      ticketId: TICKET_1,
      line: { id: "l2", sku: "TOSTADA", nameSnapshot: "Tostada" },
      at: new Date().toISOString(),
    });

    // El panel refleja la verdad sin modal ni toast.
    expect(container.textContent).toContain("Tostada");
  });

  it("(2) ticket.paid remoto de MI mesa expulsa al mapa con banner", async () => {
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      const bg = backgroundRoutes(path);
      if (bg !== undefined) return bg;
      throw new Error(`ruta inesperada: ${path}`);
    });
    await renderTableSalePage([serverLine()]);

    await fireWs({
      type: "ticket.paid",
      ticketId: TICKET_1,
      internalNumber: "000009",
      registerId: "reg-OTHER",
      tableId: MESA_1,
      byEmail: "caja2@bar.es",
      totalEur: 1.65,
      at: new Date().toISOString(),
    });

    expect(onExitToMap).toHaveBeenCalledTimes(1);
    const notice = onExitToMap.mock.calls[0]![0] as { text: string };
    expect(notice.text).toContain("cobrada desde otra caja");
  });

  it("expulsión por absorción: table.grouped con MI mesa absorbida", async () => {
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      const bg = backgroundRoutes(path);
      if (bg !== undefined) return bg;
      throw new Error(`ruta inesperada: ${path}`);
    });
    await renderTableSalePage([serverLine()]);

    await fireWs({
      type: "table.grouped",
      mainTableId: "00000000-0000-0000-0000-0000000000a4",
      absorbedTableIds: [MESA_1],
      at: new Date().toISOString(),
    });

    expect(onExitToMap).toHaveBeenCalledTimes(1);
    const notice = onExitToMap.mock.calls[0]![0] as { text: string };
    expect(notice.text).toContain("se ha unido");
  });
});

describe("Frente 2 · los errores del servidor se ven", () => {
  it("(3) checkout 400 PAYMENTS_MISMATCH pinta aviso y Actualizar recalcula", async () => {
    apiMock.apiWithCashier.mockImplementation(
      async (path: string, opts?: { method?: string }) => {
        if (path === `/tickets/${TICKET_1}/checkout` && opts?.method === "POST") {
          throw new ApiError(
            400,
            "Σ payments (1.65) menor que total (4.40)",
            "PAYMENTS_MISMATCH",
          );
        }
        // Refetch (onRefetchTable): la cuenta ahora suma 4,40 €.
        if (path === `/tickets/${TICKET_1}` && (!opts?.method || opts.method === "GET")) {
          return {
            ticket: serverDraft([
              serverLine(),
              serverLine({
                id: "00000000-0000-0000-0000-0000000000l2",
                sku: "TOSTADA",
                nameSnapshot: "Tostada",
                units: "1",
                unitPrice: "2.5",
                total: "2.75",
              }),
            ]),
          };
        }
        const bg = backgroundRoutes(path);
        if (bg !== undefined) return bg;
        throw new Error(`ruta inesperada: ${path}`);
      },
    );

    await renderTableSalePage([serverLine()]);
    await click(buttonByText("Cobrar", false)); // abre el overlay
    await click(buttonByText("Cobrar")); // confirma → 400

    // Aviso inline dentro del modal + total recalculado (4,40 €).
    expect(container.textContent).toContain("La cuenta ha cambiado desde otra caja");
    expect(container.textContent).toContain("4,40");

    // "Actualizar" acepta el nuevo total y limpia el aviso.
    await click(buttonByText("Actualizar"));
    expect(container.textContent).not.toContain("La cuenta ha cambiado desde otra caja");
  });

  it("(4) checkout 409 TICKET_ALREADY_PAID cierra modal + banner en mapa", async () => {
    apiMock.apiWithCashier.mockImplementation(
      async (path: string, opts?: { method?: string }) => {
        if (path === `/tickets/${TICKET_1}/checkout` && opts?.method === "POST") {
          throw new ApiError(
            409,
            "Este ticket ya fue cobrado por otro dispositivo.",
            "TICKET_ALREADY_PAID",
          );
        }
        const bg = backgroundRoutes(path);
        if (bg !== undefined) return bg;
        throw new Error(`ruta inesperada: ${path}`);
      },
    );

    await renderTableSalePage([serverLine()]);
    await click(buttonByText("Cobrar", false));
    await click(buttonByText("Cobrar"));

    expect(onExitToMap).toHaveBeenCalledTimes(1);
    const notice = onExitToMap.mock.calls[0]![0] as { text: string };
    expect(notice.text).toContain("ya fue cobrada desde otra caja");
    // El modal ya no está montado (openSheet cerrado).
    expect(container.textContent).not.toContain("Total a cobrar");
  });

  it("(5) add-line a mesa muerta (TABLE_GROUPED) pinta banner con CTA", async () => {
    apiMock.apiWithCashier.mockImplementation(
      async (path: string, opts?: { method?: string }) => {
        if (path === `/tables/${MESA_1}/lines` && opts?.method === "POST") {
          throw new ApiError(
            409,
            "Esta mesa forma parte de un grupo.",
            "TABLE_GROUPED",
          );
        }
        const bg = backgroundRoutes(path);
        if (bg !== undefined) return bg;
        throw new Error(`ruta inesperada: ${path}`);
      },
    );

    await renderTableSalePage([]);
    await click(buttonByText("Café solo", false));

    expect(container.textContent).toContain(
      "Esta mesa ya no está abierta",
    );
    await click(buttonByText("Ir al mapa"));
    expect(onBackToMap).toHaveBeenCalled();
  });
});

describe("Frente 3 · navegación de bar", () => {
  it("(7) 'Mesas' visible en el header de venta rápida", async () => {
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      const bg = backgroundRoutes(path);
      if (bg !== undefined) return bg;
      throw new Error(`ruta inesperada: ${path}`);
    });
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
          tableContext={null}
          onBackToMap={onBackToMap}
          onExitToMap={onExitToMap}
          onTicketMovedToTable={null}
          onLogoutCashier={vi.fn()}
          onCloseShift={vi.fn()}
        />,
      );
    });
    await settle();

    const mesas = buttonByText("Mesas", false);
    await click(mesas);
    expect(onBackToMap).toHaveBeenCalled();
  });

  it("(7) hamburguesa + 'Tickets' visibles en el header del mapa", async () => {
    apiMock.apiWithCashier.mockResolvedValue({
      storeId: "store-1",
      registerId: "reg-1",
      tables: [],
    });
    root = createRoot(container);
    await act(async () => {
      root.render(
        <TableMapScreen
          cashierLabel="caja1@bar.es"
          storeName="Bar Test"
          registerName="Caja 1"
          shiftId="shift-1"
          cashierRole="CASHIER"
          onPickTable={vi.fn()}
          onQuickSale={vi.fn()}
          onLogoutCashier={vi.fn()}
          onCloseShift={vi.fn()}
        />,
      );
    });
    await settle();

    // Menú de caja + Tickets accesibles sin pasar por venta rápida.
    expect(
      container.querySelector('button[aria-label="Abrir menú"]'),
    ).not.toBeNull();
    const ticketsBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "Tickets",
    );
    expect(ticketsBtn).not.toBeUndefined();

    // Al abrir el menú aparecen Arqueo X y Cerrar turno.
    await act(async () => {
      (
        container.querySelector(
          'button[aria-label="Abrir menú"]',
        ) as HTMLButtonElement
      ).click();
    });
    await settle();
    expect(container.textContent).toContain("Arqueo X");
    expect(container.textContent).toContain("Cerrar turno");
  });
});
