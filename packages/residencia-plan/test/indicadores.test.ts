// residencia-5 · **LOS SEIS INDICADORES, CONTRA UN MES CALCULADO A MANO.**
//
// El prompt lo pide así: «tests de indicadores contra un mes sembrado con
// el resultado calculado a mano». Aquí está el mes, y los números de las
// aserciones están calculados a mano en el comentario de cada uno — que
// es lo que hace que el test pueda estar en desacuerdo con la función.
//
// Y los casos que importan tanto como el camino feliz:
//
//   · denominador cero → **sin dato**, que no es cero;
//   · el umbral del centro gana al de serie, y el panel lo dice;
//   · una avería sin cerrar cuenta como fuera de plazo.

import { describe, expect, it } from "vitest";

import {
  INDICADORES,
  INDICADORES_SIN_DATO,
  calcularIndicadores,
} from "../src/indicadores.js";
import type { DatosDelMes } from "../src/indicadores.js";

/**
 * **EL MES DE OCTUBRE DE 2026 EN JARDÍN DE GREDOS**, con números
 * redondos para que la cuenta se pueda hacer de cabeza.
 *
 * 40 residentes. 30 vistos por el médico. De la gimnasia tocaban 200
 * sesiones y se hicieron 150. De la estimulación cognitiva tocaban 100 y
 * se hicieron 50. Tres actividades socioculturales. Dos episodios de más
 * de tres días sin deposición. Diez averías, de las que **tres** pasaron
 * de 24 h: la de 25 h, la de 48 h y una que sigue abierta.
 */
const OCTUBRE: DatosDelMes = {
  mes: "2026-10",
  residentes: 40,
  cumplimiento: {
    GIMNASIA: { tocan: 200, hechas: 150 },
    ESTIMULACION_COGNITIVA: { tocan: 100, hechas: 50 },
  },
  residentesConVisitaMedica: 30,
  actividadesSocioculturales: 3,
  episodiosSinDeposicion: 2,
  averias: [
    { horas: 2 },
    { horas: 4 },
    { horas: 6 },
    { horas: 8 },
    { horas: 10 },
    { horas: 23.9 },
    { horas: 24 },
    { horas: 25 },
    { horas: 48 },
    // Sigue abierta: cuenta como fuera de plazo.
    { horas: null },
  ],
};

/** Los valores de los seis, por código. */
function valores(datos: DatosDelMes = OCTUBRE, umbrales = [] as never[]) {
  const r = calcularIndicadores(datos, umbrales);
  return new Map(r.map((v) => [v.code, v]));
}

describe("los seis indicadores de octubre, calculados a mano", () => {
  it("son seis y están en el orden del bloque C §2", () => {
    expect(INDICADORES.map((i) => i.code)).toEqual([
      "SIN_DEPOSICION",
      "VISITA_MEDICA",
      "GIMNASIA",
      "ESTIMULACION_COGNITIVA",
      "ACTIVIDADES_SOCIOCULTURALES",
      "AVERIAS_24H",
    ]);
  });

  it("sin deposición: 2 episodios, umbral 3 al MÁXIMO → dentro", () => {
    const v = valores().get("SIN_DEPOSICION")!;
    expect(v.valor).toBe(2);
    expect(v.umbral).toBe(3);
    expect(v.comparacion).toBe("AT_MOST");
    expect(v.dentro).toBe(true);
  });

  it("visita médica: 30 de 40 = 75 %, umbral 100 → FUERA", () => {
    const v = valores().get("VISITA_MEDICA")!;
    expect(v.valor).toBe(75);
    expect(v.umbral).toBe(100);
    expect(v.dentro).toBe(false);
  });

  it("gimnasia: 150 de 200 = 75 %, umbral 73,5 → dentro, por poco", () => {
    const v = valores().get("GIMNASIA")!;
    expect(v.valor).toBe(75);
    expect(v.umbral).toBe(73.5);
    expect(v.dentro).toBe(true);
  });

  it("estimulación cognitiva: 50 de 100 = 50 %, umbral 58,5 → FUERA", () => {
    const v = valores().get("ESTIMULACION_COGNITIVA")!;
    expect(v.valor).toBe(50);
    expect(v.umbral).toBe(58.5);
    expect(v.dentro).toBe(false);
  });

  it("actividades socioculturales: 3, umbral 2 al MÍNIMO → dentro", () => {
    const v = valores().get("ACTIVIDADES_SOCIOCULTURALES")!;
    expect(v.valor).toBe(3);
    expect(v.comparacion).toBe("AT_LEAST");
    expect(v.dentro).toBe(true);
  });

  it("averías: 3 de 10 pasan de 24 h = 30 %, umbral 10 → FUERA", () => {
    // Las tres, a mano: la de 25 h, la de 48 h y la que sigue abierta.
    // **24 h exactas está DENTRO** —el criterio es «más de 24 h», no «24
    // o más»— y por eso la fila de `23,9` y la de `24` están ahí: son el
    // borde, y es donde un `>=` por descuido cambiaría el indicador que
    // el centro declara a AENOR.
    const v = valores().get("AVERIAS_24H")!;
    expect(v.valor).toBe(30);
    expect(v.umbral).toBe(10);
    expect(v.dentro).toBe(false);
  });
});

