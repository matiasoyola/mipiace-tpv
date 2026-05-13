// Tests del CRUD de tiendas y cajas (B4 §0). Mocks Prisma en memoria.
// Cubre los guardrails clave: warehouse inexistente, store con tickets
// (no permite cambiar warehouseHoldedId), register con devices/tickets
// (no permite borrar).

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Store {
  id: string;
  tenantId: string;
  name: string;
  warehouseHoldedId: string | null;
  fiscalAddress: Record<string, unknown> | null;
  deletedAt: Date | null;
  createdAt: Date;
}
interface Register {
  id: string;
  storeId: string;
  name: string;
  numSerieHolded: string | null;
  ticketCounter: number;
  deletedAt: Date | null;
  createdAt: Date;
  printerConfig: unknown;
}

const stores = new Map<string, Store>();
const registers = new Map<string, Register>();
const warehouses = new Map<string, { tenantId: string; holdedWarehouseId: string; name: string }>();
const tickets = new Map<string, { id: string; tenantId: string; registerId: string; total: number; status: string; createdAt: Date }>();
const devices = new Map<string, { id: string; registerId: string; revokedAt: Date | null }>();

function filter<T>(map: Map<string, T>, pred: (v: T) => boolean): T[] {
  return Array.from(map.values()).filter(pred);
}

