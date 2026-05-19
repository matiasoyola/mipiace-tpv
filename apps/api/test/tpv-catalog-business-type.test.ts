// B-Multi-Vertical SB3: GET /tpv/catalog/products devuelve `businessType`
// del tenant. El TPV cachea el valor en localStorage al primer pull y
// lo usa para decidir icono placeholder y si entra al mapa de mesas.
// El campo sólo aparece en la primera página (cursor vacío) — en
// páginas siguientes se omite porque el cliente ya lo cacheó.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001";
const REGISTER_ID = "00000000-0000-0000-0000-0000000000bb";
const DEVICE_ID = "00000000-0000-0000-0000-0000000000cc";
const CASHIER_ID = "00000000-0000-0000-0000-0000000000dd";

interface FakeTenantRow {
  id: string;
  businessType: "HOSPITALITY" | "RETAIL" | "SERVICES";
}

const tenants = new Map<string, FakeTenantRow>();

const fakePrisma = {
  tenant: {
    findUnique: vi.fn(async ({ where, select }: any) => {
      void select;
      const t = tenants.get(where.id);
      if (!t) return null;
      return { businessType: t.businessType };
    }),
  },
  product: {
    findMany: vi.fn(async () => []),
  },
  modifierGroup: {
    findMany: vi.fn(async () => []),
  },
  ticket: {
    count: vi.fn(async () => 0),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

vi.mock("../src/tickets/health.js", () => ({
  getTenantHealthStatus: vi.fn(async () => ({
    level: "ok",
    reason: "ok",
    hasHoldedKey: true,
    lastSuccessfulSyncAt: null,
    lastSyncAgeMs: null,
    blockedAt: null,
  })),
}));

const { registerTpvCatalogRoutes } = await import(
  "../src/tpv-catalog/routes.js"
);
const { signCashierSession } = await import(
  "../src/shift/cashier-session.js"
);

function signSession() {
  return signCashierSession(
    {
      sub: CASHIER_ID,
      tid: TENANT,
      did: DEVICE_ID,
      rid: REGISTER_ID,
      role: "CASHIER",
    },
    10,
  );
}

async function buildApp() {
  const app = Fastify();
  await registerTpvCatalogRoutes(app);
  return app;
}

beforeEach(() => {
  tenants.clear();
  vi.clearAllMocks();
});

describe("GET /tpv/catalog/products · businessType", () => {
  it("devuelve businessType=HOSPITALITY en la primera página", async () => {
    tenants.set(TENANT, { id: TENANT, businessType: "HOSPITALITY" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/tpv/catalog/products",
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenantId).toBe(TENANT);
    expect(body.businessType).toBe("HOSPITALITY");
    await app.close();
  });

  it("devuelve businessType=RETAIL para tenants retail (Thalia)", async () => {
    tenants.set(TENANT, { id: TENANT, businessType: "RETAIL" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/tpv/catalog/products",
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().businessType).toBe("RETAIL");
    await app.close();
  });

  it("devuelve businessType=SERVICES", async () => {
    tenants.set(TENANT, { id: TENANT, businessType: "SERVICES" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/tpv/catalog/products",
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().businessType).toBe("SERVICES");
    await app.close();
  });

  it("omite businessType en páginas siguientes (cursor presente)", async () => {
    tenants.set(TENANT, { id: TENANT, businessType: "RETAIL" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url:
        "/tpv/catalog/products?cursor=11111111-1111-1111-1111-111111111111",
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenantId).toBe(TENANT);
    expect(body.businessType).toBeUndefined();
    // Sólo se consulta el tenant en la primera página.
    expect(fakePrisma.tenant.findUnique).not.toHaveBeenCalled();
    await app.close();
  });

  it("rechaza sin auth de cajero → 401", async () => {
    tenants.set(TENANT, { id: TENANT, businessType: "RETAIL" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/tpv/catalog/products",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
