// residencia-4 (D-65) · **EL TEST DE ORO DE LA GRAVEDAD.**
//
// La tabla del §3 de `docs/residencia/00-decisiones.md`, fila por fila y
// borde por borde, contra el fichero de datos del producto
// (`plantilla-de-gravedad.ts`) y la función pura del paquete
// (`gravedadDe`).
//
// ── POR QUÉ ESTE TEST PRUEBA LAS DOS EJECUCIONES ────────────────────
//
// El prompt pide que «la tablet y el servidor den el mismo nivel». Lo que
// hace que den el mismo no es que se comparen aquí: es que **son la misma
// función con los mismos datos**. La tablet se lleva las reglas en el
// paquete de arranque y ejecuta `gravedadDe`; el servidor las lee de
// `severity_rules` y ejecuta `gravedadDe`.
//
// Así que lo que queda por probar son dos cosas distintas, y están en dos
// sitios:
//
//   · **aquí**, que el FICHERO DE DATOS dice lo que el §3 dice. Es lo que
//     se puede romper con un dedo: un 38 que se escribe 3.8, un `GTE` que
//     se escribe `GT`, una fila que falta.
//   · **en el e2e** (`residencia-4.e2e.ts`, «la tablet y el servidor»),
//     que las reglas que viajan en `/residencia/puerta/arranque` son las
//     mismas que el servidor usa al derivar. Esa es la pieza que sí
//     podría divergir: el mapeo de filas de Postgres a reglas.
//
// ── LOS BORDES SON LA MITAD DEL TEST ────────────────────────────────
//
// 37,4 / 37,5 · 37,9 / 38 · 39,4 / 39,5 · 92 / 91 · 88 / 87 · 70 / 69 ·
// 50 / 49 · 300 / 301 · 90 / 91 · 179 / 180. Los pide el prompt y se
// escriben uno a uno porque un `>=` que se vuelve `>` pasa todos los
// casos redondos y falla exactamente en el borde — que es el valor que
// una auxiliar teclea a las tres de la mañana.

import { describe, expect, it } from "vitest";

import {
  gravedadDe,
  gravedadDeEvento,
  type ExcepcionDeUmbral,
  type Nivel,
  type ReglaDeGravedad,
} from "@mipiacetpv/residencia-plan";

import {
  MATICES,
  NOMBRE_DEL_TIPO,
  PLANTILLA_DE_GRAVEDAD,
  TIPOS_DE_INCIDENCIA,
  VERSION_DE_LA_PLANTILLA,
  problemasDeLaPlantilla,
} from "../src/residencia/catalogo/plantilla-de-gravedad.js";

/** La plantilla del producto, tal cual, como la ve la función pura. */
const REGLAS: ReglaDeGravedad[] = PLANTILLA_DE_GRAVEDAD.map((r) =>
  r.kind === "THRESHOLD"
    ? {
        kind: "THRESHOLD" as const,
        controlCode: r.controlCode,
        comparador: r.comparador,
        valor: r.valor,
        nivel: r.nivel,
        tipo: r.tipo,
      }
    : {
        kind: "EVENT" as const,
        evento: r.evento,
        matiz: r.matiz,
        nivel: r.nivel,
        tipo: r.tipo,
      },
);

function nivelDe(control: string, n: number): Nivel | null {
  return gravedadDe(control, n, REGLAS)?.nivel ?? null;
}

describe("el fichero de datos está sano", () => {
  it("no tiene problemas", () => {
    expect(problemasDeLaPlantilla()).toEqual([]);
  });

  it("empieza en la versión 1", () => {
    expect(VERSION_DE_LA_PLANTILLA).toBe(1);
  });

  it("todos los tipos que abre tienen nombre para la pantalla", () => {
    for (const r of PLANTILLA_DE_GRAVEDAD) {
      expect(NOMBRE_DEL_TIPO[r.tipo], `falta el nombre de ${r.tipo}`).toBeTruthy();
    }
  });
});

// ════════════════════════════════════════════════════════════════════
//  LA TABLA DEL §3 · la mitad de las CONSTANTES
// ════════════════════════════════════════════════════════════════════

