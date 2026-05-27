// v1.3-Operativa-Extra · Lote 3: dedupe de tags super-admin.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_ADMIN_URL = "https://admin.test";

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SUPER_ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_ID = "33333333-3333-3333-3333-333333333333";

interface FakeProduct {
  id: string;
  tenantId: string;
  tags: string[];
}

interface FakeAudit {
  action: string;
  tenantId: string | null;
  metadata: any;
}

const products = new Map<string, FakeProduct>();
const audits: FakeAudit[] = [];

const fakePrisma: any = {
  superAdminUser: {
    findUnique: vi.fn(async ({ where, select }: any) => {
      if (where.id !== SUPER_ADMIN_ID) return null;
      const sa = {
        id: SUPER_ADMIN_ID,
        tokenVersion: 0,
        deletedAt: null,
        isRoot: true,
      };
      if (select) {
        const out: any = {};
        for (const k of Object.keys(select)) out[k] = (sa as any)[k];
        return out;
      }
      return sa;
    }),
  },
  tenant: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id !== TENANT_ID) return null;
      return { id: TENANT_ID };
    }),
  },
  product: {
    findMany: vi.fn(async ({ where, select }: any) => {
      const rows = Array.from(products.values()).filter(
        (p) => p.tenantId === where.tenantId,
      );
      if (!select) return rows;
      return rows.map((r) => {
        const out: any = {};
        for (const k of Object.keys(select)) if (select[k]) out[k] = (r as any)[k];
        return out;
      });
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const p = products.get(where.id);
      if (!p) throw new Error("product not found");
      if (data.tags) p.tags = data.tags;
      return p;
    }),
  },
  superAdminAudit: {
    create: vi.fn(async ({ data }: any) => {
      audits.push({
        action: data.action,
        tenantId: data.tenantId,
        metadata: data.metadata,
      });
      return { id: randomUUID(), ...data, createdAt: new Date() };
    }),
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

// Las queues son llamadas por otros endpoints registrados en el mismo
// módulo (resync, etc.) — el mock evita arrastrar BullMQ al test.
vi.mock("../src/queues/catalog-incremental.js", () => ({
  enqueueManualSync: vi.fn(async () => ({ jobId: "stub" })),
}));
vi.mock("../src/queues/initial-sync.js", () => ({
  enqueueInitialSync: vi.fn(async () => undefined),
}));

const { registerSuperAdminTenantsRoutes } = await import(
  "../src/superadmin/tenants.js"
);
const { signSuperAdminAccessToken } = await import(
  "../src/superadmin/tokens.js"
);

function token(): string {
  return signSuperAdminAccessToken({ sub: SUPER_ADMIN_ID, tv: 0 });
}

async function buildApp() {
  const app = Fastify();
  await registerSuperAdminTenantsRoutes(app);
  return app;
}

beforeEach(() => {
  products.clear();
  audits.length = 0;
  vi.clearAllMocks();
});

describe("POST /super-admin/tenants/:id/dedupe-tags", () => {
  it("unifica papelería/papeleria al lowercase sin tildes", async () => {
    products.set("p1", {
      id: "aaaaaaaa-1111-1111-1111-111111111111",
      tenantId: TENANT_ID,
      tags: ["papelería", "papeleria", "BOLÍGRAFOS"],
    });
    products.set("p2", {
      id: "aaaaaaaa-2222-2222-2222-222222222222",
      tenantId: TENANT_ID,
      tags: ["boligrafos", "bolígrafos"],
    });
    products.set("p3", {
      id: "aaaaaaaa-3333-3333-3333-333333333333",
      tenantId: TENANT_ID,
      tags: ["limpios"],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/dedupe-tags`,
      headers: { authorization: `Bearer ${token()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.productsScanned).toBe(3);
    expect(body.productsUpdated).toBe(2);
    expect(body.duplicatesRemoved).toBe(2);

    expect(products.get("p1")!.tags).toEqual(["papeleria", "boligrafos"]);
    expect(products.get("p2")!.tags).toEqual(["boligrafos"]);
    // El producto p3 (sin duplicados ni tildes) NO se toca.
    expect(products.get("p3")!.tags).toEqual(["limpios"]);

    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("dedupe_tags");
    expect(audits[0]!.metadata.productsUpdated).toBe(2);
    expect(audits[0]!.metadata.duplicatesRemoved).toBe(2);
  });

  it("idempotente: sin cambios la segunda vez", async () => {
    products.set("p1", {
      id: "aaaaaaaa-1111-1111-1111-111111111111",
      tenantId: TENANT_ID,
      tags: ["papelería", "papeleria"],
    });
    const app = await buildApp();
    const auth = { authorization: `Bearer ${token()}` };

    const first = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/dedupe-tags`,
      headers: auth,
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().productsUpdated).toBe(1);

    const second = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/dedupe-tags`,
      headers: auth,
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().productsUpdated).toBe(0);
    expect(second.json().duplicatesRemoved).toBe(0);
  });

  it("tenant inexistente → 404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/super-admin/tenants/00000000-0000-0000-0000-000000000000/dedupe-tags",
      headers: { authorization: `Bearer ${token()}` },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("sin token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/super-admin/tenants/${TENANT_ID}/dedupe-tags`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });
});
