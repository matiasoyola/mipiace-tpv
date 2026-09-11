// B-reservas-6a · la agenda no invita a una hora que ya pasó.
//
// Primer test de `AgendaPage` en jsdom (carryover 5 de B4, §4.8 de B-5: "no
// hay tests de AgendaPage"). Cubre las dos mitades del frente de front:
//
//   1. una franja pasada NO abre el panel de alta — ni tocándola ni con
//      "Nueva cita" en un día que ya pasó. El servidor la rechazaría igual
//      (409 BOOKING_IN_PAST); pasear a la cajera por el panel para acabar
//      en un error es peor que decírselo al tocar.
//   2. cuando el 409 llega igual (dos personas a la vez, la hora que se
//      cruza mientras se rellena el panel), se enseña CON SU FRASE y con
//      las alternativas TOCABLES, no como un error genérico.
//
// LA FRANJA EN CURSO SE RESERVA: con el reloj a las 11:10, las 11:00 abren
// el panel. Es la decisión del bloque y aquí está fijada.
//
// Mismo patrón que el resto de tests del TPV: createRoot + act + eventos
// nativos, sin testing-library.

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

const CORTE = {
  id: "00000000-0000-0000-0000-0000000000p1",
  holdedProductId: "h-corte",
  sku: "SVC-CORTE",
  name: "Corte de pelo",
  basePrice: 14.876,
  priceGross: 18,
  taxRate: 21,
  tags: [] as string[],
  kind: "SERVICE" as const,
  durationMin: 30,
};

vi.mock("../src/lib/catalog.js", () => ({
  loadCatalogFromCache: async () => [CORTE],
  productImageUrl: () => null,
}));
vi.mock("../src/lib/clients.js", () => ({
  clientFullName: () => "Rosa Marín",
  loadClientsFromCache: async () => [],
}));
vi.mock("../src/hooks/useClientPicker.js", () => ({
  useClientPicker: () => ({ open: () => {}, element: null }),
}));

import { ApiError } from "../src/api.js";
import { AgendaPage } from "../src/pages/AgendaPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// El reloj del test: 11:10 de pared en Madrid del 15-09-2026 (CEST, UTC+2).
// El SUELO son, por tanto, las 11:00.
const AHORA = new Date("2026-09-15T09:10:00.000Z");
const HOY = "2026-09-15";

const SOLE = {
  userId: "00000000-0000-0000-0000-0000000000s1",
  displayName: "Sole",
  color: "#8b5cf6",
  active: true,
};

/** ISO UTC de una hora de pared de Madrid ese día (CEST = UTC+2). */
function madrid(hhmm: string): string {
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(
    Date.UTC(2026, 8, 15, (hh ?? 0) - 2, mm ?? 0, 0, 0),
  ).toISOString();
}

// Geometría de la columna, la misma que pinta `AgendaPage`: el día empieza a
// las 08:00 y cada minuto son 1,1 px. Así se puede "tocar" una hora concreta.
const DAY_START_MIN = 8 * 60;
const PX_PER_MIN = 1.1;
function yDe(hhmm: string): number {
  const [hh, mm] = hhmm.split(":").map(Number);
  return ((hh ?? 0) * 60 + (mm ?? 0) - DAY_START_MIN) * PX_PER_MIN;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(AHORA);
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string) => {
    if (path.startsWith("/agenda?")) {
      return { staff: [SOLE], appointments: [] };
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
    root.render(<AgendaPage onClose={() => {}} />);
  });
  await settle();
}

/** La superficie clicable de la columna de Sole (la que lleva las citas). */
function columna(): HTMLElement {
  const col = container.querySelector<HTMLElement>("[data-columna]");
  if (!col) throw new Error("no hay columna de profesional");
  return col;
}

/** Toca la columna a la altura de una hora de pared. */
async function tocarFranja(hhmm: string) {
  const col = columna();
  vi.spyOn(col, "getBoundingClientRect").mockReturnValue({
    top: 0,
    left: 0,
    right: 200,
    bottom: 1000,
    width: 200,
    height: 1000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  await act(async () => {
    col.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientY: yDe(hhmm) }),
    );
  });
  await settle();
}

function textoDe(sel: string): string {
  return Array.from(container.querySelectorAll(sel))
    .map((n) => n.textContent ?? "")
    .join(" | ");
}

function hayPanelDeAlta(): boolean {
  return Array.from(container.querySelectorAll("h2")).some(
    (h) => h.textContent?.trim() === "Nueva cita",
  );
}

function botonPorTexto(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === text,
  );
  if (!btn) throw new Error(`no hay botón "${text}"`);
  return btn as HTMLButtonElement;
}

/** El botón de un servicio lleva su duración pegada ("Corte de pelo30 min"). */
function botonQueEmpieza(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").trim().startsWith(text),
  );
  if (!btn) throw new Error(`no hay botón que empiece por "${text}"`);
  return btn as HTMLButtonElement;
}

