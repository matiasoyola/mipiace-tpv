// Integration test del endpoint POST /onboarding/connect-holded.
//
// Mockea: `@mipiacetpv/holded-client` (response del probe a Holded),
// `../src/context.js` (Prisma + Redis fake), y `../src/queues/initial-sync.js`
// (enqueue → no-op). Inyecta la request con un access token válido.

import { randomBytes } from "node:crypto";

// IMPORTANTE: setear env antes de cualquier import que cargue env.ts.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────
const enqueueMock = vi.fn(async () => undefined);
vi.mock("../src/queues/initial-sync.js", () => ({
  enqueueInitialSync: enqueueMock,
}));

let probeBehavior: "ok" | "invalid-key" | "suspended" | "html" | "unreachable" = "ok";
vi.mock("@mipiacetpv/holded-client", async () => {
  const actual = await vi.importActual<typeof import("@mipiacetpv/holded-client")>(
    "@mipiacetpv/holded-client",
  );
  return {
    ...actual,
    listProductsPage: vi.fn(async () => {
      switch (probeBehavior) {
        case "ok":
          return [];
        case "invalid-key":
          throw new actual.HoldedApiError(401, "/x", { status: 0, info: "invalid" });
        case "suspended":
          throw new actual.HoldedSubscriptionSuspendedError("/x", { info: "Unpaid" });
        case "html":
          throw new actual.HoldedInvalidResponseError("GET", "/x", 200, "text/html", "<html>");
        case "unreachable":
          throw new Error("ECONNREFUSED");
      }
    }),
  };
});

interface FakeTenantRow {
  id: string;
  name: string;
  holdedApiKeyCiphertext: string | null;
  holdedAuthMode: string;
  initialSyncStatus: string;
  initialSyncStats: object | null;
}

const tenantStore = new Map<string, FakeTenantRow>();
const userStore = new Map<string, { id: string; tenantId: string; email: string; role: string }>();

const fakePrisma = {
  tenant: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => tenantStore.get(where.id) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const t = tenantStore.get(where.id);
      if (!t) throw new Error("not found");
      return t;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeTenantRow> }) => {
      const t = tenantStore.get(where.id);
      if (!t) throw new Error("not found");
      Object.assign(t, data);
      return t;
    }),
  },
  user: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      userStore.get(where.id) ?? null,
    ),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
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

// Después de los mocks, los imports del SUT.
const { registerAuthRoutes } = await import("../src/auth/routes.js");
const { registerOnboardingRoutes } = await import("../src/onboarding/routes.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { decryptSecret } = await import("../src/crypto.js");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const ACCESS_TOKEN = signAccessToken({ sub: USER_ID, tid: TENANT_ID, role: "OWNER" });

async function buildApp() {
  const app = Fastify();
  await registerAuthRoutes(app);
  await registerOnboardingRoutes(app);
  return app;
}

function resetFixtures() {
  tenantStore.clear();
  userStore.clear();
  tenantStore.set(TENANT_ID, {
    id: TENANT_ID,
    name: "Test biz",
    holdedApiKeyCiphertext: null,
    holdedAuthMode: "API_KEY",
    initialSyncStatus: "PENDING",
    initialSyncStats: null,
  });
  userStore.set(USER_ID, {
    id: USER_ID,
    tenantId: TENANT_ID,
    email: "owner@test.com",
    role: "OWNER",
  });
  enqueueMock.mockClear();
}

beforeEach(() => {
  resetFixtures();
  probeBehavior = "ok";
});

describe("POST /onboarding/connect-holded", () => {
  it("happy path: cifra la key, persiste y encola sync", async () => {
    const app = await buildApp();
    const apiKey = "k_realistic_holded_api_key_value_xxxxxx";
    const res = await app.inject({
      method: "POST",
      url: "/onboarding/connect-holded",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { apiKey },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.initialSyncStatus).toBe("PENDING");

    const tenant = tenantStore.get(TENANT_ID)!;
    expect(tenant.holdedApiKeyCiphertext).toBeTruthy();
    // No persiste plaintext.
    expect(tenant.holdedApiKeyCiphertext).not.toContain(apiKey);
    // Y se puede descifrar.
    expect(
      decryptSecret(tenant.holdedApiKeyCiphertext!, process.env.HOLDED_KEY_ENCRYPTION_SECRET!),
    ).toBe(apiKey);
    expect(enqueueMock).toHaveBeenCalledWith(TENANT_ID);
    await app.close();
  });

  it("clave inválida (401 Holded) → 401 INVALID_HOLDED_KEY", async () => {
    probeBehavior = "invalid-key";
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/onboarding/connect-holded",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { apiKey: "0123456789" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("INVALID_HOLDED_KEY");
    expect(tenantStore.get(TENANT_ID)!.holdedApiKeyCiphertext).toBeNull();
    expect(enqueueMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("cuenta suspendida (402) → 402 HOLDED_SUSPENDED", async () => {
    probeBehavior = "suspended";
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/onboarding/connect-holded",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { apiKey: "0123456789" },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toBe("HOLDED_SUSPENDED");
    await app.close();
  });

  it("Holded devuelve HTML (endpoint roto) → 502 HOLDED_INVALID_RESPONSE", async () => {
    probeBehavior = "html";
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/onboarding/connect-holded",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { apiKey: "0123456789" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("HOLDED_INVALID_RESPONSE");
    await app.close();
  });

  it("Holded inalcanzable → 502 HOLDED_UNREACHABLE (no expone la apiKey en error)", async () => {
    probeBehavior = "unreachable";
    const app = await buildApp();
    const apiKey = "supersecretkey0000";
    const res = await app.inject({
      method: "POST",
      url: "/onboarding/connect-holded",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { apiKey },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("HOLDED_UNREACHABLE");
    // El body de error no debe contener la api key.
    expect(JSON.stringify(res.json())).not.toContain(apiKey);
    await app.close();
  });

  it("rechaza request sin auth (401)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/onboarding/connect-holded",
      payload: { apiKey: "0123456789" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rechaza apiKey < 10 chars (schema validation)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/onboarding/connect-holded",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { apiKey: "short" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /onboarding/sync-status", () => {
  it("devuelve el estado actual del tenant", async () => {
    const tenant = tenantStore.get(TENANT_ID)!;
    tenant.initialSyncStatus = "RUNNING";
    tenant.initialSyncStats = {
      productsCount: 12,
      servicesCount: 0,
      warehousesCount: 1,
      taxesCount: 3,
      autoSkuFixed: 0,
      autoSkuNeedsReview: 0,
      wildcardsCreated: 0,
      wildcardsReused: 0,
      productPagesProcessed: 1,
      servicePagesProcessed: 0,
      currentStep: "Productos",
      errors: [],
    };
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/onboarding/sync-status",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("RUNNING");
    expect(body.stats.productsCount).toBe(12);
    expect(body.stats.currentStep).toBe("Productos");
    await app.close();
  });
});
