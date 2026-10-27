// personal-1 · LAS PANTALLAS DE LA FICHA, LA IMPORTACIÓN Y EL CUADRANTE.
//
// Lo que se fija aquí:
//
//   1. **La plantilla**: la cuenta de arriba, la etiqueta de cada fila con
//      la lista entera de lo que falta, el filtro «sólo incompletas»
//      puesto por defecto, y el aviso del temporal al que se le acaba el
//      contrato — que es lo que hoy se olvida.
//   2. **La ficha**: la banda con un enlace por dato, que el enlace
//      ENFOCA su campo, y que el PATCH manda `null` donde se vació (eso
//      BORRA) y no la cadena vacía.
//   3. **La importación**: la vista previa dice «completa la ficha de X» /
//      «crea a Y» / la fila que no se entiende y por qué, y **no enseña
//      ningún DNI**.
//   4. **El cuadrante**: los avisos se pintan con la MISMA función del
//      paquete puro que usa el servidor —y por lo tanto en el mismo
//      toque—, publicar con avisos pide confirmarlo, y un cuadrante
//      publicado no se toca sin motivo.
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

import { CuadrantePage } from "../src/pages/fichaje/CuadrantePage.js";
import { FichaPersonalPage } from "../src/pages/fichaje/FichaPersonalPage.js";
import { ImportarPersonalPage } from "../src/pages/fichaje/ImportarPersonalPage.js";
import { PersonalPage } from "../src/pages/fichaje/PersonalPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | undefined;
let patches: Array<{ path: string; body: unknown }>;
let posts: Array<{ path: string; body: unknown }>;
let puts: Array<{ path: string; body: unknown }>;

const falta = (campo: string, etiqueta: string, peso = "IMPRESCINDIBLE") => ({
  campo,
  etiqueta,
  peso,
});

const CATEGORIAS = [
  {
    id: "cat-aux",
    code: "AUXILIAR",
    name: "Gerocultora / auxiliar",
    countsAsDirectCare: true,
    active: true,
  },
  {
    id: "cat-adm",
    code: "ADMINISTRACION",
    name: "Administración",
    countsAsDirectCare: false,
    active: true,
  },
];

/** Ana: la ficha que nació con el nombre completo y nada más. */
const ANA = {
  id: "e-ana",
  name: "ANA SOLER RUIZ",
  lastName: null,
  nombreCompleto: "ANA SOLER RUIZ",
  categoryId: null,
  categoria: null,
  atencionDirecta: false,
  weeklyMinutes: null,
  contractKind: null,
  hiredOn: null,
  contractEndsOn: null,
  phone: null,
  email: null,
  active: true,
  tieneDni: false,
  tieneAfiliacion: false,
  faltan: {
    faltan: [
      falta("apellidos", "apellidos"),
      falta("dni", "DNI o NIE"),
      falta("afiliacion", "nº de afiliación a la Seguridad Social"),
      falta("categoria", "categoría profesional"),
      falta("jornadaSemanal", "jornada contratada"),
      falta("fechaDeAlta", "fecha de alta"),
      falta("tipoDeContrato", "tipo de contrato", "RECOMENDABLE"),
    ],
    incompleta: true,
    conImprescindibles: true,
  },
};

/** Bea: completa, y con un temporal que se le acaba en cinco días. */
const BEA = {
  ...ANA,
  id: "e-bea",
  name: "Bea",
  lastName: "Moreno Lara",
  nombreCompleto: "Bea Moreno Lara",
  categoryId: "cat-aux",
  categoria: "Gerocultora / auxiliar",
  atencionDirecta: true,
  weeklyMinutes: 2250,
  contractKind: "TEMPORAL",
  hiredOn: "2026-06-01",
  contractEndsOn: "2026-11-05",
  phone: "600111222",
  email: "bea@ejemplo.es",
  tieneDni: true,
  tieneAfiliacion: true,
  faltan: { faltan: [], incompleta: false, conImprescindibles: false },
};

