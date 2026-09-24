import { describe, expect, it } from "vitest";

import {
  fechaAeatDeIso,
  fechaCivilLocal,
  fechaHoraHusoAeat,
  formatNumSerieFactura,
  importeAeat,
  instanteDeFechaHoraHuso,
  isoDeFechaAeat,
} from "../src/formato.js";

describe("importeAeat", () => {
  it("siempre dos decimales, punto y sin separador de miles", () => {
    expect(importeAeat(123.45)).toBe("123.45");
    expect(importeAeat(123.4)).toBe("123.40");
    expect(importeAeat(123)).toBe("123.00");
    expect(importeAeat(1234567.8)).toBe("1234567.80");
  });

  it("redondea a dos decimales antes de formatear", () => {
    expect(importeAeat(12.345)).toBe("12.35");
    expect(importeAeat(12.344)).toBe("12.34");
  });

  it("no deja salir un -0.00", () => {
    // `(-0).toFixed(2)` es "-0.00", y un importe total de menos cero en un
    // registro de facturación es una pregunta que nadie quiere contestar.
    expect(importeAeat(-0)).toBe("0.00");
    expect(importeAeat(-0.001)).toBe("0.00");
  });

  it("revienta con un valor que no es un número", () => {
    expect(() => importeAeat(Number.NaN)).toThrow(RangeError);
    expect(() => importeAeat(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("las fechas", () => {
  it("fechaCivilLocal usa los componentes LOCALES, no los de UTC", () => {
    // 1 de enero a las 00:30 en Madrid (UTC+1) es el 31 de diciembre en
    // UTC. La fecha de expedición es la del calendario de quien expide.
    const d = new Date("2026-01-01T00:30:00+01:00");
    const esperado = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(fechaCivilLocal(d)).toBe(esperado);
  });

  it("fechaAeatDeIso e isoDeFechaAeat son inversas y no tocan zonas horarias", () => {
    expect(fechaAeatDeIso("2024-01-01")).toBe("01-01-2024");
    expect(isoDeFechaAeat("01-01-2024")).toBe("2024-01-01");
    expect(isoDeFechaAeat(fechaAeatDeIso("2026-12-31"))).toBe("2026-12-31");
  });

  it("rechazan un formato que no es el suyo", () => {
    expect(() => fechaAeatDeIso("01-01-2024")).toThrow(RangeError);
    expect(() => isoDeFechaAeat("2024-01-01")).toThrow(RangeError);
  });
});

describe("fechaHoraHusoAeat", () => {
  it("sale con el formato del anexo, al segundo y con huso", () => {
    const value = fechaHoraHusoAeat(new Date());
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it("no lleva milisegundos", () => {
    const value = fechaHoraHusoAeat(new Date("2024-01-01T19:20:30.456Z"));
    expect(value).not.toContain(".");
  });

  it("el instante que codifica es el mismo que se le pasó", () => {
    const d = new Date("2024-06-15T10:11:12.000Z");
    expect(instanteDeFechaHoraHuso(fechaHoraHusoAeat(d)).getTime()).toBe(
      d.getTime(),
    );
  });

  it("revienta con una fecha inválida", () => {
    expect(() => fechaHoraHusoAeat(new Date("no es una fecha"))).toThrow(
      RangeError,
    );
  });
});

describe("instanteDeFechaHoraHuso", () => {
  it("lee el ejemplo del anexo", () => {
    expect(
      instanteDeFechaHoraHuso("2024-01-01T19:20:30+01:00").toISOString(),
    ).toBe("2024-01-01T18:20:30.000Z");
  });

  it("rechaza lo que no tiene el formato exacto", () => {
    expect(() => instanteDeFechaHoraHuso("2024-01-01 19:20:30")).toThrow(
      RangeError,
    );
    expect(() => instanteDeFechaHoraHuso("2024-01-01T19:20:30.123+01:00")).toThrow(
      RangeError,
    );
  });
});

describe("formatNumSerieFactura", () => {
  it("compone serie y número con seis dígitos", () => {
    expect(formatNumSerieFactura("C1", 1)).toBe("C1/000001");
    expect(formatNumSerieFactura("C1", 123)).toBe("C1/000123");
  });

  it("no trunca cuando el número pasa de seis dígitos", () => {
    // Un millón de facturas en una caja es improbable, pero truncar el
    // número rompería la correlatividad en silencio.
    expect(formatNumSerieFactura("C1", 1234567)).toBe("C1/1234567");
  });

  it("rechaza serie vacía y números que no son correlativos válidos", () => {
    expect(() => formatNumSerieFactura("  ", 1)).toThrow(RangeError);
    expect(() => formatNumSerieFactura("C1", 0)).toThrow(RangeError);
    expect(() => formatNumSerieFactura("C1", -1)).toThrow(RangeError);
    expect(() => formatNumSerieFactura("C1", 1.5)).toThrow(RangeError);
  });
});
