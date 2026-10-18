// residencia-4 · EL ADMIN DEL BLOQUE: el libro, la ficha y la guardia.
//
// Se miden por lo que la pantalla DICE, porque en las tres lo que
// importa es la frase:
//
//   1. **El libro** llega filtrado en «abiertas» sin que nadie lo pida, y
//      avisa de la constancia de familia que falta ANTES de que alguien
//      intente cerrar.
//   2. **La ficha** no tiene un botón de editar en ninguna parte (todo es
//      append-only) y el de cerrar sale deshabilitado con su razón.
//   3. **La guardia** dice cuándo un nivel se queda SIN AVISO y cuándo no
//      hay ningún móvil emparejado — que es el estado en el que el
//      centro cree que tiene avisos y no los tiene.
//
// Y la plantilla de gravedad, en solo lectura: **sin un botón de editar**
// (D-21, D-65). Un test lo fija porque es justo lo que alguien añadiría
// «para que el centro pueda ajustarlo».

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IncidenciasPage } from "../src/pages/residencia/IncidenciasPage.js";
import { IncidenciaPage } from "../src/pages/residencia/IncidenciaPage.js";
import { GuardiaPage } from "../src/pages/residencia/GuardiaPage.js";
import {
  colorDelNivel,
  nombreDelOrigen,
  nombreDelSujeto,
  type ConfiguracionDeGuardia,
  type FichaDeIncidencia,
  type IncidenciaEnLaLista,
  type PlantillaDeGravedad,
} from "../src/pages/residencia/incidencias-lib.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ABIERTA: IncidenciaEnLaLista = {
  id: "i1",
  sujeto: "RESIDENT",
  origen: "DERIVED_THRESHOLD",
  tipo: "FIEBRE",
  nombreDelTipo: "Fiebre",
  nivel: "N2",
  nombreDelNivel: "Alguien tiene que verlo ahora",
  abierta: true,
  abiertaEn: "2026-10-18T08:41:00.000Z",
  cerradaEn: null,
  autocierre: false,
  avisadoEn: "2026-10-18T08:41:02.000Z",
  careDay: "2026-10-18",
  residente: { id: "c1", nombre: "Carmen Núñez" },
  habitacion: "112",
  abiertaPor: "Ana",
  abiertaComo: "Auxiliar",
  acciones: 1,
  constanciasDeFamilia: 0,
  avisos: [
    { canal: "ENFERMERIA", estado: "DELIVERED", acusadoPor: null, acusadoEn: null },
  ],
};

const FICHA: FichaDeIncidencia = {
  id: "i1",
  sujeto: "RESIDENT",
  origen: "DERIVED_THRESHOLD",
  tipo: "FIEBRE",
  nombreDelTipo: "Fiebre",
  nivel: "N2",
  nombreDelNivel: "Alguien tiene que verlo ahora",
  versionDeLaPlantilla: 1,
  abierta: true,
  descripcion: null,
  residente: { id: "c1", nombre: "Carmen Núñez" },
  habitacion: { numero: "112", nombre: null },
  turno: "Mañana",
  careDay: "2026-10-18",
  abiertaEn: "2026-10-18T08:41:00.000Z",
  abiertaPor: "Ana",
  abiertaComo: "Auxiliar",
  cerradaEn: null,
  cerradaPor: null,
  cerradaComo: null,
  autocierre: false,
  avisadoEn: "2026-10-18T08:41:02.000Z",
  medida: { id: "r1", control: "TEMPERATURA", en: "2026-10-18T08:41:00.000Z" },
  acciones: [
    {
      id: "a1",
      clase: "EVIDENCE",
      texto: null,
      nivelDesde: null,
      nivelHasta: null,
      registroId: "r1",
      llamado: null,
      en: "2026-10-18T08:41:00.000Z",
      por: "Ana",
      como: "Auxiliar",
    },
  ],
  familia: [],
  avisos: [
    {
      id: "al1",
      canal: "ENFERMERIA",
      nivel: "N2",
      estado: "DELIVERED",
      apuntadoEn: "2026-10-18T08:41:00.000Z",
      salidoEn: "2026-10-18T08:41:02.000Z",
      entregadoEn: "2026-10-18T08:41:05.000Z",
      acusadoEn: null,
      acusadoPor: null,
      acusadoComo: null,
      escalado: false,
    },
  ],
  enlaces: [],
  capacidades: [{ assignmentId: "cra-1", code: "DIRECCION", category: "DIRECTIVO" }],
  puedeCerrarse: false,
};

const CONFIG: ConfiguracionDeGuardia = {
  minutosDeEscalado: 5,
  destinatarios: {
    N2: ["ENFERMERIA"],
    N3: ["ENFERMERIA", "RESPONSABLE"],
    N4: ["ENFERMERIA", "RESPONSABLE"],
  },
  servicio: null,
  moviles: [],
};

