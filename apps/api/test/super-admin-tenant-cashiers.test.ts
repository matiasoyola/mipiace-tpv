// Bloque soporte-cajeros-superadmin · tests de
// GET /super-admin/tenants/:id/cashiers.
//
// El test que más vale de todo el bloque es "el PIN no viaja en la
// respuesta": mira el cuerpo CRUDO (no el objeto parseado) buscando el
// hash, y además recorre el JSON entero comprobando que no hay ninguna
// clave que hable de PIN. Un `select` al que alguien añada `pinHash`
// más adelante lo revienta, que es exactamente para lo que está.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Fakes ────────────────────────────────────────────────────────────

interface FakeUser {
  id: string;
  tenantId: string;
  email: string;
  alias: string | null;
  role: "OWNER" | "MANAGER" | "CASHIER";
  pinHash: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  isTestCashier: boolean;
  deletedAt: Date | null;
}

interface FakeTenant {
  id: string;
  name: string;
}

interface FakeSuperAdmin {
  id: string;
  tokenVersion: number;
  deletedAt: Date | null;
  isRoot: boolean;
}

interface FakeAudit {
  superAdminId: string;
  action: string;
  tenantId: string | null;
  metadata: any;
}

const users = new Map<string, FakeUser>();
const tenants = new Map<string, FakeTenant>();
const superAdmins = new Map<string, FakeSuperAdmin>();
const audits: FakeAudit[] = [];

function project<T extends object>(row: T, select: Record<string, unknown> | undefined) {
  if (!select) return row;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(select)) out[k] = (row as any)[k];
  return out;
}

const fakePrisma: any = {
  tenant: {
    findUnique: vi.fn(async ({ where, select }: any) => {
      const t = tenants.get(where.id);
      return t ? project(t, select) : null;
    }),
  },
  user: {
    findMany: vi.fn(async ({ where, orderBy, select }: any) => {
      let rows = [...users.values()];
      if (where?.tenantId) rows = rows.filter((u) => u.tenantId === where.tenantId);
      if (where?.role?.in) rows = rows.filter((u) => where.role.in.includes(u.role));
      if (orderBy?.createdAt === "asc") {
        rows = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }
      return rows.map((u) => project(u, select));
    }),
  },
  superAdminUser: {
    findUnique: vi.fn(async ({ where, select }: any) => {
      const sa = superAdmins.get(where.id);
      return sa ? project(sa, select) : null;
    }),
  },
  superAdminAudit: {
    create: vi.fn(async ({ data }: any) => {
      audits.push({
        superAdminId: data.superAdminId,
        action: data.action,
        tenantId: data.tenantId ?? null,
        metadata: data.metadata,
      });
      return { id: randomUUID(), ...data };
    }),
  },
};

// Redis mínimo para el throttle (`incr` / `expire` / `ttl`).
const counters = new Map<string, number>();
const ttls = new Map<string, number>();
const fakeRedis = {
  async ping() {
    return "PONG";
  },
  async incr(key: string) {
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return next;
  },
  async expire(key: string, seconds: number) {
    ttls.set(key, seconds);
    return 1;
  },
  async ttl(key: string) {
    return ttls.get(key) ?? -1;
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  shutdown: async () => undefined,
}));

const { registerSuperAdminTenantCashiersRoutes } = await import(
  "../src/superadmin/tenant-cashiers.js"
);
const { signSuperAdminAccessToken } = await import("../src/superadmin/tokens.js");

const SUPER_ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_TENANT_ID = "33333333-3333-3333-3333-333333333333";

// Hash reconocible a simple vista en el cuerpo crudo de la respuesta.
// Si aparece, el bloque ha fallado en lo único que no puede fallar.
const PIN_HASH = "$argon2id$v=19$m=65536,t=3,p=4$SENTINELAPINHASH$noDebeSalirJamas";

function token(): string {
  const sa = superAdmins.get(SUPER_ADMIN_ID)!;
  return signSuperAdminAccessToken({ sub: sa.id, tv: sa.tokenVersion });
}

async function buildApp() {
  const app = Fastify();
  await registerSuperAdminTenantCashiersRoutes(app);
  return app;
}

function get(app: any, tenantId = TENANT_ID) {
  return app.inject({
    method: "GET",
    url: `/super-admin/tenants/${tenantId}/cashiers`,
    headers: { authorization: `Bearer ${token()}` },
  });
}

function addUser(u: Partial<FakeUser> & { id: string; email: string }): FakeUser {
  const row: FakeUser = {
    tenantId: TENANT_ID,
    alias: null,
    role: "CASHIER",
    pinHash: PIN_HASH,
    lastLoginAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    isTestCashier: false,
    deletedAt: null,
    ...u,
  };
  users.set(row.id, row);
  return row;
}

