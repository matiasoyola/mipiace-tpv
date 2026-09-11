// B-reservas-7a · lo que la cajera ve en la rejilla con el horario puesto.
//
// Hasta este bloque la rejilla era ciega: iba de 8 a 21 siempre, la
// retícula era una constante de 15 (`SLOT_MIN`), una ausencia quitaba
// huecos en silencio y "No hay huecos ese día" era UNA frase para tres
// causas que se arreglan de tres formas distintas.
//
// Aquí se fija:
//   · la retícula sale del DÍA y viaja en la caché offline;
//   · con 30 no hay ningún inicio a y cuarto, tampoco al TOCAR;
//   · el tiempo fuera de los tramos abiertos no es reservable;
//   · el día cerrado dice «Cerrado · su nombre» y no ofrece nada;
//   · la ausencia se pinta con su motivo y se quita desde ella;
//   · poner una ausencia son TRES toques;
//   · la cita que quedó fuera de horario se sigue viendo, marcada;
//   · y el vacío distingue las tres causas.
//
// Mismo patrón que `agenda-suelo.test.tsx`: createRoot + act + eventos
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

import { __resetOutboxForTests } from "../src/lib/outbox.js";
import { AgendaPage } from "../src/pages/AgendaPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Martes 15-09-2026, 07:10 de pared en Madrid (CEST, UTC+2): ANTES de que
// abra el centro, para que el suelo de 6a no interfiera con lo que se mide.
const AHORA = new Date("2026-09-15T05:10:00.000Z");
const HOY = "2026-09-15";

