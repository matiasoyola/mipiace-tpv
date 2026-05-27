// v1.3-Operativa-Extra · Lote 1: CRUD /admin/tag-aliases.

import { randomBytes, randomUUID } from "node:crypto";

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

interface FakeAlias {
  id: string;
  tenantId: string;
  slug: string;
  label: string;
}

const aliases = new Map<string, FakeAlias>();

const fakePrisma = {
  tagAlias: {
    findMany: vi.fn(async ({ where, orderBy, select }: any) => {
      let rows = Array.from(aliases.values()).filter((a) => a.tenantId === where.tenantId);
      if (orderBy?.slug === "asc") rows = rows.sort((a, b) => a.slug.localeCompare(b.slug));
      return rows.map((r) => {
        if (!select) return r;
        const out: any = {};
        for (const k of Object.keys(select)) if (select[k]) out[k] = (r as any)[k];
        return out;
      });
    }),
    upsert: vi.fn(async ({ where, create, update, select }: any) => {
      const key = `${where.tenantId_slug.tenantId}:${where.tenantId_slug.slug}`;
      const existing = Array.from(aliases.values()).find(
        (a) =>
          a.tenantId === where.tenantId_slug.tenantId && a.slug === where.tenantId_slug.slug,
      );
      let row: FakeAlias;
      if (existing) {
        row = { ...existing, ...update };
        aliases.set(existing.id, row);
      } else {
        row = {
          id: randomUUID(),
          tenantId: create.tenantId,
          slug: create.slug,
          label: create.label,
        };
        aliases.set(row.id, row);
      }
      if (!select) return row;
      const out: any = {};
      for (const k of Object.keys(select)) if (select[k]) out[k] = (row as any)[k];
      return out;
      void key;
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      let count = 0;
      for (const [id, row] of aliases) {
        if (row.id === where.id && row.tenantId === where.tenantId) {
          aliases.delete(id);
          count++;
        }
      }
      return { count };
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

const { registerAdminTagAliasesRoutes } = await import(
  "../src/admin/tag-aliases.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");

function tokenFor(role: "OWNER" | "MANAGER" | "CASHIER", userId: string, tid = TENANT) {
  return signAccessToken({ sub: userId, tid, role });
}

beforeEach(() => {
  aliases.clear();
  vi.clearAllMocks();
});

async function buildApp() {
  const app = Fastify();
  await registerAdminTagAliasesRoutes(app);
  return app;
}

describe("/admin/tag-aliases (v1.3-Operativa-Extra · Lote 1)", () => {
  it("OWNER hace upsert, lo lista y lo borra", async () => {
    const app = await buildApp();
    const owner = `Bearer ${tokenFor("OWNER", OWNER_ID)}`;

    const post = await app.inject({
      method: "POST",
      url: "/admin/tag-aliases",
      headers: { authorization: owner },
      payload: { slug: "01cortesypeinados", label: "Cortes y peinados" },
    });
    expect(post.statusCode).toBe(200);
    const created = post.json().alias;
    expect(created.slug).toBe("01cortesypeinados");
    expect(created.label).toBe("Cortes y peinados");

    const list = await app.inject({
      method: "GET",
      url: "/admin/tag-aliases",
      headers: { authorization: owner },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);

    const del = await app.inject({
      method: "DELETE",
      url: `/admin/tag-aliases/${created.id}`,
      headers: { authorization: owner },
    });
    expect(del.statusCode).toBe(200);
    expect(aliases.size).toBe(0);
  });

  it("upsert normaliza slug a lowercase y es idempotente", async () => {
    const app = await buildApp();
    const owner = `Bearer ${tokenFor("OWNER", OWNER_ID)}`;

    const first = await app.inject({
      method: "POST",
      url: "/admin/tag-aliases",
      headers: { authorization: owner },
      payload: { slug: "  01CortesYPeinados  ", label: "Cortes y peinados" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().alias.slug).toBe("01cortesypeinados");

    const second = await app.inject({
      method: "POST",
      url: "/admin/tag-aliases",
      headers: { authorization: owner },
      payload: { slug: "01cortesypeinados", label: "Cortes & Peinados" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().alias.label).toBe("Cortes & Peinados");
    expect(aliases.size).toBe(1);
  });

  it("MANAGER también puede mutar (requireOwnerOrManager)", async () => {
    const app = await buildApp();
    const manager = `Bearer ${tokenFor("MANAGER", MANAGER_ID)}`;
    const res = await app.inject({
      method: "POST",
      url: "/admin/tag-aliases",
      headers: { authorization: manager },
      payload: { slug: "papeleria", label: "Papelería" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("CASHIER recibe 403", async () => {
    const app = await buildApp();
    const cashier = `Bearer ${tokenFor("CASHIER", MANAGER_ID)}`;
    const res = await app.inject({
      method: "POST",
      url: "/admin/tag-aliases",
      headers: { authorization: cashier },
      payload: { slug: "x", label: "X" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("DELETE de un alias de otro tenant → 404 (aislamiento)", async () => {
    const app = await buildApp();
    const ownerOther = `Bearer ${tokenFor("OWNER", OWNER_ID, OTHER_TENANT)}`;
    aliases.set("orphan", {
      id: "11111111-1111-1111-1111-111111111111",
      tenantId: TENANT,
      slug: "x",
      label: "X",
    });
    const res = await app.inject({
      method: "DELETE",
      url: "/admin/tag-aliases/11111111-1111-1111-1111-111111111111",
      headers: { authorization: ownerOther },
    });
    expect(res.statusCode).toBe(404);
  });

  it("label > 80 caracteres → 400 por schema", async () => {
    const app = await buildApp();
    const owner = `Bearer ${tokenFor("OWNER", OWNER_ID)}`;
    const res = await app.inject({
      method: "POST",
      url: "/admin/tag-aliases",
      headers: { authorization: owner },
      payload: { slug: "x", label: "x".repeat(81) },
    });
    expect(res.statusCode).toBe(400);
  });
});
