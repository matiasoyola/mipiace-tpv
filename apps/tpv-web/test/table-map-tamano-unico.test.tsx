// v1.23-las-mesas-miden-lo-mismo · el mapa pinta TODA mesa con el mismo
// tamaño, en las cuatro zonas y en las dos vistas.
//
// jsdom no hace layout, así que esto no mide rects: comprueba que el
// tamaño sale de UN sitio (`TABLE_CARD_SIZE_CLASS`) y que el lienzo ya
// no lleva ninguna de las dos piezas que daban cuatro tamaños a la misma
// mesa — la columna fija de 300 px y el `grid-cols-2`. Los rects de
// verdad van en el bucle visual con Playwright (ver el `-done`).
//
// Mismo patrón sin testing-library que `table-map-visual.test.tsx`.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
const streamMock = vi.hoisted(() => ({ status: "open" as string }));

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
    getCachedHoldedEnabled: () => true,
    getCachedCreditSalesEnabled: () => false,
  };
});
vi.mock("../src/pages/CheckoutPage.js", () => ({
  CheckoutOverlay: () => null,
}));

import { TableMapScreen, type ApiTable } from "../src/pages/TableMapScreen.js";
import { TABLE_CARD_SIZE_CLASS } from "../src/lib/roomGrid.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const BASE_MS = Date.parse("2026-10-06T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(BASE_MS - m * 60_000).toISOString();

function table(
  over: Partial<ApiTable> & { id: string; name: string },
): ApiTable {
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

// La sala del AP13 (La Maestranza) con una mesa ocupada, una pidiendo
// cuenta, una absorbida y las cuatro de barra.
const SALA: ApiTable[] = [
  table({ id: "M1", name: "M1" }),
  table({
    id: "M2",
    name: "M2",
    state: "OPEN",
    activeTicket: {
      id: "tk-M2",
      total: "55.00",
      diners: 4,
      openedAt: minutesAgo(16),
      openedByEmail: "lamaestranza@bar.es",
      openedByAlias: "lamaestranza",
      lineCount: 11,
    },
  }),
  table({ id: "M3", name: "M3", state: "OPEN", groupedIntoTableId: "M2" }),
  table({
    id: "M4",
    name: "M4",
    state: "BILLING",
    activeTicket: {
      id: "tk-M4",
      total: "12.50",
      diners: 2,
      openedAt: minutesAgo(8),
      openedByEmail: "lamaestranza@bar.es",
      openedByAlias: "lamaestranza",
      lineCount: 3,
    },
  }),
  table({ id: "T1", name: "T1", zone: "TERRAZA" }),
  table({ id: "T2", name: "T2", zone: "TERRAZA" }),
  table({ id: "R1", name: "R1", zone: "RESERVADO" }),
  table({ id: "B1", name: "B1", zone: "BARRA", barSeatIndex: 0 }),
  table({ id: "B2", name: "B2", zone: "BARRA", barSeatIndex: 1 }),
];

let container: HTMLDivElement;
let root: Root;

function defaultProps() {
  return {
    cashierLabel: "lamaestranza@bar.es",
    storeName: "La Maestranza",
    registerName: "Caja 1",
    registerId: "reg-1",
    shiftId: "shift-1",
    cashierRole: "CASHIER" as const,
    onPickTable: vi.fn(),
    onQuickSale: vi.fn(),
    onLogoutCashier: vi.fn(),
    onCloseShift: vi.fn(),
  };
}

async function renderSala(tables: ApiTable[] = SALA) {
  apiMock.apiWithCashier.mockImplementation((path: string) => {
    if (path === "/tpv/tables")
      return Promise.resolve({ storeId: "s1", registerId: "reg-1", tables });
    return Promise.reject(new Error("unexpected path " + path));
  });
  await act(async () => {
    root.render(<TableMapScreen {...defaultProps()} />);
  });
}

/** Chip de zona del filtro ("Salón", "Terraza", "Barra"…). */
async function filtrarPor(label: string) {
  const chip = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.trim().startsWith(label),
  );
  if (!chip) throw new Error(`chip de zona ${label} no encontrado`);
  await act(async () => {
    chip.click();
  });
}

