// B-reservas-7a · los ajustes de agenda del propietario.
//
// Lo que importa aquí no es el maquetado: es que un cambio de horario NO
// toque las citas ya dadas y que la pantalla lo diga ANTES de guardar, que
// el festivo se dé de alta en dos toques y salga con su nombre, y que abrir
// un día antes que el turno de todo el personal ofrezca el refuerzo — sin
// lo cual el sábado de la boda se marca a las 8:30 y la agenda sigue sin
// ofrecerlas.
//
// Mismo patrón sin testing-library que el resto del repo: createRoot + act.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return {
    ...actual,
    api: apiMock.api,
    readEffectiveAuth: () => ({ canEdit: true }),
    clearTokens: () => {},
  };
});

// El shell arrastra sesión y navegación; aquí sobra.
vi.mock("../src/AdminShell.js", () => ({
  AdminShell: ({ children }: { children: unknown }) => children,
}));

import { AgendaHorarioPage } from "../src/pages/AgendaHorarioPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const SIN_NADA = { slotMinutes: 15, week: [], days: [] };

let container: HTMLDivElement;
let root: Root;
// Lo que devuelve cada ruta, y lo que se ha llamado.
let hours: {
  slotMinutes: number;
  week: unknown[];
  days: unknown[];
};
let impacto: {
  count: number;
  appointments: unknown[];
  scannedFrom: string;
  scannedTo: string;
};
let coverage: { covered: boolean; staff: unknown[]; candidates: unknown[] };
let llamadas: Array<{ path: string; init?: { method?: string; body?: unknown } }>;

beforeEach(() => {
  hours = { ...SIN_NADA };
  impacto = {
    count: 0,
    appointments: [],
    scannedFrom: "2026-09-11",
    scannedTo: "2026-12-10",
  };
  coverage = { covered: true, staff: [], candidates: [] };
  llamadas = [];
  apiMock.api.mockReset();
  apiMock.api.mockImplementation(
    async (path: string, init?: { method?: string; body?: unknown }) => {
      llamadas.push({ path, init });
      if (path === "/admin/tenant/settings") {
        return { settings: { agendaEnabled: true } };
      }
      if (path === "/admin/agenda/hours") return hours;
      if (path === "/admin/agenda/hours/impact") return impacto;
      if (path.startsWith("/admin/agenda/hours/coverage")) return coverage;
      if (path === "/admin/agenda/hours/week") return { ok: true };
      if (path === "/admin/agenda/hours/slot") return { ok: true };
      if (path === "/admin/agenda/hours/days") return { day: {} };
      if (path.startsWith("/admin/agenda/hours/days/")) return { ok: true };
      if (path.startsWith("/staff/")) return { shift: {} };
      throw new Error(`ruta no mockeada: ${path}`);
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <AgendaHorarioPage />
      </MemoryRouter>,
    );
  });
  await settle();
}

async function click(el: Element | null) {
  if (!el) throw new Error("no existe el elemento a pulsar");
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

async function escribir(el: Element | null, valor: string) {
  if (!el) throw new Error("no existe el campo");
  const input = el as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

function texto(): string {
  return container.textContent ?? "";
}

function botonPorTexto(t: string): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === t,
    ) as HTMLButtonElement) ?? null
  );
}

function llamada(path: string, method?: string) {
  return llamadas.find(
    (l) => l.path === path && (!method || l.init?.method === method),
  );
}

// ── Un centro sin configurar ──────────────────────────────────────────

describe("un centro sin configurar", () => {
  it("dice que no tiene techo y que se comporta como hasta ahora", async () => {
    await render();
    expect(texto()).toContain("no tiene techo");
    expect(texto()).toContain("como hasta ahora");
  });

  it("enseña los siete días, cerrados", async () => {
    await render();
    expect(container.querySelectorAll("[data-dia]").length).toBe(7);
  });
});

// ── El horario semanal ────────────────────────────────────────────────

describe("el horario semanal", () => {
  it("guarda las filas que se han escrito, y sólo ésas", async () => {
    await render();
    await escribir(container.querySelector('[data-hora="2-m1"]'), "09:00");
    await escribir(container.querySelector('[data-hora="2-m2"]'), "20:00");
    await click(botonPorTexto("Guardar horario"));

    const put = llamada("/admin/agenda/hours/week", "PUT");
    expect(put).toBeDefined();
    expect((put!.init!.body as { rows: unknown[] }).rows).toEqual([
      { weekday: 2, openTime: "09:00", closeTime: "20:00" },
    ]);
  });

  it("un día en blanco se queda cerrado: no manda fila", async () => {
    await render();
    await escribir(container.querySelector('[data-hora="6-m1"]'), "09:00");
    await escribir(container.querySelector('[data-hora="6-m2"]'), "14:00");
    await click(botonPorTexto("Guardar horario"));
    const rows = (llamada("/admin/agenda/hours/week", "PUT")!.init!.body as {
      rows: Array<{ weekday: number }>;
    }).rows;
    expect(rows.map((r) => r.weekday)).toEqual([6]);
  });

  it("no manda nada si la mañana cierra antes de abrir", async () => {
    await render();
    await escribir(container.querySelector('[data-hora="2-m1"]'), "20:00");
    await escribir(container.querySelector('[data-hora="2-m2"]'), "09:00");
    await click(botonPorTexto("Guardar horario"));
    expect(llamada("/admin/agenda/hours/week", "PUT")).toBeUndefined();
    expect(texto()).toContain("cierra antes de abrir");
  });

  it("no manda nada si falta la hora de cierre", async () => {
    await render();
    await escribir(container.querySelector('[data-hora="2-m1"]'), "09:00");
    await click(botonPorTexto("Guardar horario"));
    expect(llamada("/admin/agenda/hours/week", "PUT")).toBeUndefined();
    expect(texto()).toContain("hora de apertura y de cierre");
  });
});

