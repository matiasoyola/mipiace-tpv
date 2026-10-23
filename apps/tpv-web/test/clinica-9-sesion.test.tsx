// clinica-9 (1) · LO QUE LA SANITARIA HA MARCADO NO SE LO LLEVA UNA RECARGA.
//
// La pasada en hierro del 24-10 (`docs/qa/2026-10-24-clinica-8/`): sesión
// de una paciente diabética, «Pie de riesgo» marcado desde la banda que lo
// recomienda, las cuatro comprobaciones rellenas («Riesgo muy bajo»), unas
// fotos, y la hoja de firmar diciendo **«Tipo de visita: General»**. La
// exploración del pie no llegó a la historia y nadie vio que se perdiera.
//
// El camino es el de la captura 30: para hacer una foto hay que firmar el
// consentimiento de fotos; al firmarlo, `Consentimientos` llama a
// `onFirmado`, y `onFirmado` recarga la sesión para que la puerta de
// arriba se entere. La recarga volvía a sembrar los tipos con los de los
// servicios de la cita — en la «Clínica demo», sólo «General».
//
// Lo que este fichero fija es la regla, no el camino: **una recarga
// refresca lo que es del servidor y no toca lo que hay a medio escribir.**
// Por eso el consentimiento está sustituido por un botón que sólo llama a
// `onFirmado`: lo que se prueba es `SesionPodologia.cargar`, que es la
// línea saboteada, y no la pantalla de consentimientos (ésa tiene su
// fichero). Con la siembra fuera del `if`, los cuatro tests caen.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTOS_QUIROPODIA_V1,
  CONSEJOS_V1,
  ESTADOS_DE_HERIDA,
  FUENTE_DEL_RIESGO,
  LESIONES_V1,
  MAPA_PIE_V1,
  PENDIENTES_V1,
  PISADAS,
  PUNTOS_DE_LA_HERIDA,
  TIPOS_DE_PIE_BIOMECANICA,
  versionesDeHoy,
} from "@mipiacetpv/clinica-sesion";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

// El consentimiento, reducido a su único efecto sobre esta pantalla:
// firmarlo la recarga. Lo que pinte no es de este fichero.
vi.mock("../src/clinica/Consentimientos.js", () => ({
  Consentimientos: (props: { onFirmado?: () => void }) => (
    <button type="button" data-test="stub-firmar" onClick={props.onFirmado}>
      Firmar (stub)
    </button>
  ),
}));

import {
  SesionPodologia,
  type VistaDeLaSesion,
} from "../src/clinica/SesionPodologia.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CITA = "55555555-5555-5555-5555-555555555551";
const PACIENTE = "44444444-4444-4444-4444-444444444444";
/** El único servicio de la «Clínica demo» del 24-10, y es GENERAL. */
const CONSULTA = "66666666-6666-6666-6666-666666666661";

/**
 * La vista de la «Clínica demo»: una consulta diagnóstico de tipo
 * `GENERAL` y **ni un servicio en la categoría del pie de riesgo**. Es el
 * catálogo con el que la pasada encontró el fallo, y es a propósito: si
 * el tipo sólo sobreviviera cuando su categoría cobra algo, aquí se
 * vería.
 */
function vista(): VistaDeLaSesion {
  return {
    cita: {
      id: CITA,
      clientId: PACIENTE,
      empieza: "2026-10-24T08:00:00.000Z",
      status: "IN_SERVICE",
      servicios: ["Consulta diagnóstico"],
      servicioIds: [CONSULTA],
      atiende: { userId: "u1", nombre: "Rosario" },
      ticketId: null,
    },
    cabecera: {
      paciente: {
        id: PACIENTE,
        nombre: "Carmen Prueba Demo",
        edad: 70,
        telefono: "600000001",
      },
      citaDeHoy: {
        empieza: "2026-10-24T08:00:00.000Z",
        servicios: ["Consulta diagnóstico"],
      },
      numeroDeVisita: 1,
      visitaAnterior: null,
      atiende: { userId: "u1", nombre: "Rosario" },
      alertas: ["Diabetes"],
      alertaIds: ["diab"],
    },
    puerta: { puede: true, valoracionId: "v1", validadaEn: "2026-10-24T07:00:00.000Z" },
    consentimientos: { puede: true, faltan: [], mensaje: "" },
    tratamientos: [
      {
        serviceId: CONSULTA,
        nombre: "Consulta diagnóstico",
        tipo: "GENERAL",
        nivelQuiropodia: null,
        precio: 20,
        iva: 0,
      },
    ],
    tiposSugeridos: ["GENERAL"],
    pendientes: [],
    ultimaCirugia: null,
    anterior: null,
    dolorHistorico: [],
    exploracion: {
      departeDe: {
        pulsos: { L: null, R: null },
        sinSensibilidad: [],
        tipoDePie: null,
      },
      ultima: null,
    },
    cerrada: null,
    listas: {
      mapa: MAPA_PIE_V1,
      lesiones: LESIONES_V1,
      consejos: CONSEJOS_V1,
      actos: ACTOS_QUIROPODIA_V1,
      estadosDeHerida: ESTADOS_DE_HERIDA,
      puntos: PUNTOS_DE_LA_HERIDA,
      tiposDePieBiomecanica: TIPOS_DE_PIE_BIOMECANICA,
      pisadas: PISADAS,
      pendientes: PENDIENTES_V1,
      versiones: versionesDeHoy() as unknown as Record<string, number>,
      fuenteDelRiesgo: FUENTE_DEL_RIESGO,
    },
    verImportes: true,
  };
}