const PLANTILLA: PlantillaDeGravedad = {
  version: 1,
  vigenteDesde: "2026-10-18T00:00:00.000Z",
  reglas: [
    {
      id: "s1",
      clase: "THRESHOLD",
      control: "TEMPERATURA",
      comparador: "GTE",
      valor: 38,
      evento: null,
      matiz: null,
      nivel: "N2",
      nombreDelNivel: "Alguien tiene que verlo ahora",
      tipo: "FIEBRE",
      nombreDelTipo: "Fiebre",
    },
    {
      id: "s2",
      clase: "EVENT",
      control: null,
      comparador: null,
      valor: null,
      evento: "CAIDA",
      matiz: "CON_GOLPE",
      nivel: "N3",
      nombreDelNivel: "Hay que tomar una decisión clínica",
      tipo: "CAIDA",
      nombreDelTipo: "Caída",
    },
  ],
  niveles: [],
  destinatarios: {},
  minutosDeEscalado: 5,
};

let container: HTMLDivElement;
let root: Root;
const api = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, api: api.fn };
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.fn.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function pintar(nodo: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(<MemoryRouter>{nodo}</MemoryRouter>);
  });
  // Un tick más para que el `useEffect` que pide los datos resuelva.
  await act(async () => {
    await Promise.resolve();
  });
}

function botones(): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")];
}

// ══ 1 · EL LIBRO ══════════════════════════════════════════════════
describe("el libro de incidencias", () => {
  it("pide las ABIERTAS sin que nadie lo diga", async () => {
    api.fn.mockResolvedValue({ incidencias: [ABIERTA], capacidades: [] });
    await pintar(<IncidenciasPage />);
    // El filtro por defecto va en la URL de la primera petición: es la
    // pantalla de «qué hay abierto hoy», no un listado del histórico.
    expect(api.fn.mock.calls[0]![0]).toContain("abiertas=si");
  });

  it("y dice la constancia de familia que FALTA, antes de intentar cerrar", async () => {
    api.fn.mockResolvedValue({ incidencias: [ABIERTA], capacidades: [] });
    await pintar(<IncidenciasPage />);
    expect(container.textContent).toContain("Falta la constancia de familia");
  });

  it("pinta el nivel, el tipo, de quién es y si alguien lo ha cogido", async () => {
    api.fn.mockResolvedValue({ incidencias: [ABIERTA], capacidades: [] });
    await pintar(<IncidenciasPage />);
    expect(container.textContent).toContain("Fiebre");
    expect(container.textContent).toContain("Carmen Núñez");
    expect(container.textContent).toContain("hab. 112");
    expect(container.textContent).toContain("la derivó una constante");
    expect(container.textContent).toContain("sin acusar");
  });

  it("y con el libro vacío lo dice como lo que es: la respuesta buena", async () => {
    api.fn.mockResolvedValue({ incidencias: [], capacidades: [] });
    await pintar(<IncidenciasPage />);
    expect(container.textContent).toContain(
      "No hay nada abierto. Es la respuesta que se quiere ver.",
    );
  });

  it("el AUTOCIERRE se pinta: no es lo mismo que cerrarla dirección", async () => {
    api.fn.mockResolvedValue({
      incidencias: [
        { ...ABIERTA, abierta: false, autocierre: true, cerradaEn: "2026-10-18T09:00:00.000Z" },
      ],
      capacidades: [],
    });
    await pintar(<IncidenciasPage />);
    expect(container.textContent).toContain("autocierre");
  });
});

// ══ 2 · LA FICHA ══════════════════════════════════════════════════
describe("la ficha de una incidencia", () => {
  it("NO tiene un botón de editar en ninguna parte: todo es append-only", async () => {
    api.fn.mockResolvedValue(FICHA);
    await pintar(<IncidenciaPage />);
    const textos = botones().map((b) => b.textContent ?? "");
    expect(textos.some((t) => /editar/i.test(t))).toBe(false);
    expect(textos.some((t) => /borrar/i.test(t))).toBe(false);
    // Lo que hay es «apuntar»: si algo está mal, se escribe otra línea.
    expect(textos.some((t) => t === "Apuntar")).toBe(true);
  });

  it("el botón de CERRAR sale apagado, con la razón al lado", async () => {
    api.fn.mockResolvedValue(FICHA);
    await pintar(<IncidenciaPage />);
    const cerrar = botones().find((b) => b.textContent === "Cerrar")!;
    expect(cerrar.disabled).toBe(true);
    expect(container.textContent).toContain(
      "Falta la constancia de familia",
    );
  });

  it("y con la constancia puesta, se puede", async () => {
    api.fn.mockResolvedValue({
      ...FICHA,
      puedeCerrarse: true,
      familia: [
        {
          id: "f1",
          clase: "NO_COMUNICADO",
          via: null,
          contacto: null,
          parentesco: null,
          contenido: "se le dirá cuando la vea la médica",
          respuesta: null,
          en: "2026-10-18T09:00:00.000Z",
          por: "Pilar",
          como: "Dirección",
        },
      ],
    });
    await pintar(<IncidenciaPage />);
    expect(botones().find((b) => b.textContent === "Cerrar")!.disabled).toBe(
      false,
    );
    expect(container.textContent).toContain("No comunicado");
  });

  it("en N3 dice que la tiene que cerrar OTRA persona (D-28)", async () => {
    api.fn.mockResolvedValue({ ...FICHA, nivel: "N3", puedeCerrarse: true });
    await pintar(<IncidenciaPage />);
    expect(container.textContent).toContain(
      "una persona distinta de quien la abrió",
    );
    expect(container.textContent).toContain("se queda abierta");
  });

  it("y un aviso que llegó TARDE lo dice en la cronología", async () => {
    api.fn.mockResolvedValue({
      ...FICHA,
      avisos: [
        {
          ...FICHA.avisos[0]!,
          apuntadoEn: "2026-10-18T06:41:00.000Z",
          salidoEn: "2026-10-18T08:41:00.000Z",
        },
      ],
    });
    await pintar(<IncidenciaPage />);
    expect(container.textContent).toContain("la tablet estaba sin red");
  });

  it("dice con qué VERSIÓN de la plantilla se graduó", async () => {
    api.fn.mockResolvedValue(FICHA);
    await pintar(<IncidenciaPage />);
    expect(container.textContent).toContain(
      "Graduada con la versión 1 de la plantilla",
    );
  });
});

