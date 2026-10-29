// cogecop-1 · lo que la historia enseña de lo que vino de COGECOP.
//
// Tres cosas que un test de API no puede ver, porque son de pantalla:
//
//   1. **La fila de una visita importada lo dice**, al lado de la fecha.
//   2. **La ficha enseña «De COGECOP · sin validar»** con las
//      enfermedades y las alergias que traía, y dice que nadie las ha
//      repasado. La banda NO sale si no traía ninguna de las dos.
//   3. **Abrir una visita importada** pinta sus textos, sus marcas y las
//      que no se tradujeron con su nombre de COGECOP — y NO pinta ni
//      dolor, ni consejos, ni caja, ni un botón.
//   4. **El pie vivo dice de dónde parte**: una zona cuyo último paso es
//      una visita importada lo lleva escrito.
//
// Mismo patrón sin testing-library que el resto del repo: createRoot +
// act.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAPA_PIE_V1 } from "@mipiacetpv/clinica-sesion";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

import { HistoriaViva } from "../src/clinica/HistoriaViva.js";
import { __resetBackGuardForTests } from "../src/hooks/useBackGuard.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const PACIENTE = "44444444-4444-4444-4444-444444444444";
const AHORA = "2026-10-29T09:00:00.000Z";

type Vista = Record<string, unknown>;

function vista(opts: { conCogecop?: boolean } = {}): Vista {
  return {
    cabecera: {
      paciente: {
        id: PACIENTE,
        nombre: "Carmen Rodríguez",
        iniciales: "CR",
        edad: 78,
        telefono: "+34600123456",
        desde: "2025-02-06T08:00:00.000Z",
      },
      alertas: [],
      alertaIds: [],
      alertasPorValidar: true,
      cogecop:
        opts.conCogecop === false
          ? null
          : {
              importadoEl: "2026-10-29",
              enfermedades: "HTA · diabetes tipo 2",
              alergias: "NAMC",
            },
    },
    enDiezSegundos: {
      hoyToca: null,
      dolor: { puntos: [], ultimo: null, anterior: null, texto: null },
      ultimaVez: null,
      ojoHoy: null,
    },
    zonas: [
      {
        clave: "L:h",
        pie: "L",
        zonaId: "h",
        nombre: "Pie izq. · Dedo gordo",
        estado: "ACTIVA",
        lesion: "onicogrifosis",
        lesionNombre: "Uña engrosada (onicogrifosis)",
        gravedad: null,
        gravedadNombre: null,
        importada: true,
        pasos: [
          {
            entryId: "imp1",
            fecha: "2025-06-02T09:00:00.000Z",
            lesion: "onicogrifosis",
            lesionNombre: "Uña engrosada (onicogrifosis)",
            gravedad: null,
            gravedadNombre: null,
            tipos: ["QUIROPODIA"],
            tiposNombre: ["Quiropodia"],
            importada: true,
          },
        ],
        curadaEn: null,
      },
    ],
    sensibilidad: null,
    visitas: [
      {
        entryId: "imp1",
        fecha: "2025-06-02T09:00:00.000Z",
        tipos: ["QUIROPODIA"],
        tiposNombre: ["Quiropodia"],
        titulo: "Quiropodia",
        nivel: null,
        nivelNombre: null,
        dolor: null,
        evolucion: null,
        evolucionNombre: null,
        chips: ["Q2 QUIROPODIA COMPLETA", "Eritrasma"],
        importada: true,
      },
    ],
    totalDeVisitas: 1,
    documentos: [],
    fotos: [],
    comparador: [],
    consentimientoDeFotos: { puede: false, plantillaId: "fotos-clinicas" },
    recomendada: null,
    pendientes: [],
    listas: { mapa: MAPA_PIE_V1 },
    ahora: AHORA,
  };
}

/** El detalle de una visita importada, como lo manda la API. */
const DETALLE_IMPORTADO = {
  entryId: "imp1",
  cerradaEn: "2025-06-02T09:00:00.000Z",
  firma: {
    autorNombre: "Rosario",
    colegiado: "45/0312",
    firmadaEn: "2025-06-02T09:00:00.000Z",
  },
  importada: true,
  cuerpo: {
    origen: "cogecop",
    cogecopId: 412,
    tipo: "quiropodia",
    motivo: "UÑAS",
    evolucion: null,
    diagnostico: "OC HALLUX BL",
    recomendacion: "Q2 QUIROPODIA COMPLETA",
    alerta: true,
    tratamientos: ["Q2 QUIROPODIA COMPLETA"],
    marcas: [
      {
        dibujo: 0,
        pie: "L",
        zona: "h",
        lesion: "onicogrifosis",
        lesionOriginal: "Onicigrifosis",
        curado: null,
      },
      {
        dibujo: 2,
        pie: null,
        zona: null,
        lesion: null,
        lesionOriginal: "Carcinoma basocelular",
        curado: null,
      },
    ],
    mapaVersion: 1,
    lesionesVersion: 2,
  },
  marcas: [
    {
      clave: "L:h",
      zona: "Pie izq. · Dedo gordo",
      lesion: "Uña engrosada (onicogrifosis)",
      gravedad: null,
    },
  ],
};

let host: HTMLDivElement;
let root: Root;

async function montar(v: Vista): Promise<void> {
  apiMock.apiWithCashier.mockImplementation(async (url: string) => {
    if (url.includes("/historia/visitas/")) return DETALLE_IMPORTADO;
    if (url.includes("/fotos")) {
      return {
        fotos: [],
        comparador: [],
        consentimiento: {
          puede: false,
          plantillaId: "fotos-clinicas",
          mensaje: "Hace falta firmar el consentimiento.",
        },
        mapaVersion: 1,
      };
    }
    return v;
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<HistoriaViva clientId={PACIENTE} />);
  });
}