let host: HTMLDivElement;
let root: Root;
let enviado: Array<{ url: string; body: unknown }>;
/** Cuántas veces se ha pedido la vista de la sesión. */
let cargas: number;

async function montar(): Promise<void> {
  enviado = [];
  cargas = 0;
  apiMock.apiWithCashier.mockImplementation(
    async (url: string, init?: { method?: string; body?: unknown }) => {
      if (init?.method) enviado.push({ url, body: init.body });
      if (url.includes("/contrato")) {
        return { aceptado: true, version: 2, debeAceptar: false };
      }
      if (url.endsWith("/sesion")) {
        cargas += 1;
        // La MISMA vista en las dos cargas: lo que cambia entre una y
        // otra no es el servidor, es lo que la sanitaria lleva escrito.
        return vista();
      }
      if (url.endsWith("/cerrar")) {
        return {
          yaEstaba: false,
          cerrada: {
            entryId: "e-nueva",
            cerradaEn: "2026-10-24T09:00:00.000Z",
            firma: {
              autorNombre: "Rosario",
              colegiado: null,
              firmadaEn: "2026-10-24T09:00:00.000Z",
            },
            cuerpo: {
              v: 2,
              dolor: 3,
              evolucion: null,
              consejos: [],
              proximaCita: null,
              nota: null,
              consejosVersion: 1,
            },
            marcas: [],
            resumen: { tratamientos: 1, lineas: [], textoDelBoton: "x" },
            yaCobrada: false,
          },
        };
      }
      if (url.includes("/fotos")) {
        return {
          fotos: [],
          comparador: [],
          consentimiento: {
            puede: false,
            plantillaId: "fotos-clinicas",
            mensaje: "Antes de la primera foto…",
          },
          mapaVersion: 1,
        };
      }
      return vista();
    },
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<SesionPodologia appointmentId={CITA} />);
  });
}

function texto(): string {
  return host.textContent ?? "";
}

function botones(): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")] as HTMLButtonElement[];
}

function botonPorTexto(t: string): HTMLButtonElement | undefined {
  return botones().find((b) => (b.textContent ?? "").trim() === t);
}

function porTest(t: string): HTMLElement | null {
  return host.querySelector(`[data-test="${t}"]`);
}

function chipDeTipo(nombre: string): HTMLButtonElement {
  const caja = host.querySelector('[data-test="chips-de-tipo"]');
  if (!caja) throw new Error("no hay chips de tipo");
  const b = [...caja.querySelectorAll("button")].find((x) =>
    (x.textContent ?? "").includes(nombre),
  );
  if (!b) throw new Error(`no hay chip de ${nombre}`);
  return b as HTMLButtonElement;
}

/** Un botón dentro de UNA comprobación del pie, por el título de la caja:
 *  «Sí» y «No» salen cuatro veces en esa tarjeta. */
function enComprobacion(titulo: string, etiqueta: string): HTMLButtonElement {
  const caja = [...host.querySelectorAll("div")].find(
    (d) => (d.firstElementChild?.textContent ?? "") === titulo,
  );
  if (!caja) throw new Error(`no hay comprobación «${titulo}»`);
  const b = [...caja.querySelectorAll("button")].find(
    (x) => (x.textContent ?? "").trim() === etiqueta,
  );
  if (!b) throw new Error(`no hay «${etiqueta}» en «${titulo}»`);
  return b as HTMLButtonElement;
}

