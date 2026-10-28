// agenda-1 · la aritmética del día en lista y de la semana en columnas.
//
// Sin React y sin agenda real: entran tramos, salen filas. Lo que se fija
// aquí es lo que la rejilla no decía y la lista sí tiene que decir — los
// huecos con su duración, las horas cerradas plegadas, y las tres cifras.
//
// ── Tabla de sabotajes (cada uno visto en rojo, fichero entero) ──────
//
//   H. los huecos sin recortar al suelo ························ caen 3
//   I. sin la línea de cerrado de ENTRE dos tramos ·············· cae 1
//   J. las ausencias cuentan como hueco libre ··················· cae 1
//   K. `queCabe` ordena del más corto al más largo ·············· cae 1
//   L. `cifrasDelDia` cuenta los minutos desde que ABRE ········· caen 2
//   M. `lunesDeLaSemana` sin el caso del domingo ················ cae 1
//   N. `resumenDeDia` sin «casi libre» ·························· cae 1
//
// Los siete en rojo, uno cada vez, fichero entero y sin `-t`. Y el fichero
// entero corre además en verde con `TZ=America/New_York`: ninguna de estas
// cuentas depende de la zona del proceso.

import { describe, expect, it } from "vitest";

import {
  ahoraYDespues,
  cifrasDelDia,
  duracionHumana,
  filasDelDia,
  queCabe,
  type FilaDelDia,
} from "../src/lib/agenda-dia.js";
import {
  diaCortoDeLaSemana,
  lunesDeLaSemana,
  masDias,
  resumenDeDia,
  rotuloDeLaSemana,
  sieteDias,
} from "../src/lib/agenda-semana.js";

const min = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const MANANA = [{ desdeMin: min("09:00"), hastaMin: min("14:00") }];

/** `[["09:00","09:30"], …]` → tramos ocupados con id. */
function citas(pares: Array<[string, string]>) {
  return pares.map(([a, b], i) => ({
    id: `c${i + 1}`,
    desdeMin: min(a),
    hastaMin: min(b),
  }));
}

/** Las filas resumidas en texto, que es lo que se lee de un fallo. */
function resumir(filas: FilaDelDia[]): string[] {
  return filas.map((f) =>
    f.tipo === "cita"
      ? `cita ${f.id} ${hhmm(f.desdeMin)}`
      : f.tipo === "hueco"
        ? `hueco ${hhmm(f.desdeMin)} ${f.duracionMin}min${f.reservable ? "" : " pasado"}`
        : `cerrado ${hhmm(f.desdeMin)}`,
  );
}

