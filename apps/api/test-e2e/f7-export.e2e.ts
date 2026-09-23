// F1 · el PDF y el CSV que se le enseñan a la Inspección (ADR-018).
//
// Lo que este banco fija:
//
//   1. Los dos formatos llevan lo que el art. 34.9 pide: empresa y NIF,
//      empleado, y por día entrada, salida y total, con el total del mes.
//   2. Las correcciones van AL FINAL, con el valor anterior, el nuevo, el
//      motivo, el autor y la fecha.
//   3. Las horas salen en hora local CON la zona indicada, y bien a los
//      dos lados del cambio de hora del 25-10-2026.
//   4. El PDF lleva hueco para la firma del trabajador y pie con la fecha
//      de generación.
//
// Contra Postgres real porque las correcciones sólo existen si el motor
// las escribe: el camino es `record_time_entry_correction`, no un INSERT.

import { randomBytes, randomUUID } from "node:crypto";
// pdf-parse expone el binario CJS sin tipos ESM: mismo `require` dinámico
// que `packages/ticket-pdf/test/ticket-pdf.test.ts`.
import { createRequire } from "node:module";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerFichajeAdminRoutes } = await import(
  "../src/fichaje/admin-routes.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");
const { localToUtc } = await import("../src/fichaje/time.js");
const { zoneLabel } = await import("../src/fichaje/export.js");

const require = createRequire(import.meta.url);
const pdfParse: (data: Uint8Array | Buffer) => Promise<{ text: string }> =
  require("pdf-parse/lib/pdf-parse.js");