async function pulsar(b: HTMLElement | undefined | null) {
  if (!b) throw new Error("botón no encontrado");
  await act(async () => {
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function pestana(nombre: string) {
  const b = [...host.querySelectorAll('[role="tab"]')].find(
    (x) => (x.textContent ?? "").trim() === nombre,
  );
  await pulsar(b as HTMLElement);
}

/** El recorrido de la pasada: marcar el pie de riesgo y rellenar las
 *  cuatro comprobaciones hasta que sale el veredicto. */
async function marcarPieDeRiesgo() {
  await pulsar(porTest("marcar-pie-de-riesgo"));
  await pulsar(enComprobacion("Sensibilidad (monofilamento)", "Normal"));
  // Los dos pulsos van por su fila («Izq» / «Der»): «Sí» sale cuatro
  // veces en la tarjeta y por texto se cogería siempre el primero.
  const pulsos = [...host.querySelectorAll("div")].filter((d) =>
    ["Izq", "Der"].includes(d.children[0]?.textContent ?? ""),
  );
  for (const fila of pulsos) {
    await pulsar(
      [...fila.querySelectorAll("button")].find(
        (b) => (b.textContent ?? "").trim() === "Sí",
      ),
    );
  }
  await pulsar(enComprobacion("¿Úlcera previa o actual?", "No"));
  await pulsar(enComprobacion("¿Deformidad del pie?", "No"));
}

function cuerpoDelCierre(): Record<string, unknown> {
  const ultimo = [...enviado].reverse().find((e) => e.url.endsWith("/cerrar"));
  if (!ultimo) throw new Error("no se ha cerrado nada");
  return ultimo.body as Record<string, unknown>;
}

beforeEach(() => {
  apiMock.apiWithCashier.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("clinica-9 · firmar un consentimiento no borra el tipo marcado", () => {
  it("el chip sigue marcado tras la recarga", async () => {
    await montar();
    await marcarPieDeRiesgo();
    expect(chipDeTipo("Pie de riesgo").getAttribute("aria-pressed")).toBe(
      "true",
    );

    await pestana("Consentimientos");
    await pulsar(porTest("stub-firmar"));
    await pestana("Sesión de hoy");

    // La recarga ha ocurrido de verdad: dos pasadas por `GET /sesion`.
    expect(cargas).toBe(2);
    expect(chipDeTipo("Pie de riesgo").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("y con él su tarjeta, con las cuatro comprobaciones puestas", async () => {
    await montar();
    await marcarPieDeRiesgo();
    expect(texto()).toContain("Riesgo muy bajo");

    await pestana("Consentimientos");
    await pulsar(porTest("stub-firmar"));
    await pestana("Sesión de hoy");

    expect(texto()).toContain("Pie de riesgo");
    // El veredicto sigue ahí, que es decir que las cuatro respuestas
    // siguen ahí: con una sola borrada diría cuál falta.
    expect(texto()).toContain("Riesgo muy bajo");
    expect(texto()).not.toContain("Falta");
  });

  it("la hoja de firmar dice los DOS tipos, no sólo el que cobra", async () => {
    await montar();
    await marcarPieDeRiesgo();
    await pestana("Consentimientos");
    await pulsar(porTest("stub-firmar"));
    await pestana("Sesión de hoy");
    await pulsar(botonPorTexto("3"));
    await pulsar(botonPorTexto("Cerrar sesión y cobrar"));

    const hoja = porTest("confirmar-cierre");
    expect(hoja).not.toBeNull();
    expect(hoja!.textContent).toContain("Pie de riesgo");
    expect(hoja!.textContent).toContain("General");
  });

  it("y el cierre manda el tipo con su bloque entero", async () => {
    await montar();
    await marcarPieDeRiesgo();
    await pestana("Consentimientos");
    await pulsar(porTest("stub-firmar"));
    await pestana("Sesión de hoy");
    await pulsar(botonPorTexto("3"));
    await pulsar(botonPorTexto("Cerrar sesión y cobrar"));
    await pulsar(porTest("firmar-cierre"));

    const cuerpo = cuerpoDelCierre();
    expect(cuerpo.tipos).toEqual(["PIE_RIESGO", "GENERAL"]);
    const bloques = cuerpo.bloques as Record<string, unknown>;
    expect(bloques.PIE_RIESGO).toEqual({
      sensibilidad: "NORMAL",
      pulsos: { L: "PRESENTE", R: "PRESENTE" },
      ulcera: "NO",
      deformidad: "NO",
      servicios: [],
    });
  });
});
