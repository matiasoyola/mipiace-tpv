// Tests de POST /admin/auth/manager-authorize (B6 §2.3).
// Mockea Prisma + Redis en memoria, igual que cashier-login.

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
const MANAGER_ID = "00000000-0000-0000-0000-0000000000aa";
const REGISTER_ID = "00000000-0000-0000-0000-0000000000bb";
const DEVICE_ID = "00000000-0000-0000-0000-0000000000cc";
const CASHIER_ID = "00000000-0000-0000-0000-0000000000dd";
const MANAGER_EMAIL = "encargado@test.com";
const MANAGER_PIN = "4321";

interface FakeUser {
  id: string;
  tenantId: string;
  email: string;
  pinHash: string | null;
  role: "OWNER" | "MANAGER" | "CASHIER";
}

const users = new Map<string, FakeUser>();

const fakePrisma = {
  user: {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const u of users.values()) {
        if (where.tenantId && u.tenantId !== where.tenantId) continue;
        if (where.email && u.email !== where.email) continue;
        if (where.role) {
          if (typeof where.role === "string") {
            if (u.role !== where.role) continue;
          } else if (Array.isArray(where.role.in)) {
            if (!where.role.in.includes(u.role)) continue;
          }
        }
        return u;
      }
      return null;
    }),
  },
} as const;

const redisStore = new Map<string, { value: string; expiresAt: number }>();
const fakeRedis = {
  incr: vi.fn(async (key: string) => {
    const existing = redisStore.get(key);
    const fresh = !existing || existing.expiresAt <= Date.now();
    const value = fresh ? 1 : Number(existing!.value) + 1;
    redisStore.set(key, {
      value: String(value),
      expiresAt: existing?.expiresAt ?? Date.now() + 24 * 60 * 60 * 1000,
    });
    return value;
  }),
  expire: vi.fn(async (key: string, seconds: number) => {
    const e = redisStore.get(key);
    if (!e) return 0;
    e.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }),
  ttl: vi.fn(async (key: string) => {
    const e = redisStore.get(key);
    if (!e) return -2;
    const ms = e.expiresAt - Date.now();
    return ms <= 0 ? -2 : Math.ceil(ms / 1000);
  }),
  set: vi.fn(async (key: string, value: string, _ex: string, seconds: number) => {
    redisStore.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return "OK";
  }),
  get: vi.fn(async (key: string) => {
    const e = redisStore.get(key);
    if (!e || e.expiresAt <= Date.now()) return null;
    return e.value;
  }),
  del: vi.fn(async (...keys: string[]) => {
    let c = 0;
    for (const k of keys) {
      if (redisStore.delete(k)) c++;
    }
    return c;
  }),
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  shutdown: async () => undefined,
}));

const { registerManagerAuthorizationRoutes } = await import(
  "../src/admin/manager-authorize.js"
);
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { verifyManagerAuthorization } = await import(
  "../src/auth/manager-authorization.js"
);
const { hashPassword } = await import("../src/auth/passwords.js");

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

beforeEach(async () => {
  users.clear();
  redisStore.clear();
  vi.clearAllMocks();
  users.set(MANAGER_ID, {
    id: MANAGER_ID,
    tenantId: TENANT,
    email: MANAGER_EMAIL,
    pinHash: await hashPassword(MANAGER_PIN),
    role: "MANAGER",
  });
});

async function buildApp() {
  const app = Fastify();
  await registerManagerAuthorizationRoutes(app);
  return app;
}

describe("POST /admin/auth/manager-authorize (B6 §2)", () => {
  it("happy path → 200 + token válido", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/auth/manager-authorize",
      headers: { authorization: `Bearer ${signSession()}` },
      payload: {
        managerEmail: MANAGER_EMAIL,
        managerPin: MANAGER_PIN,
        reason: "discount_over_threshold",
        ticketContext: { discountPct: 25, total: 50 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.managerEmail).toBe(MANAGER_EMAIL);
    expect(body.expiresInSeconds).toBe(5 * 60);
    const payload = verifyManagerAuthorization(body.authorizationToken);
    expect(payload.tid).toBe(TENANT);
    expect(payload.sub).toBe(MANAGER_ID);
    expect(payload.purpose).toBe("discount-override");
    expect(payload.context.maxDiscountPct).toBe(100);
  });

  it("PIN incorrecto → 401 INVALID_MANAGER_CREDENTIALS", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/auth/manager-authorize",
      headers: { authorization: `Bearer ${signSession()}` },
      payload: {
        managerEmail: MANAGER_EMAIL,
        managerPin: "0000",
        reason: "discount_over_threshold",
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("INVALID_MANAGER_CREDENTIALS");
  });

  it("email no es de un MANAGER → 401 genérico (no filtra existencia)", async () => {
    // Mismo email pero con rol distinto: el filtro role: MANAGER lo
    // descarta — el rate-limit aplica igual que en email inexistente.
    users.get(MANAGER_ID)!.role = "CASHIER";
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/auth/manager-authorize",
      headers: { authorization: `Bearer ${signSession()}` },
      payload: {
        managerEmail: MANAGER_EMAIL,
        managerPin: MANAGER_PIN,
        reason: "discount_over_threshold",
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("INVALID_MANAGER_CREDENTIALS");
  });

  it("sin sesión de cajero → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/auth/manager-authorize",
      payload: {
        managerEmail: MANAGER_EMAIL,
        managerPin: MANAGER_PIN,
        reason: "discount_over_threshold",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rate limit dispara tras 5 PINs incorrectos", async () => {
    const app = await buildApp();
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/admin/auth/manager-authorize",
        headers: { authorization: `Bearer ${signSession()}` },
        payload: {
          managerEmail: MANAGER_EMAIL,
          managerPin: "0000",
          reason: "discount_over_threshold",
        },
      });
      expect(r.statusCode).toBe(401);
    }
    // 6º — incluso con PIN correcto, 429.
    const sixth = await app.inject({
      method: "POST",
      url: "/admin/auth/manager-authorize",
      headers: { authorization: `Bearer ${signSession()}` },
      payload: {
        managerEmail: MANAGER_EMAIL,
        managerPin: MANAGER_PIN,
        reason: "discount_over_threshold",
      },
    });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error).toBe("RATE_LIMITED");
  });
});
