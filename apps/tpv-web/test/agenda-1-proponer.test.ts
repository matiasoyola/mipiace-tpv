// agenda-1 · el orden de las mejores horas, sin agenda real.
//
// `proponer()` es lo único de «Dar cita» que se puede equivocar en
// silencio: un panel que pinta un chip de más se ve, un orden que pone
// delante la hora que parte la mañana en dos trozos inservibles no se ve
// nunca. Por eso tiene su banco propio y por eso el banco no monta nada:
// entran números, salen números.
//
// El mínimo que pide el prompt del bloque está en el primer `it`: «la hora
// que llena un hueco justo va primera».
//
// ── Tabla de sabotajes (cada uno visto en rojo, fichero entero) ──────
//
//   A. quitar la regla 1 (los minutos muertos) del comparador ···· caen 2
//   B. `muerto()` cuenta TODO lo que sobra, no sólo lo inservible · caen 5
//   C. `pegada()` siempre 0 (sin la regla 2) ····················· caen 2
//   D. `fechaPropuesta` ignorada (sin la regla 3) ················ cae 1
//   E. `extras` en todas las propuestas, no sólo en la primera ··· cae 1
//   F. `encajar` esconde el candidato que la forma no sostiene ··· cae 1
//   G. `nombreDelDia` con `new Date(fecha).getDay()` ············· caen 2
//      — este sólo se ve con el proceso en otra zona, y así se corrió:
//        `TZ=America/New_York`. En Madrid el sabotaje sale VERDE, que es
//        justo por lo que la función no usa `Date` local.
//
// Los siete en rojo, uno cada vez, fichero entero y sin `-t`.

import { describe, expect, it } from "vitest";


import {
  huecosLibres,
  nombreDelDia,
  proponer,
  type DiaDeLaPropuesta,
  type EntradaDeProponer,
} from "../src/lib/agenda-proponer.js";

const MAR = "2026-11-24";
const MIE = "2026-11-25";

/** Un día de Rosario: 9:00–14:00 con las citas que se le pasen. */
function dia(fecha: string, ocupados: Array<[string, string]>): DiaDeLaPropuesta {
  const min = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return {
    fecha,
    abiertos: [{ desdeMin: 9 * 60, hastaMin: 14 * 60 }],
    ocupados: ocupados.map(([a, b]) => ({ desdeMin: min(a), hastaMin: min(b) })),
  };
}

function entrada(p: Partial<EntradaDeProponer> = {}): EntradaDeProponer {
  return {
    candidatos: [],
    duracionMin: 20,
    dias: [dia(MAR, [])],
    ...p,
  };
}

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