describe("filasDelDia", () => {
  it("intercala los huecos libres entre las citas, en orden", () => {
    const filas = filasDelDia({
      citas: citas([
        ["09:00", "09:30"],
        ["10:30", "11:00"],
      ]),
      abiertos: MANANA,
    });
    expect(resumir(filas)).toEqual([
      "cita c1 09:00",
      "hueco 09:30 60min",
      "cita c2 10:30",
      "hueco 11:00 180min",
      "cerrado 14:00",
    ]);
  });

  it("dice qué cabe en cada hueco, lo más largo primero", () => {
    const filas = filasDelDia({
      citas: citas([["09:00", "09:30"]]),
      abiertos: [{ desdeMin: min("09:00"), hastaMin: min("09:55") }],
      servicios: [
        { nombre: "Cura", duracionMin: 15 },
        { nombre: "Papiloma", duracionMin: 20 },
        { nombre: "Quiropodia completa", duracionMin: 30 },
        { nombre: "Avulsión ungueal", duracionMin: 120 },
      ],
    });
    const hueco = filas.find((f) => f.tipo === "hueco");
    expect(hueco).toMatchObject({ duracionMin: 25 });
    // 25 minutos: caben la Cura y el Papiloma, no la Quiropodia.
    expect(hueco!.tipo === "hueco" && hueco.cabe).toEqual(["Papiloma", "Cura"]);
  });

  it("pliega las horas cerradas: una línea por hueco del horario", () => {
    // Un centro que cierra a comer: 9–14 y 16–20.
    const filas = filasDelDia({
      citas: [],
      abiertos: [
        { desdeMin: min("09:00"), hastaMin: min("14:00") },
        { desdeMin: min("16:00"), hastaMin: min("20:00") },
      ],
    });
    const cerradas = filas.filter((f) => f.tipo === "cerrado");
    expect(cerradas).toEqual([
      { tipo: "cerrado", desdeMin: min("14:00"), hastaMin: min("16:00") },
      { tipo: "cerrado", desdeMin: min("20:00"), hastaMin: 24 * 60 },
    ]);
  });

  it("el suelo recorta el hueco en curso y no ofrece los pasados", () => {
    // Son las 10:30: el hueco de 9:30 a 12:00 empieza AHORA, no a las 9:30.
    const filas = filasDelDia({
      citas: citas([["09:00", "09:30"]]),
      abiertos: MANANA,
      sueloMin: min("10:30"),
    });
    expect(resumir(filas)).toEqual([
      "cita c1 09:00",
      "hueco 10:30 210min",
      "cerrado 14:00",
    ]);
  });

  it("un hueco ENTERAMENTE pasado se ve, pero no se ofrece", () => {
    const filas = filasDelDia({
      citas: citas([
        ["09:00", "09:30"],
        ["11:00", "14:00"],
      ]),
      abiertos: MANANA,
      sueloMin: min("11:00"),
      servicios: [{ nombre: "Cura", duracionMin: 15 }],
    });
    const hueco = filas.find((f) => f.tipo === "hueco")!;
    expect(resumir([hueco])).toEqual(["hueco 09:30 90min pasado"]);
    // Y sin «cabe una…»: no se puede dar nada ahí.
    expect(hueco.tipo === "hueco" && hueco.cabe).toEqual([]);
  });

  it("un día que ya pasó no tiene huecos, pero sí sus citas", () => {
    const filas = filasDelDia({
      citas: citas([["09:00", "09:30"]]),
      abiertos: MANANA,
      sueloMin: Number.POSITIVE_INFINITY,
    });
    expect(resumir(filas)).toEqual([
      "cita c1 09:00",
      "hueco 09:30 270min pasado",
      "cerrado 14:00",
    ]);
  });

  it("el día cerrado no tiene huecos ni líneas de cerrado: no hay horario", () => {
    const filas = filasDelDia({ citas: [], abiertos: [] });
    expect(filas).toEqual([]);
  });

  it("una ausencia no es un hueco libre", () => {
    const filas = filasDelDia({
      citas: [],
      abiertos: MANANA,
      ausencias: [{ desdeMin: min("10:00"), hastaMin: min("12:00") }],
    });
    expect(resumir(filas)).toEqual([
      "hueco 09:00 60min",
      "hueco 12:00 120min",
      "cerrado 14:00",
    ]);
  });

  it("un hueco de un redondeo no es una fila", () => {
    const filas = filasDelDia({
      citas: citas([
        ["09:00", "09:55"],
        ["10:00", "14:00"],
      ]),
      abiertos: MANANA,
      minimoDeHuecoMin: 10,
    });
    expect(filas.filter((f) => f.tipo === "hueco")).toEqual([]);
  });
});

describe("queCabe", () => {
  it("no nombra lo que no entra", () => {
    expect(
      queCabe(15, [
        { nombre: "Cura", duracionMin: 15 },
        { nombre: "Quiropodia", duracionMin: 30 },
      ]),
    ).toEqual(["Cura"]);
  });

  it("ignora los servicios sin duración", () => {
    expect(queCabe(60, [{ nombre: "Sin ficha", duracionMin: 0 }])).toEqual([]);
  });
});

describe("ahoraYDespues", () => {
  it("la de ahora es la del reloj, no la marcada en sala", () => {
    const c = citas([
      ["09:00", "09:30"],
      ["10:30", "11:00"],
      ["11:00", "11:30"],
    ]);
    expect(ahoraYDespues(c, min("10:45"))).toEqual({
      ahora: "c2",
      despues: "c3",
    });
  });

  it("sin nada en curso, «después» sigue siendo la siguiente", () => {
    const c = citas([
      ["09:00", "09:30"],
      ["11:00", "11:30"],
    ]);
    expect(ahoraYDespues(c, min("10:00"))).toEqual({
      ahora: null,
      despues: "c2",
    });
  });

  it("en un día que no es hoy no hay «ahora»", () => {
    const c = citas([["09:00", "09:30"]]);
    expect(ahoraYDespues(c, null)).toEqual({ ahora: null, despues: "c1" });
  });
});

