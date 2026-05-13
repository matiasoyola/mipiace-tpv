// Tests de GET/POST /admin/tenant/settings (B6 §4).

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
const OWNER_ID = "00000000-0000-0000-0000-0000000000aa";
const MANAGER_ID = "00000000-0000-0000-0000-0000000000bb";

interface FakeTenant {
  id: string;
  cashierAutoLogoutMinutes: number;
  requireManagerPinForForceClose: boolean;
  deviceNewLoginAlertEnabled: boolean;
  discountThresholdPct: number;
  cashierSearchableContacts: boolean;
}

const tenants = new Map<string, FakeTenant>();

const fakePrisma = {
  tenant: {
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const t = tenants.get(where.id);
      if (!t) throw new Error("not found");
      return t;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = tenants.get(where.id);
      if (!t) throw new Error("not found");
      for (const [k, v] of Object.entries(data)) {
        if (v !== undefined) (t as any)[k] = v;
      }
      return t;
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

function tokenFor(role: "OWNER" | "MANAGER", userId: string) {
  return signAccessToken({ sub: userId, tid: TENANT, role });
}

beforeEach(() => {
  tenants.clear();
  vi.clearAllMocks();
  tenants.set(TENANT, {
    id: TENANT,
    cashierAutoLogoutMinutes: 10,
    requireManagerPinForForceClose: true,
    deviceNewLoginAlertEnabled: true,
    discountThresholdPct: 10,
    cashierSearchableContacts: true,
  });
});

async function buildApp() {
  const app = Fastify();
  await registerAdminTenantSettingsRoutes(app);
  return app;
}

describe("/admin/tenant/settings (B6 §4)", () => {
  it("OWNER ve y edita todos los flags", async () => {
    const app = await buildApp();
    const owner = `Bearer ${tokenFor("OWNER", OWNER_ID)}`;

    const get = await app.inject({
      method: "GET",
      url: "/admin/tenant/settings",
      headers: { authorization: owner },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().settings.discountThresholdPct).toBe(10);

    const post = await app.inject({
      method: "POST",
      url: "/admin/tenant/settings",
      headers: { authorization: owner },
      payload: {
        cashierAutoLogoutMinutes: 30,
        discountThresholdPct: 15,
        cashierSearchableContacts: false,
      },
    });
    expect(post.statusCode).toBe(200);
    const body = post.json();
    expect(body.settings.cashierAutoLogoutMinutes).toBe(30);
    expect(body.settings.discountThresholdPct).toBe(15);
    expect(body.settings.cashierSearchableContacts).toBe(false);
    expect(body.settings.requireManagerPinForForceClose).toBe(true);
  });

  it("MANAGER puede leer pero NO editar (403)", async () => {
    const app = await buildApp();
    const manager = `Bearer ${tokenFor("MANAGER", MANAGER_ID)}`;

    const get = await app.inject({
      method: "GET",
      url: "/admin/tenant/settings",
      headers: { authorization: manager },
    });
    expect(get.statusCode).toBe(200);

    const post = await app.inject({
      method: "POST",
      url: "/admin/tenant/settings",
      headers: { authorization: manager },
      payload: { discountThresholdPct: 50 },
    });
    expect(post.statusCode).toBe(403);
    expect(post.json().error).toBe("FORBIDDEN");
  });

  it("valida rangos del schema: autoLogout fuera de 5-60 → 400", async () => {
    const app = await buildApp();
    const owner = `Bearer ${tokenFor("OWNER", OWNER_ID)}`;
    const res = await app.inject({
      method: "POST",
      url: "/admin/tenant/settings",
      headers: { authorization: owner },
      payload: { cashierAutoLogoutMinutes: 200 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("valida discountThresholdPct fuera de 0-100 → 400", async () => {
    const app = await buildApp();
    const owner = `Bearer ${tokenFor("OWNER", OWNER_ID)}`;
    const res = await app.inject({
      method: "POST",
      url: "/admin/tenant/settings",
      headers: { authorization: owner },
      payload: { discountThresholdPct: 200 },
    });
    expect(res.statusCode).toBe(400);
  });
});
