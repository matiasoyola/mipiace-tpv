// clinica-8 (fase B, 14) · EL TEST DEL PACIENTE EN LA TABLET.
//
// Auditoría del 18-10, punto 18: «Test en tablet: sin botón para que la
// sanitaria recupere la tablet; "la podóloga" fijo; "Sí" resaltado antes
// de contestar; "¿Quién responde?" con doble toque».
//
// Los cuatro tienen el mismo peso, y el tercero más que ninguno: esta
// pantalla la contesta una persona de 78 años y de sus diez respuestas
// salen las alertas con las que se coge el bisturí. Un cuestionario de
// salud que sugiere una respuesta la consigue.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CUESTIONARIO_V1 } from "@mipiacetpv/clinica-valoracion";

import { deLaEspecialidad, TestPaciente } from "../src/clinica/TestPaciente.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | undefined;
let devueltas: number;

beforeEach(() => {
  devueltas = 0;
  root = undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  // El primer test de este fichero es puro y no monta nada.
  if (root) await act(async () => root.unmount());
  container.remove();
});

async function montar(
  props: Partial<React.ComponentProps<typeof TestPaciente>> = {},
) {
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <TestPaciente
        clinica="Clínica demo"
        nombrePila="Carmen"
        canal="TABLET"
        cuestionario={CUESTIONARIO_V1}
        onEnviar={async () => null}
        onDevolverLaTablet={() => {
          devueltas += 1;
        }}
        {...props}
      />,
    );
  });
}

async function pulsar(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function texto(): string {
  return container.textContent ?? "";
}

function boton(t: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === t,
  ) as HTMLButtonElement | undefined;
}

function porTest(t: string): HTMLElement | null {
  return container.querySelector(`[data-test="${t}"]`);
}

// ── 1 · La especialidad, no «la podóloga» ───────────────────────────

describe("clinica-8 (14) · los textos salen de la especialidad", () => {
  it("la función reparte la frase, y sin especialidad no la nombra", () => {
    expect(deLaEspecialidad("PODOLOGIA")).toBe(" de podología");
    expect(deLaEspecialidad("FISIOTERAPIA")).toBe(" de fisioterapia");
    // Un centro que no ha declarado ningún tipo de visita. Inventar
    // «podología» sería escribirle a la paciente de un fisioterapeuta
    // que su visita es de podología.
    expect(deLaEspecialidad(null)).toBe("");
    expect(deLaEspecialidad(undefined)).toBe("");
  });

  it("en podología lo dice, y NO nombra a «la podóloga»", async () => {
    await montar({ especialidad: "PODOLOGIA" });
    expect(texto()).toContain("su primera visita de podología");
    expect(texto()).not.toContain("la podóloga");
  });

  it("en fisioterapia dice fisioterapia", async () => {
    await montar({ especialidad: "FISIOTERAPIA" });
    expect(texto()).toContain("su primera visita de fisioterapia");
  });

  it("sin especialidad la frase sigue siendo correcta", async () => {
    await montar({ especialidad: null });
    expect(texto()).toContain("Antes de su primera visita");
    expect(texto()).not.toContain("de podología");
    expect(texto()).not.toContain("la podóloga");
  });

  it("y en ninguna pantalla del test se nombra a «la podóloga»", async () => {
    await montar({ especialidad: "PODOLOGIA" });
    await pulsar(boton("Empezar")!);
    // La de «¿quién responde?».
    expect(texto()).not.toContain("la podóloga");
    await pulsar(boton("Soy Carmen")!);
    // Y la primera pregunta.
    expect(texto()).not.toContain("la podóloga");
  });
});

// ── 2 · Nada resaltado antes de contestar ───────────────────────────

