// F1 · el control horario es un módulo (ADR-018, ADR-016 §7).
//
// Lo que este banco fija:
//
//   1. La migración es aditiva y backfillea a FALSE. Un tenant de hoy
//      —Sole, Thalía, Cachitos, La Maestranza— no se despierta con el
//      módulo encendido. Es el sabotaje nº 11 de la tabla del bloque.
//   2. Una empresa con el control horario como ÚNICO módulo pasa el check
//      `modules-enabled` y se puede activar. Es, literalmente, el alta del
//      colegio de Talavera: sin caja, sin CRM, sin agenda y sin Holded.
//   3. `fichajeEnabled` se mueve SÓLO desde el super-admin. El panel del
//      cliente recibe un 400 si lo intenta, y lo LEE para poder esconder
//      la sección.
//   4. El invariante de "al menos un módulo encendido" cuenta el cuarto:
//      apagarle la caja a un colegio que ya ficha deja de ser un 400.
//
// La migración de las TABLAS del registro va aparte
// (`20260923010000_fichaje_1_registro`) y la cubre `f2-registro-*`.

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── 1 · la migración ──────────────────────────────────────────────────

const MIGRATION = new URL(
  "../../../packages/db/prisma/migrations/20260923000000_fichaje_1_modulo/migration.sql",
  import.meta.url,
);

describe("F1 · migración fichaje_1_modulo", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  // Sólo las sentencias: los comentarios hablan de DROP y de `true`, y
  // harían pasar (o fallar) los asserts por lo que explican en vez de por
  // lo que ejecutan. Mismo criterio que `h1-migracion-caja.test.ts`.
  const statements = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  it("añade fichaje_enabled NOT NULL con DEFAULT false", () => {
    expect(statements).toMatch(
      /ALTER TABLE "tenants" ADD COLUMN "fichaje_enabled" BOOLEAN NOT NULL DEFAULT false;/,
    );
  });

  // El sabotaje nº 11: si alguien cambia el default a `true`, cuatro
  // clientes en producción se despiertan con un módulo que no han
  // comprado y una sección nueva en su panel.
  it("NO backfillea a true por ninguna vía", () => {
    expect(statements).not.toMatch(/fichaje_enabled" BOOLEAN NOT NULL DEFAULT true/);
    expect(statements).not.toMatch(/UPDATE\s+"?tenants"?/i);
  });

  it("es aditiva: ni un DROP, ni un ALTER COLUMN de lo que ya existe", () => {
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/ALTER COLUMN/i);
  });

  it("no toca ninguna otra tabla", () => {
    const tablas = [...statements.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map(
      (m) => m[1],
    );
    expect(new Set(tablas)).toEqual(new Set(["tenants"]));
  });
});

// ── 2 · la salud del onboarding ───────────────────────────────────────

const { computeOnboardingHealth } = await import(
  "../src/superadmin/onboarding-health.js"
);

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// Prisma falso mínimo: sólo lo que `computeOnboardingHealth` toca. Los
// contadores describen una empresa SIN catálogo y SIN cajero técnico,
// porque el colegio no tiene ninguna de las dos cosas y el bloque tiene
// que demostrar que aun así se activa.
function prismaColegio(over: Record<string, unknown> = {}): any {
  return {
    tenant: {
      findUniqueOrThrow: async () => ({
        initialSyncStatus: "NOT_APPLICABLE",
        initialSyncCompletedAt: null,
        initialSyncStartedAt: null,
        initialSyncStats: null,
        cajaEnabled: false,
        crmEnabled: false,
        agendaEnabled: false,
        fichajeEnabled: true,
        holdedEnabled: false,
        holdedApiKeyCiphertext: null,
        fiscalProfile: { legalName: "Colegio de Talavera SL", taxId: "12345678Z" },
        ...over,
      }),
    },
    tenantTax: { count: async () => 0 },
    product: { count: async () => 0 },
    contact: { count: async () => 0 },
    ticket: { count: async () => 0, findFirst: async () => null },
    user: { findFirst: async () => null },
    $queryRaw: async () => [{ n: 0 }],
  };
}

function byId(h: any, id: string) {
  const c = h.readinessChecks.find((x: any) => x.id === id);
  if (!c) throw new Error(`check ${id} no existe`);
  return c;
}

