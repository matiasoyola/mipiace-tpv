// residencia-2 · LAS TRES PANTALLAS DEL CATÁLOGO Y DEL PLAN.
//
// Lo que se fija aquí:
//
//   1. **Controles**: el catálogo por capas; lo de serie se ve como
//      «estándar»; lo del producto se PINTA y no se puede editar; el panel
//      sólo ofrece las frecuencias y los roles que el producto permite; y
//      el aviso de la reconducción sale arriba.
//   2. **Plantillas**: los tres niveles, y que sólo el dependiente lleva
//      cambios posturales. Y que la pantalla DICE que guardar no toca los
//      planes abiertos.
//   3. **Plan del residente**: la vista «hoy» agrupada por turno, las
//      franjas sin hora y los instantes con ella, el aviso de lo
//      desactivado, el histórico detrás de un botón y —la que importa— que
//      una línea MANUAL se distingue de una de plantilla.
//
// Mismo patrón sin testing-library que el resto del repo: createRoot + act.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

vi.mock("../src/AdminShell.js", () => ({
  AdminShell: ({ children }: { children: unknown }) => children,
}));

import { ControlesPage } from "../src/pages/residencia/ControlesPage.js";
import { PlantillasPage } from "../src/pages/residencia/PlantillasPage.js";
import { PlanResidentePage } from "../src/pages/residencia/PlanResidentePage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | undefined;
let patches: Array<{ path: string; body: any }>;
let posts: Array<{ path: string; body: any }>;
let puts: Array<{ path: string; body: any }>;
let deletes: string[];
let conReconduccion = false;
let planVacio = false;

const CARMEN = "11111111-1111-1111-1111-111111111111";

const TURNOS = [
  { code: "M", name: "Mañana", startsAt: "08:00", endsAt: "15:00" },
  { code: "T", name: "Tarde", startsAt: "15:00", endsAt: "22:00" },
  { code: "N", name: "Noche", startsAt: "22:00", endsAt: "08:00" },
];
const MOMENTOS = [
  { code: "DESAYUNO", name: "Desayuno", atTime: "09:00" },
  { code: "COMIDA", name: "Comida", atTime: "13:30" },
];
const ROLES = [
  { code: "AUXILIAR", name: "Auxiliar / gerocultora", category: "OPERATIVO" },
  { code: "DUE", name: "DUE (enfermería)", category: "SUPERVISOR" },
  { code: "LIMPIEZA", name: "Limpieza", category: "OPERATIVO" },
];

