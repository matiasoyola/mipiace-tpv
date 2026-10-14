// residencia-1 (D-54) · «¿EN QUÉ TURNO CAE ESTE INSTANTE?»
//
// Pura, así que esto es una tabla y no una maqueta. Lo que fija:
//
//   · los tres turnos de serie cubren las 24 h sin hueco ni solape;
//   · LA NOCHE CRUZA MEDIANOCHE, que es lo único que no se puede escribir
//     como un rango normal;
//   · el límite es semiabierto: las 15:00 son de la tarde, no de las dos;
//   · y los DOS CAMBIOS DE HORA de España, que es donde un `getHours()`
//     sobre un instante UTC se equivocaría una hora durante seis meses.

import { describe, expect, it } from "vitest";

import {
  cruzaMedianoche,
  minutosEnTurno,
  turnoDe,
  TURNOS_DE_SERIE,
  type TurnoDelCentro,
} from "../src/residencia/turnos.js";

/** Los tres de serie, con id, como los devuelve la base. */
const TURNOS: TurnoDelCentro[] = TURNOS_DE_SERIE.map((t) => ({
  id: `turno-${t.code}`,
  code: t.code,
  name: t.name,
  startsAt: t.startsAt,
  endsAt: t.endsAt,
}));

/** Un instante a partir de una hora de pared de Madrid. */
function enMadrid(fecha: string, hora: string): Date {
  // Se construye desde el offset explícito para que el test no dependa de
  // la TZ del portátil ni de la de CI. En verano Madrid es +02:00, en
  // invierno +01:00.
  return new Date(`${fecha}T${hora}`);
}

