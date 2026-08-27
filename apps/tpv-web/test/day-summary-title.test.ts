import { describe, expect, it } from "vitest";

import { calendarDaysAgo, daySummaryTitle } from "../src/lib/daySummaryTitle.js";

// Hora local del negocio. Los tests se escriben con constructor local a
// propósito: es exactamente lo que ve el dispositivo del cajero.
const at = (y: number, m: number, d: number, h = 9, min = 0) =>
  new Date(y, m - 1, d, h, min);

describe("calendarDaysAgo", () => {
  it("cuenta días de calendario, no de 24 h", () => {
    // Cerrado a las 23:50, mirado a las 00:10: son horas, pero es AYER.
    expect(calendarDaysAgo(at(2026, 8, 25, 23, 50), at(2026, 8, 26, 0, 10))).toBe(1);
  });

  it("aguanta el cambio de hora de octubre (día de 25 h)", () => {
    // 25/10/2026 es el día que dura 25 h en Europe/Madrid.
    expect(calendarDaysAgo(at(2026, 10, 25, 9), at(2026, 10, 26, 9))).toBe(1);
  });

  it("aguanta el cambio de hora de marzo (día de 23 h)", () => {
    expect(calendarDaysAgo(at(2026, 3, 29, 9), at(2026, 3, 30, 9))).toBe(1);
  });
});

describe("daySummaryTitle", () => {
  it("hoy", () => {
    expect(daySummaryTitle(at(2026, 8, 26, 5).toISOString(), at(2026, 8, 26, 9))).toBe(
      "Así fue el turno de hoy",
    );
  });

  it("ayer", () => {
    expect(daySummaryTitle(at(2026, 8, 25, 22).toISOString(), at(2026, 8, 26, 9))).toBe(
      "Así fue el día de ayer",
    );
  });

  it("el sábado, cuando Sole vuelve el martes tras librar domingo y lunes", () => {
    // Este es el caso que motiva el fix: pasaba CADA semana.
    const title = daySummaryTitle(at(2026, 8, 22, 20).toISOString(), at(2026, 8, 25, 9));
    expect(title).toContain("sábado");
    expect(title).toContain("22");
    expect(title).not.toContain("ayer");
  });

  it("un turno de hace semanas dice su fecha, no 'ayer'", () => {
    // Sirope tenía turnos abiertos del 9 de julio.
    const title = daySummaryTitle(at(2026, 7, 9, 14).toISOString(), at(2026, 8, 26, 9));
    expect(title).toContain("julio");
    expect(title).toContain("2026");
    expect(title).not.toContain("ayer");
  });

  it("sin fecha o con basura no inventa un día", () => {
    expect(daySummaryTitle(null)).toBe("Así fue el último turno");
    expect(daySummaryTitle("no-es-una-fecha")).toBe("Así fue el último turno");
  });

  it("reloj del terminal atrasado: no se inventa un futuro", () => {
    expect(daySummaryTitle(at(2026, 8, 27, 9).toISOString(), at(2026, 8, 26, 9))).toBe(
      "Así fue el turno de hoy",
    );
  });
});
