// v1.23-las-mesas-miden-lo-mismo · el mapa pinta TODA mesa con el mismo
// tamaño, en las cuatro zonas y en las dos vistas.
//
// v2-H1-venta-y-sala · la invariante NO cambia; cambia cómo se afirma.
//
// La decisión 8 pide mesas como FORMAS del local —taburetes redondos en
// la barra, rectángulos en el salón, redondas en la terraza— y la maqueta
// las pinta además de tres tamaños distintos. Eso último es exactamente
// el bug que v1.23 mató (509 × 118 / 124 × 118 / 84 × 84 para la misma
// mesa de cuatro), y el propio prompt lo zanja: «mismo tamaño de mesa en
// todas las zonas». Así que **la forma cambia por zona y el tamaño no**,
// y lo que este fichero vigila sigue siendo lo segundo.
//
// Lo que cambia en la MANERA de vigilarlo, y es a mejor: el tamaño ya no
// entra por una clase literal de Tailwind (`TABLE_CARD_SIZE_CLASS`, que
// obligaba a tener el número escrito dos veces y a un test que
// comprobara que no se separaban) sino por `style` con la constante
// `TABLE_SHAPE_SIZE`. Se puede afirmar el píxel directamente, y ya no
// existe el hueco por el que un `!w-[124px]` colado en un envoltorio se
// escapaba de jsdom.
//
// jsdom sigue sin hacer layout: lo que NO se puede afirmar aquí es cómo
// reparte el navegador las bandas ni que la sala entre sin desplazar.
// Eso va en el bucle visual, con sus medidas, en el `-done`.
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
import {
  TABLE_SHAPE_RADIUS,
  TABLE_SHAPE_SIZE,
} from "../src/lib/roomGrid.js";

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

/** Las formas de mesa del lienzo, una por mesa visible. */
function formasDeMesa(): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>('[data-testid="table-shape"]'),
  ];
}

/** El tamaño que cada forma lleva PUESTO, leído del `style`. */
function tamanos(): string[] {
  return formasDeMesa().map((el) => `${el.style.width}x${el.style.height}`);
}

/**
 * Las rejillas de mesas del lienzo: una por zona visible. Se identifican
 * por contener formas, no por su clase — así el test sigue valiendo si la
 * clase cambia, y cae si la rejilla deja de ser la compartida.
 */