function catalogo() {
  return {
    controles: [
      {
        id: "c1",
        scope: "STANDARD",
        code: "HIGIENE_PERSONAL",
        version: 1,
        name: "Higiene personal",
        layer: "EXEC",
        nature: "SCHEDULED",
        valueDomain: "BOOL",
        unit: null,
        inputMin: null,
        inputMax: null,
        refMin: null,
        refMax: null,
        groupCode: null,
        isoIndicatorCode: "HIGIENE",
        sortOrder: 10,
        validFrom: "2026-10-15T00:00:00.000Z",
        opciones: [],
        puedeElegir: { frecuencias: ["DAILY", "EVERY_SHIFT"], roles: ["AUXILIAR", "DUE"] },
        ajuste: {
          active: true,
          alias: null,
          frecuencia: { kind: "DAILY", shiftCodes: ["M"] },
          careRoleCodes: ["AUXILIAR", "DUE"],
          familyVisible: false,
          reconducido: null,
        },
        frecuenciaDeSerie: { kind: "DAILY", shiftCodes: ["M"] },
      },
      {
        id: "c2",
        scope: "STANDARD",
        code: "ANIMO",
        version: 1,
        name: "Ánimo",
        layer: "OBS",
        nature: "SCHEDULED",
        valueDomain: "ORDINAL",
        unit: null,
        inputMin: null,
        inputMax: null,
        refMin: null,
        refMax: null,
        groupCode: null,
        isoIndicatorCode: "BIENESTAR",
        sortOrder: 300,
        validFrom: "2026-10-15T00:00:00.000Z",
        opciones: [
          { code: "BIEN", label: "Bien, como siempre", comoSiempre: true },
          { code: "TRISTE", label: "Triste, llora", comoSiempre: false },
        ],
        puedeElegir: { frecuencias: ["EVERY_SHIFT", "DAILY"], roles: ["AUXILIAR", "DUE"] },
        ajuste: {
          active: true,
          alias: null,
          frecuencia: { kind: "EVERY_SHIFT", shiftCodes: ["M", "T"] },
          careRoleCodes: ["AUXILIAR"],
          familyVisible: false,
          reconducido: conReconduccion
            ? {
                cuando: "2026-10-15T09:00:00.000Z",
                desdeVersion: 1,
                motivo:
                  "la versión 2 retiró la frecuencia «EVERY_SHIFT», que este centro tenía elegida",
              }
            : null,
        },
        frecuenciaDeSerie: { kind: "DAILY", shiftCodes: ["M"] },
      },
      {
        id: "c3",
        scope: "STANDARD",
        code: "TEMPERATURA",
        version: 1,
        name: "Temperatura",
        layer: "MEASURE",
        nature: "ON_DEMAND",
        valueDomain: "NUMERIC",
        unit: "°C",
        inputMin: 30,
        inputMax: 45,
        refMin: 36,
        refMax: 37.4,
        groupCode: null,
        isoIndicatorCode: "SEGUIMIENTO_CLINICO",
        sortOrder: 400,
        validFrom: "2026-10-15T00:00:00.000Z",
        opciones: [],
        puedeElegir: { frecuencias: ["ON_DEMAND"], roles: ["AUXILIAR", "DUE"] },
        ajuste: {
          active: true,
          alias: null,
          frecuencia: { kind: "ON_DEMAND" },
          careRoleCodes: ["AUXILIAR", "DUE"],
          familyVisible: false,
          reconducido: null,
        },
        frecuenciaDeSerie: { kind: "ON_DEMAND" },
      },
      {
        id: "c4",
        scope: "CENTER",
        code: "POMADA",
        version: 2,
        name: "Pomada en la espalda",
        layer: "EXEC",
        nature: "SCHEDULED",
        valueDomain: "BOOL",
        unit: null,
        inputMin: null,
        inputMax: null,
        refMin: null,
        refMax: null,
        groupCode: null,
        isoIndicatorCode: null,
        sortOrder: 900,
        validFrom: "2026-10-15T00:00:00.000Z",
        opciones: [],
        puedeElegir: { frecuencias: ["DAILY"], roles: ["AUXILIAR"] },
        ajuste: {
          active: false,
          alias: null,
          frecuencia: { kind: "DAILY", shiftCodes: ["T"] },
          careRoleCodes: ["AUXILIAR"],
          familyVisible: false,
          reconducido: null,
        },
        frecuenciaDeSerie: { kind: "DAILY", shiftCodes: ["T"] },
      },
    ],
    turnos: TURNOS,
    momentos: MOMENTOS,
    roles: ROLES,
  };
}