describe.skipIf(!e2eEnabled)("e2e · el registro que se exporta", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let tenantId = "";
  let ownerId = "";
  let marta = "";
  let luis = "";

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerFichajeAdminRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${tenantId}'`);
    await app.close();
    await shutdown();
  });

  beforeEach(async () => {
    if (tenantId) {
      await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${tenantId}'`);
    }
    tenantId = randomUUID();
    ownerId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: `Colegio ${tenantId.slice(0, 8)}`,
        fichajeEnabled: true,
        cajaEnabled: false,
        fiscalProfile: {
          legalName: "Colegio de Talavera SL",
          taxId: "B45123456",
        },
      },
    });
    await prisma.user.create({
      data: {
        id: ownerId,
        tenantId,
        email: `owner-${ownerId.slice(0, 8)}@colegio.test`,
        role: "OWNER",
        alias: "Secretaría",
      },
    });
    marta = (
      await prisma.employee.create({
        data: { tenantId, name: "Marta Ruiz" },
        select: { id: true },
      })
    ).id;
    luis = (
      await prisma.employee.create({
        data: { tenantId, name: "Luis Bermejo" },
        select: { id: true },
      })
    ).id;
  });

  function auth() {
    return {
      authorization: `Bearer ${signAccessToken({ sub: ownerId, tid: tenantId, role: "OWNER" })}`,
    };
  }

  async function tramo(
    employeeId: string,
    dia: string,
    de: string,
    a: string | null,
  ): Promise<string> {
    const row = await prisma.timeEntry.create({
      data: {
        tenantId,
        employeeId,
        startedAt: localToUtc(dia, de),
        startedServerAt: localToUtc(dia, de),
        startSource: "MOBILE",
        ...(a
          ? {
              endedAt: localToUtc(dia, a),
              endedServerAt: localToUtc(dia, a),
              endSource: "MOBILE" as const,
            }
          : {}),
      },
      select: { id: true },
    });
    return row.id;
  }

  async function csv(month: string, employeeId?: string): Promise<string> {
    const q = new URLSearchParams({ month });
    if (employeeId) q.set("employeeId", employeeId);
    const res = await app.inject({
      method: "GET",
      url: `/admin/fichaje/export.csv?${q}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    return res.body;
  }

  // ── contenido ────────────────────────────────────────────────────────

  it("el CSV lleva empresa, NIF, mes, zona y el registro por empleado", async () => {
    await tramo(marta, "2026-09-01", "08:00", "15:00");
    await tramo(luis, "2026-09-01", "09:00", "13:00");
    const body = await csv("2026-09");

    expect(body).toMatch(/^﻿/); // BOM: lo abre Excel en español
    expect(body).toContain("Colegio de Talavera SL");
    expect(body).toContain("B45123456");
    expect(body).toContain("Septiembre de 2026");
    expect(body).toContain("Europe/Madrid");
    expect(body).toContain("Marta Ruiz");
    expect(body).toContain("Luis Bermejo");
    expect(body).toContain("08:00");
    expect(body).toContain("TOTAL DÍA");
    expect(body).toContain("TOTAL MES");
    // Punto y coma, no coma.
    expect(body.split("\r\n")[1]).toContain(";");
  });

  it("filtrado por empleado sólo trae a ese empleado", async () => {
    await tramo(marta, "2026-09-01", "08:00", "15:00");
    await tramo(luis, "2026-09-01", "09:00", "13:00");
    const body = await csv("2026-09", marta);
    expect(body).toContain("Marta Ruiz");
    expect(body).not.toContain("Luis Bermejo");
  });

  it("un mes sin fichajes sale vacío pero con cabecera y sin correcciones", async () => {
    const body = await csv("2026-08");
    expect(body).toContain("Registro de jornada");
    expect(body).toContain("Correcciones del periodo");
    expect(body).toContain("Ninguna");
  });

  // ── las correcciones, al final ───────────────────────────────────────

  it("las correcciones van al final con antes, después, motivo, autor y fecha", async () => {
    const id = await tramo(marta, "2026-09-02", "08:00", "15:00");
    await app.inject({
      method: "POST",
      url: `/admin/fichaje/entries/${id}/corrections`,
      headers: auth(),
      payload: {
        field: "ended_at",
        value: localToUtc("2026-09-02", "17:30").toISOString(),
        reasonCode: "OTRO",
        reasonText: "Se quedó a la reunión de claustro",
      } as never,
    });

    const body = await csv("2026-09");
    const iRegistro = body.indexOf("Marta Ruiz");
    const iCorr = body.indexOf("Correcciones del periodo");
    // Al FINAL, literalmente.
    expect(iCorr).toBeGreaterThan(iRegistro);

    const cola = body.slice(iCorr);
    expect(cola).toContain("Salida");
    expect(cola).toContain("15:00"); // antes
    expect(cola).toContain("17:30"); // después
    expect(cola).toContain("Otro: Se quedó a la reunión de claustro");
    expect(cola).toContain("Secretaría (empresa)");
  });

  it("un alta manual se lee como alta, no como un cambio de 08:00 a 08:00", async () => {
    await app.inject({
      method: "POST",
      url: "/admin/fichaje/entries",
      headers: auth(),
      payload: {
        employeeId: marta,
        startedAt: localToUtc("2026-09-03", "08:00").toISOString(),
        endedAt: localToUtc("2026-09-03", "15:00").toISOString(),
        reasonCode: "OLVIDO",
      } as never,
    });
    const body = await csv("2026-09");
    const cola = body.slice(body.indexOf("Correcciones del periodo"));
    expect(cola).toContain("(alta manual)");
    expect(cola).toContain("Olvido");
    // Y en el registro, marcado como metido por la empresa.
    expect(body).toContain("añadido por la empresa");
  });

  // ── el cambio de hora ────────────────────────────────────────────────

  it("la noche del 24→25-10-2026 cuenta NUEVE horas, no ocho", async () => {
    await tramo(marta, "2026-10-24", "22:00", null);
    await prisma.$executeRawUnsafe(
      `UPDATE time_entries
          SET ended_at = '${localToUtc("2026-10-25", "06:00").toISOString()}',
              ended_server_at = now(), end_source = 'MOBILE'
        WHERE employee_id = '${marta}' AND ended_at IS NULL`,
    );
    const body = await csv("2026-10");
    // Las horas de pared dicen 22:00 → 06:00. El total dice nueve.
    expect(body).toContain("22:00");
    expect(body).toContain("06:00");
    expect(body).toContain("9h 00m");
    expect(body).not.toContain("8h 00m");
  });

  it("la zona sale con su nombre a cada lado del cambio", async () => {
    expect(zoneLabel(new Date("2026-09-15T12:00:00Z"))).toMatch(/Europe\/Madrid/);
    // Verano y invierno no son la misma etiqueta: el PDF tiene que decir
    // cuál, porque "17:30" significa dos instantes distintos según eso.
    const verano = zoneLabel(new Date("2026-09-15T12:00:00Z"));
    const invierno = zoneLabel(new Date("2026-12-15T12:00:00Z"));
    expect(verano).not.toBe(invierno);
  });

  // ── el PDF ───────────────────────────────────────────────────────────

  it("el PDF lleva lo que el art. 34.9 pide, y el hueco de firma", async () => {
    const id = await tramo(marta, "2026-09-01", "08:00", "15:00");
    await app.inject({
      method: "POST",
      url: `/admin/fichaje/entries/${id}/corrections`,
      headers: auth(),
      payload: {
        field: "ended_at",
        value: localToUtc("2026-09-01", "17:30").toISOString(),
        reasonCode: "ERROR_HORA",
      } as never,
    });

    const res = await app.inject({
      method: "GET",
      url: "/admin/fichaje/export.pdf?month=2026-09",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain(
      "registro-jornada-2026-09.pdf",
    );
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");

    // Y lo que de verdad importa: qué pone dentro.
    const { text } = await pdfParse(res.rawPayload);
    expect(text).toContain("Registro de jornada");
    expect(text).toContain("Colegio de Talavera SL");
    expect(text).toContain("B45123456");
    expect(text).toContain("Septiembre de 2026");
    expect(text).toContain("Europe/Madrid");
    expect(text).toContain("Marta Ruiz");
    expect(text).toContain("08:00");
    expect(text).toContain("17:30");
    expect(text).toContain("Total del mes");
    // Las correcciones, al final.
    expect(text).toContain("Correcciones del periodo");
    expect(text.indexOf("Correcciones del periodo")).toBeGreaterThan(
      text.indexOf("Marta Ruiz"),
    );
    expect(text).toContain("15:00");
    expect(text).toContain("Error de hora");
    expect(text).toContain("Secretar");
    // El hueco de la firma y el pie.
    expect(text).toContain("Conforme el trabajador");
    expect(text).toContain("Firma");
    expect(text).toContain("Generado el");
    expect(text).toContain("Art. 34.9");
  });

  it("el de un solo empleado lleva su nombre en el fichero", async () => {
    await tramo(marta, "2026-09-01", "08:00", "15:00");
    const res = await app.inject({
      method: "GET",
      url: `/admin/fichaje/export.pdf?month=2026-09&employeeId=${marta}`,
      headers: auth(),
    });
    expect(res.headers["content-disposition"]).toContain(
      "registro-jornada-2026-09-marta-ruiz.pdf",
    );
  });

  // ── las puertas ──────────────────────────────────────────────────────

  it("sin el módulo no hay export", async () => {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { fichajeEnabled: false },
    });
    for (const f of ["csv", "pdf"]) {
      const res = await app.inject({
        method: "GET",
        url: `/admin/fichaje/export.${f}?month=2026-09`,
        headers: auth(),
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it("sin token, tampoco", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/fichaje/export.csv?month=2026-09",
    });
    expect(res.statusCode).toBe(401);
  });
});
