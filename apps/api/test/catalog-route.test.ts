// Integration test del endpoint POST /catalog/sync-now y GET
// /catalog/sync-status (B2 §2.1). Mockea la cola BullMQ y Prisma en
// memoria.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueueManualMock = vi.fn(async (_tenantId: string) => ({ jobId: "mocked-job-id-123" }));
vi.mock("../src/queues/catalog-incremental.js", () => ({
  enqueueManualSync: enqueueManualMock,
}));

interface FakeTenantRow {
  id: string;
  holdedApiKeyCiphertext: string | null;
  initialSyncStatus: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  lastIncrementalSyncAt: Date | null;
  lastIncrementalSyncStats: object | null;
}

const tenantStore = new Map<string, FakeTenantRow>();

const fakePrisma = {
  tenant: {
    findUnique: vi.fn(async ({ where }: any) => tenantStore.get(where.id) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const t = tenantStore.get(where.id);
      if (!t) throw new Error("not found");
      return t;
    }),
  },
} as const;

// throttle() (rate-limit.ts) necesita incr/expire/ttl además de ping.
const redisCounters = new Map<string, number>();
const fakeRedis = {
  ping: async () => "PONG",
  incr: async (key: string) => {
    const next = (redisCounters.get(key) ?? 0) + 1;
    redisCounters.set(key, next);
    return next;
  },
  expire: async () => 1,
  ttl: async () => 60,
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  shutdown: async () => undefined,
}));

const { registerCatalogRoutes } = await import("../src/catalog/routes.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const ACCESS_TOKEN = signAccessToken({ sub: USER_ID, tid: TENANT_ID, role: "OWNER" });

async function buildApp() {
  const app = Fastify();
  await registerCatalogRoutes(app);
  return app;
}

beforeEach(() => {
  tenantStore.clear();
  redisCounters.clear();
  enqueueManualMock.mockClear();
  tenantStore.set(TENANT_ID, {
    id: TENANT_ID,
    holdedApiKeyCiphertext: "v1:fake-ciphertext",
    initialSyncStatus: "DONE",
    lastIncrementalSyncAt: null,
    lastIncrementalSyncStats: null,
  });
});

describe("POST /catalog/sync-now", () => {
  it("happy path: encola con prioridad alta, devuelve 202 + jobId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/catalog/sync-now",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toBe("mocked-job-id-123");
    expect(body.queuedAt).toBeTruthy();
    expect(enqueueManualMock).toHaveBeenCalledWith(TENANT_ID);
    await app.close();
  });

  it("rechaza si el sync inicial todavía no está DONE → 409", async () => {
    tenantStore.get(TENANT_ID)!.initialSyncStatus = "RUNNING";
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/catalog/sync-now",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("INITIAL_SYNC_PENDING");
    expect(enqueueManualMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("rechaza si no hay API Key conectada → 409 NO_HOLDED_KEY", async () => {
    tenantStore.get(TENANT_ID)!.holdedApiKeyCiphertext = null;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/catalog/sync-now",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("NO_HOLDED_KEY");
    expect(enqueueManualMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("rechaza sin auth → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/catalog/sync-now",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("devuelve 503 si la cola está caída", async () => {
    enqueueManualMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/catalog/sync-now",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("QUEUE_UNAVAILABLE");
    await app.close();
  });
});

describe("GET /catalog/sync-status", () => {
  it("devuelve null cuando aún no ha corrido nunca", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/catalog/sync-status",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lastIncrementalSyncAt).toBeNull();
    expect(body.stats).toBeNull();
    await app.close();
  });

  it("devuelve los stats persistidos del último sync", async () => {
    const t = tenantStore.get(TENANT_ID)!;
    t.lastIncrementalSyncAt = new Date("2026-05-12T10:00:00Z");
    t.lastIncrementalSyncStats = {
      productsSeen: 100,
      orphansMarked: 3,
      autoSkuFixed: 2,
      durationMs: 4321,
      errors: [],
    };
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/catalog/sync-status",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lastIncrementalSyncAt).toBe("2026-05-12T10:00:00.000Z");
    expect(body.stats.productsSeen).toBe(100);
    expect(body.stats.orphansMarked).toBe(3);
    await app.close();
  });
});
