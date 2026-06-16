// B3 §17.3. 2FA TOTP + recovery codes:
//   - enable → confirm activa twoFactorEnabledAt
//   - login con TOTP correcto OK
//   - login con recovery code marca usedAt y no se puede reutilizar
//   - disable requiere password + TOTP

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import speakeasy from "speakeasy";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeUser {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string | null;
  role: "OWNER" | "MANAGER" | "CASHIER";
  tokenVersion: number;
  twoFactorSecret: string | null;
  twoFactorEnabledAt: Date | null;
  twoFactorRecoveryCodes: unknown;
  lastLoginAt?: Date | null;
}

interface FakeTenant {
  id: string;
  name: string;
  holdedApiKeyCiphertext: string | null;
  initialSyncStatus: string;
}

const users = new Map<string, FakeUser>();
const tenants = new Map<string, FakeTenant>();

const fakePrisma = {
  user: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id) return users.get(where.id) ?? null;
      if (where.email) {
        for (const u of users.values()) if (u.email === where.email) return u;
        return null;
      }
      return null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const u = users.get(where.id);
      if (!u) throw new Error("not found");
      return u;
    }),
    update: vi.fn(async ({ where, data, select }: any) => {
      const u = users.get(where.id);
      if (!u) throw new Error("not found");
      if (data.twoFactorSecret !== undefined) u.twoFactorSecret = data.twoFactorSecret;
      if (data.twoFactorEnabledAt !== undefined)
        u.twoFactorEnabledAt = data.twoFactorEnabledAt;
      if (data.twoFactorRecoveryCodes !== undefined)
        u.twoFactorRecoveryCodes = data.twoFactorRecoveryCodes;
      if (data.passwordHash !== undefined) u.passwordHash = data.passwordHash;
      if (data.tokenVersion?.increment != null)
        u.tokenVersion += data.tokenVersion.increment;
      if (data.lastLoginAt) u.lastLoginAt = data.lastLoginAt;
      return select?.tokenVersion ? { tokenVersion: u.tokenVersion } : u;
    }),
  },
  tenant: {
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const t = tenants.get(where.id);
      if (!t) throw new Error("not found");
      return t;
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
  expire: vi.fn(async () => 1),
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
    for (const k of keys) if (redisStore.delete(k)) c++;
    return c;
  }),
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  shutdown: async () => undefined,
}));

