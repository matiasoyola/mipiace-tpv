// agenda-1 · H6 · LA CITA DE OTRO DÍA NO HABLA EN PRESENTE.
//
// Pasada en hierro del 27-10 (`docs/qa/2026-10-27-clinica-9/`), paso 10 y
// hallazgo H6: abriendo desde la agenda del martes la cita del JUEVES, la
// pantalla de la sesión
//
//   · ponía «Sesión en curso» arriba a la derecha,
//   · decía «Hoy toca: revisar la uña» en la banda de pendientes,
//   · y dejaba teclear el dolor, que la gráfica pintaba como el punto de
//     hoy — una línea que no pasó.
//
// clinica-9 (4) ya había puesto la franja que lo explica («Puedes mirar la
// historia y la exploración; lo de hoy se anota en la cita de hoy») y
// había apagado el botón de cerrar. Lo que faltaba era que el RESTO de la
// pantalla dijera lo mismo.
//
// Quién manda: el servidor, con la misma función que rechaza el cierre
// (`sePuedeCerrarLaSesion` → `dia.esHoy`). El front no recalcula qué día
// es: hacerlo sería un segundo sitio desde el que la fecha se puede decir
// distinta.
//
// ── Tabla de sabotajes (cada uno visto en rojo, fichero entero) ──────
//
//   1. `citaEsDeHoy = true` fijo ········· caen 2: el pendiente y el dolor
//   2. `citaEsDeHoy = false` fijo ········ caen 2: los dos del día de hoy
//   3. quitar `esDeHoy` de `<BandaDeHoyToca>` ········ cae 1: el pendiente
//   4. quitar `esDeHoy` de `<ComunDeLaSesion>` ············ cae 1: el dolor
//   5. la chapa siempre «Sesión en curso» ················· cae 1: la chapa
//   6. quitar la franja de clinica-9 (4) ·················· cae 1: la franja
//
// Los seis en rojo, uno cada vez, y ninguno se solapa con otro: la chapa y
// la franja leen `vista.dia` por su cuenta (y por eso el sabotaje 1 no las
// toca), que es lo que se quiere — tres lecturas del MISMO dato del
// servidor y ninguna de un cálculo propio.
//
// Lo que NO tiene sabotaje, y se dice: el guardia del punto de hoy en la
// gráfica (`hoy={citaEsDeHoy ? dolor : null}`). Hoy es inalcanzable —
// `setDolor` sólo lo llama la escala, que fuera del día no se pinta, y
// «Igual que la última vez» no toca el dolor— así que no hay test que
// pueda verlo en rojo. Se deja porque `dolor` es un `useState` que
// cualquier control futuro puede escribir y el guardia no cuesta nada;
// pero no está cerrando nada que hoy se pueda abrir.

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

vi.mock("../src/clinica/Consentimientos.js", () => ({
  Consentimientos: () => null,
}));

import {
  SesionPodologia,
  type VistaDeLaSesion,
} from "../src/clinica/SesionPodologia.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CITA = "55555555-5555-5555-5555-555555555551";
const PACIENTE = "44444444-4444-4444-4444-444444444444";
const CONSULTA = "66666666-6666-6666-6666-666666666661";

/** Un pendiente apuntado la visita anterior: es el que decía «Hoy toca». */
const PENDIENTE = {
  id: "revisar-una",
  zona: null,
  nota: null,
  desde: "2026-09-29T08:00:00.000Z",
  version: 1,
} as unknown as VistaDeLaSesion["pendientes"][number];

/**
 * La vista de la sesión. `esDeHoy` decide lo único que cambia entre los
 * dos casos de este fichero: lo que el SERVIDOR dice del día de la cita.
 */