const texto = () => host.textContent ?? "";
const botones = () => [...host.querySelectorAll("button")];

/** Las visitas viven en su pestaña, como en clinica-6. */
async function pestania(nombre: string) {
  const b = [...host.querySelectorAll('[role="tab"]')].find(
    (x) => (x.textContent ?? "").trim() === nombre,
  );
  await pulsar(b);
}

/** Abre la primera fila de la lista de visitas. */
async function abrirLaVisita() {
  await pestania("Visitas");
  await pulsar(
    host.querySelector('[data-test="historia-visita-fila"]') ?? undefined,
  );
}

async function pulsar(b: Element | undefined) {
  if (!b) throw new Error("no hay botón que pulsar");
  await act(async () => {
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  apiMock.apiWithCashier.mockReset();
  __resetBackGuardForTests();
  document.body.innerHTML = "";
});

describe("cogecop-1 · la historia enseña lo importado", () => {
  it("la fila de la visita lo dice, al lado de la fecha", async () => {
    await montar(vista());
    await pestania("Visitas");
    expect(
      host.querySelector('[data-test="historia-visita-importada"]'),
    ).not.toBeNull();
    expect(texto()).toContain("Importada de COGECOP");
  });

  it("la ficha enseña «De COGECOP · sin validar» con lo que traía", async () => {
    await montar(vista());
    const banda = host.querySelector('[data-test="historia-cogecop"]');
    expect(banda).not.toBeNull();
    const t = banda!.textContent ?? "";
    expect(t).toContain("De COGECOP · sin validar");
    expect(t).toContain("HTA · diabetes tipo 2");
    expect(t).toContain("NAMC");
    // Y DICE que no es una valoración. Sin esta línea, la banda se leería
    // como si alguien lo hubiera repasado con el paciente.
    expect(t).toMatch(/Nadie lo ha repasado/);
  });

  it("sin enfermedades ni alergias, la banda NO se pinta vacía", async () => {
    await montar(vista({ conCogecop: false }));
    expect(host.querySelector('[data-test="historia-cogecop"]')).toBeNull();
    expect(texto()).not.toContain("De COGECOP");
  });

  it("el pie vivo dice que parte de la última importada", async () => {
    await montar(vista());
    const zona = host.querySelector('[data-test="historia-zona"]');
    expect(zona).not.toBeNull();
    expect(zona!.textContent).toContain(
      "Parte de la última visita importada de COGECOP",
    );
    // Y la lesión se lee con el vocabulario de la V2.
    expect(zona!.textContent).toContain("Uña engrosada (onicogrifosis)");
  });

  it("abrir una visita importada pinta sus textos y sus marcas", async () => {
    await montar(vista());
    await abrirLaVisita();
    const detalle = host.querySelector('[data-test="visita-importada"]');
    expect(detalle).not.toBeNull();
    const t = detalle!.textContent ?? "";
    expect(t).toContain("Importada de COGECOP");
    expect(t).toContain("Quiropodia");
    expect(t).toContain("OC HALLUX BL");
    expect(t).toContain("Rosario");
    expect(t).toContain("45/0312");
  });

  it("la lesión SIN traducir sale con su nombre de COGECOP", async () => {
    await montar(vista());
    await abrirLaVisita();
    const marcas = host.querySelector('[data-test="visita-importada-marcas"]');
    expect(marcas).not.toBeNull();
    const t = marcas!.textContent ?? "";
    // La traducida, con el nombre de la V2 y su sitio en el mapa.
    expect(t).toContain("Uña engrosada (onicogrifosis)");
    expect(t).toContain("Pie izq. · Dedo gordo");
    // Y la que no se tradujo, con el de COGECOP y diciendo que no tiene
    // sitio. Si no, sería un dato que no se ve en ninguna pantalla.
    expect(t).toContain("Carcinoma basocelular");
    expect(t).toContain("Sin equivalente nuestro");
    expect(t).toContain("Sin sitio en el mapa");
  });

  it("la alerta de COGECOP se enseña, y dice que no se sabe de qué", async () => {
    await montar(vista());
    await abrirLaVisita();
    const alerta = host.querySelector('[data-test="visita-importada-alerta"]');
    expect(alerta).not.toBeNull();
    expect(alerta!.textContent).toMatch(/no guardaba de qué/);
  });

  it("NO se puede editar, ni anotar, ni cobrar: sólo volver", async () => {
    await montar(vista());
    await abrirLaVisita();
    const etiquetas = botones().map((b) => (b.textContent ?? "").trim());
    expect(etiquetas).toEqual(["← Volver a la historia"]);
    const t = texto();
    for (const prohibido of ["Cobrar", "Pasa a caja", "Anotar", "Editar"]) {
      expect(t, `la visita importada ofrece «${prohibido}»`).not.toContain(
        prohibido,
      );
    }
  });

  it("y no finge un dolor que COGECOP nunca midió", async () => {
    await montar(vista());
    await abrirLaVisita();
    const t = texto();
    // Canarios que NO existen en ningún otro sitio de esta pantalla
    // («afirmar ausencia con canarios»: «dolor» está dentro de
    // «dolorida», así que se busca la etiqueta entera).
    expect(t).not.toContain("de 10");
    expect(t).not.toContain("Consejos para casa");
    expect(t).not.toContain("Próxima cita");
  });
});