beforeEach(() => {
  users.clear();
  tenants.clear();
  superAdmins.clear();
  audits.length = 0;
  counters.clear();
  ttls.clear();
  vi.clearAllMocks();
  superAdmins.set(SUPER_ADMIN_ID, {
    id: SUPER_ADMIN_ID,
    tokenVersion: 0,
    deletedAt: null,
    isRoot: true,
  });
  tenants.set(TENANT_ID, { id: TENANT_ID, name: "Sirope" });
  tenants.set(OTHER_TENANT_ID, { id: OTHER_TENANT_ID, name: "Cachictos" });
});

// ── El test que más vale ─────────────────────────────────────────────

describe("GET /super-admin/tenants/:id/cashiers · el PIN no viaja", () => {
  it("ni el hash ni ninguna clave que hable de PIN salen en la respuesta", async () => {
    addUser({
      id: "aaaaaaaa-0000-0000-0000-000000000001",
      email: "maria@sirope.es",
      alias: "María",
      pinHash: PIN_HASH,
    });
    addUser({
      id: "aaaaaaaa-0000-0000-0000-000000000002",
      email: "owner@sirope.es",
      alias: "Dueño",
      role: "OWNER",
      pinHash: PIN_HASH,
    });
    const app = await buildApp();
    const res = await get(app);
    expect(res.statusCode).toBe(200);

    // 1. Cuerpo crudo: el hash no aparece en ninguna forma.
    expect(res.body).not.toContain(PIN_HASH);
    expect(res.body).not.toContain("SENTINELAPINHASH");
    expect(res.body).not.toContain("argon2");
    expect(res.body).not.toContain("pinHash");

    // 2. Ninguna clave del JSON, a cualquier profundidad, habla de PIN.
    const keys: string[] = [];
    (function walk(v: unknown) {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        for (const [k, val] of Object.entries(v)) {
          keys.push(k);
          walk(val);
        }
      }
    })(res.json());
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => /pin/i.test(k))).toEqual([]);

    // 3. Lo que sí viaja es el booleano derivado.
    expect(res.json().cashiers[0].canOpenTpv).toBe(true);
    await app.close();
  });

  it("un cajero sin PIN sale como NO_PIN y sin poder abrir el TPV", async () => {
    addUser({
      id: "aaaaaaaa-0000-0000-0000-000000000003",
      email: "nuevo@sirope.es",
      alias: "Nuevo",
      pinHash: null,
    });
    const app = await buildApp();
    const res = await get(app);
    const c = res.json().cashiers[0];
    expect(c.status).toBe("NO_PIN");
    expect(c.canOpenTpv).toBe(false);
    expect(res.body).not.toContain("pinHash");
    await app.close();
  });
});

// ── La lista ─────────────────────────────────────────────────────────