describe("cifrasDelDia", () => {
  it("los minutos libres se cuentan DESDE EL SUELO", () => {
    // 9–14 son 300 minutos. Con una cita de 30 y el suelo a las 12:00
    // quedan 120 libres, no 270.
    expect(
      cifrasDelDia({
        citas: citas([["09:00", "09:30"]]),
        hechas: 1,
        abiertos: MANANA,
        sueloMin: min("12:00"),
      }),
    ).toEqual({ citas: 1, hechas: 1, minutosLibres: 120 });
  });

  it("con el día entero por delante son todos", () => {
    expect(
      cifrasDelDia({
        citas: citas([["09:00", "09:30"]]),
        hechas: 0,
        abiertos: MANANA,
      }).minutosLibres,
    ).toBe(270);
  });

  it("un día que pasó no tiene minutos que vender", () => {
    expect(
      cifrasDelDia({
        citas: [],
        hechas: 0,
        abiertos: MANANA,
        sueloMin: Number.POSITIVE_INFINITY,
      }).minutosLibres,
    ).toBe(0);
  });
});

describe("duracionHumana", () => {
  it("lo dice como la recepción por teléfono", () => {
    expect(duracionHumana(45)).toBe("45 min");
    expect(duracionHumana(60)).toBe("1 h");
    expect(duracionHumana(90)).toBe("1 h 30 min");
    expect(duracionHumana(190)).toBe("3 h 10 min");
    expect(duracionHumana(0)).toBe("0 min");
  });
});

describe("la semana", () => {
  it("empieza el lunes, también en domingo", () => {
    // 27-10-2026 es martes; 1-11-2026 es domingo.
    expect(lunesDeLaSemana("2026-10-27")).toBe("2026-10-26");
    expect(lunesDeLaSemana("2026-11-01")).toBe("2026-10-26");
    expect(lunesDeLaSemana("2026-10-26")).toBe("2026-10-26");
  });

  it("siete días de lunes a domingo, cruzando el mes", () => {
    expect(sieteDias("2026-10-27")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });

  it("masDias cruza el cambio de hora sin perder un día", () => {
    // El 25-10-2026 es el domingo del cambio de hora en España.
    expect(masDias("2026-10-24", 1)).toBe("2026-10-25");
    expect(masDias("2026-10-25", 1)).toBe("2026-10-26");
    expect(masDias("2026-10-26", -1)).toBe("2026-10-25");
  });

  it("el rótulo dice el mes una vez si es el mismo, y dos si cambia", () => {
    expect(rotuloDeLaSemana(["2026-10-26", "2026-10-30"])).toBe("26 – 30 oct");
    expect(rotuloDeLaSemana(["2026-09-28", "2026-10-02"])).toBe(
      "28 sep – 2 oct",
    );
  });

  it("la cabecera de la columna es «Lun 26»", () => {
    expect(diaCortoDeLaSemana("2026-10-26")).toBe("Lun 26");
    expect(diaCortoDeLaSemana("2026-10-31")).toBe("Sáb 31");
  });

  it("resume el día en las tres frases que se dicen por teléfono", () => {
    const abiertos = MANANA;
    expect(
      resumenDeDia({ fecha: "x", citas: [], abiertos, minutosLibres: 300 })
        .texto,
    ).toBe("Sin citas");
    expect(
      resumenDeDia({
        fecha: "x",
        citas: citas([["09:00", "14:00"]]),
        abiertos,
        minutosLibres: 0,
      }).texto,
    ).toBe("1 cita · lleno");
    expect(
      resumenDeDia({
        fecha: "x",
        citas: citas([
          ["09:00", "09:30"],
          ["10:00", "10:30"],
        ]),
        abiertos,
        minutosLibres: 240,
      }).texto,
    ).toBe("2 citas · casi libre");
    expect(
      resumenDeDia({
        fecha: "x",
        citas: citas([["09:00", "13:15"]]),
        abiertos,
        minutosLibres: 45,
      }).texto,
    ).toBe("1 cita · 45 min libres");
  });
});