const PERSONAL = {
  personal: [ANA, BEA],
  categorias: CATEGORIAS,
  resumen: {
    total: 2,
    incompletas: 1,
    datosPendientes: 7,
    conImprescindibles: 1,
    contratosQueAcaban: [
      {
        employeeId: "e-bea",
        nombre: "Bea Moreno Lara",
        contractEndsOn: "2026-11-05",
        dias: 5,
      },
    ],
  },
};

const FICHA_DE_ANA = {
  ficha: {
    id: "e-ana",
    name: "ANA SOLER RUIZ",
    lastName: null,
    dni: null,
    afiliacion: null,
    categoryId: null,
    weeklyMinutes: null,
    contractKind: null,
    hiredOn: null,
    contractEndsOn: null,
    phone: "600999888",
    email: null,
    userId: null,
    active: true,
    faltan: ANA.faltan.faltan,
    estado: ANA.faltan,
  },
  vinculo: null,
};

const TURNOS = [
  {
    id: "t-m",
    code: "M",
    name: "Mañana",
    startsAt: "08:00",
    endsAt: "15:00",
    sortOrder: 1,
    coberturaMinima: 2,
  },
  {
    id: "t-n",
    code: "N",
    name: "Noche",
    startsAt: "22:00",
    endsAt: "08:00",
    sortOrder: 3,
    coberturaMinima: 1,
  },
];