function plantillas() {
  return {
    plantillas: {
      VALIDO: [
        {
          id: "t1",
          controlCode: "HIGIENE_PERSONAL",
          nombre: "Higiene personal",
          frecuencia: { kind: "DAILY", shiftCodes: ["M"] },
          activo: true,
        },
      ],
      SEMIASISTIDO: [
        {
          id: "t2",
          controlCode: "HIGIENE_PERSONAL",
          nombre: "Higiene personal",
          frecuencia: { kind: "DAILY", shiftCodes: ["M"] },
          activo: true,
        },
        {
          id: "t3",
          controlCode: "POMADA",
          nombre: "Pomada en la espalda",
          frecuencia: { kind: "DAILY", shiftCodes: ["T"] },
          // El centro lo desactivó: se pinta en ámbar y no se quita solo.
          activo: false,
        },
      ],
      DEPENDIENTE: [
        {
          id: "t4",
          controlCode: "CAMBIO_POSTURAL",
          nombre: "Cambio postural",
          frecuencia: { kind: "EVERY_N_HOURS", everyNHours: 3 },
          activo: true,
        },
      ],
    },
    controles: [
      {
        code: "HIDRATACION_CUTANEA",
        nombre: "Hidratación cutánea",
        layer: "EXEC",
        nature: "SCHEDULED",
        activo: true,
        puedeElegir: { frecuencias: ["DAILY", "EVERY_SHIFT"] },
        frecuenciaDeSerie: { kind: "DAILY", shiftCodes: ["T"] },
      },
      {
        code: "DEPOSICION",
        nombre: "Deposición",
        layer: "EXEC",
        nature: "ON_DEMAND",
        activo: true,
        puedeElegir: { frecuencias: ["ON_DEMAND"] },
        frecuenciaDeSerie: { kind: "ON_DEMAND" },
      },
      {
        code: "HIGIENE_PERSONAL",
        nombre: "Higiene personal",
        layer: "EXEC",
        nature: "SCHEDULED",
        activo: true,
        puedeElegir: { frecuencias: ["DAILY"] },
        frecuenciaDeSerie: { kind: "DAILY", shiftCodes: ["M"] },
      },
      {
        code: "CAMBIO_POSTURAL",
        nombre: "Cambio postural",
        layer: "EXEC",
        nature: "SCHEDULED",
        activo: true,
        puedeElegir: { frecuencias: ["EVERY_N_HOURS"] },
        frecuenciaDeSerie: { kind: "EVERY_N_HOURS", everyNHours: 3 },
      },
    ],
    turnos: TURNOS,
    momentos: MOMENTOS,
  };
}

function plan() {
  return {
    residente: {
      dependencyLevel: "DEPENDIENTE",
      admissionDate: "2026-10-14",
      dischargeDate: null,
    },
    lineas: planVacio
      ? []
      : [
          {
            id: "l1",
            controlCode: "HIGIENE_PERSONAL",
            nombre: "Higiene personal",
            layer: "EXEC",
            frecuencia: { kind: "DAILY", shiftCodes: ["M"] },
            frecuenciaEnPalabras: "Una vez al día (Mañana)",
            desde: "2026-10-14T00:00:00.000Z",
            hasta: null,
            source: "PROFILE_TEMPLATE",
            sourceLevel: "DEPENDIENTE",
            motivo: "ingreso",
            motivoDeCierre: null,
            controlDesactivado: false,
            turnoDesconocido: false,
            momentoDesconocido: false,
          },
          {
            id: "l2",
            controlCode: "CAMBIO_POSTURAL",
            nombre: "Cambio postural",
            layer: "EXEC",
            frecuencia: { kind: "EVERY_N_HOURS", everyNHours: 2 },
            frecuenciaEnPalabras: "Cada 2 h, también de noche",
            desde: "2026-11-01T00:00:00.000Z",
            hasta: null,
            // La puso la DUE a mano: es la que sobrevive a un cambio de
            // nivel, y la pantalla tiene que decirlo.
            source: "MANUAL",
            sourceLevel: null,
            motivo: "lo pide la DUE",
            motivoDeCierre: null,
            controlDesactivado: false,
            turnoDesconocido: false,
            momentoDesconocido: false,
          },
          {
            id: "l3",
            controlCode: "POMADA",
            nombre: "Pomada en la espalda",
            layer: "EXEC",
            frecuencia: { kind: "DAILY", shiftCodes: ["T"] },
            frecuenciaEnPalabras: "Una vez al día (Tarde)",
            desde: "2026-10-14T00:00:00.000Z",
            hasta: null,
            source: "PROFILE_TEMPLATE",
            sourceLevel: "DEPENDIENTE",
            motivo: null,
            motivoDeCierre: null,
            // El centro lo desactivó: existe y no toca.
            controlDesactivado: true,
            turnoDesconocido: false,
            momentoDesconocido: false,
          },
        ],
    cerradas: [
      {
        id: "l0",
        controlCode: "CAMBIO_POSTURAL",
        nombre: "Cambio postural",
        layer: "EXEC",
        frecuencia: { kind: "EVERY_N_HOURS", everyNHours: 3 },
        frecuenciaEnPalabras: "Cada 3 h, también de noche",
        desde: "2026-10-14T00:00:00.000Z",
        hasta: "2026-11-01T00:00:00.000Z",
        source: "PROFILE_TEMPLATE",
        sourceLevel: "DEPENDIENTE",
        motivo: "ingreso",
        motivoDeCierre: "cambio de frecuencia",
        controlDesactivado: false,
        turnoDesconocido: false,
        momentoDesconocido: false,
      },
    ],
    disponibles: [
      {
        code: "HIDRATACION_CUTANEA",
        nombre: "Hidratación cutánea",
        layer: "EXEC",
        nature: "SCHEDULED",
        puedeElegir: { frecuencias: ["DAILY", "EVERY_SHIFT"] },
        frecuenciaPropuesta: { kind: "DAILY", shiftCodes: ["T"] },
      },
    ],
    turnos: TURNOS,
    momentos: MOMENTOS,
  };
}

