// El importe de la tarjeta de mesa va en SU PROPIA línea.
//
// Complemento estructural de `room-grid-importe.test.ts`: aquél mide la
// aritmética (cabe o no cabe en 168 y en 153), éste fija que el
// componente no vuelva a meter el importe en la misma fila que el
// camarero, que es lo que lo sacaba de la tarjeta en el AP13.
//
// jsdom no hace layout: no se miden rects, se comprueba la estructura
// que hace imposible el desbordamiento —el pie es una columna, el
// importe no se parte y no comparte caja con el alias—. Mismo patrón sin
// testing-library que `table-map-tamano-unico.test.tsx`.

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
vi.mock("../src/hooks/useStoreEventStream.js", () => ({
  useStoreEventStream: () => "open",
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
import {
  LONGEST_TABLE_AMOUNT,
  roundTableAmountFits,
} from "../src/lib/roomGrid.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const BASE_MS = Date.parse("2026-10-07T20:00:00.000Z");

// La M2 del hallazgo: camarero de email largo (el que quedaba en
// "m.oyola+mae…") y un importe de cuatro cifras, el peor caso.
const SALA: ApiTable[] = [
  {
    id: "M2",
    name: "M2",
    capacity: 4,
    zone: "SALON",
    positionX: null,
    positionY: null,
    width: null,
    height: null,
    barSeatIndex: null,
    groupedIntoTableId: null,
    state: "OPEN",
    createdAt: new Date(BASE_MS).toISOString(),
    activeTicket: {
      id: "tk-M2",
      total: "1234.50",
      diners: 4,
      openedAt: new Date(BASE_MS - 4 * 60_000).toISOString(),
      openedByEmail: "m.oyola+maestranza-ensayo@mipiace.es",
      openedByAlias: null,
      lineCount: 6,
    },
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderSala() {
  apiMock.apiWithCashier.mockImplementation((path: string) => {
    if (path === "/tpv/tables")
      return Promise.resolve({
        storeId: "s1",
        registerId: "reg-1",
        tables: SALA,
      });
    return Promise.reject(new Error("unexpected path " + path));
  });
  await act(async () => {
    root.render(
      <TableMapScreen
        cashierLabel="m.oyola+maestranza-ensayo@mipiace.es"
        storeName="La Maestranza"
        registerName="Caja 1"
        registerId="reg-1"
        shiftId="shift-1"
        cashierRole="CASHIER"
        onPickTable={vi.fn()}
        onQuickSale={vi.fn()}
        onLogoutCashier={vi.fn()}
        onCloseShift={vi.fn()}
      />,
    );
  });
}

function importe(): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    "[data-testid='table-card-amount']",
  );
  if (!el) throw new Error("no se pinta el importe de la mesa");
  return el;
}

const clases = (el: Element) => el.getAttribute("class") ?? "";

describe("El importe de la mesa ocupada va en su propia línea", () => {
  it("se pinta el importe completo, con su €", async () => {
    await renderSala();
    expect(importe().textContent).toContain("1234,50");
    expect(importe().textContent).toContain("€");
  });

  it("el importe no se parte en dos líneas", async () => {
    await renderSala();
    expect(clases(importe())).toContain("whitespace-nowrap");
  });

  it("el importe no se trunca nunca", async () => {
    // v2-H1 · el hallazgo del AP13 era que el importe compartía fila con
    // el camarero y, con `shrink-0`, en vez de recortarse DESBORDABA: el
    // € acabó 25 px físicos más allá del borde de la tarjeta.
    //
    // La forma nueva lo resuelve por construcción y de otra manera: el
    // contenido de la mesa es una COLUMNA centrada de tres líneas
    // —nombre, importe, meta— y el camarero ya no está en ella (se fue
    // al `title`, ver `TableCard`). O sea que no hay nadie con quien
    // compartir fila. Lo que se sigue afirmando es lo que importa: el
    // importe no se recorta y no se parte.
    await renderSala();
    expect(clases(importe())).not.toContain("truncate");
    expect(clases(importe())).not.toContain("overflow-hidden");
  });

  it("la columna de la mesa es eso, una columna", async () => {
    await renderSala();
    const forma = importe().closest('[data-testid="table-shape"]')!;
    expect(clases(forma)).toContain("flex-col");
    // La fila que desbordaba era `flex-wrap ... justify-between`.
    expect(clases(forma)).not.toContain("flex-wrap");
  });

  it("el importe cabe DENTRO del círculo, medido con la cuerda", async () => {
    // El complemento aritmético de esto vive en
    // `room-grid-importe.test.ts`, y en la forma redonda la cuenta
    // cambia: el ancho útil de un círculo a la altura del importe no es
    // el lado, es la cuerda. Medir contra el lado daría «cabe» a un
    // importe que el círculo recorta por los lados.
    expect(roundTableAmountFits(LONGEST_TABLE_AMOUNT)).toBe(true);
  });
});