const fakePrisma = {
  store: {
    findMany: vi.fn(async ({ where, select }: any) => {
      const out = filter(stores, (s) => {
        if (where.tenantId && s.tenantId !== where.tenantId) return false;
        if (where.deletedAt === null && s.deletedAt) return false;
        return true;
      }).sort((a, b) => a.name.localeCompare(b.name));
      return out.map((s) => {
        const row: any = { ...s };
        if (select?.registers) {
          row.registers = filter(registers, (r) => r.storeId === s.id && !r.deletedAt).map((r) => ({
            id: r.id,
          }));
        }
        return row;
      });
    }),
    findFirst: vi.fn(async ({ where, select }: any) => {
      const out = filter(stores, (s) => {
        if (where.id && s.id !== where.id) return false;
        if (where.tenantId && s.tenantId !== where.tenantId) return false;
        if (where.deletedAt === null && s.deletedAt) return false;
        return true;
      })[0];
      if (!out) return null;
      const row: any = { ...out };
      if (select?.registers) {
        row.registers = filter(registers, (r) => r.storeId === out.id && !r.deletedAt).map((r) => ({
          ...r,
        }));
      }
      return row;
    }),
    create: vi.fn(async ({ data }: any) => {
      const s: Store = {
        id: randomUUID(),
        tenantId: data.tenantId,
        name: data.name,
        warehouseHoldedId: data.warehouseHoldedId ?? null,
        fiscalAddress: data.fiscalAddress ?? null,
        deletedAt: null,
        createdAt: new Date(),
      };
      stores.set(s.id, s);
      return s;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const s = stores.get(where.id);
      if (!s) throw new Error("not found");
      if (data.name !== undefined) s.name = data.name;
      if (data.warehouseHoldedId !== undefined) s.warehouseHoldedId = data.warehouseHoldedId;
      if (data.fiscalAddress !== undefined) s.fiscalAddress = data.fiscalAddress;
      if (data.deletedAt !== undefined) s.deletedAt = data.deletedAt;
      return s;
    }),
  },
  register: {
    findMany: vi.fn(async ({ where }: any) => {
      return filter(registers, (r) => {
        if (where.storeId && r.storeId !== where.storeId) return false;
        if (where.deletedAt === null && r.deletedAt) return false;
        if (where.store?.tenantId) {
          const s = stores.get(r.storeId);
          if (!s || s.tenantId !== where.store.tenantId) return false;
        }
        return true;
      }).map((r) => ({ ...r, store: { id: r.storeId, name: stores.get(r.storeId)?.name ?? "" } }));
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const r = filter(registers, (r) => {
        if (where.id && r.id !== where.id) return false;
        if (where.deletedAt === null && r.deletedAt) return false;
        if (where.store?.tenantId) {
          const s = stores.get(r.storeId);
          if (!s || s.tenantId !== where.store.tenantId) return false;
        }
        return true;
      })[0];
      return r ?? null;
    }),
    create: vi.fn(async ({ data }: any) => {
      const r: Register = {
        id: randomUUID(),
        storeId: data.storeId,
        name: data.name,
        numSerieHolded: data.numSerieHolded ?? null,
        ticketCounter: 0,
        deletedAt: null,
        createdAt: new Date(),
        printerConfig: null,
      };
      registers.set(r.id, r);
      return r;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const r = registers.get(where.id);
      if (!r) throw new Error("not found");
      if (data.name !== undefined) r.name = data.name;
      if (data.numSerieHolded !== undefined) r.numSerieHolded = data.numSerieHolded;
      if (data.deletedAt !== undefined) r.deletedAt = data.deletedAt;
      return r;
    }),
    count: vi.fn(async ({ where }: any) => {
      return filter(registers, (r) => {
        if (where.storeId && r.storeId !== where.storeId) return false;
        if (where.deletedAt === null && r.deletedAt) return false;
        return true;
      }).length;
    }),
  },
  warehouse: {
    findMany: vi.fn(async ({ where }: any) => {
      return filter(warehouses, (w) => w.tenantId === where.tenantId).map((w) => ({
        ...w,
        id: w.holdedWarehouseId,
      }));
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      return filter(warehouses, (w) => {
        if (where.tenantId && w.tenantId !== where.tenantId) return false;
        if (where.holdedWarehouseId && w.holdedWarehouseId !== where.holdedWarehouseId) return false;
        return true;
      })[0] ?? null;
    }),
  },
  device: {
    groupBy: vi.fn(async ({ where }: any) => {
      const counts = new Map<string, number>();
      for (const d of devices.values()) {
        if (where.registerId?.in && !where.registerId.in.includes(d.registerId)) continue;
        if (where.revokedAt === null && d.revokedAt) continue;
        counts.set(d.registerId, (counts.get(d.registerId) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([registerId, c]) => ({
        registerId,
        _count: c,
      }));
    }),
    count: vi.fn(async ({ where }: any) => {
      return filter(devices, (d) => {
        if (where.registerId && d.registerId !== where.registerId) return false;
        if (where.revokedAt === null && d.revokedAt) return false;
        return true;
      }).length;
    }),
  },
  ticket: {
    findMany: vi.fn(async ({ where }: any) => {
      return filter(tickets, (t) => {
        if (where.tenantId && t.tenantId !== where.tenantId) return false;
        return true;
      });
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      return filter(tickets, (t) => {
        if (where.register?.storeId && t.registerId) {
          const r = registers.get(t.registerId);
          if (!r || r.storeId !== where.register.storeId) return false;
        }
        return true;
      })[0] ?? null;
    }),
    count: vi.fn(async ({ where }: any) => {
      return filter(tickets, (t) => {
        if (where.registerId && t.registerId !== where.registerId) return false;
        return true;
      }).length;
    }),
    groupBy: vi.fn(async () => []),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

import { requireOwner } from "../src/auth/middleware.js";
import { registerStoresRoutes } from "../src/stores/routes.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const OWNER = "00000000-0000-0000-0000-000000000099";

function ownerToken() {
  return jwt.sign(
    { sub: OWNER, tid: TENANT, role: "OWNER", type: "access" },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: "15m" },
  );
}

async function buildApp() {
  const app = Fastify({ logger: false });
  void requireOwner;
  await registerStoresRoutes(app);
  return app;
}

beforeEach(() => {
  stores.clear();
  registers.clear();
  warehouses.clear();
  tickets.clear();
  devices.clear();
  warehouses.set("w-1", { tenantId: TENANT, holdedWarehouseId: "wh-default", name: "Almacén default" });
});

describe("GET /admin/warehouses", () => {
  it("devuelve los almacenes del tenant", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/admin/warehouses",
      headers: { authorization: `Bearer ${ownerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().warehouses).toHaveLength(1);
  });
});

describe("POST /admin/stores", () => {
  it("crea una tienda contra un warehouse válido", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/stores",
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { name: "Tienda 1", warehouseHoldedId: "wh-default" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().store.name).toBe("Tienda 1");
  });

  it("rechaza warehouse inexistente con 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/stores",
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { name: "X", warehouseHoldedId: "wh-no-existe" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("WAREHOUSE_NOT_FOUND");
  });
});

describe("DELETE /admin/stores/:id", () => {
  it("rechaza con 409 si la tienda tiene cajas activas", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/admin/stores",
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { name: "T", warehouseHoldedId: "wh-default" },
    });
    const storeId = created.json().store.id;
    await app.inject({
      method: "POST",
      url: `/admin/stores/${storeId}/registers`,
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { name: "Caja 1" },
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/stores/${storeId}`,
      headers: { authorization: `Bearer ${ownerToken()}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("STORE_HAS_REGISTERS");
  });

  it("soft-delete si no hay cajas", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/admin/stores",
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { name: "T", warehouseHoldedId: "wh-default" },
    });
    const storeId = created.json().store.id;
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/stores/${storeId}`,
      headers: { authorization: `Bearer ${ownerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(stores.get(storeId)!.deletedAt).not.toBeNull();
  });
});

describe("DELETE /admin/registers/:id", () => {
  it("rechaza si la caja tiene tickets", async () => {
    const app = await buildApp();
    const store = (
      await app.inject({
        method: "POST",
        url: "/admin/stores",
        headers: { authorization: `Bearer ${ownerToken()}` },
        payload: { name: "T", warehouseHoldedId: "wh-default" },
      })
    ).json().store;
    const reg = (
      await app.inject({
        method: "POST",
        url: `/admin/stores/${store.id}/registers`,
        headers: { authorization: `Bearer ${ownerToken()}` },
        payload: { name: "Caja 1" },
      })
    ).json().register;
    tickets.set("t1", {
      id: "t1",
      tenantId: TENANT,
      registerId: reg.id,
      total: 5,
      status: "SYNCED",
      createdAt: new Date(),
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/admin/registers/${reg.id}`,
      headers: { authorization: `Bearer ${ownerToken()}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("REGISTER_HAS_TICKETS");
  });
});

describe("PATCH /admin/stores/:id", () => {
  it("rechaza cambiar warehouse si la tienda tiene tickets", async () => {
    const app = await buildApp();
    warehouses.set("w-2", {
      tenantId: TENANT,
      holdedWarehouseId: "wh-other",
      name: "Otro almacén",
    });
    const store = (
      await app.inject({
        method: "POST",
        url: "/admin/stores",
        headers: { authorization: `Bearer ${ownerToken()}` },
        payload: { name: "T", warehouseHoldedId: "wh-default" },
      })
    ).json().store;
    const reg = (
      await app.inject({
        method: "POST",
        url: `/admin/stores/${store.id}/registers`,
        headers: { authorization: `Bearer ${ownerToken()}` },
        payload: { name: "Caja 1" },
      })
    ).json().register;
    tickets.set("t-history", {
      id: "t-history",
      tenantId: TENANT,
      registerId: reg.id,
      total: 5,
      status: "SYNCED",
      createdAt: new Date(),
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/admin/stores/${store.id}`,
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { warehouseHoldedId: "wh-other" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("STORE_HAS_TICKETS");
  });
});
