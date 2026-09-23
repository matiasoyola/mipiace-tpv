// F1 · las tres pantallas del control horario: lo que se puede probar sin
// montar el panel entero (ADR-018).
//
// Lo que este banco fija:
//
//   1. El paseo por meses no se sale del calendario ni en enero ni en
//      diciembre.
//   2. `componerLocal` —día local + "HH:MM" → instante— acierta a los dos
//      lados del cambio de hora. Es la función que convierte lo que la
//      empresa teclea en lo que se guarda: si fallara, una corrección de
//      la madrugada del 25-10 apuntaría a la hora equivocada.
//   3. Los totales se leen en reloj, no en decimales.

import { describe, expect, it } from "vitest";

import {
  componerLocal,
  duracion,
  horaLocal,
  mesLargo,
  mesVecino,
  reasonLabel,
} from "../src/pages/fichaje/lib.js";

const TZ = "Europe/Madrid";

describe("F1 · el paseo por meses", () => {
  it("avanza y retrocede", () => {
    expect(mesVecino("2026-09", 1)).toBe("2026-10");
    expect(mesVecino("2026-09", -1)).toBe("2026-08");
  });

  it("cruza el año por los dos lados", () => {
    expect(mesVecino("2026-12", 1)).toBe("2027-01");
    expect(mesVecino("2026-01", -1)).toBe("2025-12");
  });

  it("el mes se pinta con su nombre", () => {
    expect(mesLargo("2026-09")).toBe("Septiembre de 2026");
    expect(mesLargo("2026-12")).toBe("Diciembre de 2026");
  });
});

describe("F1 · lo que la empresa teclea → lo que se guarda", () => {
  it("una hora de verano (CEST, UTC+2)", () => {
    expect(componerLocal("2026-09-22", "08:00", TZ)).toBe(
      "2026-09-22T06:00:00.000Z",
    );
  });

  it("una hora de invierno (CET, UTC+1)", () => {
    expect(componerLocal("2026-12-22", "08:00", TZ)).toBe(
      "2026-12-22T07:00:00.000Z",
    );
  });

  // El caso que este bloque tiene que probar: el 25-10-2026 a las 03:00
  // CEST el reloj vuelve a las 02:00 CET.
  it("el día del cambio de hora, antes del salto", () => {
    expect(componerLocal("2026-10-25", "01:00", TZ)).toBe(
      "2026-10-24T23:00:00.000Z",
    );
  });

  it("el día del cambio de hora, después del salto", () => {
    expect(componerLocal("2026-10-25", "06:00", TZ)).toBe(
      "2026-10-25T05:00:00.000Z",
    );
  });

  it("y la vuelta: el instante se pinta en la hora de pared correcta", () => {
    const iso = componerLocal("2026-10-25", "06:00", TZ);
    expect(horaLocal(iso, TZ)).toBe("06:00");
  });

  it("la noche del cambio dura NUEVE horas medidas en instantes", () => {
    const entrada = new Date(componerLocal("2026-10-24", "22:00", TZ)).getTime();
    const salida = new Date(componerLocal("2026-10-25", "06:00", TZ)).getTime();
    expect((salida - entrada) / 3_600_000).toBe(9);
  });
});

describe("F1 · cómo se lee", () => {
  it("los totales, en reloj", () => {
    expect(duracion(570)).toBe("9h 30m");
    expect(duracion(7)).toBe("0h 07m");
  });

  it("los motivos, con la frase que ve la empresa", () => {
    expect(reasonLabel("OLVIDO")).toBe("Se le olvidó fichar");
    expect(reasonLabel("ERROR_HORA")).toBe("La hora no era ésa");
    expect(reasonLabel("OTRO")).toBe("Otro");
    // Un código que no conocemos se pinta tal cual antes que romperse.
    expect(reasonLabel("LO_QUE_SEA")).toBe("LO_QUE_SEA");
  });
});
