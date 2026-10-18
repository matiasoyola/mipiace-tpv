// residencia-5 · **LA TABLA DE LAS PERIODICIDADES.**
//
// Lo que el prompt pide comprobar: «cada periodicidad genera sus
// ocurrencias bien (fin de mes, 29 de febrero, trimestres)». Más los
// bordes que salieron al escribirla: el año no bisiesto, la ventana que
// empieza después del `startsOn`, la quinquenal mirada hacia atrás y la
// vigencia que ya pasó.
//
// Es una tabla de verdad y no una maqueta: la función es pura y no toca
// la base ni el reloj, que es exactamente para lo que se escribió aparte.

import { describe, expect, it } from "vitest";

import {
  DIAS_DE_PREAVISO,
  diaRecortado,
  diasDelMes,
  diasHasta,
  ocurrenciasDeObligacion,
  periodicidadEnPalabras,
} from "../src/obligaciones.js";
import type { ObligacionParaGenerar } from "../src/obligaciones.js";

/** Una obligación con lo mínimo, y lo que haga falta encima. */
function obligacion(extra: Partial<ObligacionParaGenerar>): ObligacionParaGenerar {
  return {
    periodicity: "MONTHLY",
    weekday: null,
    monthDay: null,
    month: null,
    anchorYear: null,
    validUntil: null,
    startsOn: "2020-01-01",
    ...extra,
  };
}

// ── 1 · Los días del mes, que es de donde sale todo ──────────────────

describe("cuántos días tiene un mes", () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2027, 2, 28],
    // El que importa: 2028 es bisiesto.
    [2028, 2, 29],
    [2026, 4, 30],
    [2026, 12, 31],
    // 2100 NO es bisiesto, y es el caso que un `% 4` a mano se come.
    [2100, 2, 28],
    [2000, 2, 29],
  ])("%i-%i → %i días", (anio, mes, dias) => {
    expect(diasDelMes(anio, mes)).toBe(dias);
  });

  it("el día se RECORTA al último del mes", () => {
    // De aquí sale «el último día de cada mes» sin inventar un centinela.
    expect(diaRecortado(2027, 2, 31)).toBe(28);
    expect(diaRecortado(2028, 2, 31)).toBe(29);
    expect(diaRecortado(2026, 4, 31)).toBe(30);
    expect(diaRecortado(2026, 10, 25)).toBe(25);
  });
});

// ── 2 · Diaria y semanal ─────────────────────────────────────────────

describe("diaria", () => {
  it("todos los días de la ventana, los dos extremos incluidos", () => {
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "DAILY" }),
      "2026-10-19",
      "2026-10-22",
    );
    expect(f).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"]);
  });

  it("nada antes del `startsOn`", () => {
    // Cargar la plantilla del bloque C en octubre no inventa los
    // registros de jornada de enero.
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "DAILY", startsOn: "2026-10-21" }),
      "2026-10-19",
      "2026-10-22",
    );
    expect(f).toEqual(["2026-10-21", "2026-10-22"]);
  });
});

describe("semanal", () => {
  it("el lunes de cada semana", () => {
    // El 19 de octubre de 2026 es lunes.
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "WEEKLY", weekday: 1 }),
      "2026-10-15",
      "2026-11-05",
    );
    expect(f).toEqual(["2026-10-19", "2026-10-26", "2026-11-02"]);
  });

  it("el domingo es el 7, no el 0", () => {
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "WEEKLY", weekday: 7 }),
      "2026-10-19",
      "2026-10-26",
    );
    expect(f).toEqual(["2026-10-25"]);
  });
});

// ── 3 · Mensual, con el fin de mes dentro ────────────────────────────