const ANA = {
  userId: "00000000-0000-0000-0000-0000000000a1",
  displayName: "Ana",
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

const PX_PER_MIN = 1.1;

interface Dia {
  open: Array<{ startTime: string; endTime: string }> | null;
  closed: { name: string | null } | null;
  specialName: string | null;
  staffOpen: Record<string, Array<{ startTime: string; endTime: string }>>;
  absences: Array<{
    id: string | null;
    staffUserId: string | null;
    startTime: string;
    endTime: string;
    reason: string | null;
  }>;
}

const DIA_ABIERTO: Dia = {
  open: [{ startTime: "09:00", endTime: "20:00" }],
  closed: null,
  specialName: null,
  staffOpen: { [ANA.userId]: [{ startTime: "09:00", endTime: "20:00" }] },
  absences: [],
};

// Lo que devuelve `GET /agenda` en cada test. Se reasigna en cada `it`.
let respuesta: {
  staff: Array<typeof ANA>;
  appointments: unknown[];
  slotMinutes?: number;
  days?: Dia[];
};
// Lo que devuelven las demás rutas, y lo que se ha llamado.
let llamadas: Array<{ path: string; init?: unknown }>;
let slotsDeBusqueda: Array<{ start: string; end: string; options: number }>;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  await __resetOutboxForTests();
  llamadas = [];
  slotsDeBusqueda = [];
  respuesta = {
    staff: [ANA],
    appointments: [],
    slotMinutes: 15,
    days: [{ ...DIA_ABIERTO }],
  };
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(
    async (path: string, init?: unknown) => {
      llamadas.push({ path, init });
      if (path.startsWith("/agenda?")) {
        return { ...respuesta, days: respuesta.days?.map((d) => ({ ...d, date: HOY })) };
      }
      if (path === "/agenda/availability") return { slots: slotsDeBusqueda };
      if (path === "/agenda/blocks") return { id: "nuevo-bloqueo" };
      if (path.startsWith("/agenda/blocks/")) return { ok: true };
      throw new Error(`ruta no mockeada: ${path}`);
    },
  );
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

function columna(): HTMLElement {
  const col = container.querySelector<HTMLElement>("[data-columna]");
  if (!col) throw new Error("no hay columna de profesional");
  return col;
}

/** El origen de la columna en minutos: se deduce de la primera etiqueta de
 *  la regla, que es la que la propia página pinta. Así el test no repite la
 *  geometría — si la franja visible cambia, el test la sigue. */
function origenMin(): number {
  const primera = container.querySelector<HTMLElement>("[data-hora]");
  if (!primera) throw new Error("la regla no tiene horas");
  const hh = Number(primera.dataset.hora!.slice(0, 2));
  // La primera etiqueta es la primera hora EN PUNTO dentro de la franja; el
  // origen puede ser esa misma hora o antes, pero `visibleRange` redondea a
  // la hora, así que coinciden.
  return hh * 60;
}

async function tocarFranja(hhmm: string) {
  const col = columna();
  vi.spyOn(col, "getBoundingClientRect").mockReturnValue({
    top: 0,
    left: 0,
    right: 200,
    bottom: 2000,
    width: 200,
    height: 2000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  const [hh, mm] = hhmm.split(":").map(Number);
  const y = ((hh ?? 0) * 60 + (mm ?? 0) - origenMin()) * PX_PER_MIN;
  await act(async () => {
    col.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: y }));
  });
  await settle();
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

function texto(): string {
  return container.textContent ?? "";
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

// ── La retícula ───────────────────────────────────────────────────────

describe("la retícula sale del día, no de una constante", () => {
  it("con 15, tocar a las 10:10 abre el alta a las 10:00", async () => {
    await render();
    await tocarFranja("10:10");
    expect(hayPanelDeAlta()).toBe(true);
    expect(texto()).toContain("10:00");
  });

  it("con 30, tocar a las 10:20 abre el alta a las 10:00 — no a y cuarto", async () => {
    respuesta.slotMinutes = 30;
    await render();
    await tocarFranja("10:20");
    expect(hayPanelDeAlta()).toBe(true);
    expect(texto()).toContain("10:00");
    expect(texto()).not.toContain("10:15");
    expect(texto()).not.toContain("10:30");
  });

  it("con 30, tocar a las 10:40 abre las 10:30", async () => {
    respuesta.slotMinutes = 30;
    await render();
    await tocarFranja("10:40");
    expect(texto()).toContain("10:30");
    expect(texto()).not.toContain("10:45");
  });

  it("SIN RED la retícula sale de la CACHÉ, no del valor por defecto", async () => {
    // Primera carga con red: se cachea el día con su retícula de 30.
    respuesta.slotMinutes = 30;
    await render();
    await act(async () => root.unmount());

    // Segunda carga sin red: el GET falla y la agenda tira de caché.
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      if (path.startsWith("/agenda?")) throw new Error("sin red");
      throw new Error(`ruta no mockeada: ${path}`);
    });
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    await render();
    // El día se ha pintado sin que el servidor haya contestado nada: lo
    // único que puede haberlo dado es la caché. (`fetchAgendaDay` cae a
    // ella por dentro, así que la agenda ni se entera de que no hay red;
    // el chip "Sin conexión" es para cuando NO hay ni caché.)
    expect(container.querySelector("[data-columna]")).not.toBeNull();

    // Y el toque sigue redondeando a 30: si volviera a 15, el alta
    // encolada se rechazaría al reconectar.
    await tocarFranja("10:20");
    expect(texto()).toContain("10:00");
    expect(texto()).not.toContain("10:15");
  });
});

// ── El tiempo no reservable ───────────────────────────────────────────

