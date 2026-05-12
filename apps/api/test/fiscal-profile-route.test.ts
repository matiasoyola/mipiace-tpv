// Test de PUT /auth/me/fiscal-profile (B2 §4.1). Verifica merge,
// guardado en JSON y autenticación.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeTenantRow {
  id: string;
  name: string;
  fiscalProfile: object | null;
  holdedApiKeyCiphertext: string | null;
  initialSyncStatus: string;
  lastIncrementalSyncAt: Date | null;
}

const tenantStore = new Map<string, FakeTenantRow>();
const userStore = new Map<string, { id: string; tenantId: string; email: string; role: string }>();

const fakePrisma = {
  tenant: {
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const t = tenantStore.get(where.id);
      if (!t) throw new Error("not found");
      return t;
    }),
    findUnique: vi.fn(async ({ where }: any) => tenantStore.get(where.id) ?? null),
    update: vi.fn(async ({ where, data }: any) => {
      const t = tenantStore.get(where.id);
      if (!t) throw new Error("not found");
      if (data.fiscalProfile !== undefined) t.fiscalProfile = data.fiscalProfile;
      return t;
    }),
  },
  user: {
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const u = userStore.get(where.id);
      if (!u) throw new Error("not found");
      return u;
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerAuthRoutes } = await import("../src/auth/routes.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const ACCESS_TOKEN = signAccessToken({ sub: USER_ID, tid: TENANT_ID, role: "OWNER" });

async function buildApp() {
  const app = Fastify();
  await registerAuthRoutes(app);
  return app;
}

beforeEach(() => {
  tenantStore.clear();
  userStore.clear();
  tenantStore.set(TENANT_ID, {
    id: TENANT_ID,
    name: "Test biz",
    fiscalProfile: { source: "warehouse_default", name: "Almacén Madrid" },
    holdedApiKeyCiphertext: "v1:ciphertext",
    initialSyncStatus: "DONE",
    lastIncrementalSyncAt: null,
  });
  userStore.set(USER_ID, {
    id: USER_ID,
    tenantId: TENANT_ID,
    email: "owner@test.com",
    role: "OWNER",
  });
});

describe("PUT /auth/me/fiscal-profile", () => {
  it("happy path: persiste el form y marca source=manual", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/auth/me/fiscal-profile",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: {
        businessName: "Librería Thalia, S.L.",
        nif: "B12345678",
        address: "Calle Mayor 47",
        city: "Madrid",
        postalCode: "28013",
        country: "España",
      },
    });
    expect(res.statusCode).toBe(200);
    const fp = res.json().fiscalProfile;
    expect(fp.businessName).toBe("Librería Thalia, S.L.");
    expect(fp.nif).toBe("B12345678");
    expect(fp.source).toBe("manual");
    expect(fp.updatedAt).toBeTruthy();
    await app.close();
  });

  it("merge: edición parcial preserva campos anteriores", async () => {
    tenantStore.get(TENANT_ID)!.fiscalProfile = {
      source: "manual",
      businessName: "Antiguo SL",
      nif: "A1",
      address: "Antigua calle",
    };
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/auth/me/fiscal-profile",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { businessName: "Nuevo SL" },
    });
    expect(res.statusCode).toBe(200);
    const fp = res.json().fiscalProfile;
    expect(fp.businessName).toBe("Nuevo SL");
    expect(fp.nif).toBe("A1"); // preservado
    expect(fp.address).toBe("Antigua calle");
    await app.close();
  });

  it("rechaza sin auth → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/auth/me/fiscal-profile",
      payload: { businessName: "X" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /auth/me (ampliado en B2)", () => {
  it("incluye fiscalProfile y lastIncrementalSyncAt", async () => {
    tenantStore.get(TENANT_ID)!.lastIncrementalSyncAt = new Date("2026-05-12T09:00:00Z");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenant.fiscalProfile).toBeTruthy();
    expect(body.tenant.lastIncrementalSyncAt).toBe("2026-05-12T09:00:00.000Z");
    await app.close();
  });
});