// ── Las citas ya dadas ────────────────────────────────────────────────

describe("las citas ya dadas no se mueven", () => {
  beforeEach(() => {
    impacto = {
      count: 3,
      scannedFrom: "2026-09-11",
      scannedTo: "2026-12-10",
      appointments: [
        {
          id: "a1",
          date: "2026-09-12",
          wallTime: "10:00",
          clientName: "Cristina",
          reason: "OUT_OF_HOURS",
        },
        {
          id: "a2",
          date: "2026-09-12",
          wallTime: "11:30",
          clientName: "Manoli",
          reason: "OUT_OF_HOURS",
        },
        {
          id: "a3",
          date: "2026-09-19",
          wallTime: "12:00",
          clientName: null,
          reason: "OUT_OF_HOURS",
        },
      ],
    };
  });

  it("se enseñan ANTES de guardar, y no se ha guardado nada todavía", async () => {
    await render();
    await escribir(container.querySelector('[data-hora="2-m1"]'), "09:00");
    await escribir(container.querySelector('[data-hora="2-m2"]'), "14:00");
    await click(botonPorTexto("Guardar horario"));

    expect(texto()).toContain("3 citas que quedarían fuera");
    expect(texto()).toContain("10:00 Cristina");
    expect(texto()).toContain("11:30 Manoli");
    expect(texto()).toContain("Se quedan como están");
    // Y nada se ha escrito: sólo se ha preguntado.
    expect(llamada("/admin/agenda/hours/week", "PUT")).toBeUndefined();
  });

  it("dice hasta dónde ha mirado", async () => {
    await render();
    await escribir(container.querySelector('[data-hora="2-m1"]'), "09:00");
    await escribir(container.querySelector('[data-hora="2-m2"]'), "14:00");
    await click(botonPorTexto("Guardar horario"));
    expect(texto()).toContain("del 2026-09-11 al 2026-12-10");
  });

  it("cancelar no guarda nada", async () => {
    await render();
    await escribir(container.querySelector('[data-hora="2-m1"]'), "09:00");
    await escribir(container.querySelector('[data-hora="2-m2"]'), "14:00");
    await click(botonPorTexto("Guardar horario"));
    await click(botonPorTexto("Cancelar"));
    expect(llamada("/admin/agenda/hours/week", "PUT")).toBeUndefined();
  });

  it("confirmar SÍ guarda, y las citas siguen intactas (nadie las toca)", async () => {
    await render();
    await escribir(container.querySelector('[data-hora="2-m1"]'), "09:00");
    await escribir(container.querySelector('[data-hora="2-m2"]'), "14:00");
    await click(botonPorTexto("Guardar horario"));
    await click(botonPorTexto("Guardar de todas formas"));
    expect(llamada("/admin/agenda/hours/week", "PUT")).toBeDefined();
    // No hay ninguna llamada que cancele ni mueva una cita.
    expect(
      llamadas.some((l) => l.path.includes("/agenda/appointments")),
    ).toBe(false);
  });

  it("sin citas afectadas guarda directo, sin preguntar de más", async () => {
    impacto = { ...impacto, count: 0, appointments: [] };
    await render();
    await escribir(container.querySelector('[data-hora="2-m1"]'), "09:00");
    await escribir(container.querySelector('[data-hora="2-m2"]'), "14:00");
    await click(botonPorTexto("Guardar horario"));
    expect(llamada("/admin/agenda/hours/week", "PUT")).toBeDefined();
    expect(texto()).not.toContain("quedarían fuera");
  });
});

// ── Los días especiales ───────────────────────────────────────────────

