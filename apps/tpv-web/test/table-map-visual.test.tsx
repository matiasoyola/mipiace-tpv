// v1.9.3-mapa-visual · render del lienzo espacial y cobro desde tarjeta.
//
// Mismo patrón sin testing-library que table-map-offline.test.tsx:
// createRoot + act + eventos nativos + DOM queries.
//
// Cubre:
//   - Estados de tarjeta: libre / ocupada / BILLING / olvidada (+45 min)
//     / absorbida (grupo fundido).
//   - Cabecera de sala: "N abiertas · M libres · X,XX € en sala".
//   - Botón «Cobrar X €» SÓLO en BILLING, que abre el modal de cobro
//     (CheckoutOverlay) con la proyección FRESCA del DRAFT (GET
//     /tickets/:id) — mismo tableTicketId/tableId, total recalculado.
//   - Gate del componente: sin mesas → EmptyState.
//   - Barra ordenada por barSeatIndex.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
const streamMock = vi.hoisted(() => ({ status: "open" as string }));
// Captura de props del modal de cobro (mockeado): el CheckoutOverlay real
// arrastra impresión/outbox; aquí sólo nos interesa CON QUÉ se monta.
const checkoutMock = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  mounts: 0,
}));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});
vi.mock("../src/hooks/useStoreEventStream.js", () => ({
  useStoreEventStream: () => streamMock.status,
}));
vi.mock("../src/lib/catalog.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/catalog.js")>(
    "../src/lib/catalog.js",
  );
  return {
    ...actual,
    getCachedBusinessType: () => "HOSPITALITY",
    getCachedCreditSalesEnabled: () => false,
  };
});
vi.mock("../src/pages/CheckoutPage.js", () => ({
  CheckoutOverlay: (props: Record<string, unknown>) => {
    checkoutMock.props = props;
    checkoutMock.mounts += 1;
    return null;
  },
}));

import { TableMapScreen, type ApiTable } from "../src/pages/TableMapScreen.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const BASE_MS = Date.parse("2026-07-05T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(BASE_MS - m * 60_000).toISOString();

function table(over: Partial<ApiTable> & { id: string; name: string }): ApiTable {
  return {
    capacity: 4,
    zone: "SALON",
    positionX: null,
    positionY: null,
    width: null,
    height: null,
    barSeatIndex: null,
    groupedIntoTableId: null,
    state: "FREE",
    activeTicket: null,
    createdAt: minutesAgo(0),
    ...over,
  };
}

function ticket(over: Partial<NonNullable<ApiTable["activeTicket"]>>) {
  return {
    id: "tk",
    total: "0.00",
    diners: 2,
    openedAt: minutesAgo(5),
    openedByEmail: "caja1@bar.es",
    openedByAlias: null,
    lineCount: 1,
    ...over,
  };
}

// DRAFT fresco que devuelve GET /tickets/:id — una línea de 10,00 € sin
// IVA → computeCart total = 10.
const FRESH_DRAFT = {
  ticket: {
    id: "tk-M3",
    status: "DRAFT",
    externalId: "ext-1",
    tableId: "M3",
    table: { id: "M3", name: "M3", zone: "SALON", capacity: 4 },
    diners: 2,
    total: "10.00",
    createdAt: minutesAgo(48),
    lines: [
      {
        id: "l1",
        productId: "p1",
        variantId: null,
        holdedProductId: null,
        sku: "SKU1",
        nameSnapshot: "Café",
        units: 1,
        unitPrice: 10,
        discountPct: 0,
        taxRate: 0,
        subtotal: 10,
        total: 10,
        modifiers: null,
      },
    ],
  },
};

let container: HTMLDivElement;
let root: Root;
const onPickTable = vi.fn();

function defaultProps() {
  return {
    cashierLabel: "caja1@bar.es",
    storeName: "Bar Test",
    registerName: "Caja 1",
    registerId: "reg-1",
    shiftId: "shift-1",
    cashierRole: "CASHIER" as const,
    onPickTable,
    onQuickSale: vi.fn(),
    onLogoutCashier: vi.fn(),
    onCloseShift: vi.fn(),
  };
}

function tablesResponse(tables: ApiTable[]) {
  return { storeId: "s1", registerId: "reg-1", tables };
}

async function renderWith(tables: ApiTable[]) {
  apiMock.apiWithCashier.mockImplementation((path: string) => {
    if (path === "/tpv/tables") return Promise.resolve(tablesResponse(tables));
    if (path.startsWith("/tickets/")) return Promise.resolve(FRESH_DRAFT);
    return Promise.reject(new Error("unexpected path " + path));
  });
  await act(async () => {
    root.render(<TableMapScreen {...defaultProps()} />);
  });
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
}

