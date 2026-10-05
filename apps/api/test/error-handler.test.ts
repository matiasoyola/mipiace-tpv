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
  // clinica-1 · las tres formas EXACTAS con las que llega una negativa de
  // la historia clínica. Dos triggers y un RESTRICT, y los tres por `P2010`
  // («raw query failed») o `P2003`, que es la razón por la que hasta este
  // bloque salían como «Error de base de datos» y nadie entendía nada.
  app.delete("/clinica-borrar-entrada", async () => {
    throw new Prisma.PrismaClientKnownRequestError(
      "Invalid `prisma.$executeRawUnsafe()` invocation:\n\nRaw query failed. " +
        "Code: `23514`. Message: `ERROR: HISTORIA_VIOLADA: la historia clínica " +
        "no se borra (clinical_entries.1f0c...). Se conserva y se le añaden anotaciones.`",
      {
        code: "P2010",
        clientVersion: "test",
        meta: { code: "23514", message: "HISTORIA_VIOLADA" },
      },
    );
  });
  app.patch("/clinica-editar-entrada", async () => {
    throw new Prisma.PrismaClientKnownRequestError(
      "Raw query failed. Code: `23514`. Message: `ERROR: HISTORIA_VIOLADA: la " +
        "historia clínica no se edita (clinical_entries.1f0c...). Lo escrito queda.`",
      {
        code: "P2010",
        clientVersion: "test",
        meta: { code: "23514", message: "HISTORIA_VIOLADA" },
      },
    );
  });
  app.delete("/clinica-borrar-paciente", async () => {
    throw new Prisma.PrismaClientKnownRequestError(
      "Foreign key constraint failed on the field: " +
        "`clinical_entries_client_id_fkey`",
      {
        code: "P2003",
        clientVersion: "test",
        meta: { code: "23503", field_name: "clinical_entries_client_id_fkey" },
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

// ── clinica-1 · la negativa de la historia se explica ────────────────
//
// Lo que se fija: que el motor diciendo NO no sale como un 500 «Error de
// base de datos (P2010)». Hoy no hay ninguna ruta que borre un cliente ni
// un tenant, así que esto no se dispara desde ninguna pantalla — está
// para el día que alguien escriba `DELETE /clients/:id`, que lo escribirá
// porque el RGPD tiene un derecho de supresión.
describe("clinica-1 · lo clínico no se borra, y la negativa se explica", () => {
  it("borrar una entrada → 409 que dice cómo se corrige", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/clinica-borrar-entrada",
    });
    // 409 y no 500: no es una avería, es el sistema funcionando.
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CLINICAL_RECORD_PROTECTED");
    expect(res.json().message).toContain("no se borra");
    expect(res.json().message).toContain("revoca el acceso");
  });

  it("editar una entrada → 409 que manda a la anotación", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/clinica-editar-entrada",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain("añade una anotación");
  });

  it("borrar al paciente con historia → 409 por el RESTRICT", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/clinica-borrar-paciente",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CLINICAL_RECORD_PROTECTED");
    expect(res.json().message).toContain("cinco años");
  });

  it("y NO se reenvía el mensaje de Postgres al cliente", async () => {
    // Esos mensajes llevan ids de fila y nombres de tabla: son para el
    // log, no para una pantalla.
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/clinica-borrar-entrada",
    });
    const cuerpo = JSON.stringify(res.json());
    expect(cuerpo).not.toContain("HISTORIA_VIOLADA");
    expect(cuerpo).not.toContain("clinical_entries");
    expect(cuerpo).not.toContain("23514");
  });

  it("un error de BD que NO es clínico sigue saliendo como antes", async () => {
    // El sabotaje de este mapeo: si la detección fuera demasiado ancha,
    // se comería los 500 de verdad y nadie los vería.
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/prisma-unique" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("DB_ERROR");
  });
});
