// Integration test del flujo de auth con tokenVersion + "Recuérdame" +
// logout-everywhere (B2 §4.3). Mockea Prisma en memoria.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
// TTL cortos para que los expect de duración (rmb=0 vs rmb=1) sean
// inequívocos sin esperar.
process.env.JWT_REFRESH_TTL = "30d";
process.env.JWT_REFRESH_TTL_REMEMBER = "90d";

import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeUserRow {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string | null;
  role: "OWNER" | "MANAGER" | "CASHIER";
  tokenVersion: number;
  lastLoginAt?: Date | null;
}

interface FakeTenantRow {
  id: string;
  name: string;
  holdedApiKeyCiphertext: string | null;
  initialSyncStatus: string;
}

const userStore = new Map<string, FakeUserRow>();
const emailIndex = new Map<string, string>();
const tenantStore = new Map<string, FakeTenantRow>();

const fakePrisma = {
  user: {
    findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
      if (where.id) return userStore.get(where.id) ?? null;
      if (where.email) {
        const id = emailIndex.get(where.email);
        return id ? userStore.get(id) ?? null : null;
      }
      return null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const u = userStore.get(where.id);
      if (!u) throw new Error("not found");
      return u;
    }),
    update: vi.fn(async ({ where, data, select }: any) => {
      const u = userStore.get(where.id);
      if (!u) throw new Error("not found");
      if (data.tokenVersion?.increment != null) {
        u.tokenVersion += data.tokenVersion.increment;
      } else if (typeof data.tokenVersion === "number") {
        u.tokenVersion = data.tokenVersion;
      }
      if (data.lastLoginAt) u.lastLoginAt = data.lastLoginAt;
      if (select?.tokenVersion) return { tokenVersion: u.tokenVersion };
      return u;
    }),
  },
  tenant: {
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const t = tenantStore.get(where.id);
      if (!t) throw new Error("not found");
      return t;
    }),
  },
} as const;

// Fake Redis para soportar el rate-limit del login (B3 §17.1).
const redisStore = new Map<string, { value: string; expiresAt: number }>();
const fakeRedis = {
  ping: async () => "PONG",
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
const { signRefreshToken, verifyRefreshToken } = await import("../src/auth/tokens.js");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const EMAIL = "owner@test.com";
const PASSWORD = "supersecret123";

async function buildApp() {
  const app = Fastify();
  await registerAuthRoutes(app);
  return app;
}

beforeEach(async () => {
  userStore.clear();
  emailIndex.clear();
  tenantStore.clear();
  const passwordHash = await hashPassword(PASSWORD);
  userStore.set(USER_ID, {
    id: USER_ID,
    tenantId: TENANT_ID,
    email: EMAIL,
    passwordHash,
    role: "OWNER",
    tokenVersion: 0,
  });
  emailIndex.set(EMAIL, USER_ID);
  tenantStore.set(TENANT_ID, {
    id: TENANT_ID,
    name: "Test biz",
    holdedApiKeyCiphertext: null,
    initialSyncStatus: "PENDING",
  });
});

function decode(token: string) {
  return jwt.decode(token) as Record<string, unknown>;
}

describe("signRefreshToken / verifyRefreshToken", () => {
  it("incluye tv en el payload y verifyRefreshToken lo devuelve", () => {
    const token = signRefreshToken({ sub: USER_ID, tid: TENANT_ID }, { tv: 7 });
    const payload = verifyRefreshToken(token);
    expect(payload.tv).toBe(7);
    expect(payload.rmb).toBe(0);
  });

  it("remember=true → rmb=1 y TTL distinto", () => {
    const without = signRefreshToken({ sub: USER_ID, tid: TENANT_ID }, { tv: 0 });
    const withRemember = signRefreshToken(
      { sub: USER_ID, tid: TENANT_ID },
      { tv: 0, remember: true },
    );
    const dWithout = decode(without);
    const dWith = decode(withRemember);
    expect(dWithout.rmb).toBe(0);
    expect(dWith.rmb).toBe(1);
    // TTL distinto: el rmb=1 expira más tarde que el rmb=0.
    expect(dWith.exp as number).toBeGreaterThan(dWithout.exp as number);
  });

  it("rechaza tokens sin tv (refresh emitido antes de B2)", () => {
    // Firmamos a mano un payload sin tv para simular un refresh viejo.
    const legacy = jwt.sign(
      { sub: USER_ID, tid: TENANT_ID, type: "refresh" },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: "1d" },
    );
    expect(() => verifyRefreshToken(legacy)).toThrow(/tv/);
  });
});

describe("POST /auth/login", () => {
  it("sin remember → refresh con rmb=0", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(decode(body.refreshToken).rmb).toBe(0);
    await app.close();
  });

  it("con remember:true → refresh con rmb=1", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD, remember: true },
    });
    expect(res.statusCode).toBe(200);
    expect(decode(res.json().refreshToken).rmb).toBe(1);
    await app.close();
  });

  it("incluye tokenVersion actual del usuario en el refresh", async () => {
    const user = userStore.get(USER_ID)!;
    user.tokenVersion = 42;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });
    expect(decode(res.json().refreshToken).tv).toBe(42);
    await app.close();
  });
});

describe("POST /auth/refresh", () => {
  it("happy path: rota tokens y devuelve uno nuevo con mismo tv", async () => {
    const app = await buildApp();
    const refreshToken = signRefreshToken({ sub: USER_ID, tid: TENANT_ID }, { tv: 0 });
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(decode(body.refreshToken).tv).toBe(0);
    await app.close();
  });

  it("rechaza refresh con tv desfasado (sesión revocada)", async () => {
    const user = userStore.get(USER_ID)!;
    user.tokenVersion = 5;
    const stale = signRefreshToken({ sub: USER_ID, tid: TENANT_ID }, { tv: 4 });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: stale },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toMatch(/revocada/i);
    await app.close();
  });

  it("preserva rmb del refresh original al rotar", async () => {
    const app = await buildApp();
    const refreshToken = signRefreshToken(
      { sub: USER_ID, tid: TENANT_ID },
      { tv: 0, remember: true },
    );
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(200);
    expect(decode(res.json().refreshToken).rmb).toBe(1);
    await app.close();
  });

  it("rechaza refresh de otro tenant (tampering)", async () => {
    const app = await buildApp();
    const tampered = signRefreshToken(
      { sub: USER_ID, tid: "99999999-9999-9999-9999-999999999999" },
      { tv: 0 },
    );
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: tampered },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /auth/logout-everywhere", () => {
  it("bumpea tokenVersion del usuario", async () => {
    const app = await buildApp();
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });
    const { accessToken } = loginRes.json();

    expect(userStore.get(USER_ID)!.tokenVersion).toBe(0);
    const res = await app.inject({
      method: "POST",
      url: "/auth/logout-everywhere",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tokenVersion).toBe(1);
    expect(userStore.get(USER_ID)!.tokenVersion).toBe(1);
    await app.close();
  });

  it("invalida refresh tokens emitidos antes del logout", async () => {
    const app = await buildApp();
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: EMAIL, password: PASSWORD },
    });
    const { accessToken, refreshToken } = loginRes.json();

    // Logout-everywhere.
    await app.inject({
      method: "POST",
      url: "/auth/logout-everywhere",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {},
    });

    // El refresh original ahora debe fallar.
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toMatch(/revocada/i);
    await app.close();
  });

  it("rechaza request sin token de acceso", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/logout-everywhere",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