async function click(btn: HTMLButtonElement) {
  await act(async () => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

describe("AgendaPage · el suelo en la superficie", () => {
  it("tocar una franja que ya pasó NO abre el panel de alta", async () => {
    await render();
    await tocarFranja("10:45");
    expect(hayPanelDeAlta()).toBe(false);
    // Y dice a partir de qué hora sí, que es la mitad útil del aviso.
    expect(container.textContent).toContain("ya ha pasado");
    expect(container.textContent).toContain("11:00");
  });

  it("LA FRANJA EN CURSO sí: a las 11:10, tocar las 11:00 abre el panel", async () => {
    await render();
    await tocarFranja("11:00");
    expect(hayPanelDeAlta()).toBe(true);
    // Y la hora que fija es la de la franja, no la del reloj.
    expect(textoDe(".text-\\[14px\\].font-semibold")).toContain("11:00");
  });

  it("una franja futura abre el panel, como siempre", async () => {
    await render();
    await tocarFranja("16:30");
    expect(hayPanelDeAlta()).toBe(true);
  });

  it("la regla de horas cuadra con las columnas, y no deriva", async () => {
    // El bucle visual pilló que la regla mentía: sin hueco para la cabecera
    // (40 px) y con un `-mt-2` por fila que ACUMULABA 8 px por hora — 96 px
    // a las 20:00. Con el suelo pintado eso deja de ser un detalle: si la
    // regla no cuadra, no se sabe a qué hora acaba lo que ya pasó.
    await render();
    for (const [hora, min] of [
      ["09:00", 9 * 60],
      ["11:00", 11 * 60],
      ["20:00", 20 * 60],
    ] as const) {
      const label = container.querySelector<HTMLElement>(`[data-hora="${hora}"]`);
      expect(label).not.toBeNull();
      expect(label!.style.top).toBe(`${(min - DAY_START_MIN) * PX_PER_MIN}px`);
    }
  });

  it("lo que ya pasó se pinta apagado, y el borde es el SUELO, no 'ahora'", async () => {
    await render();
    const wash = container.querySelector<HTMLElement>(
      "div[aria-hidden].pointer-events-none",
    );
    expect(wash).not.toBeNull();
    // 08:00 → 11:00 = 180 min. Si el borde fuera "ahora" (11:10) medirían
    // 190: la franja en curso se reserva y no puede salir apagada.
    expect(wash!.style.height).toBe(`${180 * PX_PER_MIN}px`);
  });
});

describe("AgendaPage · el 409 del suelo se enseña con su frase", () => {
  async function intentarReservar(errorDelServidor: ApiError) {
    await render();
    await tocarFranja("16:30");
    await click(botonQueEmpieza("Corte de pelo"));
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      if (path.startsWith("/agenda?")) {
        return { staff: [SOLE], appointments: [] };
      }
      if (path === "/agenda/appointments") throw errorDelServidor;
      throw new Error(`ruta no mockeada: ${path}`);
    });
    await click(botonPorTexto("Reservar"));
  }

  it("la frase del servidor y tres horas TOCABLES, no un error genérico", async () => {
    await intentarReservar(
      new ApiError(
        409,
        "Esa hora ya ha pasado. Te puedo dar las 11:15, las 11:30 o las 11:45.",
        "BOOKING_IN_PAST",
        {
          alternatives: [
            { start: madrid("11:15"), end: madrid("11:45"), options: 1 },
            { start: madrid("11:30"), end: madrid("12:00"), options: 1 },
            { start: madrid("11:45"), end: madrid("12:15"), options: 1 },
          ],
        },
      ),
    );

    expect(container.textContent).toContain("Esa hora ya ha pasado");
    // Las tres alternativas son botones, no texto.
    for (const hora of ["11:15", "11:30", "11:45"]) {
      expect(() => botonPorTexto(hora)).not.toThrow();
    }
  });

  it("tocar una alternativa fija esa hora y quita el aviso", async () => {
    await intentarReservar(
      new ApiError(
        409,
        "Esa hora ya ha pasado. Te puedo dar las 11:15, las 11:30 o las 11:45.",
        "BOOKING_IN_PAST",
        {
          alternatives: [
            { start: madrid("11:15"), end: madrid("11:45"), options: 1 },
            { start: madrid("11:30"), end: madrid("12:00"), options: 1 },
          ],
        },
      ),
    );
    await click(botonPorTexto("11:30"));
    expect(container.textContent).not.toContain("Esa hora ya ha pasado");
    expect(textoDe(".text-\\[14px\\].font-semibold")).toContain("11:30");
  });

  it("y el 409 de la retícula se enseña igual (no hay error genérico)", async () => {
    await intentarReservar(
      new ApiError(
        409,
        "Las citas empiezan cada cuarto de hora. Te puedo dar las 16:30.",
        "BOOKING_OFF_GRID",
        { alternatives: [{ start: madrid("16:30"), end: madrid("17:00"), options: 1 }] },
      ),
    );
    expect(container.textContent).toContain("cada cuarto de hora");
    expect(() => botonPorTexto("16:30")).not.toThrow();
  });
});
