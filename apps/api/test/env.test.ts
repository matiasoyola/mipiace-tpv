// Tests del schema Zod de env vars. Cubren los hotfixes 2026-05-18:
//   - SMTP_PORT="" no rompe el arranque (Docker Compose lo pasa así
//     cuando la var no está definida en el .env.production).
//   - HOST default = "127.0.0.1" para no exponer el API en LAN en dev.
//     En producción se setea HOST=0.0.0.0 desde docker-compose.prod.yml.

import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { EnvSchema } from "../src/env.js";

// Vars mínimas requeridas (todas las que no tienen default y son required).
function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    REDIS_URL: "redis://localhost:6379",
    JWT_ACCESS_SECRET: "a".repeat(40),
    JWT_REFRESH_SECRET: "b".repeat(40),
    HOLDED_KEY_ENCRYPTION_SECRET: randomBytes(32).toString("base64"),
    ...overrides,
  };
}

describe("EnvSchema · hotfixes post-deploy 2026-05-18", () => {
  it("SMTP_PORT vacío se normaliza a undefined (no rompe el arranque)", () => {
    const parsed = EnvSchema.parse(baseEnv({ SMTP_PORT: "" }));
    expect(parsed.SMTP_PORT).toBeUndefined();
  });

  it("SMTP_PORT undefined queda undefined", () => {
    const parsed = EnvSchema.parse(baseEnv());
    expect(parsed.SMTP_PORT).toBeUndefined();
  });

  it("SMTP_PORT con valor numérico se coercia a number", () => {
    const parsed = EnvSchema.parse(baseEnv({ SMTP_PORT: "587" }));
    expect(parsed.SMTP_PORT).toBe(587);
  });

  it("SMTP_PORT='0' sigue rechazado (no positivo)", () => {
    expect(() => EnvSchema.parse(baseEnv({ SMTP_PORT: "0" }))).toThrow();
  });

  it("HOST default es 127.0.0.1 (loopback) cuando no se setea", () => {
    const parsed = EnvSchema.parse(baseEnv());
    expect(parsed.HOST).toBe("127.0.0.1");
  });

  it("HOST=0.0.0.0 se respeta (producción Docker)", () => {
    const parsed = EnvSchema.parse(baseEnv({ HOST: "0.0.0.0" }));
    expect(parsed.HOST).toBe("0.0.0.0");
  });
});
