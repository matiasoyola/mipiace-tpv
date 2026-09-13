// B-reservas-9 · El panel de salud y la matriz, en jsdom.
//
// Lo que se fija aquí son las cuatro reglas de acabado del §H7 que este
// bloque salda, más la ruta de un clic del criterio de "funciona":
//
//   · carga = ESQUELETO, no spinner;
//   · error de red = la última foto CON SU HORA + reintentar, y lo de antes
//     se sigue leyendo;
//   · vacío informativo: el 0 se dice con palabras;
//   · una tarjeta sin su dependencia sale deshabilitada y SIN cifra;
//   · de la tarjeta 1 a la matriz, con el servicio ya abierto.
//
// Mismo patrón que el resto de tests del TPV: createRoot + act + eventos
// nativos, sin testing-library.

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

import { AgendaHealthPanel } from "../src/pages/AgendaHealthPanel.js";
import { AgendaSkillMatrix } from "../src/pages/AgendaSkillMatrix.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const SPA = "00000000-0000-0000-0000-0000000000s1";
const RITUAL = "00000000-0000-0000-0000-0000000000s2";
const SOLE = "00000000-0000-0000-0000-0000000000u1";
const NURIA = "00000000-0000-0000-0000-0000000000u2";

function tarjeta(over: Record<string, unknown> = {}) {
  return {
    key: "servicios-sin-profesional",
    title: "Servicios que nadie puede hacer",
    unit: "servicios",
    unitOne: "servicio",
    status: "ok",
    value: 2,
    items: [
      { id: SPA, label: "Spa capilar", detail: "Nadie lo tiene asignado" },
      { id: RITUAL, label: "Ritual reafirmante", detail: "Nadie lo tiene asignado" },
    ],
    goodNews: "Todos los servicios agendables tienen a alguien que los da.",
    explain: "Cuenta los servicios con ficha de agenda que no llegan a los que necesitan.",
    query: "SELECT p.id FROM service_scheduling ss WHERE ss.tenant_id = $1::uuid",
    params: ["$1 = este negocio"],
    dependsOn: null,
    unavailableReason: null,
    ...over,
  };
}

function tarjetaPendiente() {
  return {
    key: "saldo-vivo-sin-cita",
    title: "Programas con saldo vivo y sin próxima cita",
    unit: "programas",
    unitOne: "programa",
    status: "unavailable",
    value: null,
    items: [],
    goodNews: "Todo el saldo vendido tiene su próxima cita puesta.",
    explain: "Bonos de sesiones con sesiones sin gastar y ninguna cita futura.",
    query: "SELECT v.id FROM vouchers v WHERE v.tenant_id = $1::uuid",
    params: ["$1 = este negocio", "$2 = ahora"],
    dependsOn: {
      block: "B-reservas-8",
      what: "el saldo por sesiones (bonos de tipo SESSIONS y su consumo)",
    },
    unavailableReason: "El saldo por sesiones todavía no existe en este sistema.",
  };
}

function salud(cards: unknown[]) {
  return { generatedAt: "2026-09-13T10:00:00.000Z", cards };
}