describe("F1 · el colegio se activa con el fichaje como único módulo", () => {
  it("pasa el check de módulos y está listo", async () => {
    const h = await computeOnboardingHealth(prismaColegio() as never, TENANT_ID);
    expect(byId(h, "modules-enabled").ok).toBe(true);
    expect(byId(h, "modules-enabled").value).toBe("control horario");
    expect(h.modules).toEqual({
      caja: false,
      crm: false,
      agenda: false,
      fichaje: true,
    });
    // Sin caja y sin Holded, los checks de catálogo y sync NO aplican —
    // y por eso un colegio sin un solo producto está listo.
    expect(h.ready).toBe(true);
  });

  it("sin NINGÚN módulo sigue sin poder activarse", async () => {
    const h = await computeOnboardingHealth(
      prismaColegio({ fichajeEnabled: false }) as never,
      TENANT_ID,
    );
    expect(byId(h, "modules-enabled").ok).toBe(false);
    expect(byId(h, "modules-enabled").value).toBe("ninguno");
    expect(h.ready).toBe(false);
  });

  // `=== true` y no `!== false`: un tenant cuya fila no trae la columna
  // (master antes de la migración) no tiene el módulo.
  it("la columna ausente NO cuenta como módulo encendido", async () => {
    const h = await computeOnboardingHealth(
      prismaColegio({ fichajeEnabled: undefined }) as never,
      TENANT_ID,
    );
    expect(h.modules.fichaje).toBe(false);
    expect(byId(h, "modules-enabled").ok).toBe(false);
  });

  it("los datos fiscales siguen bloqueando: sin NIF no se activa", async () => {
    const h = await computeOnboardingHealth(
      prismaColegio({ fiscalProfile: { legalName: "Colegio de Talavera SL" } }) as never,
      TENANT_ID,
    );
    expect(byId(h, "fiscal-minimum").ok).toBe(false);
    expect(h.ready).toBe(false);
  });
});

// ── 3 · el gobierno: sólo el super-admin ──────────────────────────────

const TENANT = "00000000-0000-0000-0000-000000000001";
const OWNER_ID = "00000000-0000-0000-0000-0000000000aa";

const settingsTenant: any = {};

const fakePrisma = {
  tenant: {
    findUniqueOrThrow: vi.fn(async () => settingsTenant),
    update: vi.fn(async ({ data }: any) => {
      for (const [k, v] of Object.entries(data)) {
        if (v !== undefined) settingsTenant[k] = v;
      }
      return settingsTenant;
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

const { registerAdminTenantSettingsRoutes } = await import(
  "../src/admin/tenant-settings.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(settingsTenant, {
    id: TENANT,
    cashierAutoLogoutMinutes: 10,
    cashierSessionTtlMinutes: 720,
    requireManagerPinForForceClose: true,
    requireOwnerPinForCashClose: false,
    dayCutHour: 5,
    requireCashCountOnClose: false,
    deviceNewLoginAlertEnabled: true,
    discountThresholdPct: 10,
    cashierSearchableContacts: true,
    creditSalesEnabled: false,
    crmEnabled: false,
    agendaEnabled: false,
    cajaEnabled: false,
    fichajeEnabled: true,
  });
});

async function settingsApp() {
  const app = Fastify();
  await registerAdminTenantSettingsRoutes(app);
  return app;
}

function ownerToken() {
  return `Bearer ${signAccessToken({ sub: OWNER_ID, tid: TENANT, role: "OWNER" })}`;
}

describe("F1 · fichajeEnabled se mueve sólo desde el super-admin", () => {
  it("el panel del cliente LO LEE (para esconder la sección)", async () => {
    const app = await settingsApp();
    const res = await app.inject({
      method: "GET",
      url: "/admin/tenant/settings",
      headers: { authorization: ownerToken() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.fichajeEnabled).toBe(true);
  });

  // Mismo trato exacto que `cajaEnabled`: encenderlo es vender un módulo.
  //
  // MEDIDO, y distinto de lo que dice ADR-016 §3.1: Fastify arranca con
  // el default de AJV `removeAdditional: true`, así que
  // `additionalProperties: false` **descarta** la propiedad en silencio en
  // vez de devolver 400. La garantía que importa se cumple igual —el campo
  // no llega al handler y la columna no se mueve— pero el código de estado
  // no es el que aquel ADR prometía. Se anota en el -done; NO se cambia la
  // configuración global de AJV, que afectaría a las 92 rutas de H1.
  it("el propietario NO lo puede mover: el campo se descarta y la fila no cambia", async () => {
    const app = await settingsApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/tenant/settings",
      headers: { authorization: ownerToken() },
      payload: { fichajeEnabled: false } as never,
    });
    expect(settingsTenant.fichajeEnabled).toBe(true);
    // Y no llega al UPDATE ni como `undefined` explícito.
    for (const call of fakePrisma.tenant.update.mock.calls) {
      expect(Object.keys((call[0] as any).data)).not.toContain("fichajeEnabled");
    }
    // La respuesta tampoco lo devuelve: el POST no es la vía de lectura.
    expect(res.json().settings.fichajeEnabled).toBeUndefined();
  });

  it("tampoco colado junto a un ajuste legítimo", async () => {
    const app = await settingsApp();
    await app.inject({
      method: "POST",
      url: "/admin/tenant/settings",
      headers: { authorization: ownerToken() },
      payload: { crmEnabled: true, fichajeEnabled: false } as never,
    });
    // El ajuste legítimo entra; el módulo no.
    expect(settingsTenant.crmEnabled).toBe(true);
    expect(settingsTenant.fichajeEnabled).toBe(true);
  });
});
