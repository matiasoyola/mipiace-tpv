// clinica-9 (7) · LA VALORACIÓN DE UNA PACIENTE SIN EMAIL.
//
// Pasada en hierro del 24-10, captura 14. La pantalla de la valoración de
// una paciente que NO tiene correo en su ficha decía dos cosas falsas a
// la vez:
//
//   1. **«El enlace que se le mandó vale hasta el 22 de noviembre.»** No
//      se le mandó nada: no hay a dónde. La sanitaria espera una
//      respuesta que no puede llegar, y lo único que había que hacer era
//      darle la tablet.
//   2. **«ALERTAS · 10 respuestas sin resolver»**, en rojo, sobre un test
//      que nadie ha abierto todavía. Antes de contestar, TODAS las
//      preguntas están «sin resolver»: es la cuenta de lo que falta, no
//      una alerta clínica. Rojo es el color de «esta paciente es
//      anticoagulada»; gastarlo aquí enseña a no mirarlo.
//
// Sabotaje: quita `sinEmail` de la pantalla y caen los tres primeros;
// quita `respondida` de `FranjaDeAlertas` y caen los dos últimos.

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

import { ValoracionSanitario } from "../src/clinica/ValoracionSanitario.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const PACIENTE = "cl-carmen";

/** La vista que devuelve la API, con el test SIN CONTESTAR. */
function vista(opts: { tieneEmail: boolean }): Record<string, unknown> {
  return {
    paciente: { tieneEmail: opts.tieneEmail },
    valoracion: {
      id: "v1",
      estado: "PENDIENTE_PACIENTE",
      canal: "EMAIL",
      version: 1,
      creadaEn: "2026-10-24T08:00:00.000Z",
      origen: "APPOINTMENT",
      pedidaPor: null,
      appointmentId: "ap-carmen",
      respondidaEn: null,
      respondioPor: null,
      validadaEn: null,
      validadaPor: null,
      confirmaciones: { alergias: false, medicacion: false, alertas: false },
      enlace: { activo: true, caducaEn: "2026-11-22T08:00:00.000Z" },
    },
    cuestionario: null,
    respuestasPaciente: {},
    detalles: {},
    correcciones: [],
    // Lo que la API calcula antes de que nadie conteste: ninguna alerta y
    // las diez preguntas «sin resolver».
    alertas: {
      alertas: [],
      sinResolver: Array.from({ length: 10 }, (_, i) => `p${i}`),
      detalles: {},
    },
    validable: {
      puede: false,
      motivo: "NO_RESPONDIDA",
      mensaje: "Todavía no ha contestado.",
    },
    anteriores: [],
    primerTratamiento: {
      puede: false,
      motivo: "SIN_VALORACION",
      mensaje: "Falta la valoración.",
    },
    textosConfirmacion: {
      alergias: "a",
      medicacion: "b",
      alertas: "c",
    },
  };
}

let host: HTMLDivElement;
let root: Root;

async function montar(opts: { tieneEmail: boolean }) {
  apiMock.apiWithCashier.mockImplementation(async (url?: string) => {
    if ((url ?? "").includes("/contrato")) {
      return { aceptado: true, version: 2, debeAceptar: false };
    }
    return vista(opts);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<ValoracionSanitario clientId={PACIENTE} puedeLeer />);
  });
}

const texto = () => host.textContent ?? "";
const botonPorTexto = (t: string) =>
  [...host.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === t,
  );

beforeEach(() => apiMock.apiWithCashier.mockReset());
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("clinica-9 · la paciente sin email", () => {
  it("NO dice que se le mandó un enlace", async () => {
    await montar({ tieneEmail: false });
    expect(texto()).not.toContain("El enlace que se le mandó");
    expect(texto()).not.toContain("22 de noviembre");
  });

  it("dice que no tiene email y manda a la tablet", async () => {
    await montar({ tieneEmail: false });
    expect(texto()).toContain("No tiene email en su ficha");
    expect(texto()).toContain("ábrele la tablet");
    expect(botonPorTexto("Test en la tablet")).toBeDefined();
  });

  it("y no ofrece mandarlo: ese camino sólo puede fallar", async () => {
    await montar({ tieneEmail: false });
    expect(botonPorTexto("Reenviar el test")).toBeUndefined();
    expect(botonPorTexto("Enviar el test")).toBeUndefined();
  });

  it("con email, la pantalla es la de siempre", async () => {
    await montar({ tieneEmail: true });
    expect(texto()).toContain("El enlace que se le mandó");
    expect(botonPorTexto("Reenviar el test")).toBeDefined();
  });
});

describe("clinica-9 · un test sin contestar no es una alerta roja", () => {
  it("no se pinta «N respuestas sin resolver» antes de contestar", async () => {
    await montar({ tieneEmail: true });
    expect(texto()).not.toContain("respuestas sin resolver");
    expect(texto()).not.toContain("ALERTAS");
  });

  it("se dice lo que hay: sin alertas todavía, el test está sin contestar", async () => {
    await montar({ tieneEmail: true });
    expect(
      host.querySelector('[data-test="sin-contestar"]')?.textContent,
    ).toContain("sin contestar");
  });
});