function hoy() {
  return {
    dia: "2026-10-14",
    porTurno: [
      {
        code: "M",
        name: "Mañana",
        desde: "08:00",
        hasta: "15:00",
        ocurrencias: [
          {
            controlCode: "HIGIENE_PERSONAL",
            nombre: "Higiene personal",
            layer: "EXEC",
            at: "2026-10-14T06:00:00.000Z",
            until: "2026-10-14T13:00:00.000Z",
            // FRANJA: se pinta SIN hora. Con hora haría creer que la
            // higiene se incumple a las 08:01.
            esFranja: true,
            shiftCode: "M",
            momentCode: null,
          },
          {
            controlCode: "CAMBIO_POSTURAL",
            nombre: "Cambio postural",
            layer: "EXEC",
            // 10:00 de pared en octubre (UTC+2).
            at: "2026-10-14T08:00:00.000Z",
            until: null,
            esFranja: false,
            shiftCode: "M",
            momentCode: null,
          },
        ],
      },
      { code: "T", name: "Tarde", desde: "15:00", hasta: "22:00", ocurrencias: [] },
      { code: "N", name: "Noche", desde: "22:00", hasta: "08:00", ocurrencias: [] },
    ],
    sinTurno: [],
    total: 2,
    aDemanda: [{ controlCode: "DEPOSICION", nombre: "Deposición" }],
  };
}

beforeEach(() => {
  patches = [];
  posts = [];
  puts = [];
  deletes = [];
  conReconduccion = false;
  planVacio = false;
  apiMock.api.mockImplementation(async (path: string, init?: any) => {
    if (init?.method === "PATCH") {
      patches.push({ path, body: init.body });
      return { ajuste: {} };
    }
    if (init?.method === "POST") {
      posts.push({ path, body: init.body });
      return { control: { id: "x" }, linea: { id: "y" } };
    }
    if (init?.method === "PUT") {
      puts.push({ path, body: init.body });
      return { nivel: "VALIDO", lineas: 0 };
    }
    if (init?.method === "DELETE") {
      deletes.push(path);
      return { cerrada: true };
    }
    if (path === "/residencia/controles") return catalogo();
    if (path === "/residencia/plantillas") return plantillas();
    if (path.endsWith("/plan")) return plan();
    if (path.includes("/plan/hoy")) return hoy();
    return {};
  });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = undefined;
  }
  container.remove();
});

async function pintar(Pantalla: () => JSX.Element) {
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter>
        <Pantalla />
      </MemoryRouter>,
    );
  });
}

/** El plan vive bajo `/:clientId/plan`, así que necesita su ruta. */
async function pintarPlan() {
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[`/admin/residencia/residentes/${CARMEN}/plan`]}>
        <Routes>
          <Route
            path="/admin/residencia/residentes/:clientId/plan"
            element={<PlanResidentePage />}
          />
        </Routes>
      </MemoryRouter>,
    );
  });
}

