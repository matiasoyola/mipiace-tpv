// calidad-1 · EL ADMIN DEL BLOQUE: el mapa, un proceso, el registro de
// no conformidades y el expediente de una.
//
// Se miden por lo que la pantalla DICE y por lo que DEJA PULSAR, que en
// este bloque es lo mismo:
//
//   1. **El mapa** pinta las tres filas de un mapa de procesos y, en un
//      centro sin mapa, enseña el botón de cargarlo en vez de once
//      huecos.
//   2. **El proceso abierto** enseña lo que le cuelga, y al intentar
//      desactivarlo con cosas dentro ofrece MOVERLAS, no un «no puedes».
//   3. **El registro** pinta la clase y el estado de cada NC, y los dos
//      PDF **arrastran el filtro de la pantalla**.
//   4. **El expediente** apaga el botón de cada paso que todavía no se
//      puede dar y **dice qué falta con la frase del servidor**, que es
//      la misma que la ruta usa para rechazar.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProcesosPage } from "../src/pages/residencia/ProcesosPage.js";
import { ProcesoPage } from "../src/pages/residencia/ProcesoPage.js";
import { NoConformidadesPage } from "../src/pages/residencia/NoConformidadesPage.js";
import { NoConformidadPage } from "../src/pages/residencia/NoConformidadPage.js";
import {
  entradasDeConfiguracion,
  entradasDelMenu,
} from "../src/AdminShell.js";
import type {
  NcDeLaLista,
  RespuestaDeNc,
  RespuestaDelMapa,
  RespuestaDelProceso,
} from "../src/pages/residencia/calidad-lib.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const MAPA: RespuestaDelMapa = {
  procesos: [
    {
      id: "p-cal",
      code: "CALIDAD_MEJORA",
      nombre: "Calidad, medición y mejora",
      tipo: "STRATEGIC",
      proposito: "Indicadores, no conformidades y auditorías.",
      deReferencia: true,
      activo: true,
      orden: 20,
      responsable: { id: "r-cal", nombre: "Calidad", activo: true },
      cuelgan: {
        riesgos: 0,
        oportunidades: 0,
        objetivos: 0,
        noConformidades: 2,
        indicadores: 3,
        revisionesVencidas: 0,
      },
      bandaMaxima: null,
    },
    {
      id: "p-abvd",
      code: "CUIDADOS_ABVD",
      nombre: "Cuidados y ABVD",
      tipo: "OPERATIONAL",
      proposito: "Aseo, alimentación, movilizaciones.",
      deReferencia: true,
      activo: true,
      orden: 60,
      responsable: { id: "r-due", nombre: "DUE (enfermería)", activo: true },
      cuelgan: {
        riesgos: 1,
        oportunidades: 0,
        objetivos: 1,
        noConformidades: 0,
        indicadores: 2,
        revisionesVencidas: 1,
      },
      bandaMaxima: "ALTO",
    },
    {
      id: "p-doc",
      code: "DOCUMENTACION_DATOS",
      nombre: "Documentación, registro y protección de datos",
      tipo: "SUPPORT",
      proposito: "Registros asistenciales y protección de datos.",
      deReferencia: true,
      activo: true,
      orden: 110,
      responsable: { id: "r-cal", nombre: "Calidad", activo: true },
      cuelgan: {
        riesgos: 1,
        oportunidades: 0,
        objetivos: 0,
        noConformidades: 1,
        indicadores: 1,
        revisionesVencidas: 0,
      },
      bandaMaxima: "ALTO",
    },
  ],
  roles: [
    { id: "r-cal", nombre: "Calidad", category: "SUPERVISOR" },
    { id: "r-due", nombre: "DUE (enfermería)", category: "SUPERVISOR" },
  ],
};

