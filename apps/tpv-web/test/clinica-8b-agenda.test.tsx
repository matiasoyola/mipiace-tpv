// clinica-8 (fase B, 17) · LA AGENDA DEL MOSTRADOR DE UNA CLÍNICA.
//
// Cuatro cosas de la auditoría del 18-10, en la pantalla por la que ahora
// se entra:
//
//   · 25 · «"Buscar hueco": las horas salen bajo el pliegue»;
//   · 27 · «Servicios de la cita sin orden útil» (17 líneas seguidas);
//   · 24 · «el estetoscopio abre "Salud de la agenda" con jerga interna»;
//   · 29 · «Agenda de una profesional: columna estrecha».
//
// El reparto de los servicios y el contador de uso son funciones puras y
// viven en `clinica-8b-puras.test.ts`; aquí se fija que la pantalla los
// usa y lo que sólo se ve en la pantalla.

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

// Los servicios de Rosario, con sus categorías. El orden del array es el
// del catálogo: es lo que la pantalla recibe y lo que había que ordenar.
const CATALOGO = vi.hoisted(() => [
  { sku: "POD-001", name: "Consulta diagnóstico", tag: "consulta", min: 20 },
  { sku: "POD-002", name: "Quiropodia básica", tag: "quiropodia", min: 30 },
  { sku: "POD-003", name: "Quiropodia completa", tag: "quiropodia", min: 30 },
  { sku: "POD-006", name: "Cura", tag: "cirugía", min: 15 },
  {
    sku: "POD-009",
    name: "Revisión biomecánica adultos",
    tag: "biomecánica",
    min: 15,
  },
].map((s, i) => ({
  id: `00000000-0000-0000-0000-0000000000s${i}`,
  holdedProductId: null,
  sku: s.sku,
  name: s.name,
  basePrice: 26,
  priceGross: 26,
  taxRate: 0,
  tags: [s.tag],
  kind: "SERVICE" as const,
  durationMin: s.min,
})));

vi.mock("../src/lib/catalog.js", () => ({
  loadCatalogFromCache: async () => CATALOGO,
  productImageUrl: () => null,
  getCachedClinicaEnabled: () => true,
}));

vi.mock("../src/lib/clients.js", () => ({
  clientFullName: (c: { firstName: string; lastName: string }) =>
    `${c.firstName} ${c.lastName}`.trim(),
  loadClientsFromCache: async () => [],
  asegurarClientesEnCache: async () => false,
}));

vi.mock("../src/hooks/useClientPicker.js", () => ({
  useClientPicker: () => ({
    open: () => {},
    close: () => {},
    isOpen: false,
    element: null,
  }),
}));

import { __resetOutboxForTests } from "../src/lib/outbox.js";
import { AgendaPage } from "../src/pages/AgendaPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Lunes 19-10-2026, 09:10 de pared en Madrid.
const AHORA = new Date("2026-10-19T07:10:00.000Z");
const HOY = "2026-10-19";

const ROSA = {
  userId: "00000000-0000-0000-0000-0000000000r1",
  displayName: "Rosa",
  color: "#e8663c",
  active: true,
};
const ANA = { ...ROSA, userId: "00000000-0000-0000-0000-0000000000r2", displayName: "Ana" };

const DIA = (ids: string[]) => ({
  date: HOY,
  open: [{ startTime: "09:00", endTime: "14:00" }],
  closed: null,
  specialName: null,
  staffOpen: Object.fromEntries(
    ids.map((id) => [id, [{ startTime: "09:00", endTime: "14:00" }]]),
  ),
  absences: [],
});

