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
//     /tickets/:id) — mismo draftTicketId/tableId, total recalculado.
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
    getCachedCrmEnabled: () => false,
    getCachedAgendaEnabled: () => false,
    // catalogo-local (addendum 3) · default TRUE, como en la caché real:
    // un TPV que no ha refrescado se comporta como antes del bloque.
    getCachedHoldedEnabled: () => true,
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
import {
  TABLE_BILLING_FILL,
  TABLE_BUSY_FILL,
  TABLE_FREE_FILL,
  TABLE_LATE_RING,
} from "../src/lib/hospitalityTheme.js";

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

/**
 * La forma de una mesa por su nombre.
 *
 * Se busca entre las formas (`data-testid="table-shape"`) y no entre
 * todos los botones: el botón «Cobrar X €» de una mesa en BILLING vive
 * al lado de la forma, no dentro, así que un `querySelectorAll("button")`
 * podría devolverlo a él.
 */
function formaDeMesa(name: string): HTMLElement {
  const el = [
    ...container.querySelectorAll<HTMLElement>('[data-testid="table-shape"]'),
  ].find((b) => b.textContent?.trim().startsWith(name));
  if (!el) throw new Error(`forma de mesa ${name} no encontrada`);
  return el;
}

/**
 * El hex del token tal y como lo devuelve `style.background` en jsdom
 * (que normaliza a `rgb(...)`). Compara contra el TOKEN y no contra un
 * literal: si el token cambia, el test sigue diciendo la verdad; si un
 * componente se inventa un hex, deja de coincidir.
 */
function hexToRgb(hex: string): string {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
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

    // v2-H1 · los estados se afirman por `data-state` y por el relleno
    // que la forma lleva PUESTO, no por clases de Tailwind: el tema
    // oscuro sale de `hospitalityTheme.ts` y se pinta por `style`, que es
    // lo que impide que un hex suelto se cuele en un componente.

    // Ocupada: coral pleno, total con coma.
    const m2 = formaDeMesa("M2");
    expect(m2.getAttribute("data-state")).toBe("busy");
    expect(m2.style.background).toBe(hexToRgb(TABLE_BUSY_FILL));
    expect(m2.textContent).toContain("12,50 €");
    // El alias del camarero sale de la FORMA (no caben cuatro líneas en
    // 144 px) y se queda en el `title`, a la vista del puntero y del
    // lector de pantalla. Dentro de la mesa lo pinta la comanda.
    expect(m2.getAttribute("title")).toContain("Lucía");
    // Grupo fundido: badge "+M5".
    expect(m2.textContent).toContain("+M5");

    // Absorbida: atenuada + "unida a M2".
    const m5 = formaDeMesa("M5");
    expect(m5.className).toContain("opacity-55");
    expect(m5.textContent).toContain("unida a M2");

    // BILLING: ámbar + «cuenta» + aro de olvidada (48 min ≥ 45).
    const m3 = formaDeMesa("M3");
    expect(m3.getAttribute("data-state")).toBe("billing");
    expect(m3.style.background).toBe(hexToRgb(TABLE_BILLING_FILL));
    // v2-H1 · con el botón «Cobrar X €» delante, la meta «cuenta» no se
    // pinta: el botón ya dice qué pasa con esta mesa, y en una forma de
    // 144 px las dos cosas se pisan (lo vio el bucle visual en la T2 de
    // La Maestranza). El estado se lee del relleno ámbar y del botón.
    const cobrar = m3
      .closest("div")!
      .querySelector('[data-testid="table-cobrar"]');
    expect(cobrar).not.toBeNull();
    expect(cobrar!.textContent).toContain("Cobrar");
    expect(m3.getAttribute("data-late")).toBe("true");
    // El aro sigue el radio de la forma: va por `box-shadow`, no por un
    // `ring` cuadrado alrededor de un círculo.
    // `boxShadow` lo devuelve jsdom tal cual se escribió (no lo
    // normaliza a `rgb()` como hace con `background`), así que aquí se
    // compara contra el token en hex.
    expect(m3.style.boxShadow).toContain(TABLE_LATE_RING);

    // Ocupada olvidada (50 min): aro ámbar aunque no esté en BILLING.
    expect(formaDeMesa("M4").getAttribute("data-late")).toBe("true");

    // Libre: lo MÁS claro del lienzo, sin importe.
    const m1 = formaDeMesa("M1");
    expect(m1.getAttribute("data-state")).toBe("free");
    expect(m1.style.background).toBe(hexToRgb(TABLE_FREE_FILL));
    expect(m1.textContent).not.toContain("€");
  });

  // v2-H1 · decisión 8 · la cabecera dice «N abiertas · X €».
  //
  // El «M libres» se va: con la mesa libre siendo ahora lo más claro del
  // lienzo, contarlas es repetir con un número lo que la sala ya dice de
  // un vistazo. El CÁLCULO no se toca —sigue saliendo de
  // `summarizeOpenTables`, el módulo que v1.22 comparte con el aviso de
  // mesas abiertas del cierre— y eso es lo que el prompt protege.
  it("cabecera de sala: N abiertas · X,XX €", async () => {
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
    expect(text).toContain("2 abiertas · 22,50 €");
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
    expect(checkoutMock.props?.draftTicketId).toBe("tk-M3");
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

  it("barra: mesas ordenadas por barSeatIndex", async () => {
    const tables: ApiTable[] = [
      table({ id: "B1", name: "B1", zone: "BARRA", barSeatIndex: 2 }),
      table({ id: "B2", name: "B2", zone: "BARRA", barSeatIndex: 0 }),
      table({ id: "B3", name: "B3", zone: "BARRA", barSeatIndex: 1 }),
    ];
    await renderWith(tables);
    // v1.23 · la barra ya no pinta taburetes de 84 px con el nombre y
    // nada más: pinta LA MISMA tarjeta que el resto de la sala, así que
    // el texto del botón trae también el PAX.
    const names = [...container.querySelectorAll("button")]
      .map((b) => b.textContent?.trim() ?? "")
      .filter((t) => /^B[123]/.test(t))
      .map((t) => t.slice(0, 2));
    expect(names).toEqual(["B2", "B3", "B1"]);
  });
});