describe("GET /super-admin/tenants/:id/cashiers · la lista", () => {
  it("devuelve alias, rol, estado y último acceso, con los activos primero", async () => {
    addUser({
      id: "aaaaaaaa-0000-0000-0000-000000000010",
      email: `revoked-1-x@revoked.local`,
      alias: "Antiguo",
      pinHash: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    addUser({
      id: "aaaaaaaa-0000-0000-0000-000000000011",
      email: "sinpin@sirope.es",
      alias: "Sin PIN",
      pinHash: null,
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });
    addUser({
      id: "aaaaaaaa-0000-0000-0000-000000000012",
      email: "maria@sirope.es",
      alias: "María",
      lastLoginAt: new Date("2026-07-23T07:04:00Z"),
      createdAt: new Date("2026-01-03T00:00:00Z"),
    });
    const app = await buildApp();
    const res = await get(app);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenantId).toBe(TENANT_ID);
    expect(body.tenantName).toBe("Sirope");
    expect(body.cashiers.map((c: any) => c.status)).toEqual([
      "ACTIVE",
      "NO_PIN",
      "REVOKED",
    ]);
    const maria = body.cashiers[0];
    expect(maria.alias).toBe("María");
    expect(maria.email).toBe("maria@sirope.es");
    expect(maria.role).toBe("CASHIER");
    expect(maria.canOpenTpv).toBe(true);
    // Fecha completa en ISO — el front la pinta entera, nunca "hace X".
    expect(maria.lastLoginAt).toBe("2026-07-23T07:04:00.000Z");
    await app.close();
  });

  it("un cajero que nunca ha entrado tiene lastLoginAt null", async () => {
    addUser({
      id: "aaaaaaaa-0000-0000-0000-000000000020",
      email: "recien@sirope.es",
      alias: "Recién dado de alta",
      lastLoginAt: null,
    });
    const app = await buildApp();
    const res = await get(app);
    expect(res.json().cashiers[0].lastLoginAt).toBeNull();
    await app.close();
  });

  it("un tenant sin cajeros devuelve la lista vacía, no un 404", async () => {
    const app = await buildApp();
    const res = await get(app);
    expect(res.statusCode).toBe(200);
    expect(res.json().cashiers).toEqual([]);
    await app.close();
  });

  it("no mezcla cajeros de otro tenant", async () => {
    addUser({
      id: "aaaaaaaa-0000-0000-0000-000000000030",
      email: "mia@sirope.es",
      alias: "Mía",
    });
    addUser({
      id: "aaaaaaaa-0000-0000-0000-000000000031",
      email: "ajena@cachictos.es",
      alias: "Ajena",
      tenantId: OTHER_TENANT_ID,
    });
    const app = await buildApp();
    const res = await get(app);
    expect(res.json().cashiers.map((c: any) => c.alias)).toEqual(["Mía"]);
    await app.close();
  });

  it("marca el cajero técnico de pruebas y lo da por revocado tras activar", async () => {
    addUser({
      id: "aaaaaaaa-0000-0000-0000-000000000040",
      email: "test@sirope.test",
      alias: "Cajero de pruebas",
      isTestCashier: true,
      deletedAt: new Date("2026-06-01T10:00:00Z"),
    });
    const app = await buildApp();
    const c = (await get(app)).json().cashiers[0];
    expect(c.isTestCashier).toBe(true);
    expect(c.status).toBe("REVOKED");
    expect(c.canOpenTpv).toBe(false);
    await app.close();
  });

  it("distingue el origen del último acceso: CASHIER sólo entra por el TPV", async () => {
    addUser({
      id: "aaaaaaaa-0000-0000-0000-000000000050",
      email: "cajera@sirope.es",
      alias: "Cajera",
      role: "CASHIER",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    addUser({
      id: "aaaaaaaa-0000-0000-0000-000000000051",
      email: "encargado@sirope.es",
      alias: "Encargado",
      role: "MANAGER",
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });
    addUser({
      id: "aaaaaaaa-0000-0000-0000-000000000052",
      email: "duena@sirope.es",
      alias: "Dueña",
      role: "OWNER",
      createdAt: new Date("2026-01-03T00:00:00Z"),
    });
    const app = await buildApp();
    const rows = (await get(app)).json().cashiers;
    expect(rows.map((c: any) => [c.role, c.lastLoginSource])).toEqual([
      ["CASHIER", "TPV"],
      ["MANAGER", "TPV_O_ADMIN"],
      ["OWNER", "TPV_O_ADMIN"],
    ]);
    await app.close();
  });
});

// ── Auditoría, límite y acceso ───────────────────────────────────────

describe("GET /super-admin/tenants/:id/cashiers · auditoría y límite", () => {
  it("audita cada consulta con quién, qué tenant y cuántos cajeros", async () => {
    addUser({
      id: "aaaaaaaa-0000-0000-0000-000000000060",
      email: "maria@sirope.es",
      alias: "María",
    });
    const app = await buildApp();
    await get(app);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("view_tenant_cashiers");
    expect(audits[0]!.superAdminId).toBe(SUPER_ADMIN_ID);
    expect(audits[0]!.tenantId).toBe(TENANT_ID);
    expect(audits[0]!.metadata.cashiersReturned).toBe(1);
    expect(audits[0]!.metadata).toHaveProperty("ipAddress");
    expect(audits[0]!.metadata).toHaveProperty("userAgent");
    await app.close();
  });

  it("pasado el límite de lecturas devuelve 429 sin tocar la BD", async () => {
    const app = await buildApp();
    // El throttle es por super-admin: 60 lecturas / 5 min. Lo agotamos
    // fijando el contador justo en el límite.
    counters.set(`super-admin-cashier-read:${SUPER_ADMIN_ID}`, 60);
    ttls.set(`super-admin-cashier-read:${SUPER_ADMIN_ID}`, 120);
    const res = await get(app);
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("RATE_LIMITED");
    expect(res.json().retryAfterSeconds).toBe(120);
    expect(fakePrisma.user.findMany).not.toHaveBeenCalled();
    expect(audits).toHaveLength(0);
    await app.close();
  });

  it("tenant inexistente devuelve 404 y no audita", async () => {
    const app = await buildApp();
    const res = await get(app, "44444444-4444-4444-4444-444444444444");
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("TENANT_NOT_FOUND");
    expect(audits).toHaveLength(0);
    await app.close();
  });

  it("sin token super-admin devuelve 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/super-admin/tenants/${TENANT_ID}/cashiers`,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("no expone ninguna ruta de escritura sobre los cajeros del tenant", async () => {
    const app = await buildApp();
    for (const method of ["POST", "PATCH", "DELETE"] as const) {
      const res = await app.inject({
        method,
        url: `/super-admin/tenants/${TENANT_ID}/cashiers`,
        headers: { authorization: `Bearer ${token()}` },
      });
      expect(res.statusCode).toBe(404);
    }
    await app.close();
  });
});
