// F1 · cómo se leen las horas en la pantalla de fichar (ADR-018).
//
// Lo que este banco fija:
//
//   1. Un total de jornada se lee "8h 07m", nunca "8.12 h".
//   2. Los dos días que importan tienen nombre: Hoy y Ayer. Con doce filas
//      idénticas de "lun 21 · 08:00 → 17:30", encontrar la de hoy costaba
//      leerlas todas — lo enseñó el bucle visual.
//   3. La bifurcación de `main.tsx`: qué rutas son de fichar y cuáles no.
//      Si `/superadmin` cayera del lado de fichar, el super-admin vería
//      una pantalla con un botón enorme.

import { describe, expect, it } from "vitest";

import {
  diaCorto,
  diaLargo,
  duracion,
  horaLocal,
  hoyLocal,
  transcurrido,
} from "../src/fichar/lib/format.js";
import { esRutaDeFichar } from "../src/fichar/lib/ruta.js";

const TZ = "Europe/Madrid";

describe("F1 · los totales", () => {
  it("se leen en horas y minutos", () => {
    expect(duracion(487)).toBe("8h 07m");
    expect(duracion(0)).toBe("0h 00m");
    expect(duracion(60)).toBe("1h 00m");
    expect(duracion(9 * 60 + 30)).toBe("9h 30m");
  });

  it("el contador vivo cuenta desde la entrada", () => {
    const desde = "2026-09-22T06:00:00Z";
    const ahora = new Date("2026-09-22T09:14:00Z").getTime();
    expect(transcurrido(desde, ahora)).toBe("3h 14m");
  });

  it("y nunca cuenta hacia atrás", () => {
    const desde = "2026-09-22T09:00:00Z";
    const ahora = new Date("2026-09-22T08:00:00Z").getTime();
    expect(transcurrido(desde, ahora)).toBe("0h 00m");
  });
});

describe("F1 · las horas se pintan en hora local", () => {
  it("un instante UTC sale en hora de Madrid", () => {
    // 06:02Z en septiembre (CEST, UTC+2) son las 08:02.
    expect(horaLocal("2026-09-22T06:02:00Z", TZ)).toBe("08:02");
  });

  it("a los dos lados del cambio de hora del 25-10-2026", () => {
    expect(horaLocal("2026-10-25T00:30:00Z", TZ)).toBe("02:30"); // CEST
    expect(horaLocal("2026-10-25T01:30:00Z", TZ)).toBe("02:30"); // CET
  });
});

describe("F1 · los días con nombre", () => {
  const ahora = new Date("2026-09-23T10:00:00Z");

  it("hoy es Hoy y ayer es Ayer", () => {
    expect(diaCorto("2026-09-23", TZ, ahora)).toBe("Hoy");
    expect(diaCorto("2026-09-22", TZ, ahora)).toBe("Ayer");
  });

  it("el resto lleva su fecha", () => {
    expect(diaCorto("2026-09-21", TZ, ahora)).toMatch(/21/);
    expect(diaCorto("2026-09-21", TZ, ahora)).not.toBe("Ayer");
  });

  it("el día de hoy se calcula en la zona del registro, no en la del móvil", () => {
    // 23:30 UTC del día 22 ya son las 01:30 del 23 en Madrid.
    expect(hoyLocal(TZ, new Date("2026-09-22T23:30:00Z"))).toBe("2026-09-23");
  });

  it("el día largo empieza en mayúscula", () => {
    expect(diaLargo("2026-09-22", TZ)).toMatch(/^Martes/);
  });
});

describe("F1 · qué app arranca", () => {
  it("las rutas de fichar", () => {
    expect(esRutaDeFichar("/fichar")).toBe(true);
    expect(esRutaDeFichar("/fichar/")).toBe(true);
    expect(esRutaDeFichar("/fichar/lo-que-sea")).toBe(true);
  });

  it("y las que NO lo son", () => {
    for (const ruta of [
      "/",
      "/login",
      "/admin/fichaje",
      "/admin/devices",
      "/superadmin/tenants",
      // La que más importa: nada que empiece por "fichar" sin la barra.
      "/fichajes",
      "/ficharlo",
    ]) {
      expect(esRutaDeFichar(ruta)).toBe(false);
    }
  });
});