function rejillasDeMesas(): Element[] {
  const padres = new Set<Element>();
  for (const forma of formasDeMesa()) {
    // La forma ocupada va dentro de un envoltorio `relative` (para el
    // botón «Cobrar»), así que se sube un nivel más cuando hace falta.
    const grid = forma.closest('[data-testid="room-grid"]');
    if (grid) padres.add(grid);
  }
  return [...padres];
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
  it("TODA mesa del lienzo mide exactamente lo mismo", async () => {
    await renderSala();
    // Una forma por mesa: Salón (4, una de ellas absorbida), Terraza (2),
    // Reservados (1) y Barra (2).
    expect(formasDeMesa()).toHaveLength(SALA.length);
    // Y un solo tamaño entre todas. Esto es la invariante de v1.23 dicha
    // en píxeles en vez de en nombres de clase: antes había que
    // comprobar aparte que la clase y la constante no se habían
    // separado, y aun así un `!w-[124px]` colado en un envoltorio se
    // escapaba de jsdom. Ahora no hay por dónde.
    const unicos = new Set(tamanos());
    expect([...unicos]).toEqual([`${TABLE_SHAPE_SIZE}px x${TABLE_SHAPE_SIZE}px`.replace(" ", "")]);
  });

  it("ninguna mesa lleva una medida ADEMÁS de la compartida", async () => {
    await renderSala();
    // Una zona podría añadir la suya encima (`!w-[124px]`) y seguir
    // pasando el test de arriba si el tamaño viviera en clases. Con el
    // tamaño en `style` lo que hay que prohibir es la clase de ancho o
    // alto, que es lo que pisaría el `style` si llevara `!`.
    const medidaSuelta = /^!?(sm:|md:|lg:|xl:|2xl:)?(min-|max-)?[wh]-/;
    // `w-full` / `h-full` SÍ se permiten, y es importante que se
    // permitan: no son una medida, son «llena a tu padre», que es
    // justamente lo que mantiene el tamaño en UN sitio. La forma ocupada
    // vive dentro de un envoltorio que lleva el `style` con el lado, y
    // el botón de dentro lo rellena.
    const rellenar = ["w-full", "h-full"];
    for (const el of formasDeMesa()) {
      const sobra = clases(el).filter(
        (c) => medidaSuelta.test(c) && !rellenar.includes(c),
      );
      expect(sobra).toEqual([]);
    }
  });

  it("la FORMA cambia por zona y el tamaño no", async () => {
    await renderSala();
    // Decisión 8 · taburete redondo en la barra, rectángulo de esquina
    // blanda en el salón, redonda en la terraza. Lo único que distingue
    // una zona de otra es el radio.
    const porZona = new Map<string, Set<string>>();
    for (const el of formasDeMesa()) {
      const zona = el.getAttribute("data-zone") ?? "?";
      const radios = porZona.get(zona) ?? new Set<string>();
      radios.add(el.style.borderRadius);
      porZona.set(zona, radios);
    }
    // Dentro de una zona, un solo radio.
    for (const radios of porZona.values()) expect(radios.size).toBe(1);
    // La barra y la terraza son círculos (radio = mitad del lado); el
    // salón y los reservados, no.
    expect(porZona.get("BARRA")).toEqual(
      new Set([`${TABLE_SHAPE_RADIUS.BARRA}px`]),
    );
    expect(porZona.get("TERRAZA")).toEqual(
      new Set([`${TABLE_SHAPE_RADIUS.TERRAZA}px`]),
    );
    expect(porZona.get("SALON")).toEqual(
      new Set([`${TABLE_SHAPE_RADIUS.SALON}px`]),
    );
    expect(TABLE_SHAPE_RADIUS.BARRA).toBe(TABLE_SHAPE_SIZE / 2);
    expect(TABLE_SHAPE_RADIUS.SALON).toBeLessThan(TABLE_SHAPE_SIZE / 2);
  });

  it("la barra no vuelve a los círculos de 84 px de v1.9.3", async () => {
    await renderSala();
    const barra = formasDeMesa().filter(
      (el) => el.getAttribute("data-zone") === "BARRA",
    );
    expect(barra.length).toBeGreaterThan(0);
    for (const el of barra) {
      expect(el.style.width).toBe(`${TABLE_SHAPE_SIZE}px`);
    }
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

  it("las columnas salen del ancho, no de un grid-cols-N", async () => {
    await renderSala();
    // Es el punto del bloque v1.23 y sigue vigente: la rejilla de una
    // zona es `flex-wrap` con formas de tamaño fijo, así que el número
    // de columnas lo decide el ancho disponible. Un `grid-cols-N` lo
    // fijaría de antemano y volvería a dar dos columnas en 1.050 px y
    // dos en 300, que es de donde salía el ×4 de ancho.
    const rejillas = rejillasDeMesas();
    expect(rejillas.length).toBeGreaterThan(0);
    for (const el of rejillas) {
      expect(clases(el)).toContain("flex");
      expect(clases(el)).toContain("flex-wrap");
    }
    // Y ninguna rejilla fija columnas, en ningún breakpoint.
    const sospechosas = [...container.querySelectorAll("[class]")].filter((el) =>
      clases(el).some((c) => /^((sm|md|lg|xl|2xl):)?grid-cols-/.test(c)),
    );
    expect(sospechosas).toHaveLength(0);
  });

  it("la vista filtrada por zona usa el mismo tamaño que la vista «Todas»", async () => {
    await renderSala();
    const todas = formasDeMesa();
    await filtrarPor("Terraza");
    const filtradas = formasDeMesa();
    expect(filtradas).toHaveLength(2);
    for (const el of filtradas) {
      expect(el.style.width).toBe(`${TABLE_SHAPE_SIZE}px`);
      expect(el.style.height).toBe(`${TABLE_SHAPE_SIZE}px`);
    }
    expect(todas.length).toBeGreaterThan(filtradas.length);
  });

  it("filtrando por Barra se sigue viendo el mostrador de la zona", async () => {
    await renderSala();
    await filtrarPor("Barra");
    expect(container.textContent).toContain("BARRA");
    expect(
      container.querySelector('[data-testid="bar-counter"]'),
    ).not.toBeNull();
    expect(formasDeMesa()).toHaveLength(2);
  });

  it("la BARRA es la primera banda del lienzo", async () => {
    await renderSala();
    // Decisión 8 · iba la última desde v1.9.3, residuo de cuando sus
    // sitios eran taburetes de 84 px, y en el AP13 empezaba fuera de
    // pantalla. En un bar es lo primero que se mira.
    const rotulos = [
      ...container.querySelectorAll<HTMLElement>('[data-zone-label]'),
    ].map((el) => el.getAttribute("data-zone-label"));
    expect(rotulos[0]).toBe("BARRA");
  });
});
