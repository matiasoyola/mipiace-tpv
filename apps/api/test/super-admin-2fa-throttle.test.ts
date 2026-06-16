// v1.5-D · Frente 3: la verificación del código 2FA del super-admin en el
// login (POST /super-admin/auth/login-2fa) está throttleada por (sub, ip).
// El código es de 6 dígitos y sin esto sería fuerza-bruteable dentro de la
// validez del pendingToken.
//
// Test aislado con un fake Redis que CUENTA de verdad (el super-admin.test
// usa `incr → 1`, que nunca dispara el límite).

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SA_ID = randomUUID();

// SuperAdminUser con 2FA activo (para llegar a la verificación de código).
const sa = {
  id: SA_ID,
  email: "root@test.com",
  totpEnabledAt: new Date(),
  // Secret cifrado válido no es necesario: el throttle se evalúa ANTES de
  // descifrar/verificar el código, así que con cualquier código erróneo el
  // contador avanza igual.
  totpSecret: "v1:deadbeef",
  recoveryCodes: [],
  tokenVersion: 0,
};

const fakePrisma = {
  superAdminUser: {
    findUnique: vi.fn(async ({ where }: any) => (where.id === SA_ID ? sa : null)),
    update: vi.fn(async () => sa),
  },
} as const;

// Fake Redis con contador real por clave + TTL.
const redisStore = new Map<string, { value: number; expiresAt: number }>();
const fakeRedis = {
  incr: vi.fn(async (key: string) => {
    const e = redisStore.get(key);
    const fresh = !e || e.expiresAt <= Date.now();
    const value = fresh ? 1 : e!.value + 1;
    redisStore.set(key, {
      value,
      expiresAt: fresh ? Date.now() + 24 * 60 * 60 * 1000 : e!.expiresAt,
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
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  shutdown: async () => undefined,
}));

const { registerSuperAdminAuthRoutes } = await import("../src/superadmin/auth.js");
const { signSuperAdminPending2faToken } = await import("../src/superadmin/tokens.js");

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerSuperAdminAuthRoutes(app);
  return app;
}

beforeEach(() => {
  redisStore.clear();
  vi.clearAllMocks();
});

describe("super-admin · throttle de verificación 2FA en login", () => {
  it("5 códigos erróneos y el 6º intento devuelve 429", async () => {
    const app = await buildApp();
    const pendingToken = signSuperAdminPending2faToken(SA_ID);

    for (let i = 0; i < 5; i++) {
      const wrong = await app.inject({
        method: "POST",
        url: "/super-admin/auth/login-2fa",
        payload: { pendingToken, code: "000000" },
      });
      expect(wrong.statusCode).not.toBe(429);
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/super-admin/auth/login-2fa",
      payload: { pendingToken, code: "000000" },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe("RATE_LIMITED");
  });
});
