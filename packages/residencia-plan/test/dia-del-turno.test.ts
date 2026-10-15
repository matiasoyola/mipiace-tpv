// residencia-3 · `diaDelTurno`, como tabla de verdad.
//
// Lo que esta función decide es **a qué día del centro pertenece un
// registro**, y de eso depende que «lo que se hizo en el turno de noche»
// sea una hoja y no dos mitades. Es la columna `care_records.care_day`.
//
// Los casos que importan y por qué:
//
//   1. La madrugada del turno de noche es DE AYER. Es el caso entero.
//   2. Las 22:00 en punto ya son del turno de noche de HOY (el límite es
//      semiabierto por el final, igual que en `turnoDe`).
//   3. Un turno que NO cruza medianoche nunca desplaza el día.
//   4. Sin turno (hueco en el cuadrante) el día es el del reloj: no hay
//      nada que desplazar.
//   5. Los DOS cambios de hora, porque es donde dos implementaciones de
//      la hora de pared pueden discrepar.

import { describe, expect, it } from "vitest";

import { TURNOS_DE_SERIE, diaDelTurno, turnoDe } from "../src/turnos.js";
import { wallTimeToUtc } from "../src/tiempo.js";

const TURNOS = TURNOS_DE_SERIE.map((t, i) => ({
  id: `t${i}`,
  code: t.code,
  name: t.name,
  startsAt: t.startsAt,
  endsAt: t.endsAt,
}));

/** El día del turno de un instante de pared del centro. */
function dia(fecha: string, hora: string): string {
  const instante = wallTimeToUtc(fecha, hora);
  return diaDelTurno(instante, turnoDe(instante, TURNOS));
}

describe("diaDelTurno · el día del CENTRO", () => {
  it("LA MADRUGADA DEL TURNO DE NOCHE ES DE AYER", () => {
    // Lo registrado a las 02:00 del martes pertenece a la noche del lunes.
    // Sin esto, la ronda de cambios posturales de la noche saldría partida
    // en dos días y cada mitad contaría como un turno a medias.
    expect(dia("2026-03-10", "02:00")).toBe("2026-03-09");
    expect(dia("2026-03-10", "00:01")).toBe("2026-03-09");
    expect(dia("2026-03-10", "07:59")).toBe("2026-03-09");
  });

  it("y a las 08:00 ya es el turno de MAÑANA, del mismo día", () => {
    // El límite es semiabierto por el final: las 08:00 son de la mañana.
    expect(turnoDe(wallTimeToUtc("2026-03-10", "08:00"), TURNOS)?.code).toBe("M");
    expect(dia("2026-03-10", "08:00")).toBe("2026-03-10");
  });

  it("las 22:00 en punto son la noche DE HOY, no de ayer", () => {
    expect(turnoDe(wallTimeToUtc("2026-03-10", "22:00"), TURNOS)?.code).toBe("N");
    expect(dia("2026-03-10", "22:00")).toBe("2026-03-10");
    expect(dia("2026-03-10", "23:59")).toBe("2026-03-10");
  });

  it("un turno que NO cruza medianoche no desplaza nada", () => {
    expect(dia("2026-03-10", "09:00")).toBe("2026-03-10");
    expect(dia("2026-03-10", "15:00")).toBe("2026-03-10");
    expect(dia("2026-03-10", "21:59")).toBe("2026-03-10");
  });

  it("SIN TURNO, el día es el del reloj", () => {
    // Un centro que sólo tiene la mañana configurada: a las 03:00 no hay
    // turno, y el registro se guarda sin turno con el día de pared. No se
    // rechaza — un cuidado hecho se apunta.
    const soloManana = [TURNOS[0]!];
    const instante = wallTimeToUtc("2026-03-10", "03:00");
    expect(turnoDe(instante, soloManana)).toBeNull();
    expect(diaDelTurno(instante, null)).toBe("2026-03-10");
  });

  it("EL 29 DE MARZO (el día de 23 h) la madrugada sigue siendo de ayer", () => {
    // Ese día el reloj salta de 01:59 a 03:00. Las 03:00 son el primer
    // instante real después del salto y siguen cayendo en la parte de
    // madrugada del turno de noche.
    expect(dia("2026-03-29", "01:30")).toBe("2026-03-28");
    expect(dia("2026-03-29", "03:00")).toBe("2026-03-28");
    expect(dia("2026-03-29", "08:00")).toBe("2026-03-29");
  });

  it("EL 25 DE OCTUBRE (el día de 25 h) las DOS veces que son las 02:30 son de ayer", () => {
    // La hora repetida: 02:30 en +02:00 y 02:30 en +01:00 son dos
    // instantes distintos separados por una hora real, y los dos son «las
    // dos y media de la madrugada» — o sea los dos son la noche del 24.
    const primera = new Date("2026-10-25T00:30:00.000Z"); // 02:30 +02:00
    const segunda = new Date("2026-10-25T01:30:00.000Z"); // 02:30 +01:00
    expect(diaDelTurno(primera, turnoDe(primera, TURNOS))).toBe("2026-10-24");
    expect(diaDelTurno(segunda, turnoDe(segunda, TURNOS))).toBe("2026-10-24");
  });

  it("y el día entero no deja ningún minuto sin día", () => {
    // El barrido: los 1.440 minutos de un día de pared tienen día de
    // turno, y sólo hay dos valores posibles — ayer y hoy.
    const posibles = new Set<string>();
    for (let m = 0; m < 1440; m++) {
      const hora = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(
        m % 60,
      ).padStart(2, "0")}`;
      posibles.add(dia("2026-06-15", hora));
    }
    expect([...posibles].sort()).toEqual(["2026-06-14", "2026-06-15"]);
  });
});