function vista(esDeHoy: boolean): VistaDeLaSesion {
  return {
    cita: {
      id: CITA,
      clientId: PACIENTE,
      empieza: "2026-10-29T08:00:00.000Z",
      status: "CONFIRMED",
      servicios: ["Consulta diagnóstico"],
      servicioIds: [CONSULTA],
      atiende: { userId: "u1", nombre: "Rosario" },
      ticketId: null,
    },
    cabecera: {
      paciente: {
        id: PACIENTE,
        nombre: "Carmen Prueba",
        edad: 70,
        telefono: "600000001",
      },
      citaDeHoy: {
        empieza: "2026-10-29T08:00:00.000Z",
        servicios: ["Consulta diagnóstico"],
      },
      numeroDeVisita: 3,
      visitaAnterior: "2026-09-29T08:00:00.000Z",
      atiende: { userId: "u1", nombre: "Rosario" },
      alertas: [],
      alertaIds: [],
    },
    puerta: {
      puede: true,
      valoracionId: "v1",
      validadaEn: "2026-10-01T07:00:00.000Z",
    },
    consentimientos: { puede: true, faltan: [], mensaje: "" },
    // clinica-9 (4) · el día lo decide el servidor, con la misma función
    // que rechaza el cierre.
    dia: {
      delaCita: "2026-10-29",
      esHoy: esDeHoy,
      sePuedeCerrar: esDeHoy,
      mensaje: esDeHoy ? null : "Esta cita es del jueves 29 de octubre.",
    },
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
    pendientes: [PENDIENTE],
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

beforeEach(() => {
  apiMock.apiWithCashier.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function montar(esDeHoy: boolean) {
  apiMock.apiWithCashier.mockImplementation(async (url: string) => {
    if (url.includes("/contrato")) {
      return { aceptado: true, version: 2, debeAceptar: false };
    }
    if (url.includes("/fotos")) {
      return {
        fotos: [],
        comparador: [],
        consentimiento: { puede: true, plantillaId: null, mensaje: "" },
        mapaVersion: 1,
      };
    }
    return vista(esDeHoy);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<SesionPodologia appointmentId={CITA} />);
  });
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function texto(): string {
  return host.textContent ?? "";
}

describe("H6 · la cita de otro día no dice que sea de hoy", () => {
  it("la chapa de arriba dice que sólo se puede mirar", async () => {
    await montar(false);
    expect(
      host.querySelector('[data-test="chapa-de-la-sesion"]')!.textContent,
    ).toBe("Sólo se puede mirar");
    expect(texto()).not.toContain("Sesión en curso");
  });

  it("el pendiente sigue a la vista, pero no dice «Hoy toca» ni se marca", async () => {
    await montar(false);
    const banda = host.querySelector('[data-test="hoy-toca"]')!;
    // El pendiente NO desaparece: es lo que la sanitaria necesita leer
    // antes de la visita.
    expect(banda.textContent).toContain("Pendiente:");
    expect(banda.textContent).not.toContain("Hoy toca");
    expect(banda.textContent).toContain("se marca el día de la cita");
    // Y no se deja marcar: hacerlo apuntaría en la sesión del jueves algo
    // que se hizo (o no) el martes.
    for (const b of [...banda.querySelectorAll("button")]) {
      expect(b.disabled).toBe(true);
    }
  });

  it("no deja anotar el dolor, y dice dónde se anota", async () => {
    await montar(false);
    expect(host.querySelector('[data-test="escala-de-dolor"]')).toBeNull();
    expect(
      host.querySelector('[data-test="dolor-fuera-del-dia"]')!.textContent,
    ).toContain("se anota el día de la cita");
    // Y el rótulo de la sección tampoco dice «hoy».
    expect(texto()).not.toContain("Dolor hoy");
  });

  it("y la franja de clinica-9 sigue explicando por qué", async () => {
    await montar(false);
    expect(
      host.querySelector('[data-test="cita-de-otro-dia"]')!.textContent,
    ).toContain("lo de hoy se anota en la cita de hoy");
  });
});

describe("H6 · y el día de la cita todo sigue igual", () => {
  it("«Sesión en curso», «Hoy toca» y la escala del dolor", async () => {
    await montar(true);
    expect(
      host.querySelector('[data-test="chapa-de-la-sesion"]')!.textContent,
    ).toBe("Sesión en curso");
    expect(host.querySelector('[data-test="hoy-toca"]')!.textContent).toContain(
      "Hoy toca:",
    );
    expect(host.querySelector('[data-test="escala-de-dolor"]')).not.toBeNull();
    expect(texto()).toContain("Dolor hoy");
    // Y sin la franja de «esta cita es de otro día».
    expect(host.querySelector('[data-test="cita-de-otro-dia"]')).toBeNull();
  });

  it("el pendiente se puede marcar hecho, que es para lo que está", async () => {
    await montar(true);
    const banda = host.querySelector('[data-test="hoy-toca"]')!;
    const boton = banda.querySelector("button")!;
    expect(boton.disabled).toBe(false);
    await act(async () => {
      boton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(banda.textContent).toContain("Hecho:");
  });
});
