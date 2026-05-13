// B3 §2.2. Rate limit del login del cajero: 5 fallos en 5 min → 429
// durante 15 min. Mockea Prisma + Redis en memoria.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeUser {
  id: string;
  tenantId: string;
  email: string;
  pinHash: string;
  role: "MANAGER" | "CASHIER";
}

interface FakeTenant {
  id: string;
  cashierAutoLogoutMinutes: number;
}

interface FakeDevice {
  id: string;
  tenantId: string;
  registerId: string;
  deviceTokenHash: string;
  revokedAt: Date | null;
}

const users = new Map<string, FakeUser>();
const tenants = new Map<string, FakeTenant>();
const devices = new Map<string, FakeDevice>();

const fakePrisma = {
  user: {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const u of users.values()) {
        if (where.tenantId && u.tenantId !== where.tenantId) continue;
        if (where.email && u.email !== where.email) continue;
        if (where.role?.in && !where.role.in.includes(u.role)) continue;
        return u;
      }
      return null;
    }),
    update: vi.fn(async () => undefined),
  },
  tenant: {
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const t = tenants.get(where.id);
      if (!t) throw new Error("not found");
      return t;
    }),
  },
  device: {
    findUnique: vi.fn(async ({ where }: { where: { deviceTokenHash: string } }) => {
      for (const d of devices.values()) {
        if (d.deviceTokenHash === where.deviceTokenHash) return d;
      }
      return null;
    }),
  },
  shift: {
    findFirst: vi.fn(async () => null),
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

const { registerCashierAuthRoutes } = await import("../src/shift/cashier-auth.js");
const { hashPassword } = await import("../src/auth/passwords.js");
const { hashDeviceToken } = await import("../src/devices/auth.js");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const REGISTER_ID = "00000000-0000-0000-0000-0000000000aa";
const DEVICE_ID = "00000000-0000-0000-0000-0000000000bb";
const USER_ID = "00000000-0000-0000-0000-000000000099";
const EMAIL = "lucia@test.com";
const PIN = "1234";
const DEVICE_TOKEN = "tok_" + randomBytes(24).toString("base64url");

beforeEach(async () => {
  users.clear();
  tenants.clear();
  devices.clear();
  redisStore.clear();
  vi.clearAllMocks();
  users.set(USER_ID, {
    id: USER_ID,
    tenantId: TENANT_ID,
    email: EMAIL,
    pinHash: await hashPassword(PIN),
    role: "CASHIER",
  });
  tenants.set(TENANT_ID, { id: TENANT_ID, cashierAutoLogoutMinutes: 10 });
  devices.set(DEVICE_ID, {
    id: DEVICE_ID,
    tenantId: TENANT_ID,
    registerId: REGISTER_ID,
    deviceTokenHash: hashDeviceToken(DEVICE_TOKEN),
    revokedAt: null,
  });
});

async function buildApp() {
  const app = Fastify();
  await registerCashierAuthRoutes(app);
  return app;
}

describe("POST /shift/cashier-login", () => {
  it("PIN correcto → 200 + sessionToken + shiftState needsShiftOpen", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/shift/cashier-login",
      headers: { "x-device-token": DEVICE_TOKEN },
      payload: { email: EMAIL, pin: PIN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionToken).toBeTruthy();
    expect(body.user.email).toBe(EMAIL);
    expect(body.shiftState.kind).toBe("needsShiftOpen");
  });

  it("PIN incorrecto → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/shift/cashier-login",
      headers: { "x-device-token": DEVICE_TOKEN },
      payload: { email: EMAIL, pin: "0000" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("INVALID_CREDENTIALS");
  });

  it("falta X-Device-Token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/shift/cashier-login",
      payload: { email: EMAIL, pin: PIN },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("DEVICE_TOKEN_REQUIRED");
  });

  it("device revocado → 401 DEVICE_REVOKED", async () => {
    devices.get(DEVICE_ID)!.revokedAt = new Date();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/shift/cashier-login",
      headers: { "x-device-token": DEVICE_TOKEN },
      payload: { email: EMAIL, pin: PIN },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("DEVICE_REVOKED");
  });

  it("rate limit dispara tras 5 fallos consecutivos", async () => {
    const app = await buildApp();
    for (let i = 0; i < 4; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/shift/cashier-login",
        headers: { "x-device-token": DEVICE_TOKEN },
        payload: { email: EMAIL, pin: "0000" },
      });
      expect(r.statusCode).toBe(401);
    }
    // 5º fallo → registerFailure dispara lock interno
    const fifth = await app.inject({
      method: "POST",
      url: "/shift/cashier-login",
      headers: { "x-device-token": DEVICE_TOKEN },
      payload: { email: EMAIL, pin: "0000" },
    });
    expect(fifth.statusCode).toBe(401);
    // 6º intento — incluso con PIN correcto — debe rebotar con 429.
    const sixth = await app.inject({
      method: "POST",
      url: "/shift/cashier-login",
      headers: { "x-device-token": DEVICE_TOKEN },
      payload: { email: EMAIL, pin: PIN },
    });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error).toBe("RATE_LIMITED");
    expect(sixth.json().retryAfterSeconds).toBeGreaterThan(0);
  });

  it("rate limit se resetea tras un login exitoso", async () => {
    const app = await buildApp();
    // 3 fallos
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "POST",
        url: "/shift/cashier-login",
        headers: { "x-device-token": DEVICE_TOKEN },
        payload: { email: EMAIL, pin: "0000" },
      });
    }
    // 1 éxito → reset
    const ok = await app.inject({
      method: "POST",
      url: "/shift/cashier-login",
      headers: { "x-device-token": DEVICE_TOKEN },
      payload: { email: EMAIL, pin: PIN },
    });
    expect(ok.statusCode).toBe(200);
    // Otros 4 fallos no deben dispararnos.
    for (let i = 0; i < 4; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/shift/cashier-login",
        headers: { "x-device-token": DEVICE_TOKEN },
        payload: { email: EMAIL, pin: "0000" },
      });
      expect(r.statusCode).toBe(401);
    }
  });
});