function cuadranteDe(
  celdas: Array<{
    employeeId: string;
    dia: string;
    turnoId: string | null;
    ausencia: string | null;
  }>,
  state: "BORRADOR" | "PUBLICADO" = "BORRADOR",
) {
  return {
    month: "2026-11",
    // Un mes corto a propósito: con 30 días la rejilla del test son 60
    // celdas y los `querySelectorAll` se leen.
    dias: Array.from(
      { length: 30 },
      (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`,
    ),
    cabecera: {
      id: "sch-1",
      month: "2026-11",
      state,
      origin: "MANUAL" as const,
      publishedAt: state === "PUBLICADO" ? "2026-10-28T09:00:00.000Z" : null,
      publishedBy: state === "PUBLICADO" ? "Matías" : null,
      warningsAtPublish: state === "PUBLICADO" ? 3 : null,
    },
    turnos: TURNOS,
    personas: [
      {
        employeeId: "e-ana",
        nombre: "Ana Soler",
        atencionDirecta: true,
        minutosContratados: null,
        altaEl: null,
        finEl: null,
        active: true,
        categoria: "Gerocultora / auxiliar",
      },
      {
        employeeId: "e-bea",
        nombre: "Bea Moreno",
        atencionDirecta: true,
        minutosContratados: null,
        altaEl: null,
        finEl: null,
        active: true,
        categoria: "Gerocultora / auxiliar",
      },
    ],
    celdas,
    ausencias: ["LIBRE", "VACACIONES", "IT", "ASUNTOS_PROPIOS", "PERMISO"],
    reglas: {
      ratioAtencionDirecta: 0.2,
      minutosDeJornadaCompleta: 480,
      horasDescansoDiario: 12,
      horasDescansoSemanal: 36,
      diasComputoSemanal: 7,
      conRatioDeResidencia: false,
    },
    avisos: [],
    resumen: { total: 0, rojos: 0, ambares: 0, porRegla: {} },
    ocupacionPorDia: null,
  };
}

let cuadrante = cuadranteDe([]);

beforeEach(() => {
  patches = [];
  posts = [];
  puts = [];
  cuadrante = cuadranteDe([]);
  apiMock.api.mockReset();
  apiMock.api.mockImplementation(
    async (path: string, init?: { method?: string; body?: unknown }) => {
      if (init?.method === "PATCH") {
        patches.push({ path, body: init.body });
        return { ficha: FICHA_DE_ANA.ficha };
      }
      if (init?.method === "PUT") {
        puts.push({ path, body: init.body });
        return { celdas: cuadrante.celdas, avisos: [], resumen: cuadrante.resumen };
      }
      if (init?.method === "POST") {
        posts.push({ path, body: init.body });
        if (path.endsWith("/vista-previa")) return VISTA_PREVIA;
        if (path.endsWith("/importar")) {
          return { creadas: 0, completadas: 1, sinCambios: 0, errores: [] };
        }
        return {};
      }
      if (path === "/admin/fichaje/personal") return PERSONAL;
      if (path.startsWith("/admin/fichaje/personal/")) return FICHA_DE_ANA;
      if (path.startsWith("/admin/fichaje/cuadrante")) return cuadrante;
      if (path === "/admin/fichaje/turnos") return { turnos: TURNOS, avisos: [] };
      return {};
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

const VISTA_PREVIA = {
  separador: ";",
  columnas: ["nombre", "apellidos", "dni_nie"],
  maxFilas: 1000,
  resumen: { completar: 1, sinCambios: 0, crear: 1, errores: 1 },
  errores: [
    {
      linea: 4,
      mensaje:
        "Fila 4: la fecha de alta «2026-10-01» no está en formato dd/mm/aaaa. Así, «01/06/2026».",
    },
  ],
  acciones: [
    {
      linea: 2,
      nombreCompleto: "Ana Soler Ruiz",
      que: "COMPLETAR",
      employeeId: "e-ana",
      casaCon: "ANA SOLER RUIZ",
      cambios: [
        { campo: "apellidos", antes: null, despues: "Soler Ruiz" },
        { campo: "dni", antes: null, despues: "•••" },
      ],
    },
    {
      linea: 3,
      nombreCompleto: "Zoe Marín",
      que: "CREAR",
      employeeId: null,
      casaCon: null,
      cambios: [{ campo: "apellidos", antes: null, despues: "Marín" }],
    },
    {
      linea: 4,
      nombreCompleto: "Hugo Vega",
      que: "ERROR",
      employeeId: null,
      casaCon: null,
      cambios: [],
      motivo:
        "Fila 4: la fecha de alta «2026-10-01» no está en formato dd/mm/aaaa. Así, «01/06/2026».",
    },
  ],
};

/** La pantalla del cuadrante lee el mes de `?mes=` en la URL: sin esto
 *  abriría el mes de HOY y el test dependería del día en que corra. */
function enElMesDePrueba() {
  window.history.replaceState(null, "", "/admin/fichaje/cuadrante?mes=2026-11");
}

async function pintar(nodo: React.ReactNode, ruta?: string) {
  await act(async () => {
    root = createRoot(container);
    root.render(
      ruta ? (
        // Con ruta, para que `useParams` traiga el id de la ficha: sin
        // esto la pantalla se queda en «Cargando…» para siempre, que es
        // lo que hace de verdad cuando se llega sin id.
        <MemoryRouter initialEntries={[ruta]}>
          <Routes>
            <Route path="/admin/fichaje/personal/:id" element={nodo} />
          </Routes>
        </MemoryRouter>
      ) : (
        <MemoryRouter>{nodo}</MemoryRouter>
      ),
    );
  });
  // Un tick más para los `useEffect` que piden al servidor.
  await act(async () => {
    await Promise.resolve();
  });
}

const texto = () => container.textContent ?? "";

/** Un botón por su texto EXACTO. Casar por subcadena acabó pulsando «PIN
 *  de 4 cifras» en vez de «4» en otro bloque de esta casa. */
function boton(etiqueta: string): HTMLButtonElement {
  const todos = [...container.querySelectorAll("button")];
  const exacto = todos.find((b) => (b.textContent ?? "").trim() === etiqueta);
  const contiene = todos.find((b) => (b.textContent ?? "").includes(etiqueta));
  const b = exacto ?? contiene;
  if (!b) {
    throw new Error(
      `No hay botón «${etiqueta}». Hay: ${todos.map((x) => `«${(x.textContent ?? "").trim()}»`).join(", ")}`,
    );
  }
  return b as HTMLButtonElement;
}

/**
 * Escribe en un input o textarea **controlado por React**.
 *
 * Asignar `.value` a pelo y lanzar «input» NO basta: React guarda el
 * último valor que él puso y, al no verlo cambiar en su rastreador, no
 * dispara `onChange`. Lo que hay que mover es el setter nativo del
 * prototipo, que es lo que el rastreador vigila.
 *
 * Costó cuatro tests de este fichero: la pantalla se quedaba con el
 * `textarea` vacío y el botón deshabilitado, y parecía que el botón no
 * funcionaba.
 */
async function escribir(el: Element, valor: string) {
  const proto =
    el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

async function tocar(el: Element, evento: "click" | "mousedown" = "click") {
  await act(async () => {
    el.dispatchEvent(new MouseEvent(evento, { bubbles: true }));
    await Promise.resolve();
  });
}

// ── 1 · la plantilla ──────────────────────────────────────────────────

describe("personal-1 · la plantilla", () => {
  it("dice cuántas fichas están incompletas y cuántos datos faltan", async () => {
    await pintar(<PersonalPage />);
    expect(texto()).toContain("1 de 2 fichas sin completar");
    expect(texto()).toContain("7 datos pendientes");
  });

  it("y la fila nombra TODO lo que falta, no sólo cuántos", async () => {
    // Leerlo es lo que hace que alguien lo complete sin abrir la ficha
    // para ver qué era.
    await pintar(<PersonalPage />);
    expect(texto()).toContain("Faltan 7:");
    expect(texto()).toContain("apellidos, DNI o NIE");
    expect(texto()).toContain("nº de afiliación a la Seguridad Social");
  });

  it("el filtro «sólo incompletas» viene PUESTO", async () => {
    await pintar(<PersonalPage />);
    // Bea está completa, así que no sale EN LA LISTA. Su nombre sí
    // aparece en la pantalla, en el aviso de su contrato temporal — y por
    // eso esto se mira en las filas y no en el texto entero.
    const filas = () =>
      [...container.querySelectorAll('[data-lista="plantilla"] a')].map(
        (a) => a.textContent ?? "",
      );
    expect(filas().join(" ")).toContain("ANA SOLER RUIZ");
    expect(filas().join(" ")).not.toContain("Bea Moreno Lara");
    const casilla = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    expect(casilla.checked).toBe(true);
    // `.click()` y no `checked = false` + «change»: por lo mismo que
    // `escribir` mueve el setter nativo. React guarda el último valor que
    // él puso y, si se le cambia a pelo, no dispara `onChange`.
    await act(async () => {
      casilla.click();
      await Promise.resolve();
    });
    expect(filas().join(" ")).toContain("Bea Moreno Lara");
  });

  it("avisa del temporal al que se le acaba el contrato", async () => {
    // Es lo que hoy se olvida, y la razón de que la fecha de fin exista.
    await pintar(<PersonalPage />);
    expect(texto()).toContain("A una persona se le acaba el contrato");
    expect(texto()).toContain("en 5 días");
  });

  it("y NO enseña ningún DNI: la respuesta no lo trae", async () => {
    await pintar(<PersonalPage />);
    // Lo que llega es «lo tiene / no lo tiene», nunca el valor.
    expect(JSON.stringify(PERSONAL)).not.toMatch(/\d{8}[A-Z]/);
  });
});

// ── 2 · la ficha ──────────────────────────────────────────────────────

describe("personal-1 · la ficha", () => {
  it("la banda nombra lo que falta, con un enlace por dato", async () => {
    await pintar(<FichaPersonalPage />, "/admin/fichaje/personal/e-ana");
    expect(texto()).toContain("A esta ficha le faltan:");
    expect(texto()).toContain("(recomendable)");
    // Siete datos = siete botones de la banda.
    const enlaces = [...container.querySelectorAll("button")].filter((b) =>
      ANA.faltan.faltan.some((f) => (b.textContent ?? "").trim() === f.etiqueta),
    );
    expect(enlaces).toHaveLength(7);
  });

  it("y tocar un dato de la banda ENFOCA su campo", async () => {
    await pintar(<FichaPersonalPage />, "/admin/fichaje/personal/e-ana");
    await tocar(boton("jornada contratada"));
    const activo = document.activeElement as HTMLElement | null;
    expect(activo?.tagName).toBe("INPUT");
    expect((activo as HTMLInputElement).value).toBe("");
  });

  it("guardar manda `null` donde está vacío, no la cadena vacía", async () => {
    // `null` BORRA y `""` no significa nada: el servidor distingue las dos
    // y el CHECK de la base también.
    await pintar(<FichaPersonalPage />, "/admin/fichaje/personal/e-ana");
    await tocar(boton("Guardar"));
    expect(patches).toHaveLength(1);
    const body = patches[0]!.body as Record<string, unknown>;
    expect(body.lastName).toBeNull();
    expect(body.dni).toBeNull();
    expect(body.weeklyHours).toBeNull();
    // Y lo que SÍ tiene valor viaja con él.
    expect(body.phone).toBe("600999888");
  });

  it("los dos cifrados dicen que se guardan cifrados", async () => {
    // Quien rellena la ficha tiene que saber que esto no se guarda como
    // lo demás.
    await pintar(<FichaPersonalPage />, "/admin/fichaje/personal/e-ana");
    expect(texto()).toContain(
      "Se guarda cifrado: de la base de datos no se puede leer sin la clave",
    );
  });

  it("y la fecha de fin NO se pide si el contrato no es temporal", async () => {
    await pintar(<FichaPersonalPage />, "/admin/fichaje/personal/e-ana");
    expect(texto()).toContain(
      "La fecha de fin prevista es sólo de los contratos temporales",
    );
  });
});

// ── 3 · la importación ────────────────────────────────────────────────

describe("personal-1 · la importación", () => {
  async function conCsv() {
    await pintar(<ImportarPersonalPage />);
    await escribir(
      container.querySelector("textarea")!,
      "nombre;apellidos\nAna;Soler Ruiz\n",
    );
    await tocar(boton("Ver qué va a pasar"));
  }

  it("la vista previa dice fila a fila qué va a pasar", async () => {
    await conCsv();
    expect(texto()).toContain("completa la ficha de ANA SOLER RUIZ");
    expect(texto()).toContain("se crea");
    expect(texto()).toContain("no se entiende");
  });

  it("y la fila que no se entiende dice POR QUÉ, y el resto entra igual", async () => {
    await conCsv();
    expect(texto()).toContain("Estas filas se quedan fuera");
    expect(texto()).toContain("no está en formato dd/mm/aaaa");
    expect(texto()).toContain(
      "El resto se importa igual: una fila mal escrita no tumba el fichero",
    );
  });

  it("el DNI se enseña OCULTO, nunca el valor", async () => {
    await conCsv();
    expect(texto()).toContain("•••");
  });

  it("dice que una celda vacía no borra", async () => {
    await pintar(<ImportarPersonalPage />);
    expect(texto()).toContain("no borra");
  });

  it("y al aplicar manda el MISMO csv, no el plan", async () => {
    // El servidor vuelve a planificar sobre el estado de ahora: un plan
    // guardado se queda viejo si alguien da de alta a alguien entre la
    // vista previa y el «aplicar».
    await conCsv();
    await tocar(boton("Importar"));
    const aplicar = posts.find((p) => p.path.endsWith("/importar"))!;
    expect((aplicar.body as { csv: string }).csv).toContain("Ana;Soler Ruiz");
  });
});

// ── 4 · el cuadrante ──────────────────────────────────────────────────

describe("personal-1 · el cuadrante", () => {
  it("pinta la rejilla de personas × días", async () => {
    enElMesDePrueba();
    await pintar(<CuadrantePage />);
    expect(texto()).toContain("Noviembre de 2026");
    expect(texto()).toContain("Ana Soler");
    expect(texto()).toContain("2 personas × 30 días");
  });

  it("y los avisos salen AQUÍ, con la misma función del servidor", async () => {
    // Una noche el día 2 y una mañana el 3: cero horas de descanso. El
    // servidor manda `avisos: []` en esta respuesta a propósito — si la
    // pantalla no lo calculara, este test no vería nada.
    cuadrante = cuadranteDe([
      { employeeId: "e-ana", dia: "2026-11-02", turnoId: "t-n", ausencia: null },
      { employeeId: "e-ana", dia: "2026-11-03", turnoId: "t-m", ausencia: null },
    ]);
    await pintar(<CuadrantePage />);
    expect(texto()).toContain("Descanso entre jornadas");
    expect(texto()).toContain("descansa 0 h");
  });

  it("un mes vacío con cobertura declarada sale en rojo los 30 días", async () => {
    await pintar(<CuadrantePage />);
    // Dos turnos con mínimo × 30 días = 60 avisos de cobertura.
    expect(texto()).toContain("60 avisos");
    expect(texto()).toContain("60 incumplen una norma");
  });

  it("pintar una celda la guarda al soltar, sin botón de guardar", async () => {
    await pintar(<CuadrantePage />);
    await tocar(boton("M08:00–15:00"));
    const celda = container.querySelector("#celda-e-ana-2026-11-02")!;
    await tocar(celda, "mousedown");
    expect(puts).toHaveLength(1);
    const body = puts[0]!.body as { celdas: Array<Record<string, unknown>> };
    expect(body.celdas[0]).toMatchObject({
      employeeId: "e-ana",
      dia: "2026-11-02",
      turnoIds: ["t-m"],
      ausencia: null,
    });
    expect(texto()).toContain("no hay botón de guardar");
  });

  it("y sin pincel elegido las celdas no hacen nada", async () => {
    await pintar(<CuadrantePage />);
    const celda = container.querySelector<HTMLButtonElement>(
      "#celda-e-ana-2026-11-02",
    )!;
    expect(celda.disabled).toBe(true);
    await tocar(celda, "mousedown");
    expect(puts).toHaveLength(0);
  });

  it("un cuadrante PUBLICADO pide el motivo antes de tocar nada", async () => {
    cuadrante = cuadranteDe([], "PUBLICADO");
    await pintar(<CuadrantePage />);
    expect(texto()).toContain("ya está publicado y su gente lo ha visto");
    expect(texto()).toContain("con 3 aviso(s) apuntados");
    await tocar(boton("M08:00–15:00"));
    await tocar(container.querySelector("#celda-e-ana-2026-11-02")!, "mousedown");
    // Sin motivo no se manda nada, y se dice por qué.
    expect(puts).toHaveLength(0);
    expect(texto()).toContain("escribe arriba por qué lo cambias");
  });

  it("y con el motivo escrito, el PUT lo lleva", async () => {
    cuadrante = cuadranteDe([], "PUBLICADO");
    await pintar(<CuadrantePage />);
    await escribir(
      container.querySelector('input[placeholder^="Por qué lo cambias"]')!,
      "Ana se pone de baja",
    );
    await tocar(boton("M08:00–15:00"));
    await tocar(container.querySelector("#celda-e-ana-2026-11-02")!, "mousedown");
    expect(puts).toHaveLength(1);
    expect((puts[0]!.body as { motivo: string }).motivo).toBe(
      "Ana se pone de baja",
    );
  });

  it("un publicado no ofrece «Publicar»", async () => {
    cuadrante = cuadranteDe([], "PUBLICADO");
    await pintar(<CuadrantePage />);
    expect(
      [...container.querySelectorAll("button")].some(
        (b) => (b.textContent ?? "").trim() === "Publicar",
      ),
    ).toBe(false);
  });

  it("y los fines de semana se distinguen de los días de trabajo", async () => {
    // Es lo primero que se mira en un cuadrante, y 30 números no lo dicen.
    await pintar(<CuadrantePage />);
    const cabeceras = [...container.querySelectorAll("thead th")];
    const sabado = cabeceras.find((th) => th.id === "col-2026-11-07")!;
    expect(sabado.className).toContain("bg-mipiace-stone");
    const lunes = cabeceras.find((th) => th.id === "col-2026-11-02")!;
    expect(lunes.className).not.toContain("bg-mipiace-stone");
    expect(sabado.textContent).toContain("S");
  });
});