/** Los botones de «quitar» sólo llevan un icono: se buscan por su `aria-label`. */
function botonPorAria(label: string): HTMLButtonElement | undefined {
  return container.querySelector(
    `button[aria-label="${label}"]`,
  ) as HTMLButtonElement | null ?? undefined;
}

function botonQueContiene(texto: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function pulsar(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// ══ 1 · CONTROLES ═════════════════════════════════════════════════════

describe("residencia-2 · Controles", () => {
  it("agrupa por capas, y cada capa dice QUÉ CLASE DE PREGUNTA es", async () => {
    // «Capa de ejecución» no significa nada para nadie: lo que la
    // dirección necesita leer es «¿se hizo?».
    await pintar(ControlesPage);
    const t = container.textContent ?? "";
    expect(t).toContain("Lo que se hace");
    expect(t).toContain("¿Se hizo?");
    expect(t).toContain("Cómo está hoy");
    expect(t).toContain("como siempre");
    expect(t).toContain("Constantes");
  });

  it("lo de serie se ve como «estándar» y lo propio como del centro", async () => {
    await pintar(ControlesPage);
    const t = container.textContent ?? "";
    expect(t).toContain("estándar v1");
    expect(t).toContain("tu centro · v2");
  });

  it("un control DESACTIVADO se ve desactivado y dice que no se usa", async () => {
    await pintar(ControlesPage);
    expect(container.textContent).toContain("No lo usáis");
  });

  it("una medida enseña su unidad y su rango NORMAL", async () => {
    await pintar(ControlesPage);
    expect(container.textContent).toContain("normal 36–37.4");
  });

  it("cuenta cuántos están activos · 3 de 4", async () => {
    await pintar(ControlesPage);
    expect(container.textContent).toContain("de 4 activos");
  });

  it("EL AVISO DE RECONDUCCIÓN sale arriba, con su motivo", async () => {
    // Es lo ÚNICO de esta pantalla que pasó sin que nadie lo pidiera, así
    // que no puede estar escondido dentro de un panel.
    conReconduccion = true;
    await pintar(ControlesPage);
    const t = container.textContent ?? "";
    expect(t).toContain("se ha tenido que reconducir");
    expect(t).toContain("retiró la frecuencia");
  });

  it("…y sin reconducción, no hay aviso", async () => {
    await pintar(ControlesPage);
    expect(container.textContent).not.toContain("reconducir");
  });

  it("el panel de un control de serie PINTA lo del producto y NO lo deja editar", async () => {
    await pintar(ControlesPage);
    await pulsar(botonQueContiene("Temperatura")!);
    const t = container.textContent ?? "";
    expect(t).toContain("Control del producto · versión 1");
    expect(t).toContain("Se puede teclear de 30 a 45");
    expect(t).toContain("lo normal es 36–37.4");
    expect(t).toContain("se actualiza en todos los centros");
    // Y ni un campo editable del producto: la unidad y los rangos se leen.
    const editables = [...container.querySelectorAll("input")].map((i) => i.id);
    expect(editables).not.toContain("ctrl-unit");
    expect(editables).not.toContain("ctrl-refmin");
  });

  it("y SÓLO ofrece las frecuencias que el producto permite", async () => {
    // La temperatura sólo admite «a demanda». Si la pantalla ofreciera las
    // ocho, el servidor contestaría un 400 y el usuario no sabría por qué.
    await pintar(ControlesPage);
    await pulsar(botonQueContiene("Temperatura")!);
    expect(botonQueContiene("A demanda")).toBeDefined();
    expect(botonQueContiene("Cada N horas")).toBeUndefined();
    expect(container.textContent).toContain("sólo admite esta frecuencia");
  });

  it("…y sólo los roles que el producto permite · «limpieza» no sale", async () => {
    await pintar(ControlesPage);
    await pulsar(botonQueContiene("Ánimo")!);
    const t = container.textContent ?? "";
    expect(t).toContain("Auxiliar / gerocultora");
    expect(t).toContain("Puedes quitar roles de la lista del producto, no añadir");
    // «Limpieza» está en el centro pero no entre los permitidos del ánimo.
    expect(botonQueContiene("Limpieza")).toBeUndefined();
  });

  it("las opciones de un ordinal se leen, con cuál es el «como siempre»", async () => {
    await pintar(ControlesPage);
    await pulsar(botonQueContiene("Ánimo")!);
    expect(container.textContent).toContain("Bien, como siempre (como siempre)");
  });

  it("guardar manda SÓLO los cinco campos del centro", async () => {
    await pintar(ControlesPage);
    await pulsar(botonQueContiene("Higiene personal")!);
    await pulsar(botonQueContiene("Guardar")!);
    expect(patches).toHaveLength(1);
    expect(Object.keys(patches[0]!.body).sort()).toEqual([
      "active",
      "alias",
      "careRoleCodes",
      "familyVisible",
      "frecuencia",
    ]);
  });

  it("desactivar un control DICE que el plan se queda", async () => {
    await pintar(ControlesPage);
    await pulsar(botonQueContiene("Higiene personal")!);
    await pulsar(botonQueContiene("No lo usamos")!);
    expect(container.textContent).toContain("Las líneas de plan que lo nombran se quedan");
  });
});

// ══ 2 · PLANTILLAS ════════════════════════════════════════════════════

describe("residencia-2 · Plantillas por nivel", () => {
  it("los tres niveles, con lo que cada uno significa", async () => {
    await pintar(PlantillasPage);
    const t = container.textContent ?? "";
    expect(t).toContain("Válido");
    expect(t).toContain("Se vale solo");
    expect(t).toContain("Semiasistido");
    expect(t).toContain("Dependiente");
    expect(t).toContain("hay que movilizarlo");
  });

  it("SÓLO el dependiente lleva cambios posturales · es LA línea del nivel", async () => {
    await pintar(PlantillasPage);
    const t = container.textContent ?? "";
    expect(t).toContain("Cambio postural");
    expect(t).toContain("Cada 3 h, también de noche");
  });

  it("DICE que guardar no toca los planes ya abiertos", async () => {
    // Si no lo dijera, la dirección movería una casilla creyendo que
    // arregla los 49 planes de hoy.
    await pintar(PlantillasPage);
    expect(container.textContent).toContain(
      "Guardar no cambia los planes que ya están abiertos",
    );
  });

  it("una línea de un control DESACTIVADO se avisa y NO se quita sola", async () => {
    await pintar(PlantillasPage);
    expect(container.textContent).toContain("El control está desactivado");
    expect(container.textContent).toContain("Pomada en la espalda");
  });

  it("un nivel VACÍO lo dice en vez de quedarse en blanco", async () => {
    await pintar(PlantillasPage);
    // Ninguno está vacío en el doble, así que se vacía el válido quitando
    // su única línea.
    await pulsar(botonPorAria("Quitar Higiene personal")!);
    expect(container.textContent).toContain("entrará con el plan vacío");
  });

  it("al añadir, NO se ofrece un control A DEMANDA", async () => {
    // No haría daño pero no haría nada: `queToca` no devuelve ocurrencias
    // suyas, y el servidor lo rechaza. Mejor no ofrecerlo que explicar por
    // qué no vale.
    await pintar(PlantillasPage);
    await pulsar([...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Añadir"),
    )!);
    const t = container.textContent ?? "";
    expect(t).toContain("Hidratación cutánea");
    expect(t).not.toContain("Deposición");
  });

  it("el botón de GUARDAR sólo aparece si algo ha cambiado", async () => {
    await pintar(PlantillasPage);
    expect(botonQueContiene("Guardar")).toBeUndefined();
    await pulsar(botonPorAria("Quitar Higiene personal")!);
    expect(botonQueContiene("Guardar")).toBeDefined();
  });

  it("guardar manda la lista COMPLETA del nivel, por `PUT`", async () => {
    await pintar(PlantillasPage);
    await pulsar(botonPorAria("Quitar Higiene personal")!);
    await pulsar(botonQueContiene("Guardar")!);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.path).toBe("/residencia/plantillas/VALIDO");
    expect(puts[0]!.body.lineas).toEqual([]);
  });
});

// ══ 3 · EL PLAN DE UN RESIDENTE ═══════════════════════════════════════

describe("residencia-2 · Plan del residente", () => {
  it("la vista HOY sale arriba, agrupada por turno", async () => {
    // Es la prueba de que el plan está bien antes de que la puerta exista.
    await pintarPlan();
    const t = container.textContent ?? "";
    expect(t).toContain("Hoy le tocaría");
    expect(t).toContain("exactamente lo que la tablet de su puerta va a pedir");
    expect(t).toContain("Mañana");
    expect(t).toContain("08:00–15:00");
    expect(t).toContain("Nada en este turno");
  });

  it("las FRANJAS van SIN hora y los instantes CON ella", async () => {
    // Una franja con hora haría creer que la higiene se incumple a las
    // 08:01. El instante sí la lleva: un cambio postural a las 10:00 es a
    // las 10:00.
    await pintarPlan();
    const mañana = [...container.querySelectorAll("li")].filter((li) =>
      li.textContent?.includes("Higiene personal"),
    );
    expect(mañana.some((li) => li.textContent?.includes("—"))).toBe(true);
    expect(container.textContent).toContain("10:00");
  });

  it("los A DEMANDA salen aparte, no escondidos", async () => {
    await pintarPlan();
    expect(container.textContent).toContain("Y a demanda");
    expect(container.textContent).toContain("Deposición");
  });

  it("UNA LÍNEA MANUAL SE DISTINGUE de una de plantilla", async () => {
    // Importa porque es lo que decide qué sobrevive a un cambio de nivel.
    await pintarPlan();
    const t = container.textContent ?? "";
    expect(t).toContain("puesto a mano");
    expect(t).toContain("de la plantilla de dependiente");
  });

  it("un control DESACTIVADO por el centro se avisa en su línea", async () => {
    await pintarPlan();
    expect(container.textContent).toContain(
      "El centro ha desactivado este control: no le toca",
    );
  });

  it("el HISTÓRICO está detrás de un botón, y dice por qué se guarda", async () => {
    await pintarPlan();
    expect(container.textContent).not.toContain("Líneas cerradas");
    await pulsar(botonQueContiene("Histórico (1)")!);
    const t = container.textContent ?? "";
    expect(t).toContain("Líneas cerradas");
    expect(t).toContain("no se borran");
    expect(t).toContain("cambio de frecuencia");
  });

  it("un plan VACÍO lo dice y manda a Plantillas", async () => {
    planVacio = true;
    await pintarPlan();
    const t = container.textContent ?? "";
    expect(t).toContain("Su plan está vacío");
    expect(t).toContain("Plantillas por nivel");
  });

  it("quitar una línea manda un DELETE · y la API la CIERRA", async () => {
    await pintarPlan();
    await pulsar(botonPorAria("Quitar Cambio postural")!);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain(`/residencia/residentes/${CARMEN}/plan/l2`);
  });

  it("cambiar la frecuencia DICE que cierra una línea y abre otra", async () => {
    // No es un detalle técnico que se pueda esconder: es lo que hace que
    // «¿qué le tocaba en marzo?» tenga respuesta, y lo que explica que el
    // histórico crezca cada vez que se toca algo.
    await pintarPlan();
    await pulsar(botonQueContiene("Higiene personal")!);
    expect(container.textContent).toContain(
      "La línea de ahora se cierra y se abre una nueva",
    );
  });

  it("añadir un control propone la frecuencia DEL CENTRO", async () => {
    await pintarPlan();
    await pulsar(botonQueContiene("Añadir control")!);
    await pulsar(botonQueContiene("Hidratación cutánea")!);
    await pulsar(botonQueContiene("Añadir al plan")!);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({
      controlCode: "HIDRATACION_CUTANEA",
      frecuencia: { kind: "DAILY", shiftCodes: ["T"] },
    });
  });
});
