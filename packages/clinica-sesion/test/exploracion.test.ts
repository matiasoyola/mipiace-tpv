// clinica-3 · la exploración: pulsos, monofilamento y tipo de pie.
//
// Y sobre todo la regla 5 del prompt: «la siguiente parte de la última».
// Que es la REGLA CONTRARIA a la del mapa de la sesión, donde «igual que
// la última vez» SUMA — las dos están testeadas la una al lado de la otra
// a propósito, porque confundirlas es el error fácil.

import { describe, expect, it } from "vitest";

import {
  VERSION_DE_LA_EXPLORACION,
  esPulso,
  esTipoDePie,
  exploracionVacia,
  normalizarExploracion,
  partirDeLaUltima,
  sinSensibilidadPorPie,
  type ExploracionEnPantalla,
} from "../src/index.js";

describe("la exploración vacía", () => {
  it("arranca en lo normal: pulso presente en los dos pies y pie normal", () => {
    expect(exploracionVacia()).toEqual({
      pulsos: { L: "PRESENTE", R: "PRESENTE" },
      sinSensibilidad: [],
      tipoDePie: "NORMAL",
    });
  });

  it("pero NINGÚN punto sin sensibilidad por defecto", () => {
    // Un punto sin sensibilidad es SIEMPRE un hallazgo. Ninguno se da por
    // supuesto: la lista arranca vacía y lo que haya dentro lo puso
    // alguien con el filamento en la mano.
    expect(exploracionVacia().sinSensibilidad).toEqual([]);
  });
});

describe("«la siguiente parte de la última»", () => {
  const ULTIMA: ExploracionEnPantalla = {
    pulsos: { L: "DEBIL", R: "PRESENTE" },
    sinSensibilidad: ["L:h", "L:m1"],
    tipoDePie: "CAVO",
  };

  it("arranca con lo de la última exploración, no en blanco", () => {
    expect(partirDeLaUltima(ULTIMA)).toEqual(ULTIMA);
  });

  it("y es una COPIA: tocar la nueva no toca la historia", () => {
    const nueva = partirDeLaUltima(ULTIMA);
    nueva.pulsos.L = "AUSENTE";
    (nueva.sinSensibilidad as string[]).push("R:talon");
    expect(ULTIMA.pulsos.L).toBe("DEBIL");
    expect(ULTIMA.sinSensibilidad).toEqual(["L:h", "L:m1"]);
  });

  it("NO SUMA, al contrario que «igual que la última vez» del mapa", () => {
    // Una exploración es una foto completa del pie en un día. Sumarle la
    // de hace un año daría una foto que nunca existió: si hoy el pulso
    // izquierdo es presente, es presente — no «presente y débil».
    const r = partirDeLaUltima(ULTIMA);
    expect(Object.keys(r.pulsos)).toEqual(["L", "R"]);
    expect(r.pulsos.L).toBe("DEBIL");
  });

  it("sin ninguna anterior cae al suelo", () => {
    expect(partirDeLaUltima(null)).toEqual(exploracionVacia());
  });
});

describe("normalizarExploracion", () => {
  it("un pulso desconocido cae a PRESENTE y no revienta", () => {
    expect(
      normalizarExploracion({ pulsos: { L: "FORTÍSIMO", R: "AUSENTE" } }),
    ).toEqual({
      pulsos: { L: "PRESENTE", R: "AUSENTE" },
      sinSensibilidad: [],
      tipoDePie: "NORMAL",
    });
  });

  it("los dos pulsos están SIEMPRE, aunque no vengan", () => {
    // Una exploración sin pulsos no es una exploración.
    const r = normalizarExploracion({});
    expect(r.pulsos.L).toBe("PRESENTE");
    expect(r.pulsos.R).toBe("PRESENTE");
  });

  it("una zona que no es del mapa se tira en silencio", () => {
    expect(
      normalizarExploracion({ sinSensibilidad: ["L:h", "L:oreja", 7, null] }),
    ).toMatchObject({ sinSensibilidad: ["L:h"] });
  });

  it("no deja duplicados", () => {
    expect(
      normalizarExploracion({ sinSensibilidad: ["L:h", "L:h", "R:h"] }),
    ).toMatchObject({ sinSensibilidad: ["L:h", "R:h"] });
  });

  it("un tipo de pie inventado cae a NORMAL", () => {
    expect(
      normalizarExploracion({ tipoDePie: "PLANÍSIMO" }),
    ).toMatchObject({ tipoDePie: "NORMAL" });
  });
});

describe("las escalas", () => {
  it("el pulso tiene tres peldaños y el tipo de pie otros tres", () => {
    for (const p of ["PRESENTE", "DEBIL", "AUSENTE"]) {
      expect(esPulso(p)).toBe(true);
    }
    expect(esPulso("REGULAR")).toBe(false);
    for (const t of ["PLANO", "NORMAL", "CAVO"]) {
      expect(esTipoDePie(t)).toBe(true);
    }
    expect(esTipoDePie("ancho")).toBe(false);
  });

  it("cuenta los puntos sin sensibilidad de cada pie", () => {
    expect(sinSensibilidadPorPie(["L:h", "L:m1", "R:talon"])).toEqual({
      L: 2,
      R: 1,
    });
  });

  it("la versión del cuerpo es 1", () => {
    expect(VERSION_DE_LA_EXPLORACION).toBe(1);
  });
});