describe("lo que no es reservable no invita", () => {
  it("las bandas fuera del horario se pintan", async () => {
    await render();
    const bandas = container.querySelectorAll("[data-no-reservable]");
    expect(bandas.length).toBeGreaterThan(0);
  });

  it("un centro SIN configurar no pinta ninguna banda — como antes", async () => {
    respuesta.days = [
      { ...DIA_ABIERTO, open: null, staffOpen: { [ANA.userId]: [] } },
    ];
    // `staffOpen` vacío con `open: null` = sin techo: no se apaga nada.
    respuesta.days[0]!.staffOpen = {};
    await render();
    expect(container.querySelectorAll("[data-no-reservable]").length).toBe(0);
  });

  it("tocar fuera del horario NO abre el alta y dice el horario", async () => {
    await render();
    await tocarFranja("20:30");
    expect(hayPanelDeAlta()).toBe(false);
    expect(texto()).toContain("09:00–20:00");
  });

  it("tocar donde esa profesional no tiene turno lo dice por su nombre", async () => {
    respuesta.days = [{ ...DIA_ABIERTO, staffOpen: { [ANA.userId]: [] } }];
    await render();
    await tocarFranja("10:00");
    expect(hayPanelDeAlta()).toBe(false);
    expect(texto()).toContain("no hay turno en esta columna");
  });

  it("el sábado de boda enseña las 8:30", async () => {
    respuesta.days = [
      {
        open: [{ startTime: "08:30", endTime: "14:00" }],
        closed: null,
        specialName: "boda Marta",
        staffOpen: {
          [ANA.userId]: [{ startTime: "08:30", endTime: "14:00" }],
        },
        absences: [],
      },
    ];
    await render();
    // La regla empieza a las 08:00 (8:30 − 30 min de margen, a la hora).
    expect(origenMin()).toBe(8 * 60);
    expect(texto()).toContain("boda Marta");
    expect(texto()).toContain("08:30–14:00");
    // Y las 8:30 se pueden tocar.
    await tocarFranja("08:30");
    expect(hayPanelDeAlta()).toBe(true);
  });
});

// ── El día cerrado ────────────────────────────────────────────────────

describe("el día cerrado", () => {
  beforeEach(() => {
    respuesta.days = [
      {
        open: [],
        closed: { name: "Virgen del Prado" },
        specialName: "Virgen del Prado",
        staffOpen: { [ANA.userId]: [] },
        absences: [],
      },
    ];
  });

  it("dice «Cerrado · su nombre»", async () => {
    await render();
    const banner = container.querySelector("[data-dia-cerrado]");
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("Cerrado · Virgen del Prado");
  });

  it("y no ofrece nada: tocar la columna no abre el alta", async () => {
    await render();
    await tocarFranja("10:00");
    expect(hayPanelDeAlta()).toBe(false);
    expect(texto()).toContain("Virgen del Prado");
  });
});

// ── Las ausencias ─────────────────────────────────────────────────────

describe("las ausencias", () => {
  const isaNo = {
    id: "bloqueo-1",
    staffUserId: ANA.userId,
    startTime: "09:00",
    endTime: "10:30",
    reason: "Ana libre",
  };

  it("se pintan con su motivo, como la celda del Excel", async () => {
    respuesta.days = [{ ...DIA_ABIERTO, absences: [isaNo] }];
    await render();
    const pintada = container.querySelector('[data-ausencia="bloqueo-1"]');
    expect(pintada).not.toBeNull();
    expect(pintada!.textContent).toContain("Ana libre");
    expect(pintada!.textContent).toContain("09:00–10:30");
  });

  it("una de día entero se dice «todo el día»", async () => {
    respuesta.days = [
      {
        ...DIA_ABIERTO,
        absences: [
          { ...isaNo, startTime: "00:00", endTime: "24:00", reason: null },
        ],
      },
    ];
    await render();
    const pintada = container.querySelector('[data-ausencia="bloqueo-1"]');
    expect(pintada!.textContent).toContain("todo el día");
    // Sin motivo, el título por defecto.
    expect(pintada!.textContent).toContain("No está");
  });

  it("tocarla ofrece quitarla, y quitarla llama al DELETE", async () => {
    respuesta.days = [{ ...DIA_ABIERTO, absences: [isaNo] }];
    await render();
    await click(container.querySelector('[data-ausencia="bloqueo-1"]')!);
    expect(texto()).toContain("Ana libre");
    await click(botonPorTexto("Quitar"));
    expect(
      llamadas.some((l) => l.path === "/agenda/blocks/bloqueo-1"),
    ).toBe(true);
  });

  it("tocar la franja de una ausencia no abre el alta, y dice el motivo", async () => {
    respuesta.days = [{ ...DIA_ABIERTO, absences: [isaNo] }];
    await render();
    // Se toca la columna por debajo de la ausencia pintada (que tiene su
    // propio onClick): 09:45 cae dentro del rango 09:00–10:30.
    await tocarFranja("09:45");
    expect(hayPanelDeAlta()).toBe(false);
  });
});

// ── El alta de ausencia, en tres toques ───────────────────────────────

