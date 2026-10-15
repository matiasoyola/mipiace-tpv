// residencia-2 · la validación de una frecuencia y su frase.
//
// `problemaDeFrecuencia` es el MISMO juicio que el CHECK
// `…_frecuencia_coherente` de la migración, escrito en TypeScript para
// poder contestar un 400 con una frase antes de que Postgres conteste un
// 500 de constraint. Dos implementaciones del mismo contrato se separan si
// no hay un test que las ate, así que esto fija las dos mitades: lo que
// FALTA y lo que SOBRA.
//
// (Que las dos coincidan de verdad contra Postgres lo comprueba el e2e:
// cada fila rechazada aquí se intenta allí con un INSERT.)

import { describe, expect, it } from "vitest";

import { frecuenciaEnPalabras, problemaDeFrecuencia } from "../src/frecuencia.js";
import type { Frecuencia } from "../src/frecuencia.js";

describe("las ocho frecuencias BIEN escritas pasan", () => {
  const buenas: Array<[string, Frecuencia]> = [
    ["cada turno", { kind: "EVERY_SHIFT", shiftCodes: ["M", "T", "N"] }],
    ["una vez al día", { kind: "DAILY", shiftCodes: ["T"] }],
    ["en las comidas", { kind: "MOMENTS", momentCodes: ["DESAYUNO", "COMIDA"] }],
    ["cada 3 h", { kind: "EVERY_N_HOURS", everyNHours: 3 }],
    ["lunes y viernes", { kind: "WEEKDAYS", weekdays: [1, 5], shiftCodes: ["M"] }],
    ["cada 180 días", { kind: "EVERY_N_DAYS", everyNDays: 180, shiftCodes: ["M"] }],
    ["el día 1", { kind: "MONTHLY", monthDay: 1, shiftCodes: ["M"] }],
    ["a demanda", { kind: "ON_DEMAND" }],
  ];
  for (const [nombre, f] of buenas) {
    it(nombre, () => expect(problemaDeFrecuencia(f)).toBeNull());
  }
});

describe("lo que FALTA, dicho en castellano", () => {
  it("«cada turno» sin turnos", () => {
    expect(problemaDeFrecuencia({ kind: "EVERY_SHIFT", shiftCodes: [] })).toBe("Dime en qué turnos.");
  });
  it("«una vez al día» con DOS turnos no es una vez al día", () => {
    expect(problemaDeFrecuencia({ kind: "DAILY", shiftCodes: ["M", "T"] })).toContain("un turno");
  });
  it("«en los momentos» sin momentos", () => {
    expect(problemaDeFrecuencia({ kind: "MOMENTS", momentCodes: [] })).toBe("Dime en qué momentos del día.");
  });
  it("«cada N horas» sin N", () => {
    expect(problemaDeFrecuencia({ kind: "EVERY_N_HOURS" })).toBe("Dime cada cuántas horas.");
  });
  it("«cada N horas» con 0 o con 13 · el porqué del rango va en la frase", () => {
    expect(problemaDeFrecuencia({ kind: "EVERY_N_HOURS", everyNHours: 0 })).toContain("vigilancia continua");
    expect(problemaDeFrecuencia({ kind: "EVERY_N_HOURS", everyNHours: 13 })).toContain("una vez al día");
  });
  it("«días de la semana» sin días, o con un 8", () => {
    expect(problemaDeFrecuencia({ kind: "WEEKDAYS", weekdays: [], shiftCodes: ["M"] })).toContain("qué días");
    expect(problemaDeFrecuencia({ kind: "WEEKDAYS", weekdays: [8], shiftCodes: ["M"] })).toContain("1 (lunes) a 7 (domingo)");
  });
  it("«el día del mes» con el 31 · y la frase dice por qué no", () => {
    // El tope es 28 y no 31: un control mensual con día 31 no tocaría en
    // febrero, abril, junio, septiembre ni noviembre.
    expect(problemaDeFrecuencia({ kind: "MONTHLY", monthDay: 31, shiftCodes: ["M"] })).toContain("no tocaría en febrero");
  });
});

