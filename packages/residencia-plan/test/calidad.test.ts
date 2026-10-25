// calidad-1 · **LAS REGLAS PURAS DE CALIDAD.**
//
// Las bandas de un riesgo, el ciclo de la no conformidad y la propuesta
// de abrir NC. Lo que se prueba aquí es lo que el servidor y la pantalla
// **tienen que contestar igual**: si no, el botón está encendido y la
// ruta devuelve 409.
//
// Los bordes que importan, uno por uno:
//
//   · nivel 3 es MEDIO y nivel 6 es ALTO — las dos rayas, medidas;
//   · «vencido» es `<` y no `<=`: el día que toca todavía cuenta;
//   · una observación pasa a acciones SIN causa y una NC menor no;
//   · un «no eficaz» devuelve a acciones, no cierra;
//   · **sin dato no es estar fuera de umbral**, y por eso no propone.

import { describe, expect, it } from "vitest";

import {
  CLASE_EN_PALABRAS,
  ESTADO_EN_PALABRAS,
  TRANSICIONES,
  accionVencida,
  bandaDeRiesgo,
  estadoTrasVerificar,
  exigeCausa,
  loQueFaltaPara,
  mesAnterior,
  nivelDeRiesgo,
  proponeNc,
  revisionVencida,
  type NcParaElCiclo,
} from "../src/calidad.js";

// ── Las bandas ───────────────────────────────────────────────────────

describe("la banda de un riesgo", () => {
  it("nivel es probabilidad por impacto, y sólo hay seis posibles", () => {
    // Con los dos de 1 a 3, los niveles que existen son 1, 2, 3, 4, 6 y
    // 9. No hay ningún 5, 7 ni 8, y por eso las rayas se ponen en 3 y en
    // 6 y no «a la mitad».
    const posibles = new Set<number>();
    for (let p = 1; p <= 3; p++) {
      for (let i = 1; i <= 3; i++) posibles.add(nivelDeRiesgo(p, i));
    }
    expect([...posibles].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 6, 9]);
  });

  it("1 y 2 son bajo; 3 y 4, medio; 6 y 9, alto", () => {
    expect(bandaDeRiesgo(1)).toBe("BAJO");
    expect(bandaDeRiesgo(2)).toBe("BAJO");
    // La primera raya: un 3 ya es medio.
    expect(bandaDeRiesgo(3)).toBe("MEDIO");
    expect(bandaDeRiesgo(4)).toBe("MEDIO");
    // Y la segunda: un 6 ya es alto. Los cuatro riesgos de serie que
    // AENOR echa en falta caen tres en 6 y uno en 3.
    expect(bandaDeRiesgo(6)).toBe("ALTO");
    expect(bandaDeRiesgo(9)).toBe("ALTO");
  });
});

describe("la revisión de un riesgo", () => {
  it("el día que toca TODAVÍA no está vencida", () => {
    expect(revisionVencida("2027-03-03", "2027-03-03")).toBe(false);
    expect(revisionVencida("2027-03-03", "2027-03-04")).toBe(true);
    expect(revisionVencida("2027-03-03", "2027-03-02")).toBe(false);
  });

  it("y el cambio de año se compara bien, porque son fechas de pared", () => {
    // Comparar «YYYY-MM-DD» como texto es comparar cronológicamente.
    // Éste es el caso donde un `Date` mal construido se equivoca.
    expect(revisionVencida("2026-12-31", "2027-01-01")).toBe(true);
    expect(revisionVencida("2027-01-01", "2026-12-31")).toBe(false);
  });
});

// ── El ciclo ─────────────────────────────────────────────────────────

/** Una NC menor recién abierta, para ir moviéndola. */
function nc(parcial: Partial<NcParaElCiclo> = {}): NcParaElCiclo {
  return {
    estado: "OPEN",
    clase: "MINOR",
    tieneCausa: false,
    acciones: 0,
    accionesAbiertas: 0,
    verificadaEficaz: false,
    ...parcial,
  };
}