const MATRIZ = {
  editable: true,
  services: [
    {
      id: SPA,
      name: "Spa capilar",
      agendable: true,
      active: true,
      staffRequired: 1,
      staffUserIds: [] as string[],
    },
    {
      id: RITUAL,
      name: "Ritual reafirmante",
      agendable: true,
      active: false,
      staffRequired: 1,
      staffUserIds: [SOLE],
    },
  ],
  staff: [
    { userId: SOLE, displayName: "Sole", active: true, hasProfile: true },
    { userId: NURIA, displayName: "Nuria", active: false, hasProfile: false },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-13T11:40:00.000Z"));
  localStorage.clear();
  apiMock.apiWithCashier.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render(node: React.ReactElement) {
  root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  await settle();
}

function texto(): string {
  return container.textContent ?? "";
}

function boton(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(text),
  );
  if (!btn) throw new Error(`no hay botón con "${text}"`);
  return btn as HTMLButtonElement;
}

async function tocar(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

describe("el panel de salud", () => {
  it("mientras carga enseña el esqueleto, no un spinner", async () => {
    // Una promesa que no se resuelve: la pantalla se queda en carga.
    apiMock.apiWithCashier.mockImplementation(() => new Promise(() => {}));
    root = createRoot(container);
    await act(async () => {
      root.render(
        <AgendaHealthPanel onClose={() => {}} onOpenMatrix={() => {}} />,
      );
    });
    expect(container.querySelector("[data-test='esqueleto']")).not.toBeNull();
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("la cifra sale en grande, con su lista", async () => {
    apiMock.apiWithCashier.mockResolvedValue(salud([tarjeta()]));
    await render(<AgendaHealthPanel onClose={() => {}} onOpenMatrix={() => {}} />);
    const hero = container.querySelector(
      "[data-test='tarjeta-servicios-sin-profesional']",
    )!;
    expect(hero.querySelector("[data-test='cifra']")?.textContent).toBe("2");
    expect(hero.textContent).toContain("Spa capilar");
    expect(hero.textContent).toContain("Ritual reafirmante");
    // El dato que desambigua viaja con el nombre.
    expect(hero.textContent).toContain("Nadie lo tiene asignado");
  });

  // El cero no se deja en blanco: es una buena noticia y se dice.
  it("un cero se dice con palabras", async () => {
    apiMock.apiWithCashier.mockResolvedValue(
      salud([tarjeta({ value: 0, items: [] })]),
    );
    await render(<AgendaHealthPanel onClose={() => {}} onOpenMatrix={() => {}} />);
    expect(
      container.querySelector("[data-test='buena-noticia']")?.textContent,
    ).toContain("tienen a alguien que los da");
  });

  // Un cero falso sería peor que el hueco declarado.
  it("una tarjeta sin su dependencia sale deshabilitada y SIN cifra", async () => {
    apiMock.apiWithCashier.mockResolvedValue(salud([tarjetaPendiente()]));
    await render(<AgendaHealthPanel onClose={() => {}} onOpenMatrix={() => {}} />);
    const card = container.querySelector("[data-test='tarjeta-saldo-vivo-sin-cita']")!;
    expect(card.querySelector("[data-test='cifra']")).toBeNull();
    expect(card.querySelector("[data-test='no-disponible']")).not.toBeNull();
    expect(card.querySelector("[data-test='depende-de']")?.textContent).toContain(
      "B-reservas-8",
    );
    expect(card.textContent).not.toContain("0 programas");
  });

  // El principio del bloque, en pantalla: la consulta está al lado de la
  // cifra, en un botón que se toca (no un tooltip ni un hover).
  it("«cómo se calcula esto» enseña la consulta literal", async () => {
    apiMock.apiWithCashier.mockResolvedValue(salud([tarjeta()]));
    await render(<AgendaHealthPanel onClose={() => {}} onOpenMatrix={() => {}} />);
    expect(container.querySelector("[data-test='explicacion']")).toBeNull();
    await tocar(boton("Cómo se calcula esto"));
    const exp = container.querySelector("[data-test='explicacion']")!;
    expect(exp.textContent).toContain("FROM service_scheduling");
    expect(exp.textContent).toContain("$1 = este negocio");
  });

  it("sin red enseña la última foto con su hora, y se puede reintentar", async () => {
    // Primera lectura buena: deja la foto guardada (11:40 de Madrid).
    apiMock.apiWithCashier.mockResolvedValue(salud([tarjeta()]));
    await render(<AgendaHealthPanel onClose={() => {}} onOpenMatrix={() => {}} />);
    await act(async () => root.unmount());

    // Segunda vez, sin red.
    apiMock.apiWithCashier.mockRejectedValue(new Error("sin red"));
    await render(<AgendaHealthPanel onClose={() => {}} onOpenMatrix={() => {}} />);
    const aviso = container.querySelector("[data-test='salud-error']")!;
    expect(aviso.textContent).toContain("13:40");
    expect(aviso.querySelector("button")?.textContent).toBe("Reintentar");
    // Y lo de antes se sigue leyendo: el panel no se queda en blanco.
    expect(texto()).toContain("Spa capilar");

    apiMock.apiWithCashier.mockResolvedValue(
      salud([tarjeta({ value: 0, items: [] })]),
    );
    await tocar(boton("Reintentar"));
    expect(container.querySelector("[data-test='salud-error']")).toBeNull();
    expect(
      container.querySelector("[data-test='cifra']")?.textContent,
    ).toBe("0");
  });

  it("de la tarjeta 1 a la matriz, con ese servicio", async () => {
    apiMock.apiWithCashier.mockResolvedValue(salud([tarjeta()]));
    const abiertos: Array<string | null> = [];
    await render(
      <AgendaHealthPanel
        onClose={() => {}}
        onOpenMatrix={(id) => abiertos.push(id)}
      />,
    );
    await tocar(boton("Spa capilar"));
    expect(abiertos).toEqual([SPA]);
    await tocar(boton("Arreglarlo en la matriz"));
    expect(abiertos).toEqual([SPA, null]);
  });
});

describe("la matriz", () => {
  function mockMatriz() {
    apiMock.apiWithCashier.mockImplementation(async (path: string, opts?: any) => {
      if (path === "/agenda/skill-matrix") return structuredClone(MATRIZ);
      if (path.startsWith("/agenda/skill-matrix/service/"))
        return { staffUserIds: opts.body.staffUserIds };
      if (path.startsWith("/agenda/skill-matrix/staff/"))
        return { serviceIds: opts.body.serviceIds };
      throw new Error(`ruta no mockeada: ${path}`);
    });
  }

  it("abre con el servicio señalado y el filtro puesto", async () => {
    mockMatriz();
    await render(<AgendaSkillMatrix onClose={() => {}} focusServiceId={SPA} />);
    const ficha = container.querySelector("[data-test='ficha-matriz']")!;
    expect(ficha.textContent).toContain("Spa capilar");
    expect(ficha.textContent).toContain("Quién lo da");
    // El filtro de la tarjeta 1 viene encendido: sólo el que no tiene a nadie.
    expect(texto()).toContain("Spa capilar");
    expect(
      Array.from(container.querySelectorAll("th")).some((th) =>
        (th.textContent ?? "").includes("Ritual"),
      ),
    ).toBe(false);
  });

  // Regla nº 1 de la auditoría: lo apagado que sigue gobernando se ve.
  it("enseña el servicio apagado que conserva profesionales y a quien no cuenta", async () => {
    mockMatriz();
    await render(<AgendaSkillMatrix onClose={() => {}} focusServiceId={null} />);
    expect(texto()).toContain("Ritual reafirmante");
    expect(texto()).toContain("apagado");
    // Nuria no tiene perfil de agenda: la columna lo dice, no lo esconde.
    expect(texto()).toContain("sin perfil");
  });

  it("escribe desde la ficha del servicio (lado B)", async () => {
    mockMatriz();
    await render(<AgendaSkillMatrix onClose={() => {}} focusServiceId={SPA} />);
    const ficha = container.querySelector("[data-test='ficha-matriz']")!;
    const fila = Array.from(ficha.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Sole"),
    )!;
    await tocar(fila as HTMLElement);
    expect(apiMock.apiWithCashier).toHaveBeenCalledWith(
      `/agenda/skill-matrix/service/${SPA}`,
      { method: "PUT", body: { staffUserIds: [SOLE] } },
    );
    expect(
      container.querySelector("[data-test='aviso-guardado']")?.textContent,
    ).toContain("Spa capilar");
  });

  it("escribe desde la ficha del profesional (lado A)", async () => {
    mockMatriz();
    await render(<AgendaSkillMatrix onClose={() => {}} focusServiceId={null} />);
    // La cabecera de la columna abre la ficha del profesional.
    await tocar(boton("Sole"));
    const ficha = container.querySelector("[data-test='ficha-matriz']")!;
    expect(ficha.textContent).toContain("Qué servicios da");
    const fila = Array.from(ficha.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Spa capilar"),
    )!;
    await tocar(fila as HTMLElement);
    expect(apiMock.apiWithCashier).toHaveBeenCalledWith(
      `/agenda/skill-matrix/staff/${SOLE}`,
      { method: "PUT", body: { serviceIds: [RITUAL, SPA] } },
    );
  });

  // §4.4 del cierre: la rejilla nunca se había mirado con un catálogo de
  // verdad. Con decenas de filas, una cabecera que se va al hacer scroll
  // convierte marcar una casilla en adivinar de quién es la columna.
  it("la cabecera de la rejilla se queda fija también al bajar", async () => {
    mockMatriz();
    await render(<AgendaSkillMatrix onClose={() => {}} focusServiceId={null} />);
    const cabeceras = Array.from(
      container.querySelectorAll("thead th"),
    ) as HTMLElement[];
    expect(cabeceras.length).toBeGreaterThan(1);
    expect(cabeceras.every((th) => th.className.includes("top-0"))).toBe(true);
  });

  // El primer día de un centro: catálogo cargado y ni un perfil de agenda.
  // Sin columnas no hay nada que tocar, así que se dice y se dice dónde.
  it("sin ningún profesional con perfil lo dice, en vez de dejar una pantalla muerta", async () => {
    apiMock.apiWithCashier.mockResolvedValue({
      ...structuredClone(MATRIZ),
      staff: [],
      services: structuredClone(MATRIZ.services).map((s) => ({
        ...s,
        staffUserIds: [],
      })),
    });
    await render(<AgendaSkillMatrix onClose={() => {}} focusServiceId={null} />);
    expect(
      container.querySelector("[data-test='matriz-sin-profesionales']"),
    ).toBeTruthy();
    expect(texto()).toContain("perfil de agenda");
    expect(texto()).toContain("Profesionales");
    expect(container.querySelectorAll("td button").length).toBe(0);
  });

  // La vía en bloque: lo que la tarjeta 1 señala en un centro real son
  // decenas de servicios, y arreglarlo casilla a casilla es una petición
  // por toque. Una sola escritura, y sólo suma.
  it("el lado A marca en bloque lo agendable que falta, en una sola escritura", async () => {
    mockMatriz();
    await render(<AgendaSkillMatrix onClose={() => {}} focusServiceId={null} />);
    await tocar(boton("Sole"));
    const ficha = container.querySelector("[data-test='ficha-matriz']")!;
    const enBloque = ficha.querySelector(
      "[data-test='marcar-agendables']",
    ) as HTMLButtonElement;
    expect(enBloque).toBeTruthy();
    await tocar(enBloque);
    // Suma el agendable que le faltaba y CONSERVA el que ya daba.
    expect(apiMock.apiWithCashier).toHaveBeenCalledWith(
      `/agenda/skill-matrix/staff/${SOLE}`,
      { method: "PUT", body: { serviceIds: [RITUAL, SPA] } },
    );
  });

  it("la cajera la ve y no puede tocarla, y se le dice", async () => {
    apiMock.apiWithCashier.mockResolvedValue({ ...MATRIZ, editable: false });
    await render(<AgendaSkillMatrix onClose={() => {}} focusServiceId={null} />);
    expect(texto()).toContain("no cambiarla");
    const celdas = Array.from(
      container.querySelectorAll("td button"),
    ) as HTMLButtonElement[];
    expect(celdas.length).toBeGreaterThan(0);
    expect(celdas.every((b) => b.disabled)).toBe(true);
  });
});
