// Tests de los endpoints de rotación de API Key de Holded (B2 §4.2):
//   POST /auth/me/rotate-holded-key
//   POST /auth/me/test-holded-connection
//
// Mockea `probeHoldedKey` (resuelve vs rechaza) y Prisma en memoria.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock del probe ───────────────────────────────────────────────────
type ProbeBehavior = "ok" | "invalid" | "suspended" | "html" | "unreachable";
let probeBehavior: ProbeBehavior = "ok";

vi.mock("../src/holded/probe.js", async () => {
  const actual = await vi.importActual<typeof import("../src/holded/probe.js")>(
    "../src/holded/probe.js",
  );
  return {
    ...actual,
    probeHoldedKey: vi.fn(async () => {
      switch (probeBehavior) {
        case "ok":
          return { ok: true };
        case "invalid":
          return { ok: false, code: "INVALID_HOLDED_KEY", message: "rechazada" };
        case "suspended":
          return { ok: false, code: "HOLDED_SUSPENDED", message: "suspendida" };
        case "html":
          return { ok: false, code: "HOLDED_INVALID_RESPONSE", message: "no es JSON" };
        case "unreachable":
          return { ok: false, code: "HOLDED_UNREACHABLE", message: "no contactable" };
      }
    }),
  };
});

// ── Prisma en memoria ────────────────────────────────────────────────
interface FakeTenantRow {
  id: string;
  name: string;
  holdedApiKeyCiphertext: string | null;
  holdedAuthMode: "API_KEY" | "OAUTH";
  initialSyncStatus: "PENDING" | "RUNNING" | "DONE" | "FAILED";
}

interface FakeUserRow {
  id: string;
  tenantId: string;
  email: string;
  role: "OWNER" | "MANAGER" | "CASHIER";
  tokenVersion: number;
}

const tenantStore = new Map<string, FakeTenantRow>();
const userStore = new Map<string, FakeUserRow>();

const fakePrisma = {
  tenant: {
    findUnique: vi.fn(async ({ where }: any) => tenantStore.get(where.id) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const t = tenantStore.get(where.id);
      if (!t) throw new Error("not found");
      return t;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = tenantStore.get(where.id);
      if (!t) throw new Error("not found");
      Object.assign(t, data);
      return t;
    }),
  },
  user: {
    findUnique: vi.fn(async ({ where }: any) =>
      userStore.get(where.id) ?? null,
    ),
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
const { encryptSecret, decryptSecret } = await import("../src/crypto.js");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const ACCESS_TOKEN = signAccessToken({ sub: USER_ID, tid: TENANT_ID, role: "OWNER" });
const ENCRYPTION_KEY = process.env.HOLDED_KEY_ENCRYPTION_SECRET!;

async function buildApp() {
  const app = Fastify();
  await registerAuthRoutes(app);
  return app;
}

function seedTenant(opts: { ciphertext?: string | null } = {}) {
  const ciphertext: string | null =
    "ciphertext" in opts
      ? opts.ciphertext ?? null
      : encryptSecret("OLD_KEY_VALID", ENCRYPTION_KEY);
  tenantStore.set(TENANT_ID, {
    id: TENANT_ID,
    name: "Test biz",
    holdedApiKeyCiphertext: ciphertext,
    holdedAuthMode: "API_KEY",
    initialSyncStatus: "DONE",
  });
  userStore.set(USER_ID, {
    id: USER_ID,
    tenantId: TENANT_ID,
    email: "owner@test.com",
    role: "OWNER",
    tokenVersion: 0,
  });
}

beforeEach(() => {
  tenantStore.clear();
  userStore.clear();
  probeBehavior = "ok";
  seedTenant();
});

describe("POST /auth/me/rotate-holded-key", () => {
  it("happy path: valida, cifra y sobreescribe la antigua", async () => {
    const app = await buildApp();
    const before = tenantStore.get(TENANT_ID)!.holdedApiKeyCiphertext!;
    const newKey = "BRAND_NEW_HOLDED_API_KEY_xxxxxx";
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/rotate-holded-key",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { apiKey: newKey },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().validatedAt).toBeTruthy();

    const after = tenantStore.get(TENANT_ID)!.holdedApiKeyCiphertext!;
    expect(after).not.toBe(before);
    expect(decryptSecret(after, ENCRYPTION_KEY)).toBe(newKey);
    await app.close();
  });

  it("clave inválida → 401, mantiene la antigua intacta", async () => {
    probeBehavior = "invalid";
    const before = tenantStore.get(TENANT_ID)!.holdedApiKeyCiphertext!;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/rotate-holded-key",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { apiKey: "BAD_NEW_KEY_xxxxxx" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("INVALID_HOLDED_KEY");
    expect(tenantStore.get(TENANT_ID)!.holdedApiKeyCiphertext).toBe(before);
    await app.close();
  });

  it("cuenta suspendida → 402, mantiene la antigua", async () => {
    probeBehavior = "suspended";
    const before = tenantStore.get(TENANT_ID)!.holdedApiKeyCiphertext!;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/rotate-holded-key",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { apiKey: "SUSPENDED_KEY_xxxxxx" },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toBe("HOLDED_SUSPENDED");
    expect(tenantStore.get(TENANT_ID)!.holdedApiKeyCiphertext).toBe(before);
    await app.close();
  });

  it("Holded responde HTML → 502, mantiene la antigua", async () => {
    probeBehavior = "html";
    const before = tenantStore.get(TENANT_ID)!.holdedApiKeyCiphertext!;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/rotate-holded-key",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { apiKey: "WHATEVER_xxxxxx" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("HOLDED_INVALID_RESPONSE");
    expect(tenantStore.get(TENANT_ID)!.holdedApiKeyCiphertext).toBe(before);
    await app.close();
  });

  it("Holded inalcanzable → 502 y la response NO contiene la apiKey", async () => {
    probeBehavior = "unreachable";
    const sensitiveKey = "supersecretkey0000_must_never_leak";
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/rotate-holded-key",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { apiKey: sensitiveKey },
    });
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.json())).not.toContain(sensitiveKey);
    await app.close();
  });

  it("rechaza apiKey < 10 chars (schema) → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/rotate-holded-key",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { apiKey: "short" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("rechaza sin auth → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/rotate-holded-key",
      payload: { apiKey: "0123456789x" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /auth/me/test-holded-connection", () => {
  it("happy path: descifra y prueba contra Holded", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/test-holded-connection",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  it("sin API Key configurada → 409 NO_HOLDED_KEY", async () => {
    seedTenant({ ciphertext: null });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/test-holded-connection",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("NO_HOLDED_KEY");
    await app.close();
  });

  it("clave en BD ahora inválida → 401 INVALID_HOLDED_KEY", async () => {
    probeBehavior = "invalid";
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/test-holded-connection",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("INVALID_HOLDED_KEY");
    await app.close();
  });

  it("rechaza sin auth → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth/me/test-holded-connection",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