describe("el ciclo de una no conformidad", () => {
  it("una cerrada no va a ningún sitio", () => {
    expect(TRANSICIONES.CLOSED).toEqual([]);
  });

  it("de ABIERTA no se salta a acciones: hay que pasar por la causa", () => {
    expect(loQueFaltaPara(nc(), "ACTIONS")).toMatch(/no se puede pasar/);
  });

  it("y no se analiza la causa sin escribirla", () => {
    expect(loQueFaltaPara(nc(), "CAUSE_ANALYSED")).toBe(
      "Falta analizar la causa.",
    );
    expect(loQueFaltaPara(nc({ tieneCausa: true }), "CAUSE_ANALYSED")).toBeNull();
  });

  it("una NC menor NO pasa a acciones sin causa; una observación SÍ", () => {
    // Es la misma condición que el CHECK de la migración, escrita aquí
    // para que la pantalla lo diga antes de que el motor lo rechace.
    expect(exigeCausa("MAJOR")).toBe(true);
    expect(exigeCausa("MINOR")).toBe(true);
    expect(exigeCausa("OBSERVATION")).toBe(false);
    expect(exigeCausa("IMPROVEMENT")).toBe(false);

    const menorSinCausa = nc({ estado: "CAUSE_ANALYSED", acciones: 1 });
    expect(loQueFaltaPara(menorSinCausa, "ACTIONS")).toMatch(
      /mayor o menor no pasa a acciones sin la causa/,
    );

    const observacion = nc({
      estado: "CAUSE_ANALYSED",
      clase: "OBSERVATION",
      acciones: 1,
    });
    expect(loQueFaltaPara(observacion, "ACTIONS")).toBeNull();
  });

  it("tampoco pasa a acciones si no hay ninguna acción escrita", () => {
    const sinAcciones = nc({ estado: "CAUSE_ANALYSED", tieneCausa: true });
    expect(loQueFaltaPara(sinAcciones, "ACTIONS")).toMatch(
      /al menos una acción, con responsable y plazo/,
    );
  });

  it("las acciones no se dan por cerradas mientras quede una abierta", () => {
    const base = { estado: "ACTIONS" as const, tieneCausa: true };
    expect(loQueFaltaPara(nc({ ...base, acciones: 3, accionesAbiertas: 1 }), "ACTIONS_CLOSED"))
      .toBe("Queda una acción sin cerrar.");
    expect(loQueFaltaPara(nc({ ...base, acciones: 3, accionesAbiertas: 2 }), "ACTIONS_CLOSED"))
      .toBe("Quedan 2 acciones sin cerrar.");
    expect(loQueFaltaPara(nc({ ...base, acciones: 3, accionesAbiertas: 0 }), "ACTIONS_CLOSED"))
      .toBeNull();
  });

  it("**no se cierra sin verificación de eficacia**, y ésa es la pieza del bloque", () => {
    const pendiente = nc({
      estado: "ACTIONS_CLOSED",
      tieneCausa: true,
      acciones: 2,
    });
    expect(loQueFaltaPara(pendiente, "CLOSED")).toMatch(
      /verificación de eficacia con resultado «eficaz»/,
    );
    expect(
      loQueFaltaPara({ ...pendiente, verificadaEficaz: true }, "CLOSED"),
    ).toBeNull();
  });

  it("un «no eficaz» NO cierra: devuelve a acciones", () => {
    expect(estadoTrasVerificar("EFFECTIVE")).toBe("CLOSED");
    expect(estadoTrasVerificar("NOT_EFFECTIVE")).toBe("ACTIONS");
    // Y la vuelta atrás es una transición legal declarada, no un apaño
    // de la ruta.
    expect(TRANSICIONES.ACTIONS_CLOSED).toContain("ACTIONS");
  });

  it("todos los estados y todas las clases tienen su frase", () => {
    // El fallo que esto caza: añadir un estado al enum y que la pantalla
    // pinte `undefined` en el PAC que se le manda a AENOR.
    for (const estado of Object.keys(TRANSICIONES)) {
      expect(ESTADO_EN_PALABRAS[estado as keyof typeof ESTADO_EN_PALABRAS]).toBeTruthy();
    }
    for (const clase of ["MAJOR", "MINOR", "OBSERVATION", "IMPROVEMENT"] as const) {
      expect(CLASE_EN_PALABRAS[clase]).toBeTruthy();
    }
  });
});

describe("una acción vencida", () => {
  it("vence el día DESPUÉS del plazo, y una cerrada no vence", () => {
    expect(accionVencida("2027-01-10", false, "2027-01-10")).toBe(false);
    expect(accionVencida("2027-01-10", false, "2027-01-11")).toBe(true);
    expect(accionVencida("2027-01-10", true, "2027-02-01")).toBe(false);
  });
});

// ── La propuesta (D-74) ──────────────────────────────────────────────

describe("el indicador fuera de umbral PROPONE, no crea", () => {
  const gimnasia = { code: "GIMNASIA", nombre: "Participación en la gimnasia" };

  it("dos meses seguidos fuera → propone, con el mes más reciente de referencia", () => {
    const p = proponeNc(gimnasia, [
      { mes: "2026-08", dentro: false },
      { mes: "2026-09", dentro: false },
    ]);
    expect(p).not.toBeNull();
    expect(p!.meses).toEqual(["2026-08", "2026-09"]);
    // El mes que va a `source_indicator_month` es el último: es el que
    // alguien abrirá para ver de qué habla la NC.
    expect(p!.mesDeReferencia).toBe("2026-09");
  });

  it("un mes dentro rompe la racha, da igual cuál", () => {
    expect(
      proponeNc(gimnasia, [
        { mes: "2026-08", dentro: true },
        { mes: "2026-09", dentro: false },
      ]),
    ).toBeNull();
    expect(
      proponeNc(gimnasia, [
        { mes: "2026-08", dentro: false },
        { mes: "2026-09", dentro: true },
      ]),
    ).toBeNull();
  });

  it("**SIN DATO no es estar fuera**: no propone nada", () => {
    // Es el mismo principio que «sin dato no es cero», llevado a la
    // propuesta. Un centro que dos meses no tuvo gimnasia planificada no
    // incumple nada, y proponerle una no conformidad por eso es la forma
    // más rápida de enseñarle a ignorar las propuestas.
    expect(
      proponeNc(gimnasia, [
        { mes: "2026-08", dentro: null },
        { mes: "2026-09", dentro: false },
      ]),
    ).toBeNull();
    expect(
      proponeNc(gimnasia, [
        { mes: "2026-08", dentro: null },
        { mes: "2026-09", dentro: null },
      ]),
    ).toBeNull();
  });
});

describe("el mes anterior", () => {
  it("cruza el año por enero", () => {
    expect(mesAnterior("2027-01")).toBe("2026-12");
    expect(mesAnterior("2027-03")).toBe("2027-02");
    // Y rellena el cero: «2027-9» no casaría con el CHECK de la columna
    // ni con el `mes` de ningún otro sitio.
    expect(mesAnterior("2027-10")).toBe("2027-09");
  });
});