describe("proponer · el orden", () => {
  it("pone PRIMERA la hora que llena un hueco justo", () => {
    // Rosario tiene cita de 11:00 a 11:30 y otra de 11:50 a 12:20. Entre
    // las dos quedan 20 minutos exactos, que es lo que dura la visita.
    // Las 11:30 la llenan sin dejar nada; las 9:00 también valen, pero
    // dejan la mañana partida.
    const r = proponer(
      entrada({
        duracionMin: 20,
        dias: [
          dia(MAR, [
            ["11:00", "11:30"],
            ["11:50", "12:20"],
          ]),
        ],
        candidatos: [
          { fecha: MAR, inicioMin: 9 * 60 },
          { fecha: MAR, inicioMin: 12 * 60 + 20 },
          { fecha: MAR, inicioMin: 11 * 60 + 30 },
        ],
      }),
    );
    expect(hhmm(r[0]!.inicioMin)).toBe("11:30");
    expect(r[0]!.etiqueta).toBe("Llena el hueco justo");
    expect(r[0]!.motivo).toBe("Entre dos citas: no deja hueco");
    expect(r[0]!.minutosMuertos).toBe(0);
  });

  it("una hora que deja minutos sueltos cae por debajo de una que no", () => {
    // Hueco de 11:00 a 12:00 con una visita de 20: a las 11:00 quedan 40
    // seguidos (útiles); a las 11:50 quedan 50 antes (útiles) y 0 después
    // (también bien); a las 11:05 quedan 5 delante — muertos.
    const r = proponer(
      entrada({
        duracionMin: 20,
        dias: [
          dia(MAR, [
            ["09:00", "11:00"],
            ["12:00", "14:00"],
          ]),
        ],
        candidatos: [
          { fecha: MAR, inicioMin: 11 * 60 + 5 },
          { fecha: MAR, inicioMin: 11 * 60 },
        ],
      }),
    );
    expect(hhmm(r[0]!.inicioMin)).toBe("11:00");
    expect(r[0]!.minutosMuertos).toBe(0);
    expect(hhmm(r[1]!.inicioMin)).toBe("11:05");
    expect(r[1]!.minutosMuertos).toBe(5);
    expect(r[1]!.motivo).toBe("Deja 5 min sueltos");
    expect(r[1]!.etiqueta).toBeNull();
  });

  it("los minutos muertos MANDAN sobre el pegarse: es la regla 1", () => {
    // Dos huecos. En el primero (11:00–11:30) la visita de 20 minutos sólo
    // cabe pegada al principio y deja 10 muertos. En el segundo
    // (12:00–13:00) no se pega a nada, pero deja 20 útiles por delante y
    // 20 por detrás: cero muertos.
    //
    // Sin la regla 1 ganaría la pegada, que es exactamente el orden que
    // llena peor la agenda — deja un trozo de 10 minutos que no se vende
    // nunca.
    const r = proponer(
      entrada({
        duracionMin: 20,
        minimoUtilMin: 15,
        dias: [
          dia(MAR, [
            ["09:00", "11:00"],
            ["11:30", "12:00"],
            ["13:00", "14:00"],
          ]),
        ],
        candidatos: [
          { fecha: MAR, inicioMin: 11 * 60 },
          { fecha: MAR, inicioMin: 12 * 60 + 20 },
        ],
      }),
    );
    expect(hhmm(r[0]!.inicioMin)).toBe("12:20");
    expect(r[0]!.minutosMuertos).toBe(0);
    expect(hhmm(r[1]!.inicioMin)).toBe("11:00");
    expect(r[1]!.minutosMuertos).toBe(10);
  });

  it("a igualdad de minutos muertos gana la que se pega a lo que ya hay", () => {
    // Un día entero libre con una cita de 12:00 a 13:00. Para una visita
    // de 30 minutos, las 11:30 se pegan por detrás y las 10:00 no: las dos
    // dejan trozos útiles, pero la pegada deja el rato libre de una pieza.
    const r = proponer(
      entrada({
        duracionMin: 30,
        dias: [dia(MAR, [["12:00", "13:00"]])],
        candidatos: [
          { fecha: MAR, inicioMin: 10 * 60 },
          { fecha: MAR, inicioMin: 11 * 60 + 30 },
        ],
      }),
    );
    expect(hhmm(r[0]!.inicioMin)).toBe("11:30");
    expect(r[0]!.etiqueta).toBe("Sin hueco muerto");
    expect(r[0]!.motivo).toBe("Justo antes de la cita de después");
  });

  it("la primera de la mañana se nombra como lo que es", () => {
    const r = proponer(
      entrada({
        duracionMin: 30,
        dias: [dia(MAR, [["12:00", "13:00"]])],
        candidatos: [{ fecha: MAR, inicioMin: 9 * 60 }],
      }),
    );
    expect(r[0]!.motivo).toBe("Primera de la mañana");
    expect(r[0]!.etiqueta).toBe("Sin hueco muerto");
  });

  it("la fecha propuesta por la sanitaria sólo DESEMPATA", () => {
    // Las dos horas son igual de buenas (ninguna deja muertos, ninguna se
    // pega): manda la fecha propuesta, aunque sea la más tarde.
    const empate = proponer(
      entrada({
        duracionMin: 30,
        dias: [dia(MAR, []), dia(MIE, [])],
        fechaPropuesta: MIE,
        candidatos: [
          { fecha: MAR, inicioMin: 10 * 60 },
          { fecha: MIE, inicioMin: 10 * 60 },
        ],
      }),
    );
    expect(empate[0]!.fecha).toBe(MIE);

    // Pero NO sube una hora que deja huecos muertos: el miércoles a las
    // 11:05 deja 5 minutos sueltos y se queda detrás del martes.
    const conMuertos = proponer(
      entrada({
        duracionMin: 20,
        dias: [
          dia(MAR, []),
          dia(MIE, [
            ["09:00", "11:00"],
            ["12:00", "14:00"],
          ]),
        ],
        fechaPropuesta: MIE,
        candidatos: [
          { fecha: MIE, inicioMin: 11 * 60 + 5 },
          { fecha: MAR, inicioMin: 10 * 60 },
        ],
      }),
    );
    expect(conMuertos[0]!.fecha).toBe(MAR);
  });

  it("devuelve tres y explica la de otro día como la alternativa", () => {
    const r = proponer(
      entrada({
        duracionMin: 30,
        dias: [dia(MAR, []), dia(MIE, [])],
        candidatos: [
          { fecha: MAR, inicioMin: 9 * 60 },
          { fecha: MAR, inicioMin: 10 * 60 },
          { fecha: MIE, inicioMin: 10 * 60 },
          { fecha: MIE, inicioMin: 11 * 60 },
        ],
      }),
    );
    expect(r).toHaveLength(3);
    const deOtroDia = r.find((p) => p.fecha === MIE)!;
    expect(deOtroDia.motivo).toBe("Si el martes no le viene bien");
  });

  it("sin candidatos no inventa nada, y sin duración tampoco", () => {
    expect(proponer(entrada({ candidatos: [] }))).toEqual([]);
    expect(
      proponer(
        entrada({
          duracionMin: 0,
          candidatos: [{ fecha: MAR, inicioMin: 9 * 60 }],
        }),
      ),
    ).toEqual([]);
  });

  it("un candidato que la forma del día no sostiene se devuelve al final", () => {
    // Manda el motor: si dice que cabe, se ofrece — pero detrás de las que
    // esta aritmética sí puede explicar. Esconderlo sería quitarle a la
    // recepción una hora que el servidor sí acepta.
    const r = proponer(
      entrada({
        duracionMin: 30,
        dias: [dia(MAR, [["10:00", "11:00"]])],
        candidatos: [
          { fecha: MAR, inicioMin: 10 * 60 + 30 }, // pisa la cita
          { fecha: MAR, inicioMin: 11 * 60 },
        ],
      }),
    );
    expect(hhmm(r[0]!.inicioMin)).toBe("11:00");
    expect(hhmm(r[1]!.inicioMin)).toBe("10:30");
  });

  it("el mismo orden dos veces: nada de desempates al azar", () => {
    const e = entrada({
      duracionMin: 30,
      dias: [dia(MAR, [])],
      candidatos: [
        { fecha: MAR, inicioMin: 10 * 60 },
        { fecha: MAR, inicioMin: 11 * 60 },
        { fecha: MAR, inicioMin: 12 * 60 },
      ],
    });
    expect(proponer(e)).toEqual(proponer(e));
  });
});