function cardByName(name: string): HTMLButtonElement {
  // La tarjeta principal es el primer botón cuyo texto empieza por el
  // nombre (evita casar "Cobrar …" u otras mesas que lo contengan).
  const btn = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.trim().startsWith(name),
  );
  if (!btn) throw new Error(`tarjeta ${name} no encontrada`);
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_MS);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onPickTable.mockClear();
  apiMock.apiWithCashier.mockReset();
  streamMock.status = "open";
  checkoutMock.props = null;
  checkoutMock.mounts = 0;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe("TableMapScreen · lienzo visual", () => {
  it("pinta los estados: libre, ocupada, BILLING, olvidada y absorbida", async () => {
    const tables: ApiTable[] = [
      table({ id: "M1", name: "M1" }), // libre
      table({
        id: "M2",
        name: "M2",
        state: "OPEN",
        activeTicket: ticket({
          id: "M2",
          total: "12.50",
          openedByAlias: "Lucía",
          openedAt: minutesAgo(6),
        }),
      }), // ocupada, principal del grupo
      table({
        id: "M5",
        name: "M5",
        state: "OPEN",
        groupedIntoTableId: "M2",
      }), // absorbida en M2
      table({
        id: "M3",
        name: "M3",
        state: "BILLING",
        activeTicket: ticket({ id: "M3", total: "10.00", openedAt: minutesAgo(48) }),
      }), // billing + olvidada (48 min)
      table({
        id: "M4",
        name: "M4",
        state: "OPEN",
        activeTicket: ticket({ id: "M4", total: "5.00", openedAt: minutesAgo(50) }),
      }), // ocupada + olvidada
    ];
    await renderWith(tables);

    // Ocupada: alias + total con coma.
    const m2 = cardByName("M2");
    expect(m2.className).toContain("bg-mipiace-coral-soft");
    expect(m2.textContent).toContain("LU"); // iniciales de "Lucía"
    expect(m2.textContent).toContain("12,50 €");
    // Grupo fundido: badge "+M5" y pax sumados (4+4).
    expect(m2.textContent).toContain("+M5");
    expect(m2.textContent).toContain("8 PAX");

    // Absorbida: atenuada + "— unida a M2".
    const m5 = cardByName("M5");
    expect(m5.className).toContain("opacity-55");
    expect(m5.textContent).toContain("unida a M2");

    // BILLING: badge CUENTA + halo olvidada (48 min ≥ 45).
    const m3 = cardByName("M3");
    expect(m3.className).toContain("bg-amber-100");
    expect(m3.textContent).toContain("CUENTA");
    expect(m3.className).toContain("ring-inset");

    // Ocupada olvidada (50 min): halo ámbar aunque no esté en BILLING.
    expect(cardByName("M4").className).toContain("ring-inset");

    // Libre: sin total, sin cobrar.
    const m1 = cardByName("M1");
    expect(m1.className).toContain("bg-white");
    expect(m1.textContent).not.toContain("€");
  });

  it("cabecera de sala: N abiertas · M libres · X,XX € en sala", async () => {
    const tables: ApiTable[] = [
      table({ id: "L1", name: "L1" }),
      table({ id: "L2", name: "L2" }),
      table({ id: "L3", name: "L3" }),
      table({
        id: "O1",
        name: "O1",
        state: "OPEN",
        activeTicket: ticket({ id: "O1", total: "12.50" }),
      }),
      table({
        id: "O2",
        name: "O2",
        state: "BILLING",
        activeTicket: ticket({ id: "O2", total: "10.00" }),
      }),
    ];
    await renderWith(tables);
    const text = container.textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).toContain("2 abiertas · 3 libres · 22,50 € en sala");
  });

  it("«Cobrar» sólo en BILLING y abre el modal con el total FRESCO del DRAFT", async () => {
    const tables: ApiTable[] = [
      table({ id: "M1", name: "M1" }), // libre
      table({
        id: "M2",
        name: "M2",
        state: "OPEN",
        activeTicket: ticket({ id: "M2", total: "12.50" }),
      }), // ocupada
      table({
        id: "M3",
        name: "M3",
        state: "BILLING",
        activeTicket: ticket({ id: "tk-M3", total: "9.99" }),
      }), // billing
    ];
    await renderWith(tables);

    // Sólo la mesa BILLING ofrece Cobrar.
    const cobrar = buttonByText("Cobrar");
    expect(cobrar).toBeTruthy();
    expect(cobrar!.textContent).toContain("Cobrar 9,99 €");
    // Ni la libre ni la ocupada tienen botón de cobro.
    expect(cardByName("M1").textContent).not.toContain("Cobrar");
    expect(cardByName("M2").textContent).not.toContain("Cobrar");

    // Click Cobrar → GET fresco + modal montado.
    await act(async () => {
      cobrar!.click();
    });
    // Flush del GET /tickets/:id y del import diferido del overlay.
    for (let i = 0; i < 6 && checkoutMock.props === null; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    }

    expect(apiMock.apiWithCashier).toHaveBeenCalledWith("/tickets/tk-M3");
    expect(checkoutMock.mounts).toBeGreaterThan(0);
    expect(checkoutMock.props?.tableTicketId).toBe("tk-M3");
    expect(checkoutMock.props?.tableId).toBe("M3");
    // Total recalculado desde el DRAFT fresco (línea 10,00 sin IVA), NO
    // el 9,99 del listado.
    expect(
      (checkoutMock.props?.totals as { total: number }).total,
    ).toBe(10);
    expect(checkoutMock.props?.shiftId).toBe("shift-1");
    expect(checkoutMock.props?.registerId).toBe("reg-1");
  });

  it("sin mesas: EmptyState (gate del componente)", async () => {
    await renderWith([]);
    expect(container.textContent).toContain("aún no tiene mesas");
  });

  it("barra: taburetes ordenados por barSeatIndex", async () => {
    const tables: ApiTable[] = [
      table({ id: "B1", name: "B1", zone: "BARRA", barSeatIndex: 2 }),
      table({ id: "B2", name: "B2", zone: "BARRA", barSeatIndex: 0 }),
      table({ id: "B3", name: "B3", zone: "BARRA", barSeatIndex: 1 }),
    ];
    await renderWith(tables);
    const names = [...container.querySelectorAll("button")]
      .map((b) => b.textContent?.trim() ?? "")
      .filter((t) => /^B[123]$/.test(t));
    expect(names).toEqual(["B2", "B3", "B1"]);
  });
});
