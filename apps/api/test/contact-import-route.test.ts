// v1.0-pilotos · Lote 6 (#22): endpoints del importador de clientes.
// POST encola (OWNER-only), GET pollea con aislamiento por tenant.

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
const OTHER_TENANT = "00000000-0000-0000-0000-000000000099";
const OWNER_ID = "00000000-0000-0000-0000-0000000000aa";
const MANAGER_ID = "00000000-0000-0000-0000-0000000000bb";

const state = {
  hasApiKey: true,
  enqueued: [] as Array<{ tenantId: string; rows: unknown[] }>,
  jobs: new Map<
    string,
    {
      data: { tenantId: string; rows: unknown[] };
      state: string;
      progress: unknown;
      returnvalue: unknown;
      failedReason?: string;
    }
  >(),
};

const fakePrisma = {
  tenant: {
    findUniqueOrThrow: vi.fn(async () => ({
      holdedApiKeyCiphertext: state.hasApiKey ? "cipher" : null,
    })),
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

vi.mock("../src/queues/contact-import.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/queues/contact-import.js")
  >("../src/queues/contact-import.js");
  return {
    ...actual,
    enqueueContactImport: vi.fn(async (job: { tenantId: string; rows: unknown[] }) => {
      state.enqueued.push(job);
      const id = `job-${state.enqueued.length}`;
      state.jobs.set(id, {
        data: job,
        state: "waiting",
        progress: null,
        returnvalue: null,
      });
      return id;
    }),
    getContactImportQueue: () => ({
      getJob: async (id: string) => {
        const j = state.jobs.get(id);
        if (!j) return null;
        return {
          data: j.data,
          progress: j.progress,
          returnvalue: j.returnvalue,
          failedReason: j.failedReason,
          getState: async () => j.state,
        };
      },
    }),
  };
});

const { registerContactImportRoutes } = await import("../src/contacts/import.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

function tokenFor(role: "OWNER" | "MANAGER", userId: string, tenant = TENANT) {
  return `Bearer ${signAccessToken({ sub: userId, tid: tenant, role })}`;
}

async function buildApp() {
  const app = Fastify();
  await registerContactImportRoutes(app);
  return app;
}

beforeEach(() => {
  state.hasApiKey = true;
  state.enqueued = [];
  state.jobs.clear();
  vi.clearAllMocks();
});

describe("POST /admin/contacts/import", () => {
  it("OWNER con filas válidas → 202 + jobId, filas normalizadas (trim)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/contacts/import",
      headers: { authorization: tokenFor("OWNER", OWNER_ID) },
      payload: {
        rows: [
          { name: "  María García  ", nif: " 12345678Z ", email: "", phone: null },
        ],
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().jobId).toBeTruthy();
    expect(res.json().total).toBe(1);
    expect(state.enqueued[0]!.rows[0]).toEqual({
      name: "María García",
      nif: "12345678Z",
      email: null,
      phone: null,
    });
  });

  it("MANAGER → 403 (OWNER-only)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/contacts/import",
      headers: { authorization: tokenFor("MANAGER", MANAGER_ID) },
      payload: { rows: [{ name: "X" }] },
    });
    expect(res.statusCode).toBe(403);
    expect(state.enqueued).toHaveLength(0);
  });

  it("tenant sin API key de Holded → 409 NO_HOLDED_API_KEY", async () => {
    state.hasApiKey = false;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/contacts/import",
      headers: { authorization: tokenFor("OWNER", OWNER_ID) },
      payload: { rows: [{ name: "X" }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("NO_HOLDED_API_KEY");
  });

  it("más de 2.000 filas → 400 por schema", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/contacts/import",
      headers: { authorization: tokenFor("OWNER", OWNER_ID) },
      payload: {
        rows: Array.from({ length: 2_001 }, (_, i) => ({ name: `c${i}` })),
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /admin/contacts/import/:jobId", () => {
  it("devuelve estado + progreso + resultado del job propio", async () => {
    const app = await buildApp();
    const post = await app.inject({
      method: "POST",
      url: "/admin/contacts/import",
      headers: { authorization: tokenFor("OWNER", OWNER_ID) },
      payload: { rows: [{ name: "X" }] },
    });
    const jobId = post.json().jobId;
    const j = state.jobs.get(jobId)!;
    j.state = "completed";
    j.progress = { processed: 1, total: 1, created: 1, existed: 0, errors: 0 };
    j.returnvalue = { created: 1, existed: 0, errors: [] };

    const res = await app.inject({
      method: "GET",
      url: `/admin/contacts/import/${jobId}`,
      headers: { authorization: tokenFor("OWNER", OWNER_ID) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe("completed");
    expect(res.json().result).toEqual({ created: 1, existed: 0, errors: [] });
  });

  it("job de otro tenant → 404 (sin filtrar existencia)", async () => {
    const app = await buildApp();
    const post = await app.inject({
      method: "POST",
      url: "/admin/contacts/import",
      headers: { authorization: tokenFor("OWNER", OWNER_ID) },
      payload: { rows: [{ name: "X" }] },
    });
    const jobId = post.json().jobId;
    const res = await app.inject({
      method: "GET",
      url: `/admin/contacts/import/${jobId}`,
      headers: { authorization: tokenFor("OWNER", OWNER_ID, OTHER_TENANT) },
    });
    expect(res.statusCode).toBe(404);
  });

  it("job inexistente → 404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/admin/contacts/import/nope",
      headers: { authorization: tokenFor("OWNER", OWNER_ID) },
    });
    expect(res.statusCode).toBe(404);
  });
});
