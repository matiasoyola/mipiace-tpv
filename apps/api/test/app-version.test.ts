// v1.9.8 · Tests del resolutor de versión que expone /health. Puros —
// sin Fastify ni red. Manipulan process.env y lo restauran.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAppVersion } from "../src/version.js";

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
