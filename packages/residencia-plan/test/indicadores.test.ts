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

  // ── calidad-1 · lo que necesitan los siete nuevos ────────────────
  //
  // De los registros de atención directa tocaban 1.000 ocurrencias y se
  // hicieron 980. Cinco caídas. Ocho incidencias de residente cerradas,
  // seis con la familia comunicada antes de cerrar. Cuatro quejas: dos
  // respondidas en 3 y 15 días, una en 20 y una sin responder. 48 camas
  // × 31 días = 1.488 camas-día, de las que 1.395 ocupadas. Y de
  // personal: una baja sobre una plantilla de 20.
  cumplimentacion: { tocan: 1000, hechas: 980 },
  caidas: 5,
  incidenciasDeResidenteCerradas: 8,
  conFamiliaComunicadaAntesDeCerrar: 6,
  quejas: [
    { dias: 3 },
    // **15 días exactos está DENTRO**: el criterio es «en plazo», y el
    // día del plazo todavía cuenta. Es el borde donde un `<` por
    // descuido cambia el indicador que el centro enseña al inspector.
    { dias: 15 },
    { dias: 20 },
    // Sin responder: cuenta fuera de plazo, igual que una avería abierta.
    { dias: null },
  ],
  ocupacion: { camasDia: 1488, ocupadasDia: 1395 },
  personal: { bajas: 1, plantilla: 20 },
};

/** Los valores de los seis, por código. */
function valores(datos: DatosDelMes = OCTUBRE, umbrales = [] as never[]) {
  const r = calcularIndicadores(datos, umbrales);
  return new Map(r.map((v) => [v.code, v]));
}