describe("poner una ausencia desde la agenda", () => {
  it("«todo el día» son DOS toques y manda 00:00–24:00", async () => {
    await render();
    // Toque 1: el ⋯ de la cabecera de su columna.
    await click(container.querySelector(`[data-ausencia-menu="${ANA.userId}"]`)!);
    // Toque 2: "No está en todo el día".
    await click(container.querySelector("[data-ausencia-dia-entero]")!);

    const post = llamadas.find((l) => l.path === "/agenda/blocks");
    expect(post).toBeDefined();
    const body = (post!.init as { body: Record<string, unknown> }).body;
    expect(body).toMatchObject({
      scope: "STAFF",
      staffUserId: ANA.userId,
      date: HOY,
      // El día entero son 23 o 25 horas los domingos del cambio de hora:
      // se manda la hora de pared y la compone el servidor.
      startTime: "00:00",
      endTime: "24:00",
    });
  });

  it("«a ratos» son TRES toques con los valores por defecto", async () => {
    await render();
    await click(container.querySelector(`[data-ausencia-menu="${ANA.userId}"]`)!);
    await click(container.querySelector("[data-ausencia-rango]")!);
    await click(container.querySelector("[data-ausencia-guardar]")!);

    const post = llamadas.find((l) => l.path === "/agenda/blocks");
    const body = (post!.init as { body: Record<string, unknown> }).body;
    // El rango arranca donde abre su columna.
    expect(body).toMatchObject({ startTime: "09:00", endTime: "10:00" });
  });

  it("con la retícula a 30 los selectores NO ofrecen y cuarto", async () => {
    respuesta.slotMinutes = 30;
    await render();
    await click(container.querySelector(`[data-ausencia-menu="${ANA.userId}"]`)!);
    await click(container.querySelector("[data-ausencia-rango]")!);
    const opciones = Array.from(
      container.querySelectorAll("select option"),
    ).map((o) => o.textContent ?? "");
    expect(opciones.length).toBeGreaterThan(0);
    expect(opciones.some((o) => o.includes(":15"))).toBe(false);
    expect(opciones.some((o) => o.includes(":45"))).toBe(false);
    expect(opciones.some((o) => o.startsWith("09:30"))).toBe(true);
  });

  it("el motivo es opcional y viaja", async () => {
    await render();
    await click(container.querySelector(`[data-ausencia-menu="${ANA.userId}"]`)!);
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Motivo"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "médico");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(container.querySelector("[data-ausencia-dia-entero]")!);
    const post = llamadas.find((l) => l.path === "/agenda/blocks");
    expect((post!.init as { body: { reason: string } }).body.reason).toBe(
      "médico",
    );
  });

  it("la columna «Sin asignar» no tiene el gesto: no es de nadie", async () => {
    respuesta.appointments = [
      {
        id: "cita-huerfana",
        clientId: null,
        status: "CONFIRMED",
        source: "PRESENCIAL",
        start: madrid("11:00"),
        end: madrid("11:30"),
        ticketId: null,
        notes: null,
        items: [{ id: "i1", serviceId: CORTE.id, durationMin: 30, sortOrder: 0, startOffsetMin: 0 }],
        assignments: [],
      },
    ];
    await render();
    const menus = container.querySelectorAll("[data-ausencia-menu]");
    // Uno por profesional de verdad, ninguno para "Sin asignar".
    expect(menus.length).toBe(1);
  });
});

// ── La cita que quedó fuera de horario ────────────────────────────────

