// B3 §17.6. Flujo de password recovery del propietario:
//   - request neutro siempre (existe email o no)
//   - rate limit 5/5min
//   - confirm OK → bumpa tokenVersion + marca usedAt
//   - confirm con token caducado → 410
//   - confirm con token usado → 410
//   - newPassword < 8 → 400

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_ADMIN_URL = "http://localhost:5173";

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeUser {
  id: string;
  email: string;
  role: "OWNER" | "MANAGER" | "CASHIER";
  passwordHash: string;
  tokenVersion: number;
}

interface FakeResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

const users = new Map<string, FakeUser>();
const tokens: FakeResetToken[] = [];

const fakePrisma = {
  user: {
    findUnique: vi.fn(async ({ where }: { where: { email: string } }) => {
      for (const u of users.values()) {
        if (u.email === where.email) return u;
      }
      return null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const u = users.get(where.id);
      if (!u) throw new Error("not found");
      if (data.passwordHash) u.passwordHash = data.passwordHash;
      if (data.tokenVersion?.increment) u.tokenVersion += data.tokenVersion.increment;
      return u;
    }),
  },
  passwordResetToken: {
    create: vi.fn(async ({ data }: any) => {
      const row: FakeResetToken = {
        id: data.id ?? `token-${tokens.length + 1}`,
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        usedAt: null,
      };
      tokens.push(row);
      return row;
    }),
    findMany: vi.fn(async ({ where }: any) => {
      const now = new Date();
      return tokens.filter(
        (t) =>
          t.usedAt == null &&
          t.expiresAt > now &&
          (where.expiresAt?.gt ? t.expiresAt > where.expiresAt.gt : true),
      );
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = tokens.find((x) => x.id === where.id);
      if (!t) throw new Error("not found");
      if (data.usedAt) t.usedAt = data.usedAt;
      return t;
    }),
  },
  $transaction: vi.fn(async (fn: any) => fn(fakePrisma)),
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
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  shutdown: async () => undefined,
}));

const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({
    async send(email: { to: string; subject: string; text: string }) {
      sentEmails.push(email);
    },
  }),
  setEmailSender: () => undefined,
}));

const { registerPasswordResetRoutes } = await import(
  "../src/auth/password-reset.js"
);
const { hashPassword, verifyPassword } = await import("../src/auth/passwords.js");

const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const OWNER_EMAIL = "owner@test.com";
const ORIGINAL_PASSWORD = "oldpassword123";

beforeEach(async () => {
  users.clear();
  tokens.length = 0;
  sentEmails.length = 0;
  redisStore.clear();
  vi.clearAllMocks();
  users.set(OWNER_ID, {
    id: OWNER_ID,
    email: OWNER_EMAIL,
    role: "OWNER",
    passwordHash: await hashPassword(ORIGINAL_PASSWORD),
    tokenVersion: 0,
  });
});

async function buildApp() {
  const app = Fastify();
  await registerPasswordResetRoutes(app);
  return app;
}

describe("POST /auth/password-reset/request", () => {
  it("envía email cuando el owner existe", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      payload: { email: OWNER_EMAIL },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toMatch(/te hemos enviado/);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe(OWNER_EMAIL);
    expect(sentEmails[0]!.text).toContain("/admin/reset?token=");
  });

  it("respuesta NEUTRA cuando el email no existe", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      payload: { email: "no-existe@test.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toMatch(/te hemos enviado/);
    expect(sentEmails).toHaveLength(0);
  });

  it("respuesta neutra también cuando el usuario no es OWNER", async () => {
    const app = await buildApp();
    users.set("c1", {
      id: "c1",
      email: "cashier@test.com",
      role: "CASHIER",
      passwordHash: "x",
      tokenVersion: 0,
    });
    const res = await app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      payload: { email: "cashier@test.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(sentEmails).toHaveLength(0);
  });

  it("throttle a 5 intentos en 5 min — el 6º no envía email", async () => {
    const app = await buildApp();
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: "/auth/password-reset/request",
        payload: { email: OWNER_EMAIL },
      });
    }
    expect(sentEmails).toHaveLength(5);
    const sixth = await app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      payload: { email: OWNER_EMAIL },
    });
    // Respuesta sigue siendo neutra…
    expect(sixth.statusCode).toBe(200);
    // …pero no se envió email nuevo.
    expect(sentEmails).toHaveLength(5);
  });
});

describe("POST /auth/password-reset/confirm", () => {
  async function requestReset(): Promise<string> {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/auth/password-reset/request",
      payload: { email: OWNER_EMAIL },
    });
    const email = sentEmails[sentEmails.length - 1]!;
    const m = email.text.match(/\?token=([^\s\n]+)/);
    if (!m) throw new Error("no token in email");
    return m[1]!;
  }

  it("actualiza la contraseña + bumpa tokenVersion + marca usedAt", async () => {
    const token = await requestReset();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/password-reset/confirm",
      payload: { token, newPassword: "newSecret123!" },
    });
    expect(res.statusCode).toBe(200);
    const owner = users.get(OWNER_ID)!;
    expect(owner.tokenVersion).toBe(1);
    expect(await verifyPassword(owner.passwordHash, "newSecret123!")).toBe(true);
    expect(await verifyPassword(owner.passwordHash, ORIGINAL_PASSWORD)).toBe(false);
    expect(tokens[0]!.usedAt).not.toBeNull();
  });

  it("410 cuando el token ya está usado", async () => {
    const token = await requestReset();
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/auth/password-reset/confirm",
      payload: { token, newPassword: "newSecret123!" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/auth/password-reset/confirm",
      payload: { token, newPassword: "anotherOne123!" },
    });
    expect(second.statusCode).toBe(410);
  });

  it("410 cuando el token está caducado", async () => {
    const token = await requestReset();
    // forzar caducidad manualmente
    tokens[0]!.expiresAt = new Date(Date.now() - 1000);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/password-reset/confirm",
      payload: { token, newPassword: "newSecret123!" },
    });
    expect(res.statusCode).toBe(410);
  });

  it("400 cuando newPassword es < 8 chars", async () => {
    const token = await requestReset();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/password-reset/confirm",
      payload: { token, newPassword: "short" },
    });
    expect(res.statusCode).toBe(400);
  });

  // v1.5-D · Frente 3: el consumo de token también está throttleado
  // (clave por IP), no sólo la solicitud. Sin esto, el handler hace un
  // argon2.verify por cada token vivo y la fuerza bruta es viable.
  it("throttle a 10 intentos de confirm por IP — el 11º devuelve 429", async () => {
    const app = await buildApp();
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/auth/password-reset/confirm",
        payload: { token: "token-falso-de-fuerza-bruta", newPassword: "whatever123!" },
      });
      expect(res.statusCode).not.toBe(429);
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/auth/password-reset/confirm",
      payload: { token: "otro-intento-mas", newPassword: "whatever123!" },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe("RATE_LIMITED");
  });
});
