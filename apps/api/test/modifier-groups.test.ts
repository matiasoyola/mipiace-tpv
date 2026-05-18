// Tests del CRUD admin de modificadores (B-Bar-Modifiers · Frente 2).
// Caso B (Holded no expone modifiers nativos, spike §14).

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
const OTHER_TENANT = "00000000-0000-0000-0000-000000000002";
const OWNER_ID = "00000000-0000-0000-0000-0000000000aa";
const MANAGER_ID = "00000000-0000-0000-0000-0000000000bb";
const CASHIER_ID = "00000000-0000-0000-0000-0000000000cc";

const GROUP_MINE = "11111111-1111-1111-1111-111111111111";
const GROUP_OTHER = "11111111-1111-1111-1111-222222222222";
const GROUP_SIZE = "11111111-1111-1111-1111-333333333333";
const PRODUCT_MINE = "33333333-3333-3333-3333-111111111111";
const PRODUCT_OTHER = "33333333-3333-3333-3333-222222222222";

interface FakeGroup {
  id: string;
  tenantId: string;
  name: string;
  exclusive: boolean;
  required: boolean;
  sortOrder: number;
  createdAt: Date;
  deletedAt: Date | null;
}
interface FakeModifier {
  id: string;
  modifierGroupId: string;
  label: string;
  priceDeltaCents: number;
  sortOrder: number;
  isDefault: boolean;
  createdAt: Date;
  deletedAt: Date | null;
}
interface FakeLink {
  productId: string;
  modifierGroupId: string;
  sortOrder: number;
}
interface FakeProduct {
  id: string;
  tenantId: string;
}

const groups = new Map<string, FakeGroup>();
const modifiers = new Map<string, FakeModifier>();
const links = new Map<string, FakeLink>();
const products = new Map<string, FakeProduct>();

function linkKey(p: string, g: string) {
  return `${p}:${g}`;
}

function matchTenant(g: FakeGroup, tenantId: string) {
  return g.tenantId === tenantId;
}

