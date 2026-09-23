// F1 · EL CRITERIO DE HECHO DEL BLOQUE, de punta a punta y contra
// Postgres de verdad (ADR-018).
//
// Un recorrido, el del cliente 0:
//
//   el super-admin da de alta un colegio SIN caja, SIN Holded y con el
//   control horario como ÚNICO módulo → se activa → su OWNER entra, da de
//   alta a un profesor y le genera el enlace → el profesor lo abre en su
//   móvil, ficha la entrada y la salida → la empresa lo ve en Hoy y en el
//   Registro → se lo exporta a la Inspección.
//
// Y el otro lado de la moneda, en el mismo fichero porque se despliegan el
// mismo día: un tenant de HOY —con caja y con Holded, sin fichaje— opera
// exactamente igual que en master y no ve nada de todo esto.
//
// Por qué e2e y no un banco con prisma falso: la mitad de lo que se
// comprueba aquí son índices parciales, triggers y una migración. Nada de
// eso existe fuera de Postgres.

import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "g".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_ADMIN_URL = "https://admin.mipiacetpv.com";

const enqueuedInitialSync: string[] = [];
vi.mock("../src/queues/initial-sync.js", () => ({
  enqueueInitialSync: async (tenantId: string) => {
    enqueuedInitialSync.push(tenantId);
  },
}));
vi.mock("../src/queues/catalog-incremental.js", () => ({
  enqueueManualSync: async () => ({ jobId: "manual-1" }),
  registerTenantRepeatable: async () => undefined,
}));
vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({ send: async () => undefined }),
}));
vi.mock("../src/holded/probe.js", () => ({
  probeHoldedKey: async () => ({ ok: true }),
  probeFailureToHttpStatus: () => 400,
}));
vi.mock("@mipiacetpv/holded-client", async (orig) => {
  const real = await orig<typeof import("@mipiacetpv/holded-client")>();
  return {
    ...real,
    listWarehouses: async () => [
      { id: "wh_1", name: "Bar Thalia SL", default: true, address: null },
    ],
  };
});

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerSuperAdminTenantsRoutes } = await import(
  "../src/superadmin/tenants.js"
);
const { registerAuthRoutes } = await import("../src/auth/routes.js");
const { registerFichajeRoutes } = await import("../src/fichaje/routes.js");
const { registerFichajeAdminRoutes } = await import(
  "../src/fichaje/admin-routes.js"
);
const { registerAdminTenantSettingsRoutes } = await import(
  "../src/admin/tenant-settings.js"
);
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { hashPassword } = await import("../src/auth/passwords.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { localDate, localToUtc } = await import("../src/fichaje/time.js");
const jwtLib = (await import("jsonwebtoken")).default;

describe.skipIf(!e2eEnabled)("e2e · el colegio, de punta a punta", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let superAdminId = "";
  const creados: string[] = [];

  const saAuth = () => ({
    authorization: `Bearer ${jwtLib.sign(
      { sub: superAdminId, purpose: "super-admin", tv: 0, type: "access" },
      process.env.SUPER_ADMIN_JWT_SECRET!,
      { expiresIn: "1h" },
    )}`,
  });

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    await registerSuperAdminTenantsRoutes(app);
    await registerAuthRoutes(app);
    await registerAdminTenantSettingsRoutes(app);
    await registerFichajeRoutes(app);
    await registerFichajeAdminRoutes(app);
    await app.ready();

    superAdminId = randomUUID();
    await prisma.superAdminUser.create({
      data: {
        id: superAdminId,
        email: `f1-${superAdminId.slice(0, 8)}@mipiacetpv.tech`,
        passwordHash: await hashPassword("Irrelevante1!"),
      },
    });
  });

  afterAll(async () => {
    for (const id of creados) {
      await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${id}'`);
    }
    // El super-admin NO se borra: sus filas de auditoría lo referencian
    // (`super_admin_audits.super_admin_id`), y esa traza es justo lo que
    // no se tira. La base del e2e es desechable.
    await app?.close();
    await shutdown();
  });

  // ── EL COLEGIO ───────────────────────────────────────────────────────

  describe("el colegio de Talavera", () => {
    let tenantId = "";
    let ownerId = "";
    let ownerEmail = "";
    let profesorId = "";
    let enlace = "";
    let tokenMovil = "";
    let entryId = "";

    const owner = () => ({
      authorization: `Bearer ${signAccessToken({ sub: ownerId, tid: tenantId, role: "OWNER" })}`,
    });
    const movil = () => ({ "x-employee-token": tokenMovil });

    it("1 · se da de alta con el control horario como ÚNICO módulo", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/super-admin/tenants",
        headers: saAuth(),
        payload: {
          legalName: `Colegio de Talavera ${randomUUID().slice(0, 6)} SL`,
          taxId: "12345678Z",
          cajaEnabled: false,
          crmEnabled: false,
          agendaEnabled: false,
          fichajeEnabled: true,
          holdedEnabled: false,
        } as never,
      });
      expect(res.statusCode).toBe(201);
      tenantId = res.json().tenant.id;
      creados.push(tenantId);

      expect(res.json().tenant.modules).toEqual({
        caja: false,
        crm: false,
        agenda: false,
        fichaje: true,
      });
      // Ni una llamada a Holded, ni un sync encolado.
      expect(res.json().tenant.initialSyncStatus).toBe("NOT_APPLICABLE");
      expect(enqueuedInitialSync).not.toContain(tenantId);
    });

    it("2 · la salud dice que está lista, sin un solo producto ni cajero", async () => {
      // La salud viaja DENTRO del detalle del tenant, no en una ruta
      // aparte (`superadmin/tenants.ts`, `onboardingHealth`).
      const res = await app.inject({
        method: "GET",
        url: `/super-admin/tenants/${tenantId}`,
        headers: saAuth(),
      });
      expect(res.statusCode).toBe(200);
      const health = res.json().onboardingHealth;
      const check = (id: string) =>
        health.readinessChecks.find((c: any) => c.id === id);
      expect(check("modules-enabled").ok).toBe(true);
      expect(check("modules-enabled").value).toBe("control horario");
      // Los de caja y Holded NO aplican: ésa es la puerta que abrió H1.
      expect(check("products-sellable").applies).toBe(false);
      expect(check("sync-done").applies).toBe(false);
      expect(health.ready).toBe(true);
    });

    it("3 · se activa y su OWNER nace sin PIN de cajero", async () => {
      ownerEmail = `direccion-${tenantId.slice(0, 8)}@colegio.test`;
      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/activate`,
        headers: saAuth(),
        payload: { ownerEmail, ownerName: "Secretaría" } as never,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().cashierPinIssued).toBe(false);
      const u = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
      ownerId = u.id;
      expect(u.role).toBe("OWNER");
    });

    it("4 · el panel del OWNER ve el módulo y NO ve la caja", async () => {
      const me = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: owner(),
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().tenant.fichajeEnabled).toBe(true);
      expect(me.json().tenant.cajaEnabled).toBe(false);
      expect(me.json().tenant.holdedEnabled).toBe(false);

      // Y los ajustes lo devuelven para esconder lo que no aplica…
      const s = await app.inject({
        method: "GET",
        url: "/admin/tenant/settings",
        headers: owner(),
      });
      expect(s.json().settings.fichajeEnabled).toBe(true);
    });

    it("5 · da de alta a un profesor y le genera el enlace", async () => {
      const alta = await app.inject({
        method: "POST",
        url: "/admin/fichaje/employees",
        headers: owner(),
        payload: { name: "Marta Ruiz", email: "marta@colegio.test" } as never,
      });
      expect(alta.statusCode).toBe(201);
      profesorId = alta.json().employee.id;

      const link = await app.inject({
        method: "POST",
        url: `/admin/fichaje/employees/${profesorId}/pairing-links`,
        headers: owner(),
      });
      expect(link.statusCode).toBe(201);
      expect(link.json().url).toMatch(
        /^https:\/\/admin\.mipiacetpv\.com\/fichar\?p=/,
      );
      enlace = new URL(link.json().url).searchParams.get("p")!;
    });

    it("6 · el profesor lo abre en su móvil y queda emparejado", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/fichaje/v1/pair",
        payload: { token: enlace } as never,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().employee.name).toBe("Marta Ruiz");
      tokenMovil = res.json().employeeToken;

      // Y el enlace ya no vale: uno solo, y un reenvío no empareja otro.
      const otra = await app.inject({
        method: "POST",
        url: "/fichaje/v1/pair",
        payload: { token: enlace } as never,
      });
      expect(otra.statusCode).toBe(404);
    });

    it("7 · ficha la entrada y la salida", async () => {
      const ahora = new Date();
      const hace6h = new Date(ahora.getTime() - 6 * 3_600_000);

      const entrada = await app.inject({
        method: "POST",
        url: "/fichaje/v1/entries",
        headers: movil(),
        payload: {
          externalId: randomUUID(),
          deviceAt: hace6h.toISOString(),
        } as never,
      });
      expect(entrada.statusCode).toBe(201);
      entryId = entrada.json().entry.id;

      const salida = await app.inject({
        method: "POST",
        url: `/fichaje/v1/entries/${entryId}/close`,
        headers: movil(),
        payload: {
          externalId: randomUUID(),
          deviceAt: ahora.toISOString(),
        } as never,
      });
      expect(salida.statusCode).toBe(200);
      expect(salida.json().entry.minutes).toBe(360);
    });

    it("8 · la empresa lo ve en Hoy y en el Registro", async () => {
      const hoy = await app.inject({
        method: "GET",
        url: "/admin/fichaje/today",
        headers: owner(),
      });
      expect(hoy.statusCode).toBe(200);
      // Ya salió, así que no está dentro — pero tampoco en "sin fichar".
      expect(hoy.json().inside).toEqual([]);
      expect(hoy.json().notClockedIn).toEqual([]);
      expect(hoy.json().alerts.missingExit).toEqual([]);

      const mes = localDate(new Date()).slice(0, 7);
      const registro = await app.inject({
        method: "GET",
        url: `/admin/fichaje/entries?month=${mes}`,
        headers: owner(),
      });
      expect(registro.statusCode).toBe(200);
      expect(registro.json().blocks).toHaveLength(1);
      expect(registro.json().blocks[0].employeeName).toBe("Marta Ruiz");
      expect(registro.json().totalMinutes).toBe(360);
    });

    it("9 · y se lo puede enseñar a la Inspección", async () => {
      const mes = localDate(new Date()).slice(0, 7);
      const pdf = await app.inject({
        method: "GET",
        url: `/admin/fichaje/export.pdf?month=${mes}`,
        headers: owner(),
      });
      expect(pdf.statusCode).toBe(200);
      expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");

      const csv = await app.inject({
        method: "GET",
        url: `/admin/fichaje/export.csv?month=${mes}`,
        headers: owner(),
      });
      expect(csv.statusCode).toBe(200);
      expect(csv.body).toContain("Marta Ruiz");
      expect(csv.body).toContain("6h 00m");
    });

    // ── y el caso principal del producto ───────────────────────────────

    it("10 · con una salida olvidada, al día siguiente se le PREGUNTA", async () => {
      const ayer = localDate(new Date(Date.now() - 86_400_000));
      await prisma.timeEntry.create({
        data: {
          tenantId,
          employeeId: profesorId,
          startedAt: localToUtc(ayer, "08:00"),
          startedDeviceAt: localToUtc(ayer, "08:00"),
          startedServerAt: localToUtc(ayer, "08:00"),
          startSource: "MOBILE",
        },
      });

      const me = await app.inject({
        method: "GET",
        url: "/fichaje/v1/me",
        headers: movil(),
      });
      expect(me.json().pendingExit).not.toBeNull();
      expect(me.json().pendingExit.date).toBe(ayer);

      // Y la empresa lo ve marcado "sin salida".
      const hoy = await app.inject({
        method: "GET",
        url: "/admin/fichaje/today",
        headers: owner(),
      });
      expect(hoy.json().alerts.missingExit).toHaveLength(1);
    });

    it("11 · contesta con un toque y queda como corrección OLVIDO", async () => {
      const ayer = localDate(new Date(Date.now() - 86_400_000));
      const me = await app.inject({
        method: "GET",
        url: "/fichaje/v1/me",
        headers: movil(),
      });
      const pendiente = me.json().pendingExit;

      const res = await app.inject({
        method: "POST",
        url: `/fichaje/v1/entries/${pendiente.entryId}/corrections`,
        headers: movil(),
        payload: {
          field: "ended_at",
          value: localToUtc(ayer, "17:30").toISOString(),
          reasonCode: "OLVIDO",
        } as never,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().entry.open).toBe(false);
      expect(res.json().entry.corrected).toBe(true);

      // EL REGISTRO ORIGINAL SIGUE AHÍ: la entrada no se ha movido.
      const fila = await prisma.timeEntry.findUniqueOrThrow({
        where: { id: pendiente.entryId },
        select: { startedAt: true, startedDeviceAt: true },
      });
      expect(fila.startedAt.toISOString()).toBe(
        localToUtc(ayer, "08:00").toISOString(),
      );
      expect(fila.startedDeviceAt!.toISOString()).toBe(
        localToUtc(ayer, "08:00").toISOString(),
      );

      // Y la traza dice quién, cuándo y por qué.
      const hist = await app.inject({
        method: "GET",
        url: `/fichaje/v1/entries/${pendiente.entryId}/corrections`,
        headers: movil(),
      });
      const [c] = hist.json().corrections;
      expect(c.reasonCode).toBe("OLVIDO");
      expect(c.author).toBe("Marta Ruiz");
      expect(c.authorKind).toBe("EMPLOYEE");
    });

    it("12 · y el registro no se puede borrar ni con SQL directo", async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM time_entries WHERE employee_id = '${profesorId}'`,
        ),
      ).rejects.toThrow(/no se borra/);
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM employees WHERE id = '${profesorId}'`,
        ),
      ).rejects.toThrow(/desactiv/);
    });
  });

  // ── EL TENANT DE HOY ─────────────────────────────────────────────────
  //
  // Sole, Thalía, Cachitos y La Maestranza. La prueba de que este bloque
  // no les cambia nada.

  describe("un tenant de hoy (con caja, con Holded, sin fichaje)", () => {
    let tenantId = "";
    let ownerId = "";

    const owner = () => ({
      authorization: `Bearer ${signAccessToken({ sub: ownerId, tid: tenantId, role: "OWNER" })}`,
    });

    it("se da de alta como siempre, y NACE sin el módulo", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/super-admin/tenants",
        headers: saAuth(),
        payload: {
          holdedApiKey: "abc123abc123",
          holdedAccountId: `acc-${randomUUID().slice(0, 8)}`,
          // Otro NIF: el del colegio ya está cogido y la unicidad se
          // comprueba igual con Holded y sin él (H1).
          taxId: "00000001R",
        } as never,
      });
      expect(res.statusCode).toBe(201);
      tenantId = res.json().tenant.id;
      creados.push(tenantId);
      expect(res.json().tenant.modules).toEqual({
        caja: true,
        crm: false,
        agenda: false,
        fichaje: false,
      });
      expect(res.json().tenant.initialSyncStatus).toBe("PENDING");
      expect(enqueuedInitialSync).toContain(tenantId);
    });

    // La fila, leída de Postgres. El backfill de la migración es el
    // DEFAULT, y el DEFAULT es `false`: es el sabotaje nº 11.
    it("su fila dice fichaje_enabled = false", async () => {
      const [row] = await prisma.$queryRawUnsafe<Array<{ fichaje_enabled: boolean }>>(
        `SELECT fichaje_enabled FROM tenants WHERE id = '${tenantId}'`,
      );
      expect(row!.fichaje_enabled).toBe(false);
    });

    // Y un tenant insertado SIN nombrar la columna —una fila escrita antes
    // de que existiera— sale igual.
    it("y una fila que no la nombra, tampoco lo tiene", async () => {
      const id = randomUUID();
      creados.push(id);
      await prisma.$executeRawUnsafe(
        `INSERT INTO tenants (id, name, updated_at) VALUES ('${id}', 'Legacy ${id.slice(0, 8)}', now())`,
      );
      const [row] = await prisma.$queryRawUnsafe<
        Array<{ fichaje_enabled: boolean; caja_enabled: boolean }>
      >(`SELECT fichaje_enabled, caja_enabled FROM tenants WHERE id = '${id}'`);
      expect(row!.fichaje_enabled).toBe(false);
      // Y la caja SIGUE encendida: el backfill de H1 tampoco se ha movido.
      expect(row!.caja_enabled).toBe(true);
    });

    it("no ve NADA del control horario", async () => {
      const u = await prisma.user.create({
        data: {
          id: randomUUID(),
          tenantId,
          email: `owner-${tenantId.slice(0, 8)}@bar.test`,
          role: "OWNER",
        },
      });
      ownerId = u.id;

      for (const url of [
        "/admin/fichaje/employees",
        "/admin/fichaje/today",
        "/admin/fichaje/entries",
        "/admin/fichaje/export.csv",
      ]) {
        const res = await app.inject({ method: "GET", url, headers: owner() });
        expect(res.statusCode).toBe(403);
        expect(res.json().error).toBe("FICHAJE_DISABLED");
      }

      const me = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: owner(),
      });
      expect(me.json().tenant.fichajeEnabled).toBe(false);
      expect(me.json().tenant.cajaEnabled).toBe(true);
    });

    it("y su propietario no se lo puede encender solo", async () => {
      await app.inject({
        method: "POST",
        url: "/admin/tenant/settings",
        headers: owner(),
        payload: { fichajeEnabled: true } as never,
      });
      const [row] = await prisma.$queryRawUnsafe<Array<{ fichaje_enabled: boolean }>>(
        `SELECT fichaje_enabled FROM tenants WHERE id = '${tenantId}'`,
      );
      expect(row!.fichaje_enabled).toBe(false);
    });
  });
});