// ══ 3 · LA GUARDIA ════════════════════════════════════════════════
describe("la guardia del centro", () => {
  function responder(config = CONFIG, plantilla = PLANTILLA) {
    api.fn.mockImplementation((url: string) =>
      url.includes("plantilla")
        ? Promise.resolve(plantilla)
        : Promise.resolve(config),
    );
  }

  it("SIN NINGÚN MÓVIL emparejado lo dice con todas las letras", async () => {
    responder();
    await pintar(<GuardiaPage />);
    expect(container.textContent).toContain(
      "ningún aviso suena en ninguna parte",
    );
  });

  it("y un nivel SIN DESTINATARIOS también", async () => {
    responder({ ...CONFIG, destinatarios: { ...CONFIG.destinatarios, N2: [] } });
    await pintar(<GuardiaPage />);
    expect(container.textContent).toContain("Un N2 no sonará en ningún móvil");
  });

  it("la plantilla se pinta en SOLO LECTURA: sin un botón de editar", async () => {
    responder();
    await pintar(<GuardiaPage />);
    expect(container.textContent).toContain("Plantilla de gravedad");
    expect(container.textContent).toContain("versión 1");
    // Los umbrales clínicos no se configuran por centro (D-21, D-65).
    const textos = botones().map((b) => b.textContent ?? "");
    expect(textos.some((t) => /editar/i.test(t))).toBe(false);
    expect(container.querySelectorAll("table input")).toHaveLength(0);
  });

  it("y la tabla se lee: «≥ 38 → N2 · abre Fiebre»", async () => {
    responder();
    await pintar(<GuardiaPage />);
    const tabla = container.querySelector("table")!.textContent ?? "";
    expect(tabla).toContain("TEMPERATURA");
    expect(tabla).toContain("≥ 38");
    expect(tabla).toContain("N2");
    expect(tabla).toContain("Fiebre");
    expect(tabla).toContain("CAIDA");
    expect(tabla).toContain("CON_GOLPE");
  });

  it("VERSIÓN 0 es que no hay plantilla, y entonces NADA GRADÚA", async () => {
    responder(CONFIG, { ...PLANTILLA, version: 0, reglas: [] });
    await pintar(<GuardiaPage />);
    expect(container.textContent).toContain("nada gradúa");
  });

  it("y el servicio sanitario dice que LA LLAMADA LA HACE LA PERSONA (D-33)", async () => {
    responder();
    await pintar(<GuardiaPage />);
    expect(container.textContent).toContain("La llamada la hace la persona");
    expect(container.textContent).toContain(
      "no llama ni escribe a nadie de fuera",
    );
  });
});

// ══ 4 · LAS FUNCIONES DE LA BIBLIOTECA ════════════════════════════
describe("los nombres", () => {
  it("N4 es el único en rojo sólido", () => {
    expect(colorDelNivel("N4")).toContain("bg-red-600");
    expect(colorDelNivel("N3")).not.toContain("bg-red-600");
  });

  it("el sujeto se lee en castellano", () => {
    expect(nombreDelSujeto("RESIDENT")).toBe("Residente");
    expect(nombreDelSujeto("COMPLAINT")).toBe("Queja");
    expect(nombreDelSujeto("MAINTENANCE")).toBe("Avería");
  });

  it("y el origen dice QUIÉN la abrió, que es lo que la auditoría mira", () => {
    expect(nombreDelOrigen("DERIVED_THRESHOLD")).toBe("la derivó una constante");
    expect(nombreDelOrigen("DERIVED_ABSENCE")).toBe("la derivó una ausencia");
    expect(nombreDelOrigen("DECLARED")).toBe("declarada");
  });
});
