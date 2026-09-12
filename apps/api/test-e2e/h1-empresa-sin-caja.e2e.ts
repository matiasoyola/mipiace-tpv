// H1 · la empresa sin caja contra Postgres DE VERDAD.
//
// POR QUÉ ESTE FICHERO EXISTE. Tres cosas de este bloque no las decide el
// código de la API, y las tres se despliegan el mismo día:
//
//   1. **La migración.** `caja_enabled BOOLEAN NOT NULL DEFAULT true` y el
//      valor nuevo del enum. Que el backfill deje a Sole, Thalía, Cachitos
//      y La Maestranza EXACTAMENTE como estaban no es una afirmación sobre
//      el código: es una afirmación sobre Postgres, y sólo Postgres puede
//      confirmarla. El banco `h1-migracion-caja.test.ts` fija el texto del
//      SQL; esto ejecuta el SQL.
//   2. **`NOT_APPLICABLE` en un enum real.** Un valor de enum que el tipo
//      de la columna no acepta revienta al INSERT, no al compilar.
//   3. **Que el cron incremental no se lleve por delante al colegio.** Su
//      filtro es una WHERE (`initial_sync_status = 'DONE' AND
//      holded_api_key_ciphertext IS NOT NULL`), y una WHERE se prueba con
//      filas, no con tipos.
//
// Y encima de eso, el recorrido del bloque de punta a punta: alta sin
// Holded → activación → el OWNER entra → el TPV recibe su 403 → se
// conecta Holded más tarde y el sync arranca.

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

// Las colas y el correo no son el objeto de este fichero: lo que importa
// es QUÉ se encola, no que BullMQ funcione. Guardamos las llamadas.
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
vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: async () => {},
}));
vi.mock("../src/queues/ticket-email.js", () => ({
  enqueueTicketEmail: async () => {},
}));
const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({
    send: async (msg: { to: string; subject: string; text: string }) => {
      sentEmails.push(msg);
    },
  }),
}));
// Holded acepta la clave: lo que se prueba aquí es el salto de estado y
// lo que queda escrito en la base, no el cliente HTTP.
vi.mock("../src/holded/probe.js", () => ({
  probeHoldedKey: async () => ({ ok: true }),
  probeFailureToHttpStatus: () => 400,
}));
vi.mock("@mipiacetpv/holded-client", async (orig) => {
  const real = await orig<typeof import("@mipiacetpv/holded-client")>();
  return {
    ...real,
    listWarehouses: async () => [
      { id: "wh_1", name: "Thalia Eventos SL", default: true, address: null },
    ],
  };
});

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerSuperAdminTenantsRoutes } = await import(
  "../src/superadmin/tenants.js"
);
const { registerAuthRoutes } = await import("../src/auth/routes.js");
const { registerTpvCatalogRoutes } = await import("../src/tpv-catalog/routes.js");
const { registerCashierAuthRoutes } = await import("../src/shift/cashier-auth.js");
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { hashPassword } = await import("../src/auth/passwords.js");
const jwtLib = (await import("jsonwebtoken")).default;