let container: HTMLDivElement;
let root: Root;
let staff: typeof ROSA[];
let matrizEditable: boolean;
let huecos: Array<{ start: string }>;
let scrolls: number;

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  await __resetOutboxForTests();
  localStorage.clear();
  staff = [ROSA];
  matrizEditable = true;
  huecos = [];
  scrolls = 0;
  // jsdom no implementa `scrollIntoView`: se cuenta que se llame, que es
  // lo que el arreglo hace.
  Element.prototype.scrollIntoView = function () {
    scrolls += 1;
  } as unknown as typeof Element.prototype.scrollIntoView;

  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string) => {
    if (path.startsWith("/agenda?")) {
      return {
        staff,
        appointments: [],
        slotMinutes: 15,
        days: [DIA(staff.map((s) => s.userId))],
        valoracionesPendientes: [],
        sesionesPorCobrar: [],
      };
    }
    if (path === "/agenda/availability") return { slots: huecos };
    if (path === "/agenda/health")
      return { generatedAt: AHORA.toISOString(), cards: [] };
    if (path === "/agenda/skill-matrix") {
      return {
        editable: matrizEditable,
        services: CATALOGO.map((c) => ({
          id: c.id,
          name: c.name,
          agendable: true,
          active: true,
          staffRequired: 1,
          // Todos los hace Rosa (y Ana cuando está): es la clínica de
          // una sola profesional, que es el caso de Rosario.
          staffUserIds: staff.map((x) => x.userId),
        })),
        staff: staff.map((s) => ({
          userId: s.userId,
          displayName: s.displayName,
          active: true,
          hasProfile: true,
        })),
        skills: [],
      };
    }
    throw new Error(`ruta no mockeada: ${path}`);
  });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function asentar() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  root = createRoot(container);
  await act(async () => {
    root.render(<AgendaPage onClose={() => {}} />);
  });
  await asentar();
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await asentar();
}

function porTexto(txt: string): HTMLElement | null {
  return (
    [...container.querySelectorAll<HTMLElement>("button")].find(
      (b) => (b.textContent ?? "").trim() === txt,
    ) ?? null
  );
}

/** Abre el panel tocando «Dar cita» (agenda-1: era «Nueva cita»). */
async function abrirAlta() {
  await click(container.querySelector<HTMLElement>('[data-test="dar-cita"]')!);
}

/**
 * Elige un servicio y pide las horas.
 *
 * agenda-1 · «Buscar hueco» YA NO EXISTE: la búsqueda sale de contestar
 * «¿Cuándo?», que es un toque menos y es el objetivo del bloque. Lo que se
 * sigue midiendo es lo mismo (punto 25 de la auditoría del 18-10: «las
 * horas salen bajo el pliegue»): que la tira se traiga a la vista y que
 * diga cuántas son.
 */
async function pedirHoras(servicio: string) {
  // DENTRO del panel, no en toda la pantalla: en la lista del tablero 1
  // una fila de cita también lleva el nombre del servicio, va antes en el
  // DOM, y tocarla abriría el detalle en vez de elegir el servicio.
  const panel = container.querySelector<HTMLElement>(
    '[data-test="panel-dar-cita"]',
  )!;
  await click(
    [...panel.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(servicio),
    )!,
  );
  await click(
    container.querySelector<HTMLElement>('[data-test="cuando-esta-semana"]')!,
  );
}

// ── 1 · Los servicios, por categoría ────────────────────────────────

describe("clinica-8 (17) · los servicios del alta van por categoría", () => {
  it("salen agrupados y con su encabezado", async () => {
    await render();
    await abrirAlta();
    const grupos = [...container.querySelectorAll("[data-categoria]")].map(
      (g) => g.getAttribute("data-categoria"),
    );
    expect(grupos).toEqual([
      "biomecánica",
      "cirugía",
      "consulta",
      "quiropodia",
    ]);
    expect(container.textContent).toContain("Quiropodia");
  });

  it("lo usado sube: el orden lo pone el contador del terminal", async () => {
    // Dos «Cura» apuntadas: su categoría se pone primera.
    localStorage.setItem(
      "mipiacetpv-uso-servicios-cita:anon",
      JSON.stringify({ [CATALOGO[3]!.id]: 2 }),
    );
    await render();
    await abrirAlta();
    const grupos = [...container.querySelectorAll("[data-categoria]")].map(
      (g) => g.getAttribute("data-categoria"),
    );
    expect(grupos[0]).toBe("cirugía");
  });

  it("el nombre del servicio NO se corta en lo que lo distingue", async () => {
    // «Revisión biomecánica adultos» y «… niños» sólo se diferencian en
    // la última palabra, y `truncate` cortaba justo ahí.
    await render();
    await abrirAlta();
    const fila = [...container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Revisión biomecánica adultos"),
    )!;
    const nombre = fila.querySelector("span")!;
    expect(nombre.className).not.toContain("truncate");
    expect(nombre.className).toContain("line-clamp-2");
  });
});

// ── 2 · «Buscar hueco» ──────────────────────────────────────────────