const PROCESO: RespuestaDelProceso = {
  proceso: {
    id: "p-abvd",
    code: "CUIDADOS_ABVD",
    nombre: "Cuidados y ABVD",
    tipo: "OPERATIONAL",
    proposito: "Aseo, alimentación, movilizaciones.",
    deReferencia: true,
    activo: true,
    orden: 60,
    responsable: { id: "r-due", name: "DUE (enfermería)" },
  },
  riesgos: [
    {
      id: "ri-1",
      tipo: "RISK",
      deSerie: true,
      descripcion: "Salida del centro sin autorización de un residente.",
      probabilidad: 2,
      impacto: 3,
      nivel: 6,
      banda: "ALTO",
      accionPrevista: "Control de accesos y registro de salidas.",
      reviewAt: "2026-09-01",
      vencida: true,
      revisadoEn: null,
      isoClause: "6.1",
      activo: true,
    },
  ],
  objetivos: [
    {
      id: "ob-1",
      anio: 2026,
      nombre: "Aumentar los semiasistidos en las transferencias",
      meta: "Que el 25 % las haga de forma independiente.",
      estado: "OPEN",
      indicatorCode: null,
      nota: null,
      isoClause: "6.2",
    },
  ],
  noConformidades: [],
  indicadores: ["SIN_DEPOSICION", "CAIDAS"],
};

const LISTA: NcDeLaLista[] = [
  {
    id: "nc-1",
    referencia: "NC-2026-01",
    clase: "MINOR",
    origen: "EXTERNAL_AUDIT",
    estado: "ACTIONS",
    detectedOn: "2026-07-21",
    isoClause: "4.4.1",
    proceso: { id: "p-cal", name: "Calidad, medición y mejora" },
    cerradaEn: null,
    acciones: 2,
    verificaciones: 0,
    accionesVencidas: 1,
    descripcion: "Dos mapas de procesos que no cuadran.",
  },
  {
    id: "nc-2",
    referencia: "NC-2026-02",
    clase: "OBSERVATION",
    origen: "INSPECTION",
    estado: "CAUSE_ANALYSED",
    detectedOn: "2026-10-08",
    isoClause: null,
    proceso: { id: "p-doc", name: "Documentación, registro y protección de datos" },
    cerradaEn: null,
    acciones: 0,
    verificaciones: 0,
    accionesVencidas: 0,
    descripcion: "Registros de atención directa con anotaciones vacías.",
  },
];

/** Una NC con las acciones cerradas: el paso en el que la pantalla tiene
 *  que ofrecer la verificación de eficacia y nada más. */
const EXPEDIENTE: RespuestaDeNc = {
  noConformidad: {
    id: "nc-1",
    referencia: "NC-2026-01",
    clase: "MINOR",
    origen: "EXTERNAL_AUDIT",
    estado: "ACTIONS_CLOSED",
    isoClause: "4.4.1",
    detectedOn: "2026-07-21",
    proceso: { id: "p-cal", name: "Calidad, medición y mejora", type: "STRATEGIC" },
    descripcion: "Dos mapas de procesos que no cuadran.",
    causa: "El mapa vive en dos Word distintos.",
    origenDetalle: {
      incidencia: null,
      indicador: null,
      mes: null,
      nota: "AENOR · informe nº 24",
    },
    informe: null,
    abiertaEn: "2026-07-24T09:00:00.000Z",
    abiertaPor: "Isa",
    abiertaComo: "Calidad",
    cerradaEn: null,
    cerradaPor: null,
  },
  acciones: [
    {
      id: "ac-1",
      que: "Un mapa único en el sistema.",
      responsable: "Calidad",
      dueOn: "2026-10-31",
      vencida: false,
      abiertaEn: "2026-07-24T09:10:00.000Z",
      cerradaEn: "2026-10-28T12:00:00.000Z",
      cerradaPor: "Isa",
      notaDeCierre: "Mapa único cargado.",
      evidencias: [
        {
          id: "ev-1",
          tieneFichero: true,
          bytes: 1024,
          nota: "Captura del mapa.",
          at: "2026-10-28T12:05:00.000Z",
          por: "Isa",
        },
      ],
    },
  ],
  verificaciones: [],
  ciclo: {
    ciclo: {
      estado: "ACTIONS_CLOSED",
      clase: "MINOR",
      tieneCausa: true,
      acciones: 1,
      accionesAbiertas: 0,
      verificadaEficaz: false,
    },
    siguiente: [
      { destino: "CAUSE_ANALYSED", falta: "Desde «Pendiente de verificar» no se puede pasar a «Causa analizada»." },
      { destino: "ACTIONS", falta: null },
      { destino: "ACTIONS_CLOSED", falta: "Desde «Pendiente de verificar» no se puede pasar a «Acciones cerradas, pendiente de verificar»." },
      {
        destino: "CLOSED",
        falta: "No se cierra sin una verificación de eficacia con resultado «eficaz».",
      },
    ],
  },
};