describe("los días especiales", () => {
  it("el alta de un festivo son dos campos y Guardar, y va CERRADO", async () => {
    await render();
    await escribir(
      container.querySelector("[data-nuevo-dia-fecha]"),
      "2026-09-08",
    );
    await escribir(
      container.querySelector("[data-nuevo-dia-nombre]"),
      "Virgen del Prado",
    );
    await click(botonPorTexto("Guardar"));
    const post = llamada("/admin/agenda/hours/days", "POST");
    expect(post!.init!.body).toMatchObject({
      date: "2026-09-08",
      name: "Virgen del Prado",
      closed: true,
      openTime: null,
      closeTime: null,
    });
  });

  it("sin nombre no se guarda: el nombre es lo que la agenda enseña", async () => {
    await render();
    await escribir(
      container.querySelector("[data-nuevo-dia-fecha]"),
      "2026-09-08",
    );
    await click(botonPorTexto("Guardar"));
    expect(llamada("/admin/agenda/hours/days", "POST")).toBeUndefined();
    expect(texto()).toContain("Ponle nombre");
  });

  it("el listado enseña la fecha Y el nombre", async () => {
    hours = {
      ...SIN_NADA,
      days: [
        {
          id: "d1",
          date: "2026-09-08",
          closed: true,
          name: "Virgen del Prado",
          openTime: null,
          closeTime: null,
        },
        {
          id: "d2",
          date: "2026-09-12",
          closed: false,
          name: "boda Marta",
          openTime: "08:30",
          closeTime: "14:00",
        },
      ],
    };
    await render();
    const filas = container.querySelectorAll("[data-dia-especial]");
    expect(filas.length).toBe(2);
    expect(filas[0]!.textContent).toContain("2026-09-08");
    expect(filas[0]!.textContent).toContain("Virgen del Prado");
    expect(filas[0]!.textContent).toContain("cerrado");
    expect(filas[1]!.textContent).toContain("08:30–14:00");
  });
});

// ── El refuerzo ───────────────────────────────────────────────────────

describe("abrir antes de que nadie tenga turno", () => {
  beforeEach(() => {
    coverage = {
      covered: false,
      staff: [],
      candidates: [{ userId: "u-ana", displayName: "Ana" }],
    };
  });

  async function altaSabadoDeBoda() {
    await render();
    await escribir(
      container.querySelector("[data-nuevo-dia-fecha]"),
      "2026-09-12",
    );
    await escribir(
      container.querySelector("[data-nuevo-dia-nombre]"),
      "boda Marta",
    );
    await click(container.querySelector("[data-nuevo-dia-cerrado]"));
    await escribir(container.querySelector("[data-nuevo-dia-abre]"), "08:30");
    await escribir(container.querySelector("[data-nuevo-dia-cierra]"), "14:00");
    await click(botonPorTexto("Guardar"));
  }

  it("lo dice: nadie tiene turno a esa hora", async () => {
    await altaSabadoDeBoda();
    expect(container.querySelector("[data-refuerzo]")).not.toBeNull();
    expect(texto()).toContain("Nadie tiene turno a las 08:30");
  });

  it("y ofrece el refuerzo de un día con la API de turnos de B3", async () => {
    await altaSabadoDeBoda();
    await click(
      botonPorTexto("Añadir refuerzo de 08:30 a 14:00, sólo ese día"),
    );
    const post = llamada("/staff/u-ana/shifts", "POST");
    expect(post).toBeDefined();
    expect(post!.init!.body).toMatchObject({
      // 12-09-2026 es sábado.
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      startTime: "08:30",
      endTime: "14:00",
      // Un turno de UN día: no toca la semana tipo de nadie.
      validFrom: "2026-09-12",
      validUntil: "2026-09-12",
      kind: "REINFORCEMENT",
    });
  });

  it("si alguien YA tiene turno a esa hora, no molesta", async () => {
    coverage = {
      covered: true,
      staff: [{ userId: "u-ana", displayName: "Ana" }],
      candidates: [],
    };
    await altaSabadoDeBoda();
    expect(container.querySelector("[data-refuerzo]")).toBeNull();
  });
});

// ── La retícula ───────────────────────────────────────────────────────

describe("la retícula", () => {
  it("dice qué cambia y avisa del orden del despliegue", async () => {
    await render();
    expect(texto()).toContain("deja de ofrecer y cuarto");
    expect(texto()).toContain("después");
    expect(texto()).toContain("app del TPV");
  });

  it("pasar a 30 sin citas a y cuarto guarda directo", async () => {
    await render();
    await click(container.querySelector('[data-reticula="30"]'));
    const put = llamada("/admin/agenda/hours/slot", "PUT");
    expect(put!.init!.body).toEqual({ slotMinutes: 30 });
  });

  it("con citas a y cuarto, primero las enseña", async () => {
    impacto = {
      count: 4,
      scannedFrom: "2026-09-11",
      scannedTo: "2026-12-10",
      appointments: [1, 2, 3, 4].map((n) => ({
        id: `a${n}`,
        date: "2026-09-12",
        wallTime: "10:15",
        clientName: `Clienta ${n}`,
        reason: "OFF_GRID",
      })),
    };
    await render();
    await click(container.querySelector('[data-reticula="30"]'));
    expect(llamada("/admin/agenda/hours/slot", "PUT")).toBeUndefined();
    expect(texto()).toContain("4 citas que quedarían fuera");
    expect(texto()).toContain("no cae en la retícula nueva");
    expect(texto()).toContain("Se quedan como están");
  });
});
