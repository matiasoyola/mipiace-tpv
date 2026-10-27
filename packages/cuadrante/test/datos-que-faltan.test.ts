// personal-1 (decisión 2) · QUÉ LE FALTA A UNA FICHA DE PERSONAL.
//
// Mismo guion que `residencia-datos-que-faltan` de alta-minima: ficha
// vacía, ficha completa, la regla que depende de otro dato, y el cifrado
// que se cuenta **sin descifrarse**.

import { describe, expect, it } from "vitest";

import {
  DIAS_DE_AVISO_DE_FIN,
  datosQueFaltanDePersonal,
  diasHastaElFin,
  elContratoSeAcaba,
  estadoDeLaFichaDePersonal,
  resumenDeFichasDePersonal,
  type FichaDePersonalParaCompletar,
} from "../src/index.js";

const VACIA: FichaDePersonalParaCompletar = {
  lastName: null,
  tieneDni: false,
  tieneAfiliacion: false,
  categoryId: null,
  weeklyMinutes: null,
  hiredOn: null,
  contractKind: null,
  contractEndsOn: null,
  phone: null,
  email: null,
};

const COMPLETA: FichaDePersonalParaCompletar = {
  lastName: "Soler Ruiz",
  tieneDni: true,
  tieneAfiliacion: true,
  categoryId: "cat-aux",
  weeklyMinutes: 2250,
  hiredOn: "2026-06-01",
  contractKind: "INDEFINIDO",
  contractEndsOn: null,
  phone: "600111222",
  email: "ana@ejemplo.es",
};

function campos(f: FichaDePersonalParaCompletar): string[] {
  return datosQueFaltanDePersonal(f).map((d) => d.campo);
}

describe("una ficha que acaba de nacer con sólo el nombre", () => {
  it("le faltan nueve datos, y los seis imprescindibles van primero", () => {
    const faltan = datosQueFaltanDePersonal(VACIA);
    expect(faltan).toHaveLength(9);
    expect(faltan.slice(0, 6).map((d) => d.campo)).toEqual([
      "apellidos",
      "dni",
      "afiliacion",
      "categoria",
      "jornadaSemanal",
      "fechaDeAlta",
    ]);
    expect(faltan.slice(0, 6).every((d) => d.peso === "IMPRESCINDIBLE")).toBe(true);
    expect(faltan.slice(6).map((d) => d.campo)).toEqual([
      "tipoDeContrato",
      "telefono",
      "email",
    ]);
  });

  it("y las etiquetas se leen en una frase", () => {
    // «A esta ficha le faltan: apellidos, DNI o NIE, nº de afiliación…»
    const frase = datosQueFaltanDePersonal(VACIA)
      .map((d) => d.etiqueta)
      .join(", ");
    expect(frase).toBe(
      "apellidos, DNI o NIE, nº de afiliación a la Seguridad Social, " +
        "categoría profesional, jornada contratada, fecha de alta, " +
        "tipo de contrato, teléfono, email",
    );
  });

  it("el estado dice que está incompleta y que hay imprescindibles", () => {
    const e = estadoDeLaFichaDePersonal(VACIA);
    expect(e.incompleta).toBe(true);
    expect(e.conImprescindibles).toBe(true);
  });
});

describe("una ficha completa", () => {
  it("no le falta nada, y entonces no se pinta ningún aviso", () => {
    expect(datosQueFaltanDePersonal(COMPLETA)).toEqual([]);
    const e = estadoDeLaFichaDePersonal(COMPLETA);
    expect(e.incompleta).toBe(false);
    expect(e.conImprescindibles).toBe(false);
  });

  it("un apellido en blanco no cuenta como apellido", () => {
    // «Lo que no se sabe va NULL, no en blanco» — y un espacio tampoco.
    expect(campos({ ...COMPLETA, lastName: "   " })).toEqual(["apellidos"]);
  });
});