describe("clinica-8 (14) · el «Sí» no viene resaltado", () => {
  async function irALaPrimeraPregunta() {
    await montar();
    await pulsar(boton("Empezar")!);
    await pulsar(boton("Soy Carmen")!);
  }

  it("«Sí» y «No» salen IGUAL mientras no se ha contestado", async () => {
    await irALaPrimeraPregunta();
    const si = boton("Sí")!;
    const no = boton("No")!;
    expect(si.getAttribute("aria-pressed")).toBe("false");
    expect(no.getAttribute("aria-pressed")).toBe("false");
    // El borde coral del «Sí» era «marca de antemano el que tiene
    // consecuencias» en el mockup; en la tablet marca la respuesta que
    // se espera.
    expect(si.className).toContain("border-slate-200");
    expect(si.className).not.toContain("border-mipiace-coral");
    expect(no.className).toContain("border-slate-200");
  });

  it("el coral sigue existiendo, pero DESPUÉS: marca lo contestado", async () => {
    await irALaPrimeraPregunta();
    await pulsar(boton("Sí")!);
    // Se ha avanzado de pregunta; se vuelve con «Atrás» para verlo.
    await pulsar(boton("‹ Atrás")!);
    const si = boton("Sí")!;
    expect(si.getAttribute("aria-pressed")).toBe("true");
    expect(si.className).toContain("bg-mipiace-coral");
  });
});

// ── 3 · Elegir quién responde avanza solo ───────────────────────────

describe("clinica-8 (14) · «¿Quién responde?» avanza solo", () => {
  it("un toque y ya está en la primera pregunta", async () => {
    await montar();
    await pulsar(boton("Empezar")!);
    expect(texto()).toContain("¿Quién está respondiendo?");
    // Y no hay «Seguir» que buscar: era el segundo toque.
    expect(boton("Seguir")).toBeUndefined();
    await pulsar(boton("Soy Carmen")!);
    expect(texto()).toContain("Pregunta 1 de");
  });

  it("y lo elegido viaja en el envío", async () => {
    const enviados: Array<{ respondioPor: string }> = [];
    await montar({
      onEnviar: async (r) => {
        enviados.push(r);
        return null;
      },
    });
    await pulsar(boton("Empezar")!);
    await pulsar(boton("Un familiar o acompañante")!);
    // Las diez preguntas, todas «No» (ninguna abre seguimiento).
    for (let i = 0; i < 12; i++) {
      const no = boton("No");
      if (!no) break;
      await pulsar(no);
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(enviados[0]?.respondioPor).toBe("FAMILIAR");
  });
});

// ── 4 · Devolver la tablet al centro ────────────────────────────────

describe("clinica-8 (14) · la salida de la tablet", () => {
  it("el botón está, desde la primera pantalla", async () => {
    await montar();
    expect(porTest("devolver-la-tablet")).not.toBeNull();
  });

  it("a medias PREGUNTA: lo contestado se perdería", async () => {
    // Las respuestas sólo se mandan al final (`Paso`), así que salir a
    // mitad las tira. No es un «¿seguro?» de cortesía.
    await montar();
    await pulsar(boton("Empezar")!);
    await pulsar(porTest("devolver-la-tablet")!);
    expect(devueltas).toBe(0);
    const dialogo = porTest("confirmar-devolver");
    expect(dialogo).not.toBeNull();
    expect(dialogo!.textContent).toContain("se queda a medias");
    await pulsar(porTest("devolver-sin-terminar")!);
    expect(devueltas).toBe(1);
  });

  it("«Seguir contestando» vuelve al test sin perder nada", async () => {
    await montar();
    await pulsar(boton("Empezar")!);
    await pulsar(porTest("devolver-la-tablet")!);
    await pulsar(porTest("seguir-contestando")!);
    expect(devueltas).toBe(0);
    expect(porTest("confirmar-devolver")).toBeNull();
    expect(texto()).toContain("¿Quién está respondiendo?");
  });

  it("terminado NO pregunta: ya está todo guardado", async () => {
    await montar();
    await pulsar(boton("Empezar")!);
    await pulsar(boton("Soy Carmen")!);
    for (let i = 0; i < 12; i++) {
      const no = boton("No");
      if (!no) break;
      await pulsar(no);
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(texto()).toContain("Gracias, Carmen");
    await pulsar(porTest("devolver-la-tablet")!);
    expect(porTest("confirmar-devolver")).toBeNull();
    expect(devueltas).toBe(1);
  });

  it("por el ENLACE del email no hay ninguna tablet que devolver", async () => {
    // La persona está en SU móvil: un botón que lleve al TPV sería
    // mandarla a la pantalla de PIN de la clínica.
    await montar({ canal: "LINK", onDevolverLaTablet: undefined });
    expect(porTest("devolver-la-tablet")).toBeNull();
  });
});