describe("proponer · lo del spa, preparado y sin pantalla", () => {
  it("en clínica no devuelve ningún extra", () => {
    const r = proponer(
      entrada({ candidatos: [{ fecha: MAR, inicioMin: 10 * 60 }] }),
    );
    expect(r[0]!.extras).toEqual([]);
  });

  it("con la configuración del centro encendida salen, y SÓLO en la primera", () => {
    const r = proponer(
      entrada({
        candidatos: [
          { fecha: MAR, inicioMin: 10 * 60 },
          { fecha: MAR, inicioMin: 11 * 60 },
        ],
        centro: { sugerenciasDeVenta: true, chequeRegalo: true },
      }),
    );
    expect(r[0]!.extras).toEqual([
      { tipo: "SUGERENCIA_DE_VENTA" },
      { tipo: "CHEQUE_REGALO" },
    ]);
    expect(r[1]!.extras).toEqual([]);
  });
});

describe("huecosLibres y nombreDelDia", () => {
  it("resta las citas del turno y devuelve los trozos en orden", () => {
    expect(
      huecosLibres(
        dia(MAR, [
          ["10:00", "10:30"],
          ["12:00", "13:00"],
        ]),
      ),
    ).toEqual([
      { desdeMin: 540, hastaMin: 600 },
      { desdeMin: 630, hastaMin: 720 },
      { desdeMin: 780, hastaMin: 840 },
    ]);
  });

  it("el día de la semana no depende de la zona del proceso", () => {
    expect(nombreDelDia("2026-11-24")).toBe("martes");
    expect(nombreDelDia("2026-11-01")).toBe("domingo");
    expect(nombreDelDia("2026-10-27")).toBe("martes");
  });
});