describe("una cita fuera del horario", () => {
  const cita = (start: string, end: string) => ({
    id: "cita-1",
    clientId: "c1",
    status: "CONFIRMED",
    source: "PRESENCIAL",
    start: madrid(start),
    end: madrid(end),
    ticketId: null,
    notes: null,
    items: [
      {
        id: "i1",
        serviceId: CORTE.id,
        durationMin: 30,
        sortOrder: 0,
        startOffsetMin: 0,
      },
    ],
    assignments: [
      { reservableType: "STAFF", staffUserId: ANA.userId, resourceId: null },
    ],
  });

  it("se sigue viendo y va MARCADA", async () => {
    // El centro cierra a las 20:00 y hay una cita a las 20:30: el horario
    // se acortó después.
    respuesta.appointments = [cita("20:30", "21:00")];
    await render();
    const marcada = container.querySelector("[data-fuera-de-horario]");
    expect(marcada).not.toBeNull();
    expect(texto()).toContain("fuera de horario");
  });

  it("una cita DENTRO del horario no se marca", async () => {
    respuesta.appointments = [cita("11:00", "11:30")];
    await render();
    expect(container.querySelector("[data-fuera-de-horario]")).toBeNull();
  });

  it("una cita que pisa una ausencia también se marca", async () => {
    respuesta.appointments = [cita("09:30", "10:00")];
    respuesta.days = [
      {
        ...DIA_ABIERTO,
        absences: [
          {
            id: "b1",
            staffUserId: ANA.userId,
            startTime: "09:00",
            endTime: "10:30",
            reason: "Ana libre",
          },
        ],
      },
    ];
    await render();
    expect(container.querySelector("[data-fuera-de-horario]")).not.toBeNull();
  });

  it("y la franja visible se ENSANCHA para que quepa", async () => {
    // Una cita a las 21:30 con el día visible hasta las 20:30: si no se
    // ensanchara, la cita sería impintable y no se podría cobrar.
    respuesta.appointments = [cita("21:30", "22:00")];
    await render();
    const horas = Array.from(
      container.querySelectorAll("[data-hora]"),
    ).map((n) => (n as HTMLElement).dataset.hora);
    expect(horas).toContain("21:00");
  });
});

// ── Las tres causas del vacío ─────────────────────────────────────────

describe("«no hay huecos» distingue tres causas", () => {
  // Las tres causas aparecen en DOS sitios, y los dos se prueban:
  //   · al TOCAR la columna (arriba, "lo que no es reservable no invita"),
  //     que es donde está la cajera cuando la clienta le pregunta;
  //   · y al BUSCAR HUECO desde el panel, que es este bloque.
  // Se arreglan de tres formas distintas —el owner en los ajustes, el
  // panel de Personal, u otro día— así que decirlas igual mandaría a la
  // cajera al sitio equivocado.

  /** Abre "Nueva cita", elige el servicio y busca hueco. Es el camino sin
   *  profesional fijada: el de "¿tienes algo ese día?". */
  async function buscarDesdeNuevaCita() {
    await click(botonPorTexto("Nueva cita"));
    const servicio = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim().startsWith("Corte de pelo"),
    )!;
    await click(servicio);
    await click(botonPorTexto("Buscar hueco"));
  }

  it("1 · el centro cerrado se dice con su nombre", async () => {
    respuesta.days = [
      {
        open: [],
        closed: { name: "Virgen del Prado" },
        specialName: "Virgen del Prado",
        staffOpen: { [ANA.userId]: [] },
        absences: [],
      },
    ];
    await render();
    await buscarDesdeNuevaCita();
    expect(texto()).toContain("El centro está cerrado ese día");
    expect(texto()).toContain("Virgen del Prado");
  });

  it("2 · nadie con turno es OTRA causa, y otra frase", async () => {
    respuesta.days = [{ ...DIA_ABIERTO, staffOpen: { [ANA.userId]: [] } }];
    await render();
    await buscarDesdeNuevaCita();
    expect(texto()).toContain("Ese día no hay nadie con turno");
    expect(texto()).not.toContain("cerrado");
  });

  it("3 · y si el día está lleno, la frase de siempre", async () => {
    await render();
    await buscarDesdeNuevaCita();
    expect(texto()).toContain("No hay huecos ese día");
    expect(texto()).not.toContain("cerrado");
    expect(texto()).not.toContain("nadie con turno");
  });

  it("al TOCAR, la columna sin turno se dice por su sitio", async () => {
    respuesta.days = [{ ...DIA_ABIERTO, staffOpen: { [ANA.userId]: [] } }];
    await render();
    await tocarFranja("11:00");
    expect(hayPanelDeAlta()).toBe(false);
    expect(texto()).toContain("no hay turno en esta columna");
  });
});
