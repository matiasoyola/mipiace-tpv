// Tests de los endpoints de gift receipts (B6 §5).

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
const REGISTER_ID = "00000000-0000-0000-0000-0000000000bb";
const STORE_ID = "00000000-0000-0000-0000-0000000000cc";

interface FakeTicket {
  id: string;
  tenantId: string;
  internalNumber: string;
  registerId: string;
  total: number;
  status: string;
  createdAt: Date;
  giftReceiptIntentAt: Date | null;
}

const tickets = new Map<string, FakeTicket>();

function dec(n: number) {
  return { toString: () => String(n) };
}

const fakePrisma = {
  ticket: {
    findMany: vi.fn(async ({ where, take }: any) => {
      void take;
      const list = [...tickets.values()].filter((t) => {
        if (where?.tenantId && t.tenantId !== where.tenantId) return false;
        if (where?.createdAt?.gte && t.createdAt < where.createdAt.gte) return false;
        if (where?.createdAt?.lte && t.createdAt > where.createdAt.lte) return false;
        if (where?.status?.in && !where.status.in.includes(t.status)) return false;
        return true;
      });
      return list.map((t) => ({
        ...t,
        total: dec(t.total),
        register: {
          id: t.registerId,
          name: "Caja 1",
          store: { id: STORE_ID, name: "Tienda" },
        },
        lines: [
          {
            nameSnapshot: "Producto X",
            units: dec(1),
          },
        ],
      }));
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const t of tickets.values()) {
        if (where.id && t.id !== where.id) continue;
        if (where.tenantId && t.tenantId !== where.tenantId) continue;
        return { id: t.id };
      }
      return null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = tickets.get(where.id);
      if (!t) throw new Error("not found");
      if (data.giftReceiptIntentAt != null) {
        t.giftReceiptIntentAt = data.giftReceiptIntentAt;
      }
      return {
        id: t.id,
        giftReceiptIntentAt: t.giftReceiptIntentAt,
      };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const t of tickets.values()) {
        if (where.id?.in && !where.id.in.includes(t.id)) continue;
        if (where.tenantId && t.tenantId !== where.tenantId) continue;
        if (data.giftReceiptIntentAt != null) {
          t.giftReceiptIntentAt = data.giftReceiptIntentAt;
        }
        count++;
      }
      return { count };
    }),
  },
  register: {
    findMany: vi.fn(async ({ where }: any) => {
      const list = [...tickets.values()]
        .map((t) => t.registerId)
        .filter((id) => id === REGISTER_ID);
      if (where.storeId && where.storeId !== STORE_ID) return [];
      return list.map((id) => ({ id }));
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

const { registerAdminGiftReceiptRoutes } = await import(
  "../src/admin/gift-receipts.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");

function ownerToken() {
  return `Bearer ${signAccessToken({ sub: OWNER_ID, tid: TENANT, role: "OWNER" })}`;
}

beforeEach(() => {
  tickets.clear();
  vi.clearAllMocks();
});

function addTicket(id: string, opts: Partial<FakeTicket> = {}) {
  tickets.set(id, {
    id,
    tenantId: TENANT,
    internalNumber: "000001",
    registerId: REGISTER_ID,
    total: 25,
    status: "SYNCED",
    createdAt: new Date(),
    giftReceiptIntentAt: null,
    ...opts,
  });
}

async function buildApp() {
  const app = Fastify();
  await registerAdminGiftReceiptRoutes(app);
  return app;
}

describe("Gift receipts (B6 §5)", () => {
  it("lista candidatos del tenant excluyendo otros tenants", async () => {
    addTicket("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", {
      total: 25,
    });
    addTicket("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", {
      tenantId: OTHER_TENANT,
      total: 99,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/admin/tickets/gift-receipt-candidates?daysBack=30",
      headers: { authorization: ownerToken() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  });

  it("POST :id/gift-receipt-intent marca giftReceiptIntentAt", async () => {
    addTicket("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/tickets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/gift-receipt-intent",
      headers: { authorization: ownerToken() },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ticket.giftReceiptIntentAt).toBeTruthy();
    expect(
      tickets.get("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")!.giftReceiptIntentAt,
    ).toBeInstanceOf(Date);
  });

  it("ticket de otro tenant → 404", async () => {
    addTicket("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", {
      tenantId: OTHER_TENANT,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/tickets/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/gift-receipt-intent",
      headers: { authorization: ownerToken() },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("batch marca todos los del propio tenant; ignora ajenos", async () => {
    addTicket("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    addTicket("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    addTicket("cccccccc-cccc-cccc-cccc-cccccccccccc", {
      tenantId: OTHER_TENANT,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/admin/tickets/batch-gift-receipt",
      headers: { authorization: ownerToken() },
      payload: {
        ticketIds: [
          "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          "cccccccc-cccc-cccc-cccc-cccccccccccc",
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.requested).toBe(3);
    expect(body.updated).toBe(2);
  });
});
