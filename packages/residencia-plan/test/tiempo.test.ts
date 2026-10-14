// residencia-2 · la hora de pared de este paquete, y el ACUERDO con la
// de la agenda.
//
// `tiempo.ts` es una copia declarada de `apps/api/src/agenda/time.ts` (ver
// su cabecera: un paquete no puede importar de una app, y mover las
// primitivas aquí invertiría la propiedad del huso del motor de citas).
// Una copia sin test es una copia que se separa, así que esto fija los
// valores en los DOS días del cambio de hora de 2026 — que son el único
// sitio donde dos implementaciones de esto pueden discrepar.

import { describe, expect, it } from "vitest";

import {
  addDays,
  daysBetween,
  isoWeekday,
  minutesToTime,
  timeToMinutes,
  utcToWallDate,
  utcToWallTime,
  wallTimeToUtc,
} from "../src/tiempo.js";

describe("hora de pared · ida y vuelta", () => {
  it("una hora de verano (CEST, UTC+2) va y vuelve", () => {
    const i = wallTimeToUtc("2026-07-15", "09:00");
    expect(i.toISOString()).toBe("2026-07-15T07:00:00.000Z");
    expect(utcToWallTime(i)).toBe("09:00");
    expect(utcToWallDate(i)).toBe("2026-07-15");
  });

  it("una hora de invierno (CET, UTC+1) va y vuelve", () => {
    const i = wallTimeToUtc("2026-12-15", "09:00");
    expect(i.toISOString()).toBe("2026-12-15T08:00:00.000Z");
    expect(utcToWallTime(i)).toBe("09:00");
  });

  it("MEDIANOCHE sale «00:00» y no «24:00»", () => {
    // El formateador de `en-US` con `hour12: false` contesta «24» a la
    // medianoche, y sin el arreglo del `map.hour === "24"` toda la
    // aritmética de minutos del turno de noche se iría 1.440 minutos.
    expect(utcToWallTime(wallTimeToUtc("2026-07-15", "00:00"))).toBe("00:00");
  });
});

describe("los dos cambios de hora de 2026", () => {
  // 29-03-2026: el reloj salta de 01:59 a 03:00. Las 02:30 NO EXISTEN.
  it("la hora que NO EXISTE resuelve a un instante real, no a Invalid Date", () => {
    const i = wallTimeToUtc("2026-03-29", "02:30");
    expect(Number.isNaN(i.getTime())).toBe(false);
    // 02:30 de pared no existe; el instante que sale es 01:30Z, que de
    // pared son las 03:30. Lo que importa para el plan es que el cambio
    // postural de esa madrugada SE PIDE, no que desaparezca.
    expect(i.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  // 25-10-2026: el reloj repite de 02:59 a 02:00. Las 02:30 pasan DOS veces.
  it("la hora REPETIDA resuelve a la SEGUNDA pasada, y siempre a la misma", () => {
    const i = wallTimeToUtc("2026-10-25", "02:30");
    // Las dos pasadas son 00:30Z (aún UTC+2) y 01:30Z (ya UTC+1). Sale la
    // segunda, porque la conjetura (02:30Z) cae después del cambio y su
    // offset ya es +1. Lo que importa no es cuál de las dos: es que sea
    // SIEMPRE la misma, porque de eso depende que `queToca` devuelva lo
    // mismo en dos llamadas seguidas.
    expect(i.toISOString()).toBe("2026-10-25T01:30:00.000Z");
    expect(utcToWallTime(i)).toBe("02:30");
  });

  it("los DOS instantes de «las 02:30» del 25-10 son los dos «02:30» de pared", () => {
    const primera = new Date("2026-10-25T00:30:00.000Z");
    const segunda = new Date("2026-10-25T01:30:00.000Z");
    expect(segunda.getTime() - primera.getTime()).toBe(3_600_000);
    expect(utcToWallTime(primera)).toBe("02:30");
    expect(utcToWallTime(segunda)).toBe("02:30");
  });
});

describe("aritmética de CALENDARIO y no de milisegundos", () => {
  it("sumar un día al 25-10-2026 da el 26, no las 23:00 del 25", () => {
    // Ese día tiene 25 horas. Sumar 86.400.000 ms al instante de la
    // medianoche daría las 23:00 del mismo día, y el barrido de `queToca`
    // repetiría un día y se saltaría otro.
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
  });

  it("cruza mes, año y el 29 de febrero", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("los días entre dos fechas no cuentan la hora perdida ni la ganada", () => {
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-26", "2026-10-24")).toBe(-2);
  });

  it("el día de la semana es ISO: lunes 1, domingo 7", () => {
    expect(isoWeekday("2026-10-12")).toBe(1); // lunes
    expect(isoWeekday("2026-10-18")).toBe(7); // domingo
  });
});

describe("minutos", () => {
  it("van y vuelven", () => {
    expect(timeToMinutes("08:00")).toBe(480);
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("23:59")).toBe(1439);
    expect(minutesToTime(480)).toBe("08:00");
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(1439)).toBe("23:59");
  });
});
