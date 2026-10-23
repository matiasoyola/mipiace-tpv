// alta-minima · LAS PANTALLAS DE «LO QUE LE FALTA A UNA FICHA».
//
// Lo que se fija aquí:
//
//   1. **La lista**: «12 de 43 fichas incompletas», la etiqueta de cada
//      fila (roja si falta algún imprescindible) y el filtro «Sólo
//      incompletas» **puesto por defecto** mientras quede alguna — y que
//      DESAPARECE cuando no queda ninguna.
//   2. **La ficha**: la banda con un enlace por dato, que el enlace
//      ENFOCA su campo, el formulario que la apaga y que el PATCH manda
//      **sólo lo que cambió** (reenviar el mismo nivel recalcularía el
//      plan de alguien).
//   3. **Añadir varios**: la vista previa con los que se crean y los que
//      ya existen, los sabotajes del pegado y el límite.
//   4. **El panel**: la tarjeta con «Completar», que lleva a Residentes
//      con el `?completar=` de la primera incompleta.
//   5. Que un residente sin nivel ni fecha **no sale como «Invalid
//      Date»** en ningún sitio.
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

vi.mock("../src/AdminShell.js", () => ({
  AdminShell: ({ children }: { children: unknown }) => children,
}));

import { PanelPage } from "../src/pages/residencia/PanelPage.js";
import { ResidentesPage } from "../src/pages/residencia/ResidentesPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | undefined;
let posts: Array<{ path: string; body: unknown }>;
let patches: Array<{ path: string; body: unknown }>;

const ABEL = "c-abel";
const CARMEN = "c-carmen";
const COMPLETA = "c-completa";

/** Un dato que falta, como lo manda el servidor. */
const falta = (campo: string, etiqueta: string, peso = "IMPRESCINDIBLE") => ({
  campo,
  etiqueta,
  peso,
});

/**
 * Abel: el residente del alta rápida. Nombre y nada más, con los apellidos
 * vacíos a propósito (decisión 7).
 */
const ABEL_FILA = {
  clientId: ABEL,
  nombre: "ABEL RAMOS DOBLADO",
  firstName: "ABEL RAMOS DOBLADO",
  lastName: "",
  phone: null,
  birthdate: null,
  admissionDate: null,
  dischargeDate: null,
  dischargeReason: null,
  dependencyLevel: null,
  dependencyGrade: null,
  placeType: null,
  responsible: null,
  cama: null,
  faltan: [
    falta("apellidos", "apellidos"),
    falta("fechaDeIngreso", "fecha de ingreso"),
    falta("nivelDeDependencia", "nivel de dependencia"),
    falta("tipoDePlaza", "tipo de plaza"),
    falta("dni", "DNI"),
    falta("familiarResponsable", "familiar responsable"),
    falta("planDeCuidados", "plan de cuidados"),
    falta("gradoReconocido", "grado reconocido", "RECOMENDABLE"),
    falta("nss", "nº de la Seguridad Social", "RECOMENDABLE"),
    falta("fechaDeNacimiento", "fecha de nacimiento", "RECOMENDABLE"),
    falta("cama", "cama asignada", "RECOMENDABLE"),
  ],
};

/** Carmen: le falta sólo lo RECOMENDABLE. Ámbar, no rojo. */
const CARMEN_FILA = {
  ...ABEL_FILA,
  clientId: CARMEN,
  nombre: "Carmen del Río",
  firstName: "Carmen",
  lastName: "del Río",
  admissionDate: "2026-01-10",
  dependencyLevel: "DEPENDIENTE" as const,
  dependencyGrade: "III" as const,
  placeType: "PRIVADA" as const,
  responsible: { name: "Pilar", phone: "600111222", relation: "hija" },
  cama: {
    assignmentId: "oc-1",
    bedId: "b-112a",
    bedLabel: "A",
    roomId: "h-112",
    roomNumber: "112",
    roomName: null,
    floorId: "p-1",
    floorName: "Primera",
    desde: "2026-01-10T00:00:00.000Z",
  },
  faltan: [falta("nss", "nº de la Seguridad Social", "RECOMENDABLE")],
};

/** Y una COMPLETA: ninguna etiqueta, ninguna banda. */
const COMPLETA_FILA = {
  ...CARMEN_FILA,
  clientId: COMPLETA,
  nombre: "Luis Prieto",
  firstName: "Luis",
  lastName: "Prieto",
  faltan: [],
};

