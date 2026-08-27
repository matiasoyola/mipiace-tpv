// v1.11-cierre-de-dia · el corte de día, en hora LOCAL.
//
// Lo único con aristas de verdad en este bloque es la conversión: el corte
// es a las 05:00 de Europe/Madrid, y Europe/Madrid no es UTC ni un offset
// fijo. Restar 24 h a un instante para obtener "las 05:00 de ayer" se
// rompe los dos días del año en que el día dura 23 o 25 horas — y ese
// fallo cerraría un turno vivo o dejaría uno colgado otras 24 h.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_DAY_CUT_HOUR,
  lastDayCutBefore,
  normalizeDayCutHour,
  previousWallDate,
  shiftCrossedDayCut,
} from "../src/shift/day-cut.js";

describe("lastDayCutBefore · el último corte que ya pasó", () => {
  it("en verano (CEST, UTC+2) el corte de las 05:00 local es 03:00Z", () => {
    // Martes 11/08/2026 a las 09:00 local (07:00Z): el corte de HOY ya pasó.
    const now = new Date("2026-08-11T07:00:00.000Z");
    expect(lastDayCutBefore(now, 5).toISOString()).toBe("2026-08-11T03:00:00.000Z");
  });

  it("en invierno (CET, UTC+1) el mismo corte es 04:00Z", () => {
    const now = new Date("2026-01-15T08:00:00.000Z");
    expect(lastDayCutBefore(now, 5).toISOString()).toBe("2026-01-15T04:00:00.000Z");
  });

  it("antes del corte de hoy, el último corte es el de AYER", () => {
    // 11/08/2026 a las 04:30 local (02:30Z) — todavía no son las 05:00.
    const now = new Date("2026-08-11T02:30:00.000Z");
    expect(lastDayCutBefore(now, 5).toISOString()).toBe("2026-08-10T03:00:00.000Z");
  });

  it("justo EN el corte cuenta como pasado (comparación <=)", () => {
    const now = new Date("2026-08-11T03:00:00.000Z");
    expect(lastDayCutBefore(now, 5).toISOString()).toBe("2026-08-11T03:00:00.000Z");
  });

  it("cruce a CEST (29/03/2026, el día de 23 h): el corte de ayer sigue siendo 05:00 local", () => {
    // El domingo 29/03/2026 los relojes van de las 02:00 a las 03:00. Las
    // 05:00 del domingo son 03:00Z (CEST); las del sábado, 04:00Z (CET).
    // Restar 24 h al corte del domingo daría 03:00Z del sábado = 04:00
    // local: una hora antes de tiempo.
    const domingoManana = new Date("2026-03-29T08:00:00.000Z"); // 10:00 local
    expect(lastDayCutBefore(domingoManana, 5).toISOString()).toBe(
      "2026-03-29T03:00:00.000Z",
    );
    const domingoMadrugada = new Date("2026-03-29T02:30:00.000Z"); // 03:30 local
    expect(lastDayCutBefore(domingoMadrugada, 5).toISOString()).toBe(
      "2026-03-28T04:00:00.000Z",
    );
  });

  it("cruce a CET (25/10/2026, el día de 25 h)", () => {
    // Domingo 25/10/2026: los relojes van de las 03:00 a las 02:00. Las
    // 05:00 del domingo son 04:00Z (CET); las del sábado, 03:00Z (CEST).
    const domingoManana = new Date("2026-10-25T09:00:00.000Z"); // 10:00 local
    expect(lastDayCutBefore(domingoManana, 5).toISOString()).toBe(
      "2026-10-25T04:00:00.000Z",
    );
    const domingoMadrugada = new Date("2026-10-25T02:00:00.000Z"); // 03:00 local (CEST aún)
    expect(lastDayCutBefore(domingoMadrugada, 5).toISOString()).toBe(
      "2026-10-24T03:00:00.000Z",
    );
  });

  it("corte a medianoche (dayCutHour 0)", () => {
    const now = new Date("2026-08-11T07:00:00.000Z"); // 09:00 local
    expect(lastDayCutBefore(now, 0).toISOString()).toBe("2026-08-10T22:00:00.000Z");
  });
});

describe("shiftCrossedDayCut · a quién cierra el job", () => {
  const now = new Date("2026-08-11T03:05:00.000Z"); // 05:05 local, recién pasado el corte

  it("el turno de AYER por la mañana ha cruzado el corte", () => {
    const shift = { openedAt: new Date("2026-08-10T07:00:00.000Z") };
    expect(shiftCrossedDayCut(shift, now, 5)).toBe(true);
  });

  it("un turno abierto DESPUÉS del corte de hoy no se toca", () => {
    const shift = { openedAt: new Date("2026-08-11T03:30:00.000Z") };
    expect(shiftCrossedDayCut(shift, now, 5)).toBe(false);
  });

  it("un turno de madrugada abierto ANTES del corte sí cruza", () => {
    // Bar que abrió turno a las 23:00 y cerró la barra a las 04:00: a las
    // 05:00 su turno se cierra. Ése es justo el motivo de que el default
    // sean las 05:00 y no medianoche.
    const shift = { openedAt: new Date("2026-08-10T21:00:00.000Z") };
    expect(shiftCrossedDayCut(shift, now, 5)).toBe(true);
  });

  it("el turno colgado de 288 h de vacaciones cruza igual", () => {
    const shift = { openedAt: new Date("2026-07-30T07:00:00.000Z") };
    expect(shiftCrossedDayCut(shift, now, 5)).toBe(true);
  });

  it("con corte a las 05:00, a las 04:30 local el turno de ayer TODAVÍA no cruza", () => {
    // El cajero de noche sigue trabajando: no le cerramos la caja debajo.
    const madrugada = new Date("2026-08-11T02:30:00.000Z");
    const shift = { openedAt: new Date("2026-08-10T07:00:00.000Z") };
    // Abrió ayer a las 09:00 local, que es DESPUÉS del corte de ayer.
    expect(shiftCrossedDayCut(shift, madrugada, 5)).toBe(false);
  });
});

describe("helpers", () => {
  it("previousWallDate cruza mes y año", () => {
    expect(previousWallDate("2026-03-01")).toBe("2026-02-28");
    expect(previousWallDate("2026-01-01")).toBe("2025-12-31");
    expect(previousWallDate("2024-03-01")).toBe("2024-02-29"); // bisiesto
  });

  it("normalizeDayCutHour rechaza basura y cae al default", () => {
    expect(normalizeDayCutHour(0)).toBe(0);
    expect(normalizeDayCutHour(23)).toBe(23);
    expect(normalizeDayCutHour(24)).toBe(DEFAULT_DAY_CUT_HOUR);
    expect(normalizeDayCutHour(-1)).toBe(DEFAULT_DAY_CUT_HOUR);
    expect(normalizeDayCutHour(null)).toBe(DEFAULT_DAY_CUT_HOUR);
    expect(normalizeDayCutHour("5")).toBe(DEFAULT_DAY_CUT_HOUR);
  });
});
