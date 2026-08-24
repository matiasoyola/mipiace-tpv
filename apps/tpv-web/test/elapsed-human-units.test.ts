// Duración de mesa en unidades humanas (v1.10.3-barra · hallazgo #5).
//
// T1 llevaba 1037 h abierta y la tarjeta pintaba "1013 h 28 m": ocupaba
// la línea entera, empujaba el importe a dos líneas y truncaba el alias
// del cajero a "m..". A partir de un día, la unidad es el día.

import { describe, expect, it } from "vitest";

import { formatElapsed } from "../src/hooks/useElapsedTime.js";

const MIN = 60_000;
const H = 60 * MIN;

describe("formatElapsed", () => {
  it("por debajo del minuto dice 'ahora'", () => {
    expect(formatElapsed(0)).toBe("ahora");
    expect(formatElapsed(59_000)).toBe("ahora");
  });

  it("minutos sueltos durante la primera hora", () => {
    expect(formatElapsed(1 * MIN)).toBe("1 min");
    expect(formatElapsed(45 * MIN)).toBe("45 min");
    expect(formatElapsed(59 * MIN)).toBe("59 min");
  });

  it("horas y minutos dentro del mismo día de servicio", () => {
    expect(formatElapsed(1 * H)).toBe("1 h 00 m");
    expect(formatElapsed(3 * H + 20 * MIN)).toBe("3 h 20 m");
    expect(formatElapsed(23 * H + 59 * MIN)).toBe("23 h 59 m");
  });

  it("a partir de las 24 h cuenta días, no horas de cuatro cifras", () => {
    expect(formatElapsed(24 * H)).toBe("1 día");
    expect(formatElapsed(47 * H)).toBe("1 día");
    expect(formatElapsed(48 * H)).toBe("2 días");
    // El caso real de la simulación: T1 abierta desde hacía 1037 h.
    expect(formatElapsed(1037 * H)).toBe("43 días");
    expect(formatElapsed(1013 * H + 28 * MIN)).toBe("42 días");
  });

  it("el peor caso realista cabe en 8 caracteres", () => {
    expect(formatElapsed(1037 * H).length).toBeLessThanOrEqual(8);
    expect(formatElapsed(999 * 24 * H).length).toBeLessThanOrEqual(8);
  });
});