// ── El borde que convierte un panel en ruido ─────────────────────────

describe("sin dato NO es cero", () => {
  const vacio: DatosDelMes = {
    mes: "2026-10",
    residentes: 0,
    cumplimiento: {},
    residentesConVisitaMedica: 0,
    actividadesSocioculturales: 0,
    episodiosSinDeposicion: 0,
    averias: [],
  };

  it("un centro sin residentes no incumple la visita médica: no hay dato", () => {
    const v = valores(vacio).get("VISITA_MEDICA")!;
    expect(v.valor).toBeNull();
    // Y sin valor **no se juzga**: pintar 0 % en rojo sería decirle a la
    // dirección que algo va mal cuando lo que pasa es que no hay dato.
    expect(v.dentro).toBeNull();
  });

  it("un mes sin gimnasia planificada no da 0 % de participación", () => {
    const v = valores(vacio).get("GIMNASIA")!;
    expect(v.valor).toBeNull();
    expect(v.dentro).toBeNull();
  });

  it("un mes sin averías no da 0 % fuera de plazo", () => {
    const v = valores(vacio).get("AVERIAS_24H")!;
    expect(v.valor).toBeNull();
  });

  it("pero un RECUENTO de cero SÍ es un cero", () => {
    // «Cero episodios de estreñimiento» es un resultado, y bueno. La
    // diferencia con los porcentajes es que aquí no hay denominador.
    const v = valores(vacio).get("SIN_DEPOSICION")!;
    expect(v.valor).toBe(0);
    expect(v.dentro).toBe(true);
  });
});

// ── La frontera estándar / centro, medida ────────────────────────────

describe("el umbral es del centro, la fórmula del producto", () => {
  it("sin fila del centro, el umbral es el de serie y se dice", () => {
    const v = valores().get("GIMNASIA")!;
    expect(v.umbral).toBe(73.5);
    expect(v.umbralDelCentro).toBe(false);
  });

  it("con fila del centro, gana la del centro", () => {
    const r = calcularIndicadores(OCTUBRE, [
      { code: "GIMNASIA", target: 80, comparison: "AT_LEAST" },
    ]);
    const v = r.find((x) => x.code === "GIMNASIA")!;
    expect(v.umbral).toBe(80);
    expect(v.umbralDelCentro).toBe(true);
    // 75 % contra un objetivo de 80 %: fuera. Con el de serie estaba
    // dentro, y es el punto entero de que el umbral sea del centro.
    expect(v.dentro).toBe(false);
  });

  it("el centro puede cambiar el LADO, no la fórmula", () => {
    // Un centro que mida «averías resueltas en plazo» en vez de «fuera de
    // plazo» cambia la comparación. El 30 % sigue saliendo de contar lo
    // mismo.
    const r = calcularIndicadores(OCTUBRE, [
      { code: "AVERIAS_24H", target: 50, comparison: "AT_MOST" },
    ]);
    const v = r.find((x) => x.code === "AVERIAS_24H")!;
    expect(v.valor).toBe(30);
    expect(v.dentro).toBe(true);
  });

  it("un umbral de otro indicador no se aplica al nuestro", () => {
    const r = calcularIndicadores(OCTUBRE, [
      { code: "GIMNASIA", target: 80, comparison: "AT_LEAST" },
    ]);
    expect(r.find((x) => x.code === "ESTIMULACION_COGNITIVA")!.umbral).toBe(58.5);
  });
});

// ── Y los que NO se pintan ───────────────────────────────────────────

describe("los que todavía no tienen dato se NOMBRAN", () => {
  it("son once y cada uno dice qué le falta", () => {
    // Un indicador que falta y no se nombra es un indicador que alguien
    // da por calculado. De aquí sale la lista del done.
    expect(INDICADORES_SIN_DATO).toHaveLength(11);
    for (const i of INDICADORES_SIN_DATO) {
      expect(i.nombre.length).toBeGreaterThan(0);
      expect(i.falta.length).toBeGreaterThan(0);
    }
  });

  it("ninguno de ellos está entre los seis que sí se calculan", () => {
    const nombres = new Set(INDICADORES.map((i) => i.nombre));
    for (const i of INDICADORES_SIN_DATO) expect(nombres.has(i.nombre)).toBe(false);
  });
});

// ── Y la redondeo, que se ve en pantalla ─────────────────────────────

describe("los porcentajes se redondean a un decimal", () => {
  it("1 de 3 es 33,3 % y no 33,333333", () => {
    const datos: DatosDelMes = { ...OCTUBRE, cumplimiento: { GIMNASIA: { tocan: 3, hechas: 1 } } };
    expect(valores(datos).get("GIMNASIA")!.valor).toBe(33.3);
  });

  it("2 de 3 es 66,7 %", () => {
    const datos: DatosDelMes = { ...OCTUBRE, cumplimiento: { GIMNASIA: { tocan: 3, hechas: 2 } } };
    expect(valores(datos).get("GIMNASIA")!.valor).toBe(66.7);
  });
});