describe("§3 · Temperatura", () => {
  // «≥ 37,5 y < 38 → N1 · ≥ 38 → N2 · ≥ 39,5 → N3»
  const casos: Array<[number, Nivel | null]> = [
    [35.0, null],
    [36.8, null],
    [37.4, null], // borde de abajo: NO gradúa
    [37.5, "N1"], // …y aquí sí
    [37.9, "N1"],
    [38.0, "N2"], // el salto a N2 es EN 38, no a partir de 38,1
    [38.4, "N2"], // el caso del prompt: «la auxiliar teclea 38,4»
    [39.4, "N2"],
    [39.5, "N3"],
    [41.0, "N3"],
  ];
  it.each(casos)("%s °C → %s", (n, esperado) => {
    expect(nivelDe("TEMPERATURA", n)).toBe(esperado);
  });

  it("y abre una incidencia de tipo FIEBRE", () => {
    expect(gravedadDe("TEMPERATURA", 38.4, REGLAS)?.tipo).toBe(
      TIPOS_DE_INCIDENCIA.FIEBRE,
    );
  });
});

describe("§3 · Saturación de oxígeno", () => {
  // «< 92 % → N2 · < 88 % → N3»
  const casos: Array<[number, Nivel | null]> = [
    [99, null],
    [93, null],
    [92, null], // «< 92» deja 92 fuera
    [91, "N2"],
    [89, "N2"],
    [88, "N2"], // «< 88» deja 88 en N2
    [87, "N3"],
    [80, "N3"],
  ];
  it.each(casos)("%s %% → %s", (n, esperado) => {
    expect(nivelDe("SATURACION_O2", n)).toBe(esperado);
  });

  it("y abre una incidencia de tipo HIPOXIA", () => {
    expect(gravedadDe("SATURACION_O2", 87, REGLAS)?.tipo).toBe(
      TIPOS_DE_INCIDENCIA.HIPOXIA,
    );
  });
});

describe("§3 · Tensión sistólica", () => {
  // «≥ 180 o ≤ 90 → N2». Los dos extremos, y el medio sin graduar.
  const casos: Array<[number, Nivel | null]> = [
    [80, "N2"],
    [90, "N2"], // «≤ 90» incluye el 90
    [91, null],
    [120, null],
    [179, null],
    [180, "N2"], // «≥ 180» incluye el 180
    [200, "N2"],
  ];
  it.each(casos)("%s mmHg → %s", (n, esperado) => {
    expect(nivelDe("TA_SISTOLICA", n)).toBe(esperado);
  });
});

describe("§3 · Glucemia", () => {
  // «< 70 o > 300 → N2 · < 50 → N3»
  const casos: Array<[number, Nivel | null]> = [
    [110, null],
    [70, null], // «< 70» deja 70 fuera
    [69, "N2"],
    [51, "N2"],
    [50, "N2"], // «< 50» deja 50 en N2
    [49, "N3"],
    [30, "N3"],
    [300, null], // «> 300» deja 300 fuera
    [301, "N2"],
    [450, "N2"],
  ];
  it.each(casos)("%s mg/dl → %s", (n, esperado) => {
    expect(nivelDe("GLUCEMIA", n)).toBe(esperado);
  });
});

