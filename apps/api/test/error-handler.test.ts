// Tests del manejador de errores global (v1.5-consistencia-A §4.a).

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  HoldedApiError,
  HoldedSilentRejectError,
  HoldedSubscriptionSuspendedError,
} from "@mipiacetpv/holded-client";
import { Prisma } from "@mipiacetpv/db";

import { registerErrorHandler } from "../src/lib/error-handler.js";

async function buildApp() {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);

  app.post(
    "/with-schema",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
      },
    },
    async () => ({ ok: true }),
  );
  app.post("/with-zod", async (request) => {
    z.object({ amount: z.number().positive() }).parse(request.body);
    return { ok: true };
  });
  app.get("/holded-down", async () => {
    throw new HoldedApiError(503, "/api/invoicing/v1/salesreceipts", "boom");
  });
  app.get("/holded-rate-limit", async () => {
    throw new HoldedApiError(429, "/api/invoicing/v1/salesreceipts", "slow down");
  });
  app.get("/holded-suspended", async () => {
    throw new HoldedSubscriptionSuspendedError("/api/x", {});
  });
  app.get("/holded-silent", async () => {
    throw new HoldedSilentRejectError("POST pay", "/api/x", [
      { field: "paymentsPending", expected: 0, actual: 2.75 },
    ]);
  });
  app.get("/boom", async () => {
    throw new Error("detalle interno secreto con stack");
  });
  // Frente carrera-409 · el deadlock de dos altas simultáneas, con la forma
  // EXACTA con la que llega: `P2010` por fuera («raw query failed», que vale
  // para cualquier cosa) y el SQLSTATE sólo en `meta.code`.
  app.get("/deadlock", async () => {
    throw new Prisma.PrismaClientKnownRequestError(
      "Invalid `prisma.$executeRawUnsafe()` invocation:\n\nRaw query failed. " +
        "Code: `40P01`. Message: `ERROR: deadlock detected`",
      {
        code: "P2010",
        clientVersion: "test",
        meta: { code: "40P01", message: "ERROR: deadlock detected" },
      },
    );
  });
  app.get("/prisma-unique", async () => {
    throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["email"] },
    });
  });
  return app;
}

describe("registerErrorHandler", () => {
  it("error de validación de schema Fastify → 400 con detalle", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/with-schema", payload: {} });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(body.message).toMatch(/no son válidos/);
    expect(body.details.length).toBeGreaterThan(0);
  });

  it("ZodError → 400 con detalle por campo", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/with-zod",
      payload: { amount: -5 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(body.details[0].path).toBe("amount");
  });

  it("HoldedApiError genérico → 502 HOLDED_UNAVAILABLE", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/holded-down" });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("HOLDED_UNAVAILABLE");
  });

  it("HoldedApiError 429 → 502 HOLDED_RATE_LIMITED", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/holded-rate-limit" });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("HOLDED_RATE_LIMITED");
  });

  it("suscripción suspendida → 502 HOLDED_SUBSCRIPTION_SUSPENDED con mensaje en español", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/holded-suspended" });
    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error).toBe("HOLDED_SUBSCRIPTION_SUSPENDED");
    expect(body.message).toMatch(/impago/);
  });

  it("silent reject → 502 HOLDED_SYNC_ERROR", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/holded-silent" });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("HOLDED_SYNC_ERROR");
  });

  it("error genérico → 500 con requestId, sin stack ni mensaje interno", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe("INTERNAL_ERROR");
    expect(body.requestId).toBeTruthy();
    expect(res.body).not.toContain("detalle interno secreto");
    expect(res.body).not.toContain("at "); // nada de stack frames
  });

  // ── Frente carrera-409 · que el 500 traiga su SQLSTATE ────────────────
  //
  // Por qué esto es un test y no una línea de log más: el done de B-7a pudo
  // escribir «sale por el manejador genérico» y NO pudo decir cuál era el
  // error, porque `prismaCode: "P2010"` significa «una raw query falló» y
  // vale igual para un deadlock, una clave ajena o una columna que no
  // existe. Averiguarlo costó una sonda entera. Que no vuelva a costar.

  it("un error de raw query trae el SQLSTATE, no sólo el código de Prisma", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/deadlock" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe("DB_ERROR");
    expect(body.prismaCode).toBe("P2010");
    // LO QUE FALTABA: el código de Postgres, que es el que dice algo.
    expect(body.sqlState).toBe("40P01");
    expect(body.requestId).toBeTruthy();
  });

  it("un error de Prisma sin SQLSTATE no se inventa uno", async () => {
    // `P2002` es un código de PRISMA y tiene la misma forma que un
    // SQLSTATE. Colarlo como tal sería peor que no ponerlo.
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/prisma-unique" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.prismaCode).toBe("P2002");
    expect(body.sqlState).toBeUndefined();
  });
});
