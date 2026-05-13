// Tests del endpoint POST /tickets (B4 §1.2). Cubre idempotencia,
// rechazo por payment mismatch y sku vacío. Usa mocks Prisma + cola
// no-op.

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

const TENANT = "00000000-0000-0000-0000-000000000001";
const CASHIER = "00000000-0000-0000-0000-000000000002";
const REGISTER = "00000000-0000-0000-0000-000000000003";
const DEVICE = "00000000-0000-0000-0000-000000000004";
const SHIFT = "00000000-0000-0000-0000-000000000005";

let ticketCounter = 0;
const tickets = new Map<string, any>();
const uploads = new Map<string, any>();
const emailJobs = new Map<string, any>();

const fakePrisma = {
  ticket: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.externalId) return tickets.get(where.externalId) ?? null;
      return null;
    }),
    create: vi.fn(async ({ data, include }: any) => {
      const id = randomUUID();
      const t = {
        id,
        ...data,
        total: { toString: () => String(data.total) },
        totalTax: { toString: () => String(data.totalTax) },
        totalDiscount: { toString: () => String(data.totalDiscount) },
        cashAmount: data.cashAmount ? { toString: () => String(data.cashAmount) } : null,
        createdAt: new Date(),
        paidAt: new Date(),
        register: { id: REGISTER, name: "Caja 1", store: { name: "T1" } },
        lines: data.lines.create.map((l: any, i: number) => ({
          id: `l${i}`,
          ...l,
          units: { toString: () => String(l.units) },
          unitPrice: { toString: () => String(l.unitPrice) },
          discountPct: { toString: () => String(l.discountPct) },
          taxRate: { toString: () => String(l.taxRate) },
          subtotal: { toString: () => String(l.subtotal) },
          total: { toString: () => String(l.total) },
        })),
        payments: data.payments.create.map((p: any, i: number) => ({
          id: `p${i}`,
          method: p.method,
          amount: { toString: () => String(p.amount) },
          meta: p.meta,
        })),
        refunds: [],
      };
      tickets.set(data.externalId, t);
      void include;
      return t;
    }),
    findFirst: vi.fn(async () => null),
  },
  register: {
    update: vi.fn(async ({ where, data, select }: any) => {
      if (data.ticketCounter?.increment) ticketCounter += data.ticketCounter.increment;
      void where;
      void select;
      return { ticketCounter };
    }),
  },
  shift: {
    findFirst: vi.fn(async ({ where }: any) => {
      if (where.id === SHIFT) return { id: SHIFT };
      return null;
    }),
    update: vi.fn(async () => ({})),
  },
  holdedUpload: {
    upsert: vi.fn(async ({ where, create }: any) => {
      if (uploads.has(where.externalId)) return uploads.get(where.externalId);
      const u = { ...create };
      uploads.set(where.externalId, u);
      return u;
    }),
  },
  ticketEmailJob: {
    create: vi.fn(async ({ data }: any) => {
      emailJobs.set(data.id, data);
      return { id: data.id };
    }),
  },
  $transaction: vi.fn(async (fn: any) => {
    if (typeof fn === "function") return await fn(fakePrisma);
    return await Promise.all(fn);
  }),
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: async () => undefined,
}));
vi.mock("../src/queues/refund-upload.js", () => ({
  enqueueRefundUpload: async () => undefined,
}));
vi.mock("../src/queues/ticket-email.js", () => ({
  enqueueTicketEmail: async () => undefined,
}));

import { registerTicketRoutes } from "../src/tickets/routes.js";

function cashierToken() {
  return jwt.sign(
    {
      sub: CASHIER,
      tid: TENANT,
      did: DEVICE,
      rid: REGISTER,
      role: "CASHIER",
      type: "cashier",
    },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: "30m" },
  );
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerTicketRoutes(app);
  return app;
}

beforeEach(() => {
  tickets.clear();
  uploads.clear();
  emailJobs.clear();
  ticketCounter = 0;
  vi.clearAllMocks();
});

describe("POST /tickets", () => {
  it("happy path: persiste ticket en PENDING_SYNC y encola upload", async () => {
    const app = await buildApp();
    const externalId = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: { authorization: `Bearer ${cashierToken()}` },
      payload: {
        externalId,
        registerId: REGISTER,
        shiftId: SHIFT,
        lines: [
          {
            nameSnapshot: "Cafe",
            sku: "CAFE-1",
            units: 1,
            unitPrice: 1.4,
            discountPct: 0,
            taxRate: 10,
          },
        ],
        payments: [{ method: "CASH", amount: 1.54 }],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ticket.status).toBe("PENDING_SYNC");
    expect(body.ticket.internalNumber).toBe("000001");
  });

  it("idempotente: mismo externalId → devuelve el ticket existente (200)", async () => {
    const app = await buildApp();
    const externalId = randomUUID();
    const payload = {
      externalId,
      registerId: REGISTER,
      shiftId: SHIFT,
      lines: [
        {
          nameSnapshot: "Cafe",
          sku: "CAFE-1",
          units: 1,
          unitPrice: 1.4,
          discountPct: 0,
          taxRate: 10,
        },
      ],
      payments: [{ method: "CASH", amount: 1.54 }],
    };
    await app.inject({
      method: "POST",
      url: "/tickets",
      headers: { authorization: `Bearer ${cashierToken()}` },
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: { authorization: `Bearer ${cashierToken()}` },
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().duplicate).toBe(true);
  });

  it("rechaza pagos no cuadrados (PAYMENTS_MISMATCH)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: { authorization: `Bearer ${cashierToken()}` },
      payload: {
        externalId: randomUUID(),
        registerId: REGISTER,
        shiftId: SHIFT,
        lines: [
          {
            nameSnapshot: "X",
            sku: "X-1",
            units: 1,
            unitPrice: 10,
            discountPct: 0,
            taxRate: 21,
          },
        ],
        // Total esperado: 12.10; mando 5.
        payments: [{ method: "CASH", amount: 5 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("PAYMENTS_MISMATCH");
  });

  it("rechaza líneas sin SKU (LINE_WITHOUT_SKU)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: { authorization: `Bearer ${cashierToken()}` },
      payload: {
        externalId: randomUUID(),
        registerId: REGISTER,
        shiftId: SHIFT,
        lines: [
          {
            nameSnapshot: "X",
            sku: "  ", // espacios no son sku
            units: 1,
            unitPrice: 10,
            discountPct: 0,
            taxRate: 21,
          },
        ],
        payments: [{ method: "CASH", amount: 12.1 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("LINE_WITHOUT_SKU");
  });

  it("rechaza ticket si la caja no coincide con la sesión", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: { authorization: `Bearer ${cashierToken()}` },
      payload: {
        externalId: randomUUID(),
        registerId: "11111111-1111-1111-1111-111111111111",
        shiftId: SHIFT,
        lines: [
          { nameSnapshot: "x", sku: "S", units: 1, unitPrice: 1, discountPct: 0, taxRate: 0 },
        ],
        payments: [{ method: "CASH", amount: 1 }],
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("REGISTER_MISMATCH");
  });

  it("rechaza si el turno no está abierto", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: { authorization: `Bearer ${cashierToken()}` },
      payload: {
        externalId: randomUUID(),
        registerId: REGISTER,
        shiftId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        lines: [
          { nameSnapshot: "x", sku: "S", units: 1, unitPrice: 1, discountPct: 0, taxRate: 0 },
        ],
        payments: [{ method: "CASH", amount: 1 }],
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("SHIFT_NOT_OPEN");
  });
});