describe("mensual", () => {
  it("las nóminas el 25 de cada mes", () => {
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "MONTHLY", monthDay: 25 }),
      "2026-10-01",
      "2026-12-31",
    );
    expect(f).toEqual(["2026-10-25", "2026-11-25", "2026-12-25"]);
  });

  it("«el 31» es EL ÚLTIMO DÍA DEL MES, y febrero existe", () => {
    // La decisión del fichero: recortar en vez de no generar nada. Un
    // centro que paga el último día del mes no puede quedarse sin la
    // nómina de febrero.
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "MONTHLY", monthDay: 31 }),
      "2027-01-01",
      "2027-05-31",
    );
    expect(f).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
      "2027-05-31",
    ]);
  });

  it("y en 2028, el 29 de febrero", () => {
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "MONTHLY", monthDay: 31 }),
      "2028-02-01",
      "2028-02-29",
    );
    expect(f).toEqual(["2028-02-29"]);
  });

  it("el 30 en febrero también se recorta", () => {
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "MONTHLY", monthDay: 30 }),
      "2027-02-01",
      "2027-02-28",
    );
    expect(f).toEqual(["2027-02-28"]);
  });
});

// ── 4 · Trimestral ───────────────────────────────────────────────────

describe("trimestral", () => {
  it("anclada en marzo → marzo, junio, septiembre y diciembre", () => {
    // El calendario de los informes de extintores del cliente cero.
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "QUARTERLY", month: 3, monthDay: 15 }),
      "2026-01-01",
      "2026-12-31",
    );
    expect(f).toEqual(["2026-03-15", "2026-06-15", "2026-09-15", "2026-12-15"]);
  });

  it("anclada en enero → enero, abril, julio y octubre", () => {
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "QUARTERLY", month: 1, monthDay: 1 }),
      "2026-01-01",
      "2026-12-31",
    );
    expect(f).toEqual(["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"]);
  });

  it("cruza el año sin perder ningún trimestre", () => {
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "QUARTERLY", month: 2, monthDay: 10 }),
      "2026-11-01",
      "2027-06-30",
    );
    expect(f).toEqual(["2026-11-10", "2027-02-10", "2027-05-10"]);
  });

  it("y el 31 de un trimestre que cae en febrero se recorta", () => {
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "QUARTERLY", month: 2, monthDay: 31 }),
      "2027-01-01",
      "2027-12-31",
    );
    expect(f).toEqual(["2027-02-28", "2027-05-31", "2027-08-31", "2027-11-30"]);
  });
});

// ── 5 · Anual y quinquenal ───────────────────────────────────────────

describe("anual", () => {
  it("el certificado del mantenedor, cada 31 de diciembre", () => {
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "ANNUAL", month: 12, monthDay: 31 }),
      "2026-01-01",
      "2028-12-31",
    );
    expect(f).toEqual(["2026-12-31", "2027-12-31", "2028-12-31"]);
  });

  it("una anual del 29 de febrero se recorta los años no bisiestos", () => {
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "ANNUAL", month: 2, monthDay: 29 }),
      "2027-01-01",
      "2029-12-31",
    );
    expect(f).toEqual(["2027-02-28", "2028-02-29", "2029-02-28"]);
  });
});

describe("quinquenal", () => {
  it("la inspección OCA: anclada en 2024, toca en 2029", () => {
    // «Vigente hasta el 05-11-2029» (bloque C §3.4).
    const f = ocurrenciasDeObligacion(
      obligacion({
        periodicity: "FIVE_YEARLY",
        month: 11,
        monthDay: 5,
        anchorYear: 2024,
      }),
      "2026-01-01",
      "2035-12-31",
    );
    expect(f).toEqual(["2029-11-05", "2034-11-05"]);
  });

  it("mirada hacia atrás, también", () => {
    // Una ventana que pregunte por 2019 tiene que decir que tocó.
    const f = ocurrenciasDeObligacion(
      obligacion({
        periodicity: "FIVE_YEARLY",
        month: 11,
        monthDay: 5,
        anchorYear: 2024,
        startsOn: "2010-01-01",
      }),
      "2018-01-01",
      "2020-12-31",
    );
    expect(f).toEqual(["2019-11-05"]);
  });
});

// ── 6 · Por vigencia: UNA, la de su caducidad ────────────────────────