let residentes = [ABEL_FILA, CARMEN_FILA, COMPLETA_FILA];
let resumen = {
  total: 3,
  incompletas: 2,
  datosPendientes: 12,
  conImprescindibles: 1,
};

const PANEL = {
  abierto: {
    porNivel: [],
    avisosSinAcuse: 0,
    sinConstanciaDeFamilia: 0,
    esperandoCierreDeOtro: 0,
    total: 0,
  },
  relevos: { ultimo: null, sinConfirmar: [] },
  obligaciones: { hoy: [], vencidas: [], proximas: [] },
  turno: { turno: null, careDay: "2026-10-23", plantas: [], noHechoDeTurnosCerrados: 0 },
  porArreglar: { pinesPorRenovar: [], residentesSinPlan: [] },
  fichasIncompletas: {
    total: 43,
    incompletas: 12,
    datosPendientes: 31,
    conImprescindibles: 9,
    primeras: [
      {
        clientId: ABEL,
        nombre: "ABEL RAMOS DOBLADO",
        habitacion: null,
        faltan: ABEL_FILA.faltan,
      },
      {
        clientId: CARMEN,
        nombre: "Carmen del Río",
        habitacion: "112",
        faltan: CARMEN_FILA.faltan,
      },
    ],
  },
  indicadores: [],
  mes: "2026-10",
  generadoEn: "2026-10-23T10:00:00.000Z",
};

beforeEach(() => {
  posts = [];
  patches = [];
  residentes = [ABEL_FILA, CARMEN_FILA, COMPLETA_FILA];
  resumen = { total: 3, incompletas: 2, datosPendientes: 12, conImprescindibles: 1 };
  apiMock.api.mockReset();
  apiMock.api.mockImplementation(
    async (path: string, init?: { method?: string; body?: unknown }) => {
      if (init?.method === "PATCH") {
        patches.push({ path, body: init.body });
        return { residente: fichaDe(path.split("/").pop()!), puedeCargarPlan: null };
      }
      if (init?.method === "POST") {
        posts.push({ path, body: init.body });
        if (path === "/residencia/residentes/varios") {
          return { creados: 1, residentes: [], saltados: [], avisos: [] };
        }
        if (path.endsWith("/plan/plantilla")) {
          return { plan: { abiertas: ["ASEO"], cerradas: [], intactas: [] } };
        }
        return {};
      }
      if (path === "/residencia/panel") return PANEL;
      if (path === "/residencia/edificio") return { plantas: [] };
      if (path.startsWith("/residencia/residentes/")) {
        return { residente: fichaDe(path.split("/").pop()!) };
      }
      if (path.startsWith("/residencia/residentes")) {
        return { residentes, alcance: "CENTRO", resumen };
      }
      return {};
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
});

function fichaDe(clientId: string) {
  const f = residentes.find((x) => x.clientId === clientId) ?? ABEL_FILA;
  return { ...f, dni: null, nss: null, ocupaciones: [], foto: null };
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

async function pintar(Pantalla: () => JSX.Element, ruta = "/") {
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[ruta]}>
        <Pantalla />
      </MemoryRouter>,
    );
  });
}

function botonPorTexto(texto: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;
}