describe.skipIf(!e2eEnabled)("e2e · la empresa sin caja contra Postgres real", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;
  let superAdminId = "";

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
    await registerTpvCatalogRoutes(app);
    await registerCashierAuthRoutes(app);
    await app.ready();

    superAdminId = randomUUID();
    await prisma.superAdminUser.create({
      data: {
        id: superAdminId,
        email: `h1-${superAdminId.slice(0, 8)}@mipiacetpv.tech`,
        passwordHash: await hashPassword("Irrelevante1!"),
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await shutdown();
  });

  // ── 1 · la migración, sobre filas ────────────────────────────────────

  describe("la migración", () => {
    it("un tenant insertado SIN nombrar caja_enabled sale con caja: el backfill es el DEFAULT", async () => {
      // Ésta es la prueba de que Sole, Thalía, Cachitos y La Maestranza no
      // se quedan sin caja el día del despliegue. El INSERT va por SQL y
      // NO menciona la columna, igual que una fila escrita antes de que
      // la columna existiera.
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO tenants (id, name, created_at, updated_at)
         VALUES ($1::uuid, $2, now(), now())`,
        id,
        `Tenant legado ${id.slice(0, 8)}`,
      );
      const rows = await prisma.$queryRawUnsafe<Array<{ caja_enabled: boolean }>>(
        `SELECT caja_enabled FROM tenants WHERE id = $1::uuid`,
        id,
      );
      expect(rows[0]!.caja_enabled).toBe(true);
    });

    it("la columna es NOT NULL: no se puede dejar una empresa sin decidir si tiene caja", async () => {
      const id = randomUUID();
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO tenants (id, name, caja_enabled, created_at, updated_at)
           VALUES ($1::uuid, $2, NULL, now(), now())`,
          id,
          `Tenant nulo ${id.slice(0, 8)}`,
        ),
      ).rejects.toThrow();
    });

    it("el enum acepta NOT_APPLICABLE de verdad", async () => {
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO tenants (id, name, initial_sync_status, created_at, updated_at)
         VALUES ($1::uuid, $2, 'NOT_APPLICABLE', now(), now())`,
        id,
        `Tenant sin sync ${id.slice(0, 8)}`,
      );
      const t = await prisma.tenant.findUniqueOrThrow({ where: { id } });
      expect(t.initialSyncStatus).toBe("NOT_APPLICABLE");
    });
  });

  // ── 2 · el cron incremental no se lleva al colegio ───────────────────

  describe("el cron incremental", () => {
    it("NO recoge al tenant NOT_APPLICABLE, aunque alguien le ponga una clave a mano", async () => {
      const sinHolded = randomUUID();
      const conHolded = randomUUID();
      await prisma.tenant.create({
        data: {
          id: sinHolded,
          name: `Colegio cron ${sinHolded.slice(0, 8)}`,
          cajaEnabled: false,
          initialSyncStatus: "NOT_APPLICABLE",
          // Clave presente a propósito: lo que lo deja fuera es el
          // ESTADO, no la ausencia de clave.
          holdedApiKeyCiphertext: "v1:loquesea",
        },
      });
      await prisma.tenant.create({
        data: {
          id: conHolded,
          name: `Thalia cron ${conHolded.slice(0, 8)}`,
          initialSyncStatus: "DONE",
          holdedApiKeyCiphertext: "v1:loquesea",
        },
      });
      // La MISMA where del worker (`catalog-incremental-worker.ts:72`).
      const barridos = await prisma.tenant.findMany({
        where: { initialSyncStatus: "DONE", holdedApiKeyCiphertext: { not: null } },
        select: { id: true },
      });
      const ids = barridos.map((t) => t.id);
      expect(ids).toContain(conHolded);
      expect(ids).not.toContain(sinHolded);
    });
  });

  // ── 3 · el recorrido del bloque ──────────────────────────────────────

  describe("de punta a punta", () => {
    let tenantId = "";
    const ownerEmail = `direccion-${randomUUID().slice(0, 8)}@colegio.es`;

    it("alta sin clave de Holded, con la caja apagada", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/super-admin/tenants",
        headers: saAuth(),
        payload: {
          legalName: `Colegio de Talavera ${randomUUID().slice(0, 6)}`,
          taxId: spanishNif(),
          cajaEnabled: false,
          crmEnabled: true,
        },
      });
      expect(res.statusCode).toBe(201);
      tenantId = res.json().tenant.id;

      const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(t.cajaEnabled).toBe(false);
      expect(t.crmEnabled).toBe(true);
      expect(t.initialSyncStatus).toBe("NOT_APPLICABLE");
      expect(t.holdedApiKeyCiphertext).toBeNull();
      // Y no se encoló nada.
      expect(enqueuedInitialSync).not.toContain(tenantId);
    });

    it("la salud dice que está lista, con cinco checks que no aplican", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/super-admin/tenants/${tenantId}`,
        headers: saAuth(),
      });
      expect(res.statusCode).toBe(200);
      const h = res.json().onboardingHealth;
      expect(h.ready).toBe(true);
      expect(h.readinessChecks.filter((c: any) => !c.applies)).toHaveLength(5);
    });

    it("se activa y el OWNER nace SIN PIN de cajero", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/super-admin/tenants/${tenantId}/activate`,
        headers: saAuth(),
        payload: { ownerEmail, ownerName: "Marta" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ownerPin).toBeNull();
      expect(res.json().cashierPinIssued).toBe(false);

      const owner = await prisma.user.findUniqueOrThrow({
        where: { email: ownerEmail },
      });
      expect(owner.role).toBe("OWNER");
      expect(owner.pinHash).toBeNull();
      const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(t.onboardingState).toBe("ACTIVE");
    });

    it("el email de bienvenida no habla de PIN ni de Holded", async () => {
      const mail = sentEmails.find((m) => m.to === ownerEmail);
      expect(mail).toBeTruthy();
      expect(mail!.text).not.toMatch(/PIN/);
      expect(mail!.text).not.toMatch(/Holded/);
    });

    it("/auth/me manda los módulos, y el panel sabe que no hay caja", async () => {
      const owner = await prisma.user.findUniqueOrThrow({
        where: { email: ownerEmail },
      });
      const token = jwtLib.sign(
        { sub: owner.id, tid: tenantId, role: "OWNER", tv: owner.tokenVersion, type: "access" },
        process.env.JWT_ACCESS_SECRET!,
        { expiresIn: "1h" },
      );
      const res = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().tenant.cajaEnabled).toBe(false);
      expect(res.json().tenant.crmEnabled).toBe(true);
      expect(res.json().tenant.initialSyncStatus).toBe("NOT_APPLICABLE");
    });

    it("el TPV recibe 403 CAJA_DISABLED con frase, no una pantalla rota", async () => {
      const session = signCashierSession(
        {
          sub: randomUUID(),
          tid: tenantId,
          did: randomUUID(),
          rid: randomUUID(),
          role: "CASHIER",
        },
        10,
      );
      const res = await app.inject({
        method: "GET",
        url: "/tpv/catalog/products",
        headers: { authorization: `Bearer ${session}` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("CAJA_DISABLED");
      expect(res.json().message.length).toBeGreaterThan(20);
    });

    it("conectar Holded más tarde arranca el sync inicial DE VERDAD", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/super-admin/tenants/${tenantId}/holded-api-key`,
        headers: saAuth(),
        payload: { holdedApiKey: "abc123abc123" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().initialSyncStatus).toBe("PENDING");
      expect(res.json().initialSyncQueued).toBe(true);

      const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(t.initialSyncStatus).toBe("PENDING");
      expect(t.holdedApiKeyCiphertext).toBeTruthy();
      expect(enqueuedInitialSync).toContain(tenantId);
    });
  });

  // ── 4 · el tenant de hoy no se entera del bloque ──────────────────────

  describe("un tenant con Holded y caja", () => {
    it("se da de alta como en master: PENDING, sync encolado y caja encendida", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/super-admin/tenants",
        headers: saAuth(),
        payload: {
          holdedApiKey: "abc123abc123",
          holdedAccountId: `acc-${randomUUID().slice(0, 8)}`,
          taxId: spanishNif(),
        },
      });
      expect(res.statusCode).toBe(201);
      const id = res.json().tenant.id;
      const t = await prisma.tenant.findUniqueOrThrow({ where: { id } });
      expect(t.cajaEnabled).toBe(true);
      expect(t.crmEnabled).toBe(false);
      expect(t.agendaEnabled).toBe(false);
      expect(t.initialSyncStatus).toBe("PENDING");
      expect(t.name).toBe("Thalia Eventos SL");
      expect(enqueuedInitialSync).toContain(id);
    });

    it("su TPV sigue recibiendo el catálogo", async () => {
      const id = randomUUID();
      await prisma.tenant.create({
        data: {
          id,
          name: `Thalia tpv ${id.slice(0, 8)}`,
          initialSyncStatus: "DONE",
          holdedApiKeyCiphertext: "v1:loquesea",
        },
      });
      const session = signCashierSession(
        { sub: randomUUID(), tid: id, did: randomUUID(), rid: randomUUID(), role: "CASHIER" },
        10,
      );
      const res = await app.inject({
        method: "GET",
        url: "/tpv/catalog/products",
        headers: { authorization: `Bearer ${session}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().cajaEnabled).toBe(true);
    });
  });
});

// NIF español válido al vuelo: el alta lo valida con dígito de control,
// y un literal fijo chocaría con el check de unicidad entre casos.
function spanishNif(): string {
  const n = Math.floor(Math.random() * 100_000_000);
  const letras = "TRWAGMYFPDXBNJZSQVHLCKE";
  return `${String(n).padStart(8, "0")}${letras[n % 23]}`;
}