describe("§3 · lo que NO gradúa, y está dicho", () => {
  // «Pulso, peso y diastólica no tienen umbral en la plantilla: se
  // registran y no derivan nada.» Está en el alcance 4 del prompt y es
  // una decisión, no un hueco: un rango inventado por nosotros sería
  // ruido que hace que la enfermera deje de mirar el móvil.
  it.each([
    ["PULSO", 30],
    ["PULSO", 180],
    ["PESO", 38],
    ["PESO", 150],
    ["TA_DIASTOLICA", 40],
    ["TA_DIASTOLICA", 130],
  ])("%s = %s no abre nada", (control, n) => {
    expect(nivelDe(control, n)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
//  LA TABLA DEL §3 · la mitad de los EVENTOS
// ════════════════════════════════════════════════════════════════════

describe("§3 · los eventos", () => {
  const casos: Array<[string, string | null, Nivel]> = [
    ["ALGO_NO_VA_BIEN", null, "N1"],
    ["CAIDA", null, "N1"], // «caída sin lesión aparente»
    ["CAIDA", MATICES.SIN_GOLPE, "N1"],
    ["CAIDA", MATICES.CON_GOLPE, "N3"], // «con lesión o golpe en la cabeza»
    ["VOMITO", null, "N1"],
    ["VOMITO", MATICES.REPETIDO, "N2"], // «repetido en el turno»
    ["SIN_DEPOSICION", null, "N1"],
    ["INGESTA_NULA", null, "N1"],
    ["NO_LOCALIZADO", null, "N4"],
    ["EMERGENCIA_VITAL", null, "N4"],
    ["QUEJA", null, "N1"],
    ["AVERIA", MATICES.PELIGROSA, "N2"], // «avería que afecta a la seguridad»
    ["AVERIA", MATICES.SIN_RIESGO, "N0"], // «avería sin riesgo»
  ];
  it.each(casos)("%s (%s) → %s", (evento, matiz, esperado) => {
    expect(gravedadDeEvento(evento, matiz, REGLAS)?.nivel).toBe(esperado);
  });

  it("y las DIECISIETE filas del §3 están todas", () => {
    // El §3 tiene diecisiete filas y la plantilla tiene VEINTITRÉS
    // reglas, y la diferencia no es un error: tres bandas de temperatura
    // son tres reglas y una sola fila del §3 («≥ 37,5 → N1 · ≥ 38 → N2 ·
    // ≥ 39,5 → N3»), los dos extremos de la tensión son dos reglas y una
    // fila, y una caída son tres (la base y sus dos matices).
    //
    // El número se fija aquí para que quitar una regla por descuido se
    // vea. Si cambia a propósito, se cambia aquí y se sube la versión de
    // la plantilla.
    expect(PLANTILLA_DE_GRAVEDAD).toHaveLength(23);
  });
});

// ════════════════════════════════════════════════════════════════════
//  CON EXCEPCIÓN, SIN EXCEPCIÓN Y CON EXCEPCIÓN CADUCADA (D-22)
// ════════════════════════════════════════════════════════════════════

describe("§3 · con la excepción de un residente", () => {
  const DESDE = new Date("2026-10-01T00:00:00Z");
  const HASTA = new Date("2026-10-31T00:00:00Z");

  /** La pauta del paliativo: febrícula basal de 37,8, así que no se avisa
   *  hasta 38,5. */
  const paliativo: ExcepcionDeUmbral = {
    controlCode: "TEMPERATURA",
    desde: DESDE,
    hasta: HASTA,
    reglas: [
      { comparador: "GTE", valor: 38.5, nivel: "N2", tipo: TIPOS_DE_INCIDENCIA.FIEBRE },
      { comparador: "GTE", valor: 39.8, nivel: "N3", tipo: TIPOS_DE_INCIDENCIA.FIEBRE },
    ],
  };

  const casos: Array<[number, Nivel | null, Nivel | null]> = [
    // [valor, sin excepción, con excepción vigente]
    [37.6, "N1", null],
    [38.0, "N2", null],
    [38.4, "N2", null],
    [38.5, "N2", "N2"],
    [39.5, "N3", "N2"], // la de serie diría N3; la pauta dice N2
    [39.8, "N3", "N3"],
  ];
  it.each(casos)(
    "%s °C · de serie %s · con la pauta %s",
    (n, deSerie, conPauta) => {
      expect(nivelDe("TEMPERATURA", n)).toBe(deSerie);
      expect(gravedadDe("TEMPERATURA", n, REGLAS, paliativo)?.nivel ?? null).toBe(
        conPauta,
      );
    },
  );

  it("CADUCADA, vuelve la de serie: 38,0 vuelve a ser N2", () => {
    // Quien decide si está vigente es quien llama (el servidor, contra el
    // instante del registro). Aquí se simula pasando `null`, que es lo
    // que `excepcionesVigentes` devuelve cuando ya caducó.
    expect(gravedadDe("TEMPERATURA", 38, REGLAS, null)?.nivel).toBe("N2");
  });

  it("una pauta VACÍA deja al residente sin aviso por esa constante", () => {
    const sinUmbral: ExcepcionDeUmbral = {
      controlCode: "TA_SISTOLICA",
      desde: DESDE,
      hasta: null,
      reglas: [],
    };
    expect(nivelDe("TA_SISTOLICA", 190)).toBe("N2");
    expect(gravedadDe("TA_SISTOLICA", 190, REGLAS, sinUmbral)).toBeNull();
    // Y la temperatura del mismo residente sigue graduando de serie.
    expect(gravedadDe("TEMPERATURA", 38, REGLAS, sinUmbral)?.nivel).toBe("N2");
  });
});