function botonQueContiene(texto: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

/** La casilla cuyo `<label>` dice esto. */
function casillaDe(texto: string): HTMLInputElement | undefined {
  return [...container.querySelectorAll("label")]
    .filter((l) => l.textContent?.includes(texto))
    .map((l) => l.querySelector("input[type=checkbox]"))
    .find((x): x is HTMLInputElement => x != null);
}

async function pulsar(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/**
 * Escribir en un campo controlado por React.
 *
 * Por el SETTER NATIVO y no `el.value = …`: React guarda el último valor
 * que pintó y descarta el evento si el `value` del nodo coincide, así que
 * la asignación directa se pierde en silencio y el test falla diciendo
 * que el botón sigue deshabilitado. Es el mismo helper que
 * `agenda-horario-page.test.tsx`.
 */
async function escribir(id: string, valor: string) {
  const el = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `#${id}`,
  );
  if (!el) throw new Error(`no existe el campo #${id}`);
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Y marcar o desmarcar una casilla, por lo mismo. */
async function marcar(el: HTMLInputElement, valor: boolean) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "checked",
    )!.set!.call(el, valor);
    el.dispatchEvent(new Event("click", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

// ════════════════════════════════════════════════════════════════════
//  1 · LA LISTA
// ════════════════════════════════════════════════════════════════════

describe("alta-minima · la lista de residentes", () => {
  it("dice «2 de 3 fichas incompletas» y cuántos datos", async () => {
    await pintar(ResidentesPage);
    const texto = container.textContent ?? "";
    expect(texto).toContain("2 de 3 fichas incompletas");
    expect(texto).toContain("12 datos pendientes");
    expect(texto).toContain("1 con algo imprescindible");
    // Y dice que no bloquea nada: es la mitad que evita que alguien crea
    // que a esa señora no se la puede atender.
    expect(texto).toContain("Se atienden igual");
  });

  it("el filtro «Sólo incompletas» viene PUESTO, y la lista sale filtrada", async () => {
    await pintar(ResidentesPage);
    const casilla = casillaDe("Sólo incompletas");
    expect(casilla).toBeDefined();
    expect(casilla!.checked).toBe(true);
    const texto = container.textContent ?? "";
    expect(texto).toContain("ABEL RAMOS DOBLADO");
    expect(texto).toContain("Carmen del Río");
    // La completa NO está: el filtro está puesto.
    expect(texto).not.toContain("Luis Prieto");
    expect(texto).toContain("2 de 3");
  });

  it("y al quitarlo salen los tres", async () => {
    await pintar(ResidentesPage);
    await marcar(casillaDe("Sólo incompletas")!, false);
    expect(container.textContent).toContain("Luis Prieto");
  });

  it("SIN NINGUNA incompleta, el filtro NO SE OFRECE", async () => {
    // Un filtro que no filtra nada es una casilla más que leer. Y el
    // aviso de arriba también desaparece: la pantalla vuelve a ser la
    // lista de siempre.
    residentes = [COMPLETA_FILA];
    resumen = { total: 1, incompletas: 0, datosPendientes: 0, conImprescindibles: 0 };
    await pintar(ResidentesPage);
    expect(casillaDe("Sólo incompletas")).toBeUndefined();
    expect(container.textContent).not.toContain("fichas incompletas");
    expect(container.textContent).toContain("Luis Prieto");
  });

  it("la etiqueta de cada fila: ROJA con imprescindibles, ÁMBAR sin ellos", async () => {
    await pintar(ResidentesPage);
    const etiquetas = [...container.querySelectorAll("span")].filter((s) =>
      s.textContent?.startsWith("Faltan "),
    );
    // Abel: 11 datos y alguno imprescindible → rosa.
    const abel = etiquetas.find((s) => s.textContent === "Faltan 11 datos")!;
    expect(abel.className).toContain("rose");
    // Carmen: 1 dato, recomendable → «Falta 1 dato», en ámbar.
    const carmen = [...container.querySelectorAll("span")].find(
      (s) => s.textContent === "Falta 1 dato",
    )!;
    expect(carmen.className).toContain("amber");
  });

  it("y la COMPLETA no lleva etiqueta ninguna", async () => {
    residentes = [COMPLETA_FILA];
    resumen = { total: 1, incompletas: 0, datosPendientes: 0, conImprescindibles: 0 };
    await pintar(ResidentesPage);
    expect(container.textContent).not.toContain("Falta");
  });

  it("un residente SIN nivel ni plaza no pinta píldoras vacías", async () => {
    await pintar(ResidentesPage);
    // `NIVEL_LABEL[null]` es `undefined`: un hueco dentro de una píldora
    // gris que parece un fallo de pintado. Lo que falta lo dice la
    // etiqueta de al lado.
    expect(container.textContent).not.toContain("undefined");
    // Y Carmen, que sí los tiene, los sigue pintando.
    expect(container.textContent).toContain("Dependiente · grado III");
  });

  it("y en ningún sitio sale «Invalid Date» ni 1970", async () => {
    await pintar(ResidentesPage);
    const texto = container.textContent ?? "";
    expect(texto).not.toContain("Invalid Date");
    expect(texto).not.toContain("1970");
    expect(texto).not.toContain("NaN");
  });

  it("el vacío del filtro dice por qué está vacío", async () => {
    residentes = [COMPLETA_FILA];
    // El resumen dice que hay una incompleta pero la lista no la trae
    // (puede pasar con el alcance por zona): el filtro deja la tabla a
    // cero y «todavía no hay residentes» sería mentira.
    resumen = { total: 1, incompletas: 1, datosPendientes: 1, conImprescindibles: 0 };
    await pintar(ResidentesPage);
    expect(container.textContent).toContain("No queda ninguna ficha incompleta");
    expect(container.textContent).not.toContain("Todavía no hay residentes");
  });
});

// ════════════════════════════════════════════════════════════════════
//  2 · EL ALTA CON SÓLO EL NOMBRE
// ════════════════════════════════════════════════════════════════════

describe("alta-minima · «Nuevo ingreso»", () => {
  it("crea con sólo el nombre, y NO manda los campos vacíos", async () => {
    await pintar(ResidentesPage);
    await pulsar(botonPorTexto("Nuevo ingreso")!);
    await escribir("nombre", "Abel Ramos Doblado");
    const guardar = botonPorTexto("Registrar ingreso")!;
    expect(guardar.disabled).toBe(false);
    await pulsar(guardar);
    expect(posts).toHaveLength(1);
    // Lo que se manda: el nombre y nada más. Mandar `null` en los tres
    // sería un 400, porque el esquema de la ruta no los acepta nulos.
    expect(posts[0]!.body).toEqual({ firstName: "Abel Ramos Doblado" });
  });

  it("la fecha de ingreso nace VACÍA, no con «hoy»", async () => {
    // Una fecha que el formulario rellena solo es un dato que nadie ha
    // mirado y que luego sale en un informe a la Consejería.
    await pintar(ResidentesPage);
    await pulsar(botonPorTexto("Nuevo ingreso")!);
    const ingreso = container.querySelector<HTMLInputElement>("#ingreso")!;
    expect(ingreso.value).toBe("");
  });
});

// ════════════════════════════════════════════════════════════════════
//  3 · LA FICHA · LA BANDA Y EL FORMULARIO
// ════════════════════════════════════════════════════════════════════

describe("alta-minima · la banda de la ficha", () => {
  async function abrirFichaDeAbel() {
    await pintar(ResidentesPage);
    await pulsar(botonQueContiene("ABEL RAMOS DOBLADO")!);
  }

  it("dice lo que falta, dato por dato", async () => {
    await abrirFichaDeAbel();
    const texto = container.textContent ?? "";
    expect(texto).toContain("A esta ficha le faltan 11 datos");
    expect(texto).toContain("Toca uno para ir a su campo");
    expect(texto).toContain("fecha de ingreso");
    expect(texto).toContain("DNI");
    expect(texto).toContain("familiar responsable");
  });

  it("cada dato es un BOTÓN que ENFOCA su campo", async () => {
    // Es la mitad que hace que el aviso sirva: «le falta el DNI» que no
    // se puede tocar obliga a buscar el campo a mano.
    await abrirFichaDeAbel();
    const enlace = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "DNI",
    )!;
    expect(enlace).toBeDefined();
    await pulsar(enlace);
    expect(document.activeElement?.id).toBe("ficha-dni");
  });

  it("y también los que no son un input · el nivel enfoca su grupo", async () => {
    await abrirFichaDeAbel();
    const enlace = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "nivel de dependencia",
    )!;
    await pulsar(enlace);
    expect(document.activeElement?.id).toBe("ficha-nivel");
  });

  it("la ficha COMPLETA no pinta banda ninguna", async () => {
    residentes = [COMPLETA_FILA];
    resumen = { total: 1, incompletas: 0, datosPendientes: 0, conImprescindibles: 0 };
    await pintar(ResidentesPage);
    await pulsar(botonQueContiene("Luis Prieto")!);
    expect(container.textContent).not.toContain("A esta ficha le falta");
  });

  it("el formulario trae los apellidos VACÍOS y los guarda · viven en `clients`", async () => {
    await abrirFichaDeAbel();
    const apellidos = container.querySelector<HTMLInputElement>("#ficha-apellidos")!;
    expect(apellidos.value).toBe("");
    await escribir("ficha-apellidos", "Ramos Doblado");
    await pulsar(botonPorTexto("Guardar la ficha")!);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toEqual({ lastName: "Ramos Doblado" });
  });

  it("manda SÓLO lo que cambió · reenviar el nivel recalcularía un plan", async () => {
    await abrirFichaDeAbel();
    await escribir("ficha-dni", "11111111H");
    await pulsar(botonPorTexto("Guardar la ficha")!);
    // Ni `dependencyLevel`, ni `placeType`, ni las fechas: nada que no se
    // haya tocado.
    expect(patches[0]!.body).toEqual({ dni: "11111111H" });
  });

  it("guardar SIN tocar nada no manda nada · es un doble toque", async () => {
    await abrirFichaDeAbel();
    await pulsar(botonPorTexto("Guardar la ficha")!);
    expect(patches).toHaveLength(0);
  });

  it("ofrece CARGAR EL PLAN sólo si hay nivel", async () => {
    // Abel no tiene nivel: sin él no hay plantilla que cargar, y el botón
    // no está. La banda sí dice que el plan falta.
    await abrirFichaDeAbel();
    expect(botonQueContiene("Cargar el plan de cuidados")).toBeUndefined();

    // Con nivel y sin plan, el botón aparece y es un toque.
    residentes = [
      {
        ...ABEL_FILA,
        dependencyLevel: "DEPENDIENTE" as const,
        faltan: [falta("planDeCuidados", "plan de cuidados")],
      },
    ];
    resumen = { total: 1, incompletas: 1, datosPendientes: 1, conImprescindibles: 1 };
    act(() => root?.unmount());
    await pintar(ResidentesPage);
    await pulsar(botonQueContiene("ABEL RAMOS DOBLADO")!);
    const boton = botonQueContiene("Cargar el plan de cuidados de «dependiente»")!;
    expect(boton).toBeDefined();
    await pulsar(boton);
    expect(posts.map((p) => p.path)).toEqual([
      `/residencia/residentes/${ABEL}/plan/plantilla`,
    ]);
    expect(container.textContent).toContain("Se ha abierto 1 línea");
  });

  it("«Siguiente incompleta» está cuando queda otra, y NO en la última", async () => {
    await abrirFichaDeAbel();
    expect(botonQueContiene("pasar a la siguiente incompleta")).toBeDefined();

    // Con una sola incompleta en el centro, el botón no está: cerraría el
    // modal sin decir por qué.
    residentes = [ABEL_FILA, COMPLETA_FILA];
    resumen = { total: 2, incompletas: 1, datosPendientes: 11, conImprescindibles: 1 };
    act(() => root?.unmount());
    await pintar(ResidentesPage);
    await pulsar(botonQueContiene("ABEL RAMOS DOBLADO")!);
    expect(botonQueContiene("pasar a la siguiente incompleta")).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════
//  4 · AÑADIR VARIOS
// ════════════════════════════════════════════════════════════════════

describe("alta-minima · «Añadir varios»", () => {
  async function abrirVarios() {
    await pintar(ResidentesPage);
    await pulsar(botonQueContiene("Añadir varios")!);
  }

  const pegar = (texto: string) => escribir("pegado", texto);

  it("la vista previa dice cuántos se crean, en formato de nombre", async () => {
    await abrirVarios();
    await pegar("MARIA DEL CARMEN RUIZ\nABEL DE LA FUENTE\n");
    const texto = container.textContent ?? "";
    expect(texto).toContain("Se van a crear 2 residentes");
    // Se ENSEÑAN en formato de nombre; se guardan como vienen.
    expect(texto).toContain("Maria del Carmen Ruiz");
    expect(texto).toContain("Abel de la Fuente");
    expect(botonPorTexto("Crear 2 residentes")).toBeDefined();
  });

  it("marca los que YA EXISTEN y no los cuenta", async () => {
    await abrirVarios();
    // «Carmen del Río» ya está (es Carmen), escrito sin tilde y en
    // mayúsculas: la clave del paquete puro los casa.
    await pegar("CARMEN DEL RIO\nNUEVA SEÑORA");
    const texto = container.textContent ?? "";
    expect(texto).toContain("Se va a crear 1 residente");
    expect(texto).toContain("1 ya existe y se salta");
  });

  it("SABOTAJE · líneas vacías en silencio, tabulador suelto delatado", async () => {
    await abrirVarios();
    await pegar("UNA SEÑORA\n\n   \n\tCONCERTADA\nOTRA SEÑORA\n\n");
    const texto = container.textContent ?? "";
    expect(texto).toContain("Se van a crear 2 residentes");
    expect(texto).toContain("Línea 4");
    expect(texto).toContain("no trae nombre");
  });

  it("SABOTAJE · repetido dentro del propio pegado: se queda la primera", async () => {
    await abrirVarios();
    await pegar("UNA SEÑORA\nuna  señora\nOTRA SEÑORA");
    const texto = container.textContent ?? "";
    expect(texto).toContain("Se van a crear 2 residentes");
    expect(texto).toContain("1 línea está repetida en lo que has pegado");
  });

  it("SABOTAJE · 2.000 líneas: lo dice y NO deja darle", async () => {
    await abrirVarios();
    await pegar(Array.from({ length: 2000 }, (_, i) => `MASIVO ${i}`).join("\n"));
    expect(container.textContent).toContain("de una vez caben 300");
    const crear = botonQueContiene("Crear ")!;
    expect(crear.disabled).toBe(true);
    expect(posts).toHaveLength(0);
  });

  it("y el tipo de plaza POR LÍNEA se pinta en la vista previa", async () => {
    await abrirVarios();
    await pegar("UNA SEÑORA\tCONCERTADA");
    expect(container.textContent).toContain("Concertada");
  });

  it("al crear, manda el texto TAL CUAL · lo parte el servidor", async () => {
    await abrirVarios();
    await pegar("UNA SEÑORA\nOTRA SEÑORA");
    await pulsar(botonPorTexto("Crear 2 residentes")!);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe("/residencia/residentes/varios");
    expect(posts[0]!.body).toEqual({ texto: "UNA SEÑORA\nOTRA SEÑORA" });
  });
});

// ════════════════════════════════════════════════════════════════════
//  5 · LA TARJETA DEL PANEL
// ════════════════════════════════════════════════════════════════════

describe("alta-minima · la tarjeta del panel de dirección", () => {
  it("«12 fichas de residentes incompletas · 31 datos pendientes»", async () => {
    await pintar(PanelPage);
    const texto = container.textContent ?? "";
    expect(texto).toContain("12 fichas de residentes incompletas");
    expect(texto).toContain("31 datos pendientes");
    expect(texto).toContain("9 les falta algo imprescindible");
    // Y dice la consecuencia, que es lo que hace que se mire: en plaza
    // concertada, sin grado no se factura.
    expect(texto).toContain("no se factura a la Junta");
  });

  it("«Completar» lleva a Residentes con la PRIMERA incompleta abierta", async () => {
    await pintar(PanelPage);
    const completar = [...container.querySelectorAll("a")].find(
      (a) => a.textContent?.trim() === "Completar",
    )!;
    expect(completar).toBeDefined();
    expect(completar.getAttribute("href")).toBe(
      `/admin/residencia/residentes?completar=${ABEL}`,
    );
  });

  it("y cada nombre abre SU ficha, con lo que le falta al lado", async () => {
    await pintar(PanelPage);
    const abel = [...container.querySelectorAll("a")].find(
      (a) => a.textContent?.trim() === "ABEL RAMOS DOBLADO",
    )!;
    expect(abel.getAttribute("href")).toBe(
      `/admin/residencia/residentes?completar=${ABEL}`,
    );
    expect(container.textContent).toContain("fecha de ingreso, nivel de dependencia");
    expect(container.textContent).toContain("habitación 112");
  });

  it("sin ninguna incompleta, la tarjeta NO EXISTE", async () => {
    apiMock.api.mockImplementation(async (path: string) => {
      if (path === "/residencia/panel") {
        return {
          ...PANEL,
          fichasIncompletas: {
            total: 43,
            incompletas: 0,
            datosPendientes: 0,
            conImprescindibles: 0,
            primeras: [],
          },
        };
      }
      return {};
    });
    await pintar(PanelPage);
    expect(container.textContent).not.toContain("fichas de residentes incompletas");
  });

  it("y un panel de una API vieja no la tumba", async () => {
    // Durante los minutos de un despliegue, lo que la dirección ve es el
    // panel sin la tarjeta, no una pantalla en blanco.
    apiMock.api.mockImplementation(async (path: string) => {
      if (path === "/residencia/panel") {
        const { fichasIncompletas: _fuera, ...viejo } = PANEL;
        return viejo;
      }
      return {};
    });
    await pintar(PanelPage);
    expect(container.textContent).toContain("Qué hay abierto hoy");
  });
});

// ════════════════════════════════════════════════════════════════════
//  6 · EL `?completar=` QUE MANDA EL PANEL
// ════════════════════════════════════════════════════════════════════

describe("alta-minima · entrar por `?completar=`", () => {
  it("abre la ficha de ese residente directamente", async () => {
    await pintar(ResidentesPage, `/?completar=${CARMEN}`);
    const texto = container.textContent ?? "";
    // El modal está abierto: lo dice su formulario.
    expect(texto).toContain("Completar la ficha");
    expect(texto).toContain("Carmen del Río");
  });
});