const { registerAuthRoutes } = await import("../src/auth/routes.js");
const { hashPassword } = await import("../src/auth/passwords.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const OWNER_ID = "00000000-0000-0000-0000-000000000099";
const EMAIL = "owner@test.com";
const PASSWORD = "ownerSecret123";

beforeEach(async () => {
  users.clear();
  tenants.clear();
  redisStore.clear();
  vi.clearAllMocks();
  users.set(OWNER_ID, {
    id: OWNER_ID,
    tenantId: TENANT_ID,
    email: EMAIL,
    passwordHash: await hashPassword(PASSWORD),
    role: "OWNER",
    tokenVersion: 0,
    twoFactorSecret: null,
    twoFactorEnabledAt: null,
    twoFactorRecoveryCodes: null,
  });
  tenants.set(TENANT_ID, {
    id: TENANT_ID,
    name: "Test biz",
    holdedApiKeyCiphertext: null,
    initialSyncStatus: "PENDING",
  });
});

async function buildApp() {
  const app = Fastify({ trustProxy: 1 });
  await registerAuthRoutes(app);
  return app;
}

function ownerBearer(): string {
  return `Bearer ${signAccessToken({ sub: OWNER_ID, tid: TENANT_ID, role: "OWNER" })}`;
}

describe("2FA enable + confirm flow", () => {
  it("enable devuelve qr/secret/recoveryCodes", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/2fa/enable",
      headers: { authorization: ownerBearer() },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.qrDataUrl).toMatch(/^data:image\/png/);
    expect(body.secret).toBeTruthy();
    expect(body.recoveryCodes).toHaveLength(10);
    const u = users.get(OWNER_ID)!;
    expect(u.twoFactorSecret).toBeTruthy();
    expect(u.twoFactorEnabledAt).toBeNull(); // sin confirmar aún
  });

  it("confirm con código correcto activa 2FA", async () => {
    const app = await buildApp();
    const enroll = await app.inject({
      method: "POST",
      url: "/auth/me/2fa/enable",
      headers: { authorization: ownerBearer() },
      payload: {},
    });
    const secret = enroll.json().secret as string;
    const code = speakeasy.totp({ secret, encoding: "base32" });
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/2fa/confirm",
      headers: { authorization: ownerBearer() },
      payload: { code },
    });
    expect(res.statusCode).toBe(200);
    expect(users.get(OWNER_ID)!.twoFactorEnabledAt).not.toBeNull();
  });

  it("login + 2FA: paso 1 devuelve pendingToken, paso 2 valida TOTP", async () => {
    const app = await buildApp();
    // Enroll
    const enroll = await app.inject({
      method: "POST",
      url: "/auth/me/2fa/enable",
      headers: { authorization: ownerBearer() },
      payload: {},
    });
    const secret = enroll.json().secret as string;
    await app.inject({
      method: "POST",
      url: "/auth/me/2fa/confirm",
      headers: { authorization: ownerBearer() },
      payload: { code: speakeasy.totp({ secret, encoding: "base32" }) },
    });

    // Paso 1: email + password
    const step1 = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(step1.statusCode).toBe(200);
    expect(step1.json().requires2fa).toBe(true);
    const pendingToken = step1.json().pendingToken as string;

    // Paso 2: TOTP correcto
    const step2 = await app.inject({
      method: "POST",
      url: "/auth/login/2fa",
      payload: {
        pendingToken,
        code: speakeasy.totp({ secret, encoding: "base32" }),
      },
    });
    expect(step2.statusCode).toBe(200);
    expect(step2.json().accessToken).toBeTruthy();
    expect(step2.json().refreshToken).toBeTruthy();
    expect(step2.json().usedRecoveryCode).toBe(false);
  });

  it("login + 2FA: recovery code se consume al usar y no se puede reutilizar", async () => {
    const app = await buildApp();
    const enroll = await app.inject({
      method: "POST",
      url: "/auth/me/2fa/enable",
      headers: { authorization: ownerBearer() },
      payload: {},
    });
    const secret = enroll.json().secret as string;
    const recovery = (enroll.json().recoveryCodes as string[])[0]!;
    await app.inject({
      method: "POST",
      url: "/auth/me/2fa/confirm",
      headers: { authorization: ownerBearer() },
      payload: { code: speakeasy.totp({ secret, encoding: "base32" }) },
    });

    const step1 = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });
    const pendingToken = step1.json().pendingToken as string;

    const useRecovery = await app.inject({
      method: "POST",
      url: "/auth/login/2fa",
      payload: { pendingToken, code: recovery },
    });
    expect(useRecovery.statusCode).toBe(200);
    expect(useRecovery.json().usedRecoveryCode).toBe(true);

    // Reuse del mismo recovery → 401
    const step1again = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });
    const pendingToken2 = step1again.json().pendingToken as string;
    const reuse = await app.inject({
      method: "POST",
      url: "/auth/login/2fa",
      payload: { pendingToken: pendingToken2, code: recovery },
    });
    expect(reuse.statusCode).toBe(401);
  });

  // v1.5-D · Frente 3: la verificación del código 2FA en el login está
  // throttleada por CUENTA (clave por sub, sin IP). El código es de 6
  // dígitos, fuerza-bruteable dentro de la validez del pendingToken sin
  // esto. Cada intento llega desde una IP distinta (X-Forwarded-For
  // rotado) para demostrar que rotar de IP NO crea buckets nuevos: el
  // bucket es la cuenta, no la IP.
  it("login + 2FA: 5 códigos erróneos (IP rotada) y el 6º intento devuelve 429", async () => {
    const app = await buildApp();
    const enroll = await app.inject({
      method: "POST",
      url: "/auth/me/2fa/enable",
      headers: { authorization: ownerBearer() },
      payload: {},
    });
    const secret = enroll.json().secret as string;
    await app.inject({
      method: "POST",
      url: "/auth/me/2fa/confirm",
      headers: { authorization: ownerBearer() },
      payload: { code: speakeasy.totp({ secret, encoding: "base32" }) },
    });

    const step1 = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });
    const pendingToken = step1.json().pendingToken as string;

    for (let i = 0; i < 5; i++) {
      const wrong = await app.inject({
        method: "POST",
        url: "/auth/login/2fa",
        headers: { "x-forwarded-for": `45.0.0.${i}, 203.0.113.${i}` },
        payload: { pendingToken, code: "000000" },
      });
      expect(wrong.statusCode).not.toBe(429);
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/auth/login/2fa",
      headers: { "x-forwarded-for": "45.0.0.250, 203.0.113.250" },
      payload: { pendingToken, code: "000000" },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe("RATE_LIMITED");
  });

  it("disable requiere password + código actual", async () => {
    const app = await buildApp();
    const enroll = await app.inject({
      method: "POST",
      url: "/auth/me/2fa/enable",
      headers: { authorization: ownerBearer() },
      payload: {},
    });
    const secret = enroll.json().secret as string;
    await app.inject({
      method: "POST",
      url: "/auth/me/2fa/confirm",
      headers: { authorization: ownerBearer() },
      payload: { code: speakeasy.totp({ secret, encoding: "base32" }) },
    });

    // Password incorrecta
    const badPwd = await app.inject({
      method: "POST",
      url: "/auth/me/2fa/disable",
      headers: { authorization: ownerBearer() },
      payload: { password: "nope", code: speakeasy.totp({ secret, encoding: "base32" }) },
    });
    expect(badPwd.statusCode).toBe(401);

    // Código incorrecto
    const badCode = await app.inject({
      method: "POST",
      url: "/auth/me/2fa/disable",
      headers: { authorization: ownerBearer() },
      payload: { password: PASSWORD, code: "000000" },
    });
    expect(badCode.statusCode).toBe(401);

    // Ambos correctos → OK
    const ok = await app.inject({
      method: "POST",
      url: "/auth/me/2fa/disable",
      headers: { authorization: ownerBearer() },
      payload: { password: PASSWORD, code: speakeasy.totp({ secret, encoding: "base32" }) },
    });
    expect(ok.statusCode).toBe(200);
    const u = users.get(OWNER_ID)!;
    expect(u.twoFactorEnabledAt).toBeNull();
    expect(u.twoFactorSecret).toBeNull();
  });
});