describe("la regla que depende de otro dato: el fin de un temporal", () => {
  it("en un TEMPORAL sin fecha de fin, es IMPRESCINDIBLE", () => {
    const f = { ...COMPLETA, contractKind: "TEMPORAL", contractEndsOn: null };
    const faltan = datosQueFaltanDePersonal(f);
    expect(faltan).toHaveLength(1);
    expect(faltan[0]).toEqual({
      campo: "finPrevisto",
      etiqueta: "fecha de fin prevista",
      peso: "IMPRESCINDIBLE",
    });
  });

  it("en un INDEFINIDO no se pide: la base no deja ni ponerla", () => {
    expect(campos({ ...COMPLETA, contractKind: "INDEFINIDO" })).toEqual([]);
  });

  it("y sin tipo de contrato TAMPOCO se pide: no se sabe", () => {
    // El día que la dirección ponga «temporal», el fin previsto aparece
    // solo en la lista. Misma forma que el grado con la plaza concertada.
    expect(campos({ ...COMPLETA, contractKind: null })).toEqual([
      "tipoDeContrato",
    ]);
  });

  it("con fecha de fin puesta, nada que pedir", () => {
    expect(
      campos({
        ...COMPLETA,
        contractKind: "TEMPORAL",
        contractEndsOn: "2026-12-31",
      }),
    ).toEqual([]);
  });
});

describe("los dos cifrados se cuentan SIN descifrarlos", () => {
  it("lo que llega es presencia, no valor", () => {
    // Esta función no toca una clave en su vida, y por eso puede correr
    // también en el navegador.
    expect(campos({ ...COMPLETA, tieneDni: false })).toEqual(["dni"]);
    expect(campos({ ...COMPLETA, tieneAfiliacion: false })).toEqual(["afiliacion"]);
  });
});

describe("el resumen de la plantilla", () => {
  it("cuenta fichas, datos pendientes y cuántas tienen imprescindibles", () => {
    const r = resumenDeFichasDePersonal([
      datosQueFaltanDePersonal(VACIA),
      datosQueFaltanDePersonal(COMPLETA),
      datosQueFaltanDePersonal({ ...COMPLETA, phone: null }),
    ]);
    expect(r).toEqual({
      total: 3,
      incompletas: 2,
      datosPendientes: 10,
      conImprescindibles: 1,
    });
  });

  it("una plantilla entera completa no deja nada pendiente", () => {
    const r = resumenDeFichasDePersonal([
      datosQueFaltanDePersonal(COMPLETA),
      datosQueFaltanDePersonal(COMPLETA),
    ]);
    expect(r).toEqual({
      total: 2,
      incompletas: 0,
      datosPendientes: 0,
      conImprescindibles: 0,
    });
  });
});

describe("al temporal se le acaba el contrato", () => {
  it("se avisa desde quince días antes", () => {
    expect(DIAS_DE_AVISO_DE_FIN).toBe(15);
    const f = { contractKind: "TEMPORAL", contractEndsOn: "2026-11-15" };
    // Dieciséis días antes, todavía no.
    expect(elContratoSeAcaba(f, "2026-10-30")).toBe(false);
    // Quince clavados, sí.
    expect(elContratoSeAcaba(f, "2026-10-31")).toBe(true);
    expect(elContratoSeAcaba(f, "2026-11-14")).toBe(true);
  });

  it("y el aviso NO se apaga cuando la fecha pasa: se vuelve más urgente", () => {
    // Un contrato que venció hace tres días y cuya persona sigue en el
    // cuadrante es lo que nadie quiere descubrir en una inspección.
    const f = { contractKind: "TEMPORAL", contractEndsOn: "2026-11-15" };
    expect(elContratoSeAcaba(f, "2026-11-18")).toBe(true);
    expect(diasHastaElFin("2026-11-15", "2026-11-18")).toBe(-3);
  });

  it("un indefinido nunca avisa, aunque alguien le colara una fecha", () => {
    expect(
      elContratoSeAcaba(
        { contractKind: "INDEFINIDO", contractEndsOn: "2026-11-15" },
        "2026-11-14",
      ),
    ).toBe(false);
  });

  it("y sin fecha no hay nada que contar", () => {
    expect(diasHastaElFin(null, "2026-11-14")).toBeNull();
    expect(
      elContratoSeAcaba({ contractKind: "TEMPORAL", contractEndsOn: null }, "2026-11-14"),
    ).toBe(false);
  });

  it("los días son de CALENDARIO, también en la semana del cambio de hora", () => {
    // Restar milisegundos daría 14,96 días y `Math.round` lo taparía; un
    // `Math.floor` lo habría convertido en catorce. Aquí no se restan
    // instantes.
    expect(diasHastaElFin("2026-10-26", "2026-10-24")).toBe(2);
    expect(diasHastaElFin("2026-03-30", "2026-03-28")).toBe(2);
  });
});