let container: HTMLDivElement;
let root: Root;
const api = vi.hoisted(() => ({ fn: vi.fn(), blob: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, api: api.fn, apiBlob: api.blob };
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.fn.mockReset();
  api.blob.mockReset();
  api.blob.mockResolvedValue(new Blob(["%PDF-"]));
  // jsdom no tiene `createObjectURL` ni `open`, y los dos los usa el
  // botón del PAC.
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () =>
    "blob:x";
  window.open = vi.fn() as unknown as typeof window.open;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function pintar(
  nodo: React.ReactNode,
  ruta?: { camino: string; url: string },
): Promise<void> {
  await act(async () => {
    root.render(
      ruta ? (
        <MemoryRouter initialEntries={[ruta.url]}>
          <Routes>
            <Route path={ruta.camino} element={nodo} />
          </Routes>
        </MemoryRouter>
      ) : (
        <MemoryRouter>{nodo}</MemoryRouter>
      ),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** Un botón por su texto EXACTO. Buscar por subcadena ha costado ya un
 *  rato en este repo: `pulsar("4")` acabó pulsando «PIN de 4 cifras». */
function boton(texto: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === texto,
  );
}

async function pulsar(texto: string): Promise<void> {
  const b = boton(texto);
  if (!b) throw new Error(`No hay ningún botón «${texto}».`);
  await act(async () => {
    b.click();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

// ══ 1 · EL MAPA ══════════════════════════════════════════════════

describe("el mapa de procesos", () => {
  it("un centro SIN mapa ve el botón de cargarlo, no once huecos", async () => {
    api.fn.mockResolvedValue({ procesos: [], roles: [] });
    await pintar(<ProcesosPage />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("todavía no tiene mapa de procesos");
    expect(boton("Cargar el mapa de referencia")).toBeTruthy();
  });

  it("con mapa, pinta las TRES filas y en su orden", async () => {
    api.fn.mockResolvedValue(MAPA);
    await pintar(<ProcesosPage />);
    const texto = container.textContent ?? "";
    // El orden de un mapa de procesos de ISO 9001: arriba los que
    // deciden, en medio la cadena de valor, abajo los que sostienen.
    expect(texto.indexOf("Estratégicos")).toBeGreaterThanOrEqual(0);
    expect(texto.indexOf("Estratégicos")).toBeLessThan(texto.indexOf("Operativos"));
    expect(texto.indexOf("Operativos")).toBeLessThan(texto.indexOf("De soporte"));
  });

  it("cada tarjeta dice QUÉ cuelga, que es lo que contesta la NC 01", async () => {
    api.fn.mockResolvedValue(MAPA);
    await pintar(<ProcesosPage />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("3 indicadores");
    expect(texto).toContain("2 NC abiertas");
    // Y en SINGULAR cuando es una. Lo encontró el bucle visual: once
    // tarjetas diciendo «1 objetivos» en la pantalla que se enseña en la
    // auditoría.
    expect(texto).toContain("1 indicador");
    expect(texto).toContain("1 riesgo");
    expect(texto).toContain("1 objetivo");
    expect(texto).toContain("1 NC abierta");
    expect(texto).toContain("1 revisión de riesgo vencida");
    expect(texto).not.toContain("1 indicadores");
    expect(texto).not.toContain("1 objetivos");
  });

  it("y cada proceso se abre", async () => {
    api.fn.mockResolvedValue(MAPA);
    await pintar(<ProcesosPage />);
    const destinos = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(destinos).toContain("/admin/residencia/procesos/p-abvd");
  });
});

// ══ 2 · UN PROCESO ABIERTO ═══════════════════════════════════════

describe("un proceso abierto", () => {
  const RUTA = {
    camino: "/admin/residencia/procesos/:id",
    url: "/admin/residencia/procesos/p-abvd",
  };

  function respuestas(): void {
    api.fn.mockImplementation(async (ruta: string) =>
      ruta === "/residencia/procesos" ? MAPA : PROCESO,
    );
  }

  it("enseña sus riesgos con la banda y la revisión VENCIDA", async () => {
    respuestas();
    await pintar(<ProcesoPage />, RUTA);
    const texto = container.textContent ?? "";
    expect(texto).toContain("nivel 6 · alto");
    expect(texto).toContain("VENCIDA");
    expect(texto).toContain("probabilidad 2 × impacto 3");
  });

  it("y sus objetivos de calidad, que caben aquí sin pantalla nueva", async () => {
    respuestas();
    await pintar(<ProcesoPage />, RUTA);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Objetivos de calidad (1)");
    expect(texto).toContain("Que el 25 % las haga de forma independiente.");
  });

  it("desactivar con cosas dentro ofrece MOVERLAS, no un «no puedes»", async () => {
    respuestas();
    await pintar(<ProcesoPage />, RUTA);
    // El 409 del servidor con la cuenta de lo que cuelga.
    const { ApiError } = await vi.importActual<typeof import("../src/api.js")>(
      "../src/api.js",
    );
    api.fn.mockImplementation(async (ruta: string) => {
      if (ruta === "/residencia/procesos/p-abvd/desactivar") {
        throw new ApiError(
          409,
          "PROCESO_CON_COSAS_COLGANDO",
          "De este proceso cuelgan 1 riesgo(s) u oportunidad(es).",
          { cuelga: { riesgos: 1, objetivos: 1, noConformidades: 0, indicadores: 2, total: 4 } },
        );
      }
      return ruta === "/residencia/procesos" ? MAPA : PROCESO;
    });
    await pulsar("desactivar");
    const texto = container.textContent ?? "";
    expect(texto).toContain("Primero hay que reasignar lo que cuelga");
    // Y el desplegable para moverlo, con los OTROS procesos activos.
    const opciones = [...container.querySelectorAll("option")].map(
      (o) => o.textContent,
    );
    expect(opciones).toContain("Calidad, medición y mejora");
    expect(opciones).not.toContain("Cuidados y ABVD");
  });

  it("y el código no cambia al renombrar: la pantalla lo dice", async () => {
    respuestas();
    await pintar(<ProcesoPage />, RUTA);
    await pulsar("Editar el proceso");
    expect(container.textContent ?? "").toContain(
      "El código del proceso (CUIDADOS_ABVD) no cambia al renombrarlo",
    );
  });
});

// ══ 3 · EL REGISTRO DE NO CONFORMIDADES ══════════════════════════

describe("el registro de no conformidades", () => {
  function respuestas(lista = LISTA): void {
    api.fn.mockImplementation(async (ruta: string) =>
      ruta === "/residencia/procesos" ? MAPA : { noConformidades: lista },
    );
  }

  it("pinta la clase, el estado y el origen de cada una", async () => {
    respuestas();
    await pintar(<NoConformidadesPage />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("NC-2026-01");
    expect(texto).toContain("NC menor");
    expect(texto).toContain("Con acciones en curso");
    expect(texto).toContain("Auditoría externa");
    expect(texto).toContain("Observación");
  });

  it("y las acciones vencidas saltan a la vista", async () => {
    respuestas();
    await pintar(<NoConformidadesPage />);
    expect(container.textContent ?? "").toContain("1 vencida(s)");
  });

  it("**los dos PDF arrastran el filtro de la pantalla**", async () => {
    respuestas();
    await pintar(<NoConformidadesPage />);
    // Se filtra por origen en la pantalla…
    const select = [...container.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.textContent === "Auditoría externa"),
    )!;
    await act(async () => {
      select.value = "EXTERNAL_AUDIT";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await pulsar("PAC en PDF");
    // …y el PDF se pide con ese filtro. Rellenar un segundo formulario
    // sería la forma de que el papel diga otra cosa que la pantalla.
    expect(api.blob).toHaveBeenCalledWith(
      "/residencia/calidad/pac.pdf?origen=EXTERNAL_AUDIT",
    );
  });

  it("**la propuesta del panel llega con el origen ya relleno** (D-74)", async () => {
    // El panel enlaza con `?proponer=…&mes=…&proceso=…`, y la pantalla
    // abre el formulario con el origen puesto. Si hubiera que volver a
    // teclearlo, la propuesta no ahorraría nada y nadie la usaría.
    respuestas();
    await pintar(<NoConformidadesPage />, {
      camino: "/admin/residencia/no-conformidades",
      url: "/admin/residencia/no-conformidades?proponer=GIMNASIA&mes=2026-09&proceso=p-abvd",
    });
    const texto = container.textContent ?? "";
    expect(texto).toContain("Viene del panel");
    expect(texto).toContain("GIMNASIA");
    expect(texto).toContain("2026-09");
    // El desplegable de origen DEL FORMULARIO, ya en «indicador fuera de
    // umbral». Se coge el ÚLTIMO que casa y no el primero: el filtro de
    // arriba tiene las mismas opciones, y buscar el primero encuentra el
    // filtro —que está vacío a propósito— y el test pasaría en verde
    // diciendo lo contrario de lo que quiere decir.
    const origenes = [...container.querySelectorAll("select")].filter((sel) =>
      [...sel.options].some((o) => o.textContent === "Indicador fuera de umbral"),
    );
    expect(origenes.length).toBe(2);
    expect(origenes[origenes.length - 1]!.value).toBe("INDICATOR");
    // Y el proceso, el que el centro eligió para ese indicador.
    const procesos = [...container.querySelectorAll("select")].filter((sel) =>
      [...sel.options].some((o) => o.textContent === "Cuidados y ABVD"),
    );
    expect(procesos[procesos.length - 1]!.value).toBe("p-abvd");
  });

  it("sin mapa, no deja abrir una NC: manda a cargarlo", async () => {
    api.fn.mockImplementation(async (ruta: string) =>
      ruta === "/residencia/procesos"
        ? { procesos: [], roles: [] }
        : { noConformidades: [] },
    );
    await pintar(<NoConformidadesPage />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("cuelga siempre de un proceso del mapa");
    expect(boton("Abrir una no conformidad")).toBeUndefined();
  });
});

// ══ 4 · EL EXPEDIENTE Y SU CICLO ═════════════════════════════════

describe("el expediente de una no conformidad", () => {
  const RUTA = {
    camino: "/admin/residencia/no-conformidades/:id",
    url: "/admin/residencia/no-conformidades/nc-1",
  };

  function respuestas(nc = EXPEDIENTE): void {
    api.fn.mockImplementation(async (ruta: string) =>
      ruta === "/residencia/procesos" ? MAPA : nc,
    );
  }

  it("pinta el ciclo entero y marca en cuál está", async () => {
    respuestas();
    await pintar(<NoConformidadPage />, RUTA);
    const texto = container.textContent ?? "";
    for (const paso of [
      "Abierta",
      "Causa analizada",
      "Con acciones en curso",
      "Pendiente de verificar",
      "Cerrada",
    ]) {
      expect(texto, paso).toContain(paso);
    }
  });

  it("la causa escrita se PINTA, y no hay caja para reescribirla", async () => {
    respuestas();
    await pintar(<NoConformidadPage />, RUTA);
    expect(container.textContent ?? "").toContain(
      "El mapa vive en dos Word distintos.",
    );
    expect(boton("Guardar la causa")).toBeUndefined();
  });

  it("con las acciones cerradas, ofrece la VERIFICACIÓN y dice quién no puede firmarla", async () => {
    respuestas();
    await pintar(<NoConformidadPage />, RUTA);
    const texto = container.textContent ?? "";
    expect(boton("Firmar la verificación")).toBeTruthy();
    expect(texto).toContain(
      "una persona distinta de quien cerró la última acción",
    );
    // Y lo que pasa con un «no eficaz», antes de pulsarlo.
    expect(texto).toContain("No eficaz · vuelve a acciones");
  });

  it("y la evidencia adjunta se puede abrir", async () => {
    respuestas();
    await pintar(<NoConformidadPage />, RUTA);
    const destinos = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(destinos).toContain("/api/residencia/evidencias/ev-1/fichero");
  });

  it("**el botón apagado dice QUÉ FALTA, con la frase del servidor**", async () => {
    // Una NC con una acción todavía abierta: el paso «dar las acciones
    // por cerradas» no se puede dar, y la frase que se pinta es la que
    // la ruta usaría para rechazar — las dos salen de `loQueFaltaPara`.
    const conAccionAbierta: RespuestaDeNc = {
      ...EXPEDIENTE,
      noConformidad: { ...EXPEDIENTE.noConformidad, estado: "ACTIONS" },
      acciones: [
        { ...EXPEDIENTE.acciones[0]!, cerradaEn: null, cerradaPor: null, notaDeCierre: null },
      ],
      ciclo: {
        ciclo: {
          estado: "ACTIONS",
          clase: "MINOR",
          tieneCausa: true,
          acciones: 1,
          accionesAbiertas: 1,
          verificadaEficaz: false,
        },
        siguiente: [
          { destino: "CAUSE_ANALYSED", falta: "x" },
          { destino: "ACTIONS", falta: "x" },
          { destino: "ACTIONS_CLOSED", falta: "Queda una acción sin cerrar." },
          { destino: "CLOSED", falta: "x" },
        ],
      },
    };
    respuestas(conAccionAbierta);
    await pintar(<NoConformidadPage />, RUTA);
    const b = boton("Dar las acciones por cerradas");
    expect(b).toBeTruthy();
    expect(b!.disabled).toBe(true);
    expect(container.textContent ?? "").toContain("Queda una acción sin cerrar.");
  });

  it("una NC recién abierta y MENOR no deja escribir acciones, y dice por qué", async () => {
    const reciente: RespuestaDeNc = {
      ...EXPEDIENTE,
      noConformidad: {
        ...EXPEDIENTE.noConformidad,
        estado: "OPEN",
        causa: null,
      },
      acciones: [],
      ciclo: {
        ciclo: {
          estado: "OPEN",
          clase: "MINOR",
          tieneCausa: false,
          acciones: 0,
          accionesAbiertas: 0,
          verificadaEficaz: false,
        },
        siguiente: [
          { destino: "CAUSE_ANALYSED", falta: "Falta analizar la causa." },
          { destino: "ACTIONS", falta: "x" },
          { destino: "ACTIONS_CLOSED", falta: "x" },
          { destino: "CLOSED", falta: "x" },
        ],
      },
    };
    respuestas(reciente);
    await pintar(<NoConformidadPage />, RUTA);
    const texto = container.textContent ?? "";
    expect(boton("Escribir una acción")).toBeUndefined();
    expect(texto).toContain(
      "no lleva acciones hasta que se analiza la causa",
    );
    // Y la caja de la causa SÍ está, con el aviso de que se escribe una
    // vez.
    expect(boton("Guardar la causa")).toBeTruthy();
    expect(texto).toContain("se escribe");
  });
});

// ══ 5 · DÓNDE VIVEN LAS DOS ENTRADAS (cuadro-de-control, decisión 2) ══

describe("el mapa y las no conformidades viven en «Configuración»", () => {
  const RESIDENCIA = {
    residencia: true,
    clinica: true,
    agenda: true,
    caja: false,
    fichaje: false,
    holded: false,
    holdedEnabled: false,
    holdedDejado: false,
    bonos: false,
    cocina: false,
    businessType: "RESIDENCIA",
  } as never;

  it("**NO están en el menú**: son cinco entradas y «Configuración»", () => {
    const menu = entradasDelMenu(RESIDENCIA, "OWNER", false).map((i) => i.to);
    expect(menu).toEqual([
      "/admin/residencia/panel",
      "/admin/residencia/residentes",
      "/admin/residencia/incidencias",
      "/admin/residencia/relevos",
      "/admin/residencia/obligaciones",
      "/admin/residencia/configuracion",
    ]);
    expect(menu).not.toContain("/admin/residencia/procesos");
    expect(menu).not.toContain("/admin/residencia/no-conformidades");
  });

  it("y SÍ están en «Configuración», pegadas a los indicadores", () => {
    // El mapa se ajusta una vez al año y las NC se trabajan por semanas:
    // no son lo del día a día. Lo urgente de calidad sale en el panel,
    // y sale como una banda.
    const config = entradasDeConfiguracion(RESIDENCIA, "OWNER", false).map(
      (i) => i.to,
    );
    expect(config).toContain("/admin/residencia/procesos");
    expect(config).toContain("/admin/residencia/no-conformidades");
    // Pegadas al indicador del que hablan, y en ese orden: el mapa es de
    // dónde cuelgan los indicadores, las NC es a dónde van los que se
    // salen dos meses.
    const i = config.indexOf("/admin/residencia/indicadores");
    expect(config[i + 1]).toBe("/admin/residencia/procesos");
    expect(config[i + 2]).toBe("/admin/residencia/no-conformidades");
  });
});