/**
 * Las cajas que ocupan una mesa en el lienzo. Son los elementos que
 * llevan la clase de tamaño compartida — y la gracia del test es
 * justamente contar que hay una por mesa: si una zona se saliera con su
 * propia clase, su mesa no aparecería aquí.
 */
function cajasDeMesa(): Element[] {
  // `getAttribute("class")` y no `.className`: los `<svg>` de los iconos
  // lo devuelven como `SVGAnimatedString`, que no tiene `.split`.
  return [...container.querySelectorAll("[class]")].filter((el) =>
    TABLE_CARD_SIZE_CLASS.split(" ").every((c) => clases(el).includes(c)),
  );
}

/** Las clases de un elemento, como lista. */
function clases(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_MS);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  apiMock.apiWithCashier.mockReset();
  streamMock.status = "open";
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe("mapa de sala · una mesa mide lo mismo esté donde esté", () => {
  it("las nueve mesas del lienzo llevan la MISMA clase de tamaño", async () => {
    await renderSala();
    // Una caja por mesa: Salón (4, una de ellas absorbida), Terraza (2),
    // Reservados (1) y Barra (2). Ninguna zona con tamaño propio.
    expect(cajasDeMesa()).toHaveLength(SALA.length);
  });

  it("ninguna mesa lleva una medida ADEMÁS de la compartida", async () => {
    await renderSala();
    // La clase compartida no basta: una zona podría añadir la suya
    // encima (`!w-[124px]`) y seguir pasando el test de arriba.
    const compartidas = TABLE_CARD_SIZE_CLASS.split(" ");
    const medidaSuelta = /^!?(sm:|md:|lg:|xl:)?(min-|max-)?[wh]-/;
    for (const el of cajasDeMesa()) {
      const sobra = clases(el).filter(
        (c) => medidaSuelta.test(c) && !compartidas.includes(c),
      );
      expect(sobra).toEqual([]);
    }
  });

  it("la barra ya no pinta círculos de 84 px: mide como una mesa", async () => {
    await renderSala();
    const barra = [...container.querySelectorAll("[class]")].filter(
      (el) =>
        /^B[12]/.test(el.textContent?.trim() ?? "") &&
        clases(el).includes("rounded-[18px]"),
    );
    expect(barra.length).toBeGreaterThan(0);
    // El taburete de v1.9.3 era `w-[84px] h-[84px] rounded-full`.
    const html = container.innerHTML;
    expect(html).not.toContain("w-[84px]");
    expect(html).not.toContain("h-[84px]");
  });

  it("el lienzo no reserva una columna fija de 300 px para Terraza", async () => {
    await renderSala();
    const sospechosas = [...container.querySelectorAll("[class]")].filter((el) =>
      (el.getAttribute("class") ?? "").includes("300px"),
    );
    expect(sospechosas).toHaveLength(0);
  });

  it("ninguna zona se pinta con dos columnas fijas", async () => {
    await renderSala();
    const sospechosas = [...container.querySelectorAll("[class]")].filter((el) =>
      clases(el).some((c) => c === "grid-cols-2" || c.endsWith(":grid-cols-2")),
    );
    expect(sospechosas).toHaveLength(0);
  });

  it("la vista filtrada por zona usa el mismo tamaño que la vista «Todas»", async () => {
    await renderSala();
    const todas = cajasDeMesa();
    await filtrarPor("Terraza");
    const filtradas = cajasDeMesa();
    expect(filtradas).toHaveLength(2);
    // Mismo tamaño que las de la vista «Todas»: la clase de tamaño está
    // en las dos y no hay ninguna clase de ancho alternativa.
    for (const el of filtradas) {
      for (const c of TABLE_CARD_SIZE_CLASS.split(" ")) {
        expect(clases(el)).toContain(c);
      }
    }
    expect(todas.length).toBeGreaterThan(filtradas.length);
  });

  it("filtrando por Barra se sigue viendo el mostrador de la zona", async () => {
    await renderSala();
    await filtrarPor("Barra");
    expect(container.textContent).toContain("BARRA");
    expect(cajasDeMesa()).toHaveLength(2);
  });
});