describe("clinica-8 (17) · las horas de «Buscar hueco» se ven", () => {
  it("al contestar, la tira se trae a la vista y dice CUÁNTAS son", async () => {
    huecos = [
      { start: "2026-10-19T08:00:00.000Z" },
      { start: "2026-10-19T08:30:00.000Z" },
      { start: "2026-10-19T09:00:00.000Z" },
    ];
    await render();
    await abrirAlta();
    // Un servicio, que es lo que enciende el botón.
    await click(
      [...container.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Quiropodia completa"),
      )!,
    );
    const antes = scrolls;
    await pedirHoras("Quiropodia completa");
    expect(scrolls).toBeGreaterThan(antes);
    const cuantos = container.querySelector('[data-test="cuantos-huecos"]')!;
    expect(cuantos.textContent).toBe("3 huecos · toca una hora");
  });

  it("con uno solo lo dice en singular", async () => {
    huecos = [{ start: "2026-10-19T08:00:00.000Z" }];
    await render();
    await abrirAlta();
    await pedirHoras("Quiropodia completa");
    expect(
      container.querySelector('[data-test="cuantos-huecos"]')!.textContent,
    ).toBe("1 hueco · toca la hora");
  });

  it("sin huecos no se promete una tira que no existe", async () => {
    huecos = [];
    await render();
    await abrirAlta();
    await pedirHoras("Quiropodia completa");
    expect(container.querySelector('[data-test="cuantos-huecos"]')).toBeNull();
    // Y en su lugar se dice POR QUÉ no hay ninguna.
    expect(container.textContent).toContain("No hay huecos");
  });
});

// ── 3 · El estetoscopio ─────────────────────────────────────────────

describe("clinica-8 (17) · «Salud de la agenda» no se le abre a la clienta", () => {
  it("quien puede arreglar la matriz lo tiene", async () => {
    matrizEditable = true;
    await render();
    expect(container.querySelector('[data-test="abrir-salud"]')).not.toBeNull();
  });

  it("quien NO puede, no: el panel enseña la consulta SQL que produce cada cifra", async () => {
    matrizEditable = false;
    await render();
    expect(container.querySelector('[data-test="abrir-salud"]')).toBeNull();
    // Y con el botón se va el badge: una cifra que no se puede abrir es
    // una alarma sin puerta.
    expect(container.querySelector('[data-test="badge-salud"]')).toBeNull();
  });
});

// ── 4 · La columna con una sola profesional ─────────────────────────

describe("clinica-8 (17) · con una sola profesional, la columna se ensancha", () => {
  it("con UNA ya no hay columna: hay lista, y se queda con la pantalla", async () => {
    // agenda-1 · decisión D1 de Matías (27-10). clinica-8 ensanchó la
    // columna a `flex-1` para que no dejara 208 px de agenda y el resto en
    // blanco; eso arreglaba el ancho y no el fondo del problema, que es el
    // ALTO: una cita de 15 minutos seguía siendo una raya de 16 px. Con
    // una profesional el día pasa a ser una lista de filas tocables y la
    // columna desaparece.
    staff = [ROSA];
    await render();
    expect(container.querySelectorAll("[data-columna-staff]")).toHaveLength(0);
    const lista = container.querySelector<HTMLElement>(
      '[data-test="dia-en-lista"]',
    );
    expect(lista).not.toBeNull();
    expect(lista!.className).toContain("flex-1");
    // Y la columna izquierda con «Ahora», que es lo que la rejilla de una
    // sola profesional no podía dar.
    expect(
      container.querySelector('[data-test="columna-del-dia"]'),
    ).not.toBeNull();
  });

  it("con dos, cada una con su mínimo, y el carril se desliza si no caben", async () => {
    // agenda-1 · el ancho de 176/208 px deja de ser FIJO y pasa a ser el
    // SUELO: tres profesionales con ancho fijo dejaban 600 px en blanco a
    // la derecha en la Lenovo apaisada (es el punto 29 de la auditoría
    // con tres columnas en vez de una). El carril es `w-full min-w-max`:
    // con pocas se reparten la pantalla, con muchas desborda y se desliza
    // — que es lo que esta prueba fijaba y sigue fijando.
    staff = [ROSA, ANA];
    await render();
    const columnas = [
      ...container.querySelectorAll('[data-columna-staff]'),
    ] as HTMLElement[];
    expect(columnas).toHaveLength(2);
    for (const c of columnas) {
      expect(c.className).toContain("min-w-44");
      expect(c.className).toContain("md:min-w-52");
    }
    const carril = columnas[0]!.parentElement!;
    expect(carril.className).toContain("min-w-max");
  });
});
