// Tests de los helpers de zona horaria (B-koibox-4). B4 es el dueño de la
// tz: compone fecha(local) + hora de pared en Europe/Madrid → instante UTC.

import { describe, expect, it } from "vitest";

import {
  gridStarts,
  minutesToTime,
  timeToMinutes,
  utcToWallDate,
  utcToWallTime,
  wallTimeToUtc,
} from "../src/agenda/time.js";

describe("wallTimeToUtc (Europe/Madrid)", () => {
  it("en verano (CEST, UTC+2) 09:00 local → 07:00Z", () => {
    expect(wallTimeToUtc("2026-08-10", "09:00").toISOString()).toBe(
      "2026-08-10T07:00:00.000Z",
    );
  });

  it("en invierno (CET, UTC+1) 09:00 local → 08:00Z", () => {
    expect(wallTimeToUtc("2026-01-15", "09:00").toISOString()).toBe(
      "2026-01-15T08:00:00.000Z",
    );
  });

  it("ida y vuelta: UTC → pared → coincide", () => {
    const utc = wallTimeToUtc("2026-08-10", "13:30");
    expect(utcToWallDate(utc)).toBe("2026-08-10");
    expect(utcToWallTime(utc)).toBe("13:30");
  });
});

describe("rejilla de 15 min", () => {
  it("alinea a la rejilla y deja caber el span", () => {
    // 09:00–10:00 (540..600), span 30 → inicios 540,555,570 (600 no cabe).
    expect(gridStarts(540, 600, 30)).toEqual([540, 555, 570]);
  });
  it("HH:MM ↔ minutos", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(minutesToTime(570)).toBe("09:30");
  });
});