const fakePrisma = {
  modifierGroup: {
    findMany: vi.fn(async ({ where, include }: any) => {
      void include;
      return [...groups.values()]
        .filter((g) => {
          if (where?.tenantId && g.tenantId !== where.tenantId) return false;
          if (where?.deletedAt === null && g.deletedAt !== null) return false;
          return true;
        })
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((g) => ({
          ...g,
          modifiers: [...modifiers.values()]
            .filter((m) => m.modifierGroupId === g.id && m.deletedAt === null)
            .sort((a, b) => a.sortOrder - b.sortOrder),
          products: [...links.values()]
            .filter((l) => l.modifierGroupId === g.id)
            .map((l) => ({ productId: l.productId })),
        }));
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const g of groups.values()) {
        if (where.id && g.id !== where.id) continue;
        if (where.tenantId && g.tenantId !== where.tenantId) continue;
        if (where.deletedAt === null && g.deletedAt !== null) continue;
        return { id: g.id };
      }
      return null;
    }),
    create: vi.fn(async ({ data, include }: any) => {
      void include;
      const id =
        "11111111-1111-1111-1111-" + String(groups.size + 1).padStart(12, "0");
      const g: FakeGroup = {
        id,
        tenantId: data.tenantId,
        name: data.name,
        exclusive: data.exclusive ?? true,
        required: data.required ?? false,
        sortOrder: data.sortOrder ?? 0,
        createdAt: new Date(),
        deletedAt: null,
      };
      groups.set(id, g);
      return { ...g, modifiers: [], products: [] };
    }),
    update: vi.fn(async ({ where, data, include }: any) => {
      void include;
      const g = groups.get(where.id)!;
      if (data.name !== undefined) g.name = data.name;
      if (data.exclusive !== undefined) g.exclusive = data.exclusive;
      if (data.required !== undefined) g.required = data.required;
      if (data.sortOrder !== undefined) g.sortOrder = data.sortOrder;
      return {
        ...g,
        modifiers: [...modifiers.values()]
          .filter((m) => m.modifierGroupId === g.id && m.deletedAt === null),
        products: [...links.values()]
          .filter((l) => l.modifierGroupId === g.id)
          .map((l) => ({ productId: l.productId })),
      };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const g of groups.values()) {
        if (where.id && g.id !== where.id) continue;
        if (where.tenantId && g.tenantId !== where.tenantId) continue;
        if (where.deletedAt === null && g.deletedAt !== null) continue;
        if (data.deletedAt !== undefined) g.deletedAt = data.deletedAt;
        count++;
      }
      return { count };
    }),
  },
  modifier: {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const m of modifiers.values()) {
        if (where.id && m.id !== where.id) continue;
        if (where.modifierGroupId && m.modifierGroupId !== where.modifierGroupId)
          continue;
        if (where.deletedAt === null && m.deletedAt !== null) continue;
        if (where.modifierGroup) {
          const g = groups.get(m.modifierGroupId)!;
          if (where.modifierGroup.tenantId && !matchTenant(g, where.modifierGroup.tenantId))
            continue;
          if (where.modifierGroup.deletedAt === null && g.deletedAt !== null) continue;
        }
        return { id: m.id };
      }
      return null;
    }),
    create: vi.fn(async ({ data }: any) => {
      const id =
        "22222222-2222-2222-2222-" + String(modifiers.size + 1).padStart(12, "0");
      const m: FakeModifier = {
        id,
        modifierGroupId: data.modifierGroupId,
        label: data.label,
        priceDeltaCents: data.priceDeltaCents ?? 0,
        sortOrder: data.sortOrder ?? 0,
        isDefault: data.isDefault ?? false,
        createdAt: new Date(),
        deletedAt: null,
      };
      modifiers.set(id, m);
      return m;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const m = modifiers.get(where.id)!;
      if (data.label !== undefined) m.label = data.label;
      if (data.priceDeltaCents !== undefined) m.priceDeltaCents = data.priceDeltaCents;
      if (data.sortOrder !== undefined) m.sortOrder = data.sortOrder;
      if (data.isDefault !== undefined) m.isDefault = data.isDefault;
      return m;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const m of modifiers.values()) {
        if (where.id && m.id !== where.id) continue;
        if (where.modifierGroupId && m.modifierGroupId !== where.modifierGroupId)
          continue;
        if (where.deletedAt === null && m.deletedAt !== null) continue;
        if (where.modifierGroup) {
          const g = groups.get(m.modifierGroupId)!;
          if (where.modifierGroup.tenantId && !matchTenant(g, where.modifierGroup.tenantId))
            continue;
          if (where.modifierGroup.deletedAt === null && g.deletedAt !== null) continue;
        }
        if (data.deletedAt !== undefined) m.deletedAt = data.deletedAt;
        count++;
      }
      return { count };
    }),
  },
  product: {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const p of products.values()) {
        if (where.id && p.id !== where.id) continue;
        if (where.tenantId && p.tenantId !== where.tenantId) continue;
        return { id: p.id };
      }
      return null;
    }),
  },
  productModifierGroup: {
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const k = linkKey(
        where.productId_modifierGroupId.productId,
        where.productId_modifierGroupId.modifierGroupId,
      );
      const existing = links.get(k);
      let link: FakeLink;
      if (existing) {
        Object.assign(existing, update);
        link = existing;
      } else {
        link = { ...create } as FakeLink;
        links.set(k, link);
      }
      return link;
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      let count = 0;
      for (const [k, l] of links.entries()) {
        if (where.productId && l.productId !== where.productId) continue;
        if (where.modifierGroupId && l.modifierGroupId !== where.modifierGroupId)
          continue;
        const product = products.get(l.productId);
        if (where.product?.tenantId && product?.tenantId !== where.product.tenantId)
          continue;
        const grp = groups.get(l.modifierGroupId);
        if (where.modifierGroup?.tenantId && grp?.tenantId !== where.modifierGroup.tenantId)
          continue;
        links.delete(k);
        count++;
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

const { registerAdminModifierGroupRoutes } = await import(
  "../src/admin/modifier-groups.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");

function ownerToken() {
  return `Bearer ${signAccessToken({ sub: OWNER_ID, tid: TENANT, role: "OWNER" })}`;
}
function managerToken() {
  return `Bearer ${signAccessToken({ sub: MANAGER_ID, tid: TENANT, role: "MANAGER" })}`;
}
function cashierToken() {
  return `Bearer ${signAccessToken({ sub: CASHIER_ID, tid: TENANT, role: "CASHIER" })}`;
}

async function buildApp() {
  const app = Fastify();
  await registerAdminModifierGroupRoutes(app);
  return app;
}

beforeEach(() => {
  groups.clear();
  modifiers.clear();
  links.clear();
  products.clear();
  vi.clearAllMocks();
});

describe("Modifier group CRUD (B-Bar-Modifiers)", () => {
  it("OWNER puede crear grupo con defaults", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/modifier-groups",
      headers: { authorization: ownerToken() },
      payload: { name: "Tipo de leche" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.group.name).toBe("Tipo de leche");
    expect(body.group.exclusive).toBe(true);
    expect(body.group.required).toBe(false);
    expect(body.group.modifiers).toEqual([]);
  });

  it("MANAGER también puede crear grupo (operativa de menú)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/modifier-groups",
      headers: { authorization: managerToken() },
      payload: { name: "Tamaño", exclusive: true, required: true },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().group.required).toBe(true);
  });

  it("CASHIER no puede crear grupo → 403", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/modifier-groups",
      headers: { authorization: cashierToken() },
      payload: { name: "X" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Sin token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/admin/modifier-groups",
    });
    expect(res.statusCode).toBe(401);
  });

  it("listado sólo muestra grupos del tenant del Bearer", async () => {
    groups.set(GROUP_MINE, {
      id: GROUP_MINE,
      tenantId: TENANT,
      name: "Tipo de leche",
      exclusive: true,
      required: false,
      sortOrder: 0,
      createdAt: new Date(),
      deletedAt: null,
    });
    groups.set(GROUP_OTHER, {
      id: GROUP_OTHER,
      tenantId: OTHER_TENANT,
      name: "Tipo de pizza",
      exclusive: true,
      required: false,
      sortOrder: 0,
      createdAt: new Date(),
      deletedAt: null,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/admin/modifier-groups",
      headers: { authorization: ownerToken() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].id).toBe(GROUP_MINE);
  });

  it("DELETE hace soft-delete (deletedAt poblado)", async () => {
    groups.set(GROUP_SIZE, {
      id: GROUP_SIZE,
      tenantId: TENANT,
      name: "X",
      exclusive: true,
      required: false,
      sortOrder: 0,
      createdAt: new Date(),
      deletedAt: null,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/modifier-groups/${GROUP_SIZE}`,
      headers: { authorization: ownerToken() },
    });
    expect(res.statusCode).toBe(204);
    expect(groups.get(GROUP_SIZE)!.deletedAt).toBeInstanceOf(Date);
  });

  it("DELETE de grupo de otro tenant → 404 (no fuga)", async () => {
    groups.set(GROUP_OTHER, {
      id: GROUP_OTHER,
      tenantId: OTHER_TENANT,
      name: "X",
      exclusive: true,
      required: false,
      sortOrder: 0,
      createdAt: new Date(),
      deletedAt: null,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/modifier-groups/${GROUP_OTHER}`,
      headers: { authorization: ownerToken() },
    });
    expect(res.statusCode).toBe(404);
    expect(groups.get(GROUP_OTHER)!.deletedAt).toBeNull();
  });

  it("añade modifier al grupo con priceDeltaCents", async () => {
    groups.set(GROUP_SIZE, {
      id: GROUP_SIZE,
      tenantId: TENANT,
      name: "Tamaño",
      exclusive: true,
      required: true,
      sortOrder: 0,
      createdAt: new Date(),
      deletedAt: null,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/modifier-groups/${GROUP_SIZE}/modifiers`,
      headers: { authorization: ownerToken() },
      payload: { label: "Grande", priceDeltaCents: 50 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().modifier.priceDeltaCents).toBe(50);
  });

  it("asocia producto y grupo (idempotente)", async () => {
    groups.set(GROUP_SIZE, {
      id: GROUP_SIZE,
      tenantId: TENANT,
      name: "X",
      exclusive: true,
      required: false,
      sortOrder: 0,
      createdAt: new Date(),
      deletedAt: null,
    });
    products.set(PRODUCT_MINE, { id: PRODUCT_MINE, tenantId: TENANT });
    const app = await buildApp();
    const first = await app.inject({
      method: "POST",
      url: `/admin/products/${PRODUCT_MINE}/modifier-groups/${GROUP_SIZE}`,
      headers: { authorization: ownerToken() },
      payload: { sortOrder: 5 },
    });
    expect(first.statusCode).toBe(200);
    // Re-asociar no falla (upsert).
    const second = await app.inject({
      method: "POST",
      url: `/admin/products/${PRODUCT_MINE}/modifier-groups/${GROUP_SIZE}`,
      headers: { authorization: ownerToken() },
      payload: { sortOrder: 7 },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().link.sortOrder).toBe(7);
  });

  it("desasociar producto×grupo cross-tenant → 404", async () => {
    groups.set(GROUP_OTHER, {
      id: GROUP_OTHER,
      tenantId: OTHER_TENANT,
      name: "X",
      exclusive: true,
      required: false,
      sortOrder: 0,
      createdAt: new Date(),
      deletedAt: null,
    });
    products.set(PRODUCT_OTHER, { id: PRODUCT_OTHER, tenantId: OTHER_TENANT });
    links.set(linkKey(PRODUCT_OTHER, GROUP_OTHER), {
      productId: PRODUCT_OTHER,
      modifierGroupId: GROUP_OTHER,
      sortOrder: 0,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/products/${PRODUCT_OTHER}/modifier-groups/${GROUP_OTHER}`,
      headers: { authorization: ownerToken() },
    });
    expect(res.statusCode).toBe(404);
    expect(links.has(linkKey(PRODUCT_OTHER, GROUP_OTHER))).toBe(true);
  });
});
