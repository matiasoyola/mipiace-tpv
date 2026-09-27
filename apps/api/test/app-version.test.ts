// v1.9.8 · Tests del resolutor de versión que expone /health. Puros —
// sin Fastify ni red. Manipulan process.env y lo restauran.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAppVersion, getAppVersionDate } from "../src/version.js";

describe("getAppVersion (v1.9.8)", () => {
  let prevAppVersion: string | undefined;
  let prevSentryRelease: string | undefined;

  beforeEach(() => {
    prevAppVersion = process.env.APP_VERSION;
    prevSentryRelease = process.env.SENTRY_RELEASE;
    delete process.env.APP_VERSION;
    delete process.env.SENTRY_RELEASE;
  });

  afterEach(() => {
    if (prevAppVersion === undefined) delete process.env.APP_VERSION;
    else process.env.APP_VERSION = prevAppVersion;
    if (prevSentryRelease === undefined) delete process.env.SENTRY_RELEASE;
    else process.env.SENTRY_RELEASE = prevSentryRelease;
  });

  it("devuelve APP_VERSION cuando está horneada", () => {
    process.env.APP_VERSION = "a1b2c3d";
    expect(getAppVersion()).toBe("a1b2c3d");
  });

  it("cae a SENTRY_RELEASE si APP_VERSION no está", () => {
    process.env.SENTRY_RELEASE = "deadbee";
    expect(getAppVersion()).toBe("deadbee");
  });

  it("APP_VERSION tiene prioridad sobre SENTRY_RELEASE", () => {
    process.env.APP_VERSION = "aaaaaaa";
    process.env.SENTRY_RELEASE = "bbbbbbb";
    expect(getAppVersion()).toBe("aaaaaaa");
  });

  it("ignora 'latest' (tag por defecto, no identifica versión)", () => {
    process.env.APP_VERSION = "latest";
    expect(getAppVersion()).toBe("unknown");
  });

  it("ignora vacío y espacios", () => {
    process.env.APP_VERSION = "   ";
    expect(getAppVersion()).toBe("unknown");
  });

  it("sin ninguna env → 'unknown'", () => {
    expect(getAppVersion()).toBe("unknown");
  });

  it("recorta espacios alrededor del sha", () => {
    process.env.APP_VERSION = "  c0ffee1  ";
    expect(getAppVersion()).toBe("c0ffee1");
  });
});

// declaracion-responsable · la FECHA de esa versión, que es el apartado 1.l)
// de la declaración responsable del SIF.
//
// Sabotajes que esto pone en rojo (tabla del done):
//   · devolver la fecha de hoy cuando la env no está horneada
//   · aceptar una fecha con otro formato como si fuera buena
describe("getAppVersionDate (declaracion-responsable)", () => {
  let previa: string | undefined;

  beforeEach(() => {
    previa = process.env.APP_VERSION_DATE;
    delete process.env.APP_VERSION_DATE;
  });

  afterEach(() => {
    if (previa === undefined) delete process.env.APP_VERSION_DATE;
    else process.env.APP_VERSION_DATE = previa;
  });

  it("devuelve la fecha civil horneada", () => {
    process.env.APP_VERSION_DATE = "2026-09-27";
    expect(getAppVersionDate()).toBe("2026-09-27");
  });

  it("de un ISO completo se queda con la parte civil", () => {
    // Una hora en un documento legal sólo añade la pregunta de en qué huso.
    process.env.APP_VERSION_DATE = "2026-09-27T18:04:11Z";
    expect(getAppVersionDate()).toBe("2026-09-27");
  });

  it("recorta espacios", () => {
    process.env.APP_VERSION_DATE = "  2026-09-27  ";
    expect(getAppVersionDate()).toBe("2026-09-27");
  });

  it("sin la env devuelve null, NO la fecha de hoy", () => {
    // Lo importante de este test es el `null`. Una declaración responsable
    // cuya fecha cambia cada vez que alguien abre el documento no es la
    // declaración de ninguna versión.
    expect(getAppVersionDate()).toBeNull();
  });

  it("vacío, 'latest' y basura son null, no fechas inventadas", () => {
    for (const valor of ["", "   ", "latest", "ayer", "27/09/2026", "2026-9-7"]) {
      process.env.APP_VERSION_DATE = valor;
      expect(getAppVersionDate(), `«${valor}» se colaría como fecha`).toBeNull();
    }
  });
});