describe("por vigencia", () => {
  it("una sola ocurrencia, la de la fecha de caducidad", () => {
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "VALIDITY", validUntil: "2027-03-14" }),
      "2026-01-01",
      "2028-12-31",
    );
    expect(f).toEqual(["2027-03-14"]);
  });

  it("fuera de la ventana, ninguna", () => {
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "VALIDITY", validUntil: "2030-01-01" }),
      "2026-01-01",
      "2026-12-31",
    );
    expect(f).toEqual([]);
  });

  it("no se repite al año siguiente: CADUCA, no se vuelve a hacer", () => {
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "VALIDITY", validUntil: "2027-03-14" }),
      "2026-01-01",
      "2040-12-31",
    );
    expect(f).toHaveLength(1);
  });

  it("los 60 días de preaviso del bloque C son UN número y vive aquí", () => {
    expect(DIAS_DE_PREAVISO).toBe(60);
    expect(diasHasta("2027-01-13", "2027-03-14")).toBe(60);
    // Vencida: negativo.
    expect(diasHasta("2027-03-20", "2027-03-14")).toBe(-6);
  });
});

// ── 7 · Bordes de la ventana ─────────────────────────────────────────

describe("la ventana", () => {
  it("al revés devuelve vacío en vez de barrer el calendario entero", () => {
    expect(
      ocurrenciasDeObligacion(
        obligacion({ periodicity: "DAILY" }),
        "2026-10-22",
        "2026-10-19",
      ),
    ).toEqual([]);
  });

  it("un solo día es una ventana válida", () => {
    expect(
      ocurrenciasDeObligacion(
        obligacion({ periodicity: "DAILY" }),
        "2026-10-19",
        "2026-10-19",
      ),
    ).toEqual(["2026-10-19"]);
  });

  it("sin el dato que su periodicidad necesita, no se inventa nada", () => {
    // Una mensual sin día del mes no sabe cuándo toca. El CHECK de la
    // migración lo impide; esto es lo que pasa si alguien se lo salta por
    // SQL: no genera, en vez de generar el día 1 por omisión.
    expect(
      ocurrenciasDeObligacion(
        obligacion({ periodicity: "MONTHLY", monthDay: null }),
        "2026-10-01",
        "2026-12-31",
      ),
    ).toEqual([]);
  });

  it("y no repite ninguna fecha", () => {
    // La lista entra en un `ON CONFLICT DO NOTHING`, así que un
    // repetido haría que la idempotencia fuera un accidente del motor en
    // vez de una propiedad de la función.
    const f = ocurrenciasDeObligacion(
      obligacion({ periodicity: "QUARTERLY", month: 1, monthDay: 1 }),
      "2026-01-01",
      "2030-12-31",
    );
    expect(f).toEqual([...new Set(f)].sort());
  });
});

// ── 8 · La frase de la pantalla ──────────────────────────────────────

describe("cómo se lee cada periodicidad", () => {
  it.each([
    [obligacion({ periodicity: "DAILY" }), "Todos los días"],
    [obligacion({ periodicity: "WEEKLY", weekday: 1 }), "Cada semana, el lunes"],
    [obligacion({ periodicity: "MONTHLY", monthDay: 25 }), "Cada mes, el día 25"],
    // El 31 se lee como lo que significa, no como un número.
    [obligacion({ periodicity: "MONTHLY", monthDay: 31 }), "Cada mes, el último día del mes"],
    [
      obligacion({ periodicity: "ANNUAL", month: 7, monthDay: 20 }),
      "Cada año, el 20 de julio",
    ],
    [
      obligacion({ periodicity: "VALIDITY", validUntil: "2029-11-05" }),
      "Vence el 05-11-2029",
    ],
  ])("%#", (o, frase) => {
    expect(periodicidadEnPalabras(o)).toBe(frase);
  });

  it("la trimestral nombra sus cuatro meses", () => {
    expect(
      periodicidadEnPalabras(
        obligacion({ periodicity: "QUARTERLY", month: 3, monthDay: 15 }),
      ),
    ).toBe("Cada trimestre (marzo, junio, septiembre, diciembre), el día 15");
  });
});