describe("residencia-1 · el turno de un instante", () => {
  it("los tres de serie son mañana 08-15, tarde 15-22 y noche 22-08", () => {
    expect(TURNOS_DE_SERIE.map((t) => [t.code, t.startsAt, t.endsAt])).toEqual([
      ["M", "08:00", "15:00"],
      ["T", "15:00", "22:00"],
      ["N", "22:00", "08:00"],
    ]);
  });

  it("sólo la NOCHE cruza medianoche", () => {
    expect(TURNOS.map((t) => cruzaMedianoche(t))).toEqual([false, false, true]);
  });

  it("las 09:30 son de la mañana", () => {
    expect(turnoDe(enMadrid("2026-10-14", "09:30:00+02:00"), TURNOS)?.code).toBe("M");
  });

  it("las 18:00 son de la tarde", () => {
    expect(turnoDe(enMadrid("2026-10-14", "18:00:00+02:00"), TURNOS)?.code).toBe("T");
  });

  it("las 23:10 son de la NOCHE", () => {
    expect(turnoDe(enMadrid("2026-10-14", "23:10:00+02:00"), TURNOS)?.code).toBe("N");
  });

  it("LAS 02:30 DE LA MADRUGADA SON DE LA NOCHE — el caso que un rango normal pierde", () => {
    // Escrito como `minutos >= 22*60 && minutos < 8*60` esto sería `null`,
    // y la madrugada entera se quedaría sin turno: justo el tramo en que
    // una residencia está más sola.
    expect(turnoDe(enMadrid("2026-10-15", "02:30:00+02:00"), TURNOS)?.code).toBe("N");
    expect(turnoDe(enMadrid("2026-10-15", "00:00:00+02:00"), TURNOS)?.code).toBe("N");
    expect(turnoDe(enMadrid("2026-10-15", "07:59:00+02:00"), TURNOS)?.code).toBe("N");
  });

  it("el límite es SEMIABIERTO: las 15:00 en punto son de la tarde", () => {
    // Si fuera cerrado por los dos lados, las 15:00 caerían en dos turnos
    // y «algo» tendría que elegir — y ese algo acabaría siendo el orden de
    // la lista, o sea nada.
    expect(turnoDe(enMadrid("2026-10-14", "15:00:00+02:00"), TURNOS)?.code).toBe("T");
    expect(turnoDe(enMadrid("2026-10-14", "14:59:00+02:00"), TURNOS)?.code).toBe("M");
    expect(turnoDe(enMadrid("2026-10-14", "22:00:00+02:00"), TURNOS)?.code).toBe("N");
    expect(turnoDe(enMadrid("2026-10-14", "08:00:00+02:00"), TURNOS)?.code).toBe("M");
  });

  it("los tres cubren las 1.440 minutos del día SIN HUECO Y SIN SOLAPE", () => {
    // El barrido entero. Es lo que hace que «ahora» nunca salga `null` en
    // un centro que no ha tocado sus turnos, y también lo que haría ver un
    // solape si alguien cambiara una hora en la semilla.
    for (let m = 0; m < 1440; m++) {
      const dentro = TURNOS.filter((t) => minutosEnTurno(m, t));
      expect(dentro).toHaveLength(1);
    }
  });

  // ── EL CAMBIO DE HORA ─────────────────────────────────────────────
  //
  // En 2026: el 29 de marzo a las 02:00 el reloj salta a las 03:00 (se
  // pierde una hora) y el 25 de octubre a las 03:00 vuelve a las 02:00 (se
  // repite). Lo que se prueba es que **la hora de pared manda**: los dos
  // instantes de las 02:30 del 25 de octubre —uno en +02:00 y otro en
  // +01:00— son los dos turno de noche, porque los dos son «las dos y
  // media de la madrugada» en el reloj de la sala de terapia.
  it("CAMBIO DE HORA de octubre · la hora REPETIDA cae en el mismo turno las dos veces", () => {
    const primera = new Date("2026-10-25T02:30:00+02:00");
    const segunda = new Date("2026-10-25T02:30:00+01:00");
    // Son dos instantes distintos de verdad: una hora de diferencia.
    expect(segunda.getTime() - primera.getTime()).toBe(3_600_000);
    expect(turnoDe(primera, TURNOS)?.code).toBe("N");
    expect(turnoDe(segunda, TURNOS)?.code).toBe("N");
  });

  it("CAMBIO DE HORA de marzo · la hora que NO EXISTE no deja ningún registro sin turno", () => {
    // A las 02:00 del 29-03-2026 el reloj salta a las 03:00. Los instantes
    // de alrededor siguen cayendo donde tienen que caer, y ninguno queda
    // sin turno.
    expect(turnoDe(new Date("2026-03-29T01:59:00+01:00"), TURNOS)?.code).toBe("N");
    expect(turnoDe(new Date("2026-03-29T03:00:00+02:00"), TURNOS)?.code).toBe("N");
    expect(turnoDe(new Date("2026-03-29T08:30:00+02:00"), TURNOS)?.code).toBe("M");
  });

  it("el MISMO instante UTC cae en turnos distintos según la estación, y es correcto", () => {
    // 06:30 UTC es 08:30 de pared en verano (mañana) y 07:30 en invierno
    // (noche). Comparar el instante UTC en vez de la hora de pared habría
    // dado el mismo turno a los dos, y durante medio año el turno de
    // mañana habría empezado a las nueve.
    expect(turnoDe(new Date("2026-07-14T06:30:00Z"), TURNOS)?.code).toBe("M");
    expect(turnoDe(new Date("2026-01-14T06:30:00Z"), TURNOS)?.code).toBe("N");
  });

  it("un centro con un HUECO en el cuadrante devuelve `null`, no «el primero»", () => {
    // `null` y no un turno aproximado: adscribir un cuidado a un turno
    // equivocado es peor que decir que no se sabe. Quien llama decide.
    const soloManana: TurnoDelCentro[] = [TURNOS[0]!];
    expect(turnoDe(enMadrid("2026-10-14", "20:00:00+02:00"), soloManana)).toBeNull();
    expect(turnoDe(enMadrid("2026-10-14", "09:00:00+02:00"), soloManana)?.code).toBe("M");
  });

  it("un centro SIN turnos devuelve `null` y no revienta", () => {
    expect(turnoDe(new Date(), [])).toBeNull();
  });

  it("un turno PARTIDO de noche (22-02 y 02-08) también funciona", () => {
    // La configuración que un centro puede inventar y que no conocemos
    // todavía: dos rondas de noche. La función no lo prohíbe.
    const partidos: TurnoDelCentro[] = [
      { id: "a", code: "N1", name: "Noche 1", startsAt: "22:00", endsAt: "02:00" },
      { id: "b", code: "N2", name: "Noche 2", startsAt: "02:00", endsAt: "08:00" },
    ];
    expect(turnoDe(enMadrid("2026-10-14", "23:00:00+02:00"), partidos)?.code).toBe("N1");
    expect(turnoDe(enMadrid("2026-10-15", "01:00:00+02:00"), partidos)?.code).toBe("N1");
    expect(turnoDe(enMadrid("2026-10-15", "03:00:00+02:00"), partidos)?.code).toBe("N2");
  });
});