describe("los seis indicadores de octubre, calculados a mano", () => {
  it("los seis de residencia-5 siguen los PRIMEROS y en el orden del bloque C §2", () => {
    // **NO REGRESIÓN** (lo pide el prompt de calidad-1): los seis de
    // residencia-5 siguen estando, en su orden, y las aserciones de este
    // bloque son las mismas de entonces, número por número. Los siete de
    // calidad-1 van DETRÁS: añadir uno delante habría cambiado el orden
    // en que la dirección los lee cada mes sin que nadie lo pidiera.
    expect(INDICADORES.map((i) => i.code).slice(0, 6)).toEqual([
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
    cumplimentacion: undefined,
    caidas: 0,
    incidenciasDeResidenteCerradas: 0,
    conFamiliaComunicadaAntesDeCerrar: 0,
    quejas: [],
    ocupacion: { camasDia: 0, ocupadasDia: 0 },
    personal: { bajas: 0, plantilla: 0 },
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
  it("son trece y cada uno dice qué le falta", () => {
    // Un indicador que falta y no se nombra es un indicador que alguien
    // da por calculado. De aquí sale la lista del done.
    //
    // calidad-1 los deja en TRECE y no en once: la rotación se va de
    // aquí (ya se calcula), pero la fila «rotación, absentismo y
    // formación» se parte en dos —absentismo y formación tienen bloques
    // distintos detrás— y entran la representatividad de las encuestas
    // (obs. 05 de AENOR), que hasta ahora no se nombraba.
    expect(INDICADORES_SIN_DATO).toHaveLength(13);
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

// ════════════════════════════════════════════════════════════════════
//  calidad-1 (D-72) · LOS SIETE NUEVOS, TAMBIÉN A MANO
// ════════════════════════════════════════════════════════════════════

describe("calidad-1 · los siete indicadores que añade el bloque", () => {
  it("van los últimos, y cada uno trae su proceso de referencia", () => {
    expect(INDICADORES.map((i) => i.code).slice(6)).toEqual([
      "CUMPLIMENTACION_REGISTROS",
      "CAIDAS",
      "FAMILIA_COMUNICADA",
      "QUEJAS",
      "QUEJAS_EN_PLAZO",
      "OCUPACION_MEDIA",
      "ROTACION_PERSONAL",
    ]);
    // **Todos**, los trece: un indicador sin proceso es el agujero que la
    // NC 01 de AENOR señala, y aquí es donde se nota si alguien añade el
    // catorce sin ponérselo.
    for (const i of INDICADORES) {
      expect(i.procesoDeReferencia, i.code).toMatch(/^[A-Z_]+$/);
    }
  });

  it("cumplimentación de registros: 980 de 1.000 = 98 %, umbral 98 → dentro, justo", () => {
    // Es R9 de la inspección. 98 exacto contra un umbral de 98 al MÍNIMO
    // está dentro: el borde es `>=`, y si fuera `>` un centro que cumple
    // exactamente su objetivo saldría en rojo.
    const v = valores().get("CUMPLIMENTACION_REGISTROS")!;
    expect(v.valor).toBe(98);
    expect(v.umbral).toBe(98);
    expect(v.comparacion).toBe("AT_LEAST");
    expect(v.dentro).toBe(true);
  });

  it("caídas: 5 al mes, umbral 4 al MÁXIMO → FUERA", () => {
    const v = valores().get("CAIDAS")!;
    expect(v.valor).toBe(5);
    expect(v.dentro).toBe(false);
  });

  it("familia comunicada: 6 de 8 = 75 %, umbral 90 → FUERA", () => {
    const v = valores().get("FAMILIA_COMUNICADA")!;
    expect(v.valor).toBe(75);
    expect(v.umbral).toBe(90);
    expect(v.dentro).toBe(false);
  });

  it("quejas: 4 al mes, umbral 2 al MÁXIMO → FUERA", () => {
    const v = valores().get("QUEJAS")!;
    expect(v.valor).toBe(4);
    expect(v.dentro).toBe(false);
  });

  it("quejas en plazo: 2 de 4 = 50 %, y los 15 días exactos CUENTAN", () => {
    // Las dos en plazo son la de 3 días y **la de 15 exactos**. Fuera: la
    // de 20 y la que sigue sin responder — por lo mismo que una avería
    // sin cerrar, si no, no responder ninguna daría el mejor resultado.
    const v = valores().get("QUEJAS_EN_PLAZO")!;
    expect(v.valor).toBe(50);
    expect(v.umbral).toBe(100);
    expect(v.dentro).toBe(false);
  });

  it("ocupación media: 1.395 de 1.488 camas-día = 93,8 %, umbral 90 → dentro", () => {
    // 1395 / 1488 = 0,93750 → 93,8 % con un decimal.
    const v = valores().get("OCUPACION_MEDIA")!;
    expect(v.valor).toBe(93.8);
    expect(v.dentro).toBe(true);
  });

  it("rotación: 1 baja de 20 = 5 %, umbral 2 al MÁXIMO → FUERA", () => {
    // Observación 04 de AENOR. Sale de `employees`, sin inventar nada.
    const v = valores().get("ROTACION_PERSONAL")!;
    expect(v.valor).toBe(5);
    expect(v.comparacion).toBe("AT_MOST");
    expect(v.dentro).toBe(false);
  });
});

describe("calidad-1 · los nuevos también distinguen «sin dato» de cero", () => {
  const vacio: DatosDelMes = {
    mes: "2026-10",
    residentes: 0,
    cumplimiento: {},
    residentesConVisitaMedica: 0,
    actividadesSocioculturales: 0,
    episodiosSinDeposicion: 0,
    averias: [],
    cumplimentacion: undefined,
    caidas: 0,
    incidenciasDeResidenteCerradas: 0,
    conFamiliaComunicadaAntesDeCerrar: 0,
    quejas: [],
    ocupacion: { camasDia: 0, ocupadasDia: 0 },
    personal: { bajas: 0, plantilla: 0 },
  };

  it("un centro sin plan de cuidados no cumplimenta el 0 % de sus registros", () => {
    const v = calcularIndicadores(vacio, []).find(
      (x) => x.code === "CUMPLIMENTACION_REGISTROS",
    )!;
    expect(v.valor).toBeNull();
    expect(v.dentro).toBeNull();
  });

  it("un mes sin quejas no da 0 % de respuestas en plazo", () => {
    // Y es el que más importa de los siete: «cero quejas» es un mes
    // bueno, y pintarlo como «0 % respondidas en plazo» en rojo sería
    // castigar al centro por no tener quejas.
    const v = calcularIndicadores(vacio, []).find(
      (x) => x.code === "QUEJAS_EN_PLAZO",
    )!;
    expect(v.valor).toBeNull();
    expect(v.dentro).toBeNull();
  });

  it("un centro sin camas no tiene 0 % de ocupación", () => {
    const v = calcularIndicadores(vacio, []).find(
      (x) => x.code === "OCUPACION_MEDIA",
    )!;
    expect(v.valor).toBeNull();
  });

  it("un centro sin plantilla no tiene 0 % de rotación", () => {
    const v = calcularIndicadores(vacio, []).find(
      (x) => x.code === "ROTACION_PERSONAL",
    )!;
    expect(v.valor).toBeNull();
  });

  it("pero cero caídas y cero quejas SÍ son ceros", () => {
    const r = calcularIndicadores(vacio, []);
    expect(r.find((x) => x.code === "CAIDAS")!.valor).toBe(0);
    expect(r.find((x) => x.code === "QUEJAS")!.valor).toBe(0);
  });
});

describe("calidad-1 · los que NO se pintan se siguen nombrando", () => {
  it("la rotación sale de la lista de los que faltan: ya se calcula", () => {
    const nombres = INDICADORES_SIN_DATO.map((i) => i.nombre);
    expect(nombres).not.toContain("Rotación, absentismo y formación en plazo");
    // Pero el absentismo y la formación siguen, cada uno con lo suyo: la
    // fila de los tres juntos hacía parecer que «falta RRHH» era una
    // sola deuda, y son tres con tres bloques distintos detrás.
    expect(nombres).toContain("Absentismo");
    expect(nombres).toContain("Formación obligatoria en plazo");
  });

  it("y ninguno de los que se nombran está también calculado", () => {
    // El fallo que esto caza: añadir el cálculo de uno y olvidarse de
    // quitarlo de la lista, y entonces la pantalla lo pinta arriba con
    // su número y abajo dice que falta.
    const calculados = new Set(INDICADORES.map((i) => i.nombre.toLowerCase()));
    for (const s of INDICADORES_SIN_DATO) {
      expect(calculados.has(s.nombre.toLowerCase()), s.nombre).toBe(false);
    }
  });
});
