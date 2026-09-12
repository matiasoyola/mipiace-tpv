// B-reservas-7a · LAS CITAS YA DADAS NO SE MUEVEN.
//
// Poner un día especial, una ausencia o un horario más corto, o cambiar la
// retícula, NO cancela ni mueve ninguna cita. La API devuelve las que
// quedarían fuera y el front las enseña ANTES de confirmar:
//
//   «Ese día hay 3 citas: 10:00 Cristina, 11:30 Manoli… Se quedan como
//    están, avísalas.»
//   «Hay 4 citas a y cuarto. Se quedan como están.»
//
// Una cita fuera de la retícula sigue siendo válida y cobrable; sólo al
// MOVERLA se le exige un inicio en la retícula nueva (eso lo prueba
// `agenda-reticula.test.ts`).
//
// Aquí se prueba la DECISIÓN, que es pura. El SQL que la alimenta y la cota
// del barrido se ejercen en el e2e.

import { describe, expect, it } from "vitest";

import { resolveCenterSchedule } from "../src/agenda/center-hours.js";
import {
  appointmentsOutside,
  IMPACT_DAYS,
  validateWeek,
  type LiveAppointment,
} from "../src/agenda/hours.js";

const MARTES = "2026-09-08";

function cita(
  wallTime: string,
  clientName: string | null = null,
  date = MARTES,
): LiveAppointment {
  return { id: `c-${date}-${wallTime}`, date, wallTime, clientName };
}

const semana = () =>
  [2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    openTime: "09:00",
    closeTime: "20:00",
    validFrom: "2026-01-01",
    validUntil: null,
  }));

const horario = (
  week = semana(),
  days: Parameters<typeof resolveCenterSchedule>[1] = [],
  from = MARTES,
  to = MARTES,
) => resolveCenterSchedule(week, days, from, to);

describe("qué citas quedarían fuera", () => {
  it("un festivo deja fuera TODAS las del día, y dice por qué", () => {
    const festivo = horario(semana(), [
      {
        date: MARTES,
        closed: true,
        name: "Virgen del Prado",
        openTime: null,
        closeTime: null,
      },
    ]);
    const fuera = appointmentsOutside(
      [cita("10:00", "Cristina"), cita("11:30", "Manoli")],
      festivo,
      null,
    );
    expect(fuera).toHaveLength(2);
    expect(fuera.map((f) => f.reason)).toEqual(["CLOSED", "CLOSED"]);
    expect(fuera[0]!.clientName).toBe("Cristina");
  });

  it("un horario más corto deja fuera sólo las de después", () => {
    const corto = horario([
      {
        weekday: 2,
        openTime: "09:00",
        closeTime: "14:00",
        validFrom: "2026-01-01",
        validUntil: null,
      },
    ]);
    const fuera = appointmentsOutside(
      [cita("10:00"), cita("13:30"), cita("16:00"), cita("19:00")],
      corto,
      null,
    );
    expect(fuera.map((f) => f.wallTime)).toEqual(["16:00", "19:00"]);
    expect(fuera[0]!.reason).toBe("OUT_OF_HOURS");
  });

  it("la retícula de 30 deja fuera las de y cuarto", () => {
    const fuera = appointmentsOutside(
      [cita("10:00"), cita("10:15"), cita("11:30"), cita("11:45")],
      horario(),
      30,
    );
    expect(fuera.map((f) => f.wallTime)).toEqual(["10:15", "11:45"]);
    expect(fuera.every((f) => f.reason === "OFF_GRID")).toBe(true);
  });

  it("con retícula 15 ninguna de esas cuatro queda fuera", () => {
    expect(appointmentsOutside(
      [cita("10:00"), cita("10:15"), cita("11:30"), cita("11:45")],
      horario(),
      15,
    )).toEqual([]);
  });

  it("el día cerrado manda sobre la retícula: se dice la causa gorda", () => {
    const festivo = horario(semana(), [
      {
        date: MARTES,
        closed: true,
        name: "festivo",
        openTime: null,
        closeTime: null,
      },
    ]);
    const fuera = appointmentsOutside([cita("10:15")], festivo, 30);
    expect(fuera[0]!.reason).toBe("CLOSED");
  });

  it("un tenant SIN techo no deja fuera a nadie por horario", () => {
    // La comprobación de que este simulacro no puede asustar a un centro
    // que no ha configurado nada.
    const sinTecho = horario([], []);
    expect(appointmentsOutside([cita("22:00")], sinTecho, null)).toEqual([]);
  });

  it("pero sin techo la retícula SÍ se sigue mirando", () => {
    // Cambiar la retícula es un cambio real aunque no haya horario puesto.
    const sinTecho = horario([], []);
    expect(
      appointmentsOutside([cita("10:15")], sinTecho, 30).map((f) => f.reason),
    ).toEqual(["OFF_GRID"]);
  });

  it("una fecha fuera del rango resuelto no se juzga", () => {
    // El barrido está acotado; lo que no se miró no se afirma.
    const fuera = appointmentsOutside(
      [cita("10:00", null, "2027-01-01")],
      horario(),
      null,
    );
    expect(fuera).toEqual([]);
  });

  it("el horario partido no deja fuera lo de por la tarde", () => {
    const partido = horario([
      {
        weekday: 2,
        openTime: "10:00",
        closeTime: "14:00",
        validFrom: "2026-01-01",
        validUntil: null,
      },
      {
        weekday: 2,
        openTime: "17:00",
        closeTime: "20:30",
        validFrom: "2026-01-01",
        validUntil: null,
      },
    ]);
    const fuera = appointmentsOutside(
      [cita("11:00"), cita("15:00"), cita("18:00")],
      partido,
      null,
    );
    expect(fuera.map((f) => f.wallTime)).toEqual(["15:00"]);
  });

  it("la cota del barrido es un número dicho, no uno escondido", () => {
    expect(IMPACT_DAYS).toBe(90);
  });
});

describe("la semana tipo se valida ANTES de reemplazar nada", () => {
  it("acepta una semana normal", () => {
    expect(validateWeek(semana())).toBeNull();
  });

  it("rechaza un cierre anterior a la apertura", () => {
    expect(
      validateWeek([{ weekday: 2, openTime: "20:00", closeTime: "09:00" }]),
    ).toContain("posterior");
  });

  it("rechaza una hora mal escrita", () => {
    expect(
      validateWeek([{ weekday: 2, openTime: "9", closeTime: "20:00" }]),
    ).toContain("HH:MM");
  });

  it("rechaza dos tramos del mismo día que se pisan", () => {
    expect(
      validateWeek([
        { weekday: 2, openTime: "09:00", closeTime: "15:00" },
        { weekday: 2, openTime: "14:00", closeTime: "20:00" },
      ]),
    ).toContain("solapan");
  });

  it("dos tramos PEGADOS sí valen: es un horario partido legítimo", () => {
    expect(
      validateWeek([
        { weekday: 2, openTime: "09:00", closeTime: "14:00" },
        { weekday: 2, openTime: "14:00", closeTime: "20:00" },
      ]),
    ).toBeNull();
  });

  it("el mismo tramo en días distintos no se solapa", () => {
    expect(
      validateWeek([
        { weekday: 2, openTime: "09:00", closeTime: "20:00" },
        { weekday: 3, openTime: "09:00", closeTime: "20:00" },
      ]),
    ).toBeNull();
  });
});