describe("lo que SOBRA · el error de quien cambia de tipo", () => {
  it("«a demanda» con turnos puestos", () => {
    // Es el caso real: alguien tenía «cada turno», cambia a «a demanda» y
    // la pantalla se deja los turnos marcados. La base lo rechazaría con
    // un 500; esto lo dice con una frase.
    expect(problemaDeFrecuencia({ kind: "ON_DEMAND", shiftCodes: ["M"] })).toContain("«turnos»");
  });
  it("«cada 3 h» con turnos · los cambios posturales no cuelgan de un turno", () => {
    expect(problemaDeFrecuencia({ kind: "EVERY_N_HOURS", everyNHours: 3, shiftCodes: ["N"] })).toContain("«turnos»");
  });
  it("«cada turno» con momentos", () => {
    expect(problemaDeFrecuencia({ kind: "EVERY_SHIFT", shiftCodes: ["M"], momentCodes: ["COMIDA"] })).toContain("«momentos»");
  });
  it("«en los momentos» con turnos · el turno lo calcula la función, no se elige", () => {
    expect(problemaDeFrecuencia({ kind: "MOMENTS", momentCodes: ["COMIDA"], shiftCodes: ["M"] })).toContain("«turnos»");
  });
  it("«el día 1» con días de la semana", () => {
    expect(problemaDeFrecuencia({ kind: "MONTHLY", monthDay: 1, shiftCodes: ["M"], weekdays: [1] })).toContain("«días de la semana»");
  });
});

describe("la frase de la pantalla", () => {
  const turno = (c: string) => ({ M: "mañana", T: "tarde", N: "noche" })[c] ?? c;
  const momento = (c: string) => ({ DESAYUNO: "el desayuno", CENA: "la cena" })[c] ?? c;

  it("cada frecuencia tiene la suya", () => {
    expect(frecuenciaEnPalabras({ kind: "EVERY_SHIFT", shiftCodes: ["M", "T", "N"] }, turno)).toBe("Cada turno (mañana, tarde, noche)");
    expect(frecuenciaEnPalabras({ kind: "DAILY", shiftCodes: ["T"] }, turno)).toBe("Una vez al día (tarde)");
    expect(frecuenciaEnPalabras({ kind: "MOMENTS", momentCodes: ["DESAYUNO", "CENA"] }, turno, momento)).toBe("En el desayuno, la cena");
    expect(frecuenciaEnPalabras({ kind: "EVERY_N_HOURS", everyNHours: 3 })).toBe("Cada 3 h, también de noche");
    expect(frecuenciaEnPalabras({ kind: "WEEKDAYS", weekdays: [5, 1, 3], shiftCodes: ["M"] }, turno)).toBe("L·X·V (mañana)");
    expect(frecuenciaEnPalabras({ kind: "EVERY_N_DAYS", everyNDays: 180, shiftCodes: ["M"] }, turno)).toBe("Cada 180 días (mañana)");
    expect(frecuenciaEnPalabras({ kind: "MONTHLY", monthDay: 1, shiftCodes: ["M"] }, turno)).toBe("El día 1 de cada mes (mañana)");
    expect(frecuenciaEnPalabras({ kind: "ON_DEMAND" })).toBe("A demanda (no tiene agenda)");
  });

  it("los días salen ORDENADOS aunque entren desordenados", () => {
    // Los guarda la pantalla en el orden en que se pulsan las casillas, y
    // «V·L·X» en el parte de relevo se lee dos veces.
    expect(frecuenciaEnPalabras({ kind: "WEEKDAYS", weekdays: [7, 2], shiftCodes: ["N"] }, turno)).toBe("M·D (noche)");
  });

  it("«cada 1 día» se dice «todos los días», que es como se habla", () => {
    expect(frecuenciaEnPalabras({ kind: "EVERY_N_DAYS", everyNDays: 1, shiftCodes: ["M"] }, turno)).toBe("Todos los días (mañana)");
  });
});
