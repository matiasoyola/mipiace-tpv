// Tests del endpoint POST /tickets/:id/partial-payment
// (v1.4-Bar-Operativa-MVP Lote 4 · split bill Modo A).

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
const REGISTER = "00000000-0000-0000-0000-000000000002";
const DEVICE = "00000000-0000-0000-0000-000000000003";
const CASHIER = "00000000-0000-0000-0000-000000000004";
const TICKET = "00000000-0000-0000-0000-000000000005";

interface FakeTicket {
  id: string;
  tenantId: string;
  registerId: string;
  status: "DRAFT" | "PAID";
  lines: Array<{
    units: number;
    unitPrice: number;
    discountPct: number;
    taxRate: number;
    modifiers: unknown;
  }>;
  partialPayments: Array<{ amount: number }>;
}

const state = {
  tickets: new Map<string, FakeTicket>(),
  partials: [] as Array<{
    id: string;
    ticketId: string;
    amount: number;
    method: string;
  }>,
};

const fakePrisma = {
  ticket: {
    findFirst: vi.fn(async ({ where, include: _include }: any) => {
      const t = state.tickets.get(where.id);
      if (!t) return null;
      if (where.tenantId && t.tenantId !== where.tenantId) return null;
      if (where.status && t.status !== where.status) return null;
      return {
        ...t,
        lines: t.lines.map((l) => ({
          units: l.units,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          taxRate: l.taxRate,
          modifiers: l.modifiers,
        })),
        partialPayments: t.partialPayments.map((p) => ({ amount: p.amount })),
      };
    }),
  },
  ticketPartialPayment: {
    create: vi.fn(async ({ data, select: _select }: any) => {
      const id = `pp-${state.partials.length + 1}`;
      const ticket = state.tickets.get(data.ticketId);
      if (ticket) {
        ticket.partialPayments.push({ amount: Number(data.amount) });
      }
      state.partials.push({
        id,
        ticketId: data.ticketId,
        amount: Number(data.amount),
        method: data.method,
      });
      return { id };
    }),
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}) as never,
  shutdown: async () => undefined,
}));

const { registerPartialPaymentRoute } = await import(
  "../src/tickets/partial-payment.js"
);
const { signCashierSession } = await import("../src/shift/cashier-session.js");

function signSession() {
  return signCashierSession(
    {
      sub: CASHIER,
      tid: TENANT,
      did: DEVICE,
      rid: REGISTER,
      role: "CASHIER",
    },
    10,
  );
}

async function buildApp() {
  const app = Fastify();
  await registerPartialPaymentRoute(app);
  return app;
}

// 1 línea, 100 € (sin IVA, sin descuento) para simplificar la
// aritmética de los tests. computeTicket aplica IVA 0% por
// defecto al parámetro 0.
function seedTicket(overrides: Partial<FakeTicket> = {}): FakeTicket {
  const t: FakeTicket = {
    id: TICKET,
    tenantId: TENANT,
    registerId: REGISTER,
    status: "DRAFT",
    lines: [
      {
        units: 1,
        unitPrice: 100,
        discountPct: 0,
        taxRate: 0,
        modifiers: null,
      },
    ],
    partialPayments: [],
    ...overrides,
  };
  state.tickets.set(t.id, t);
  return t;
}

beforeEach(() => {
  state.tickets.clear();
  state.partials.length = 0;
  vi.clearAllMocks();
});

describe("POST /tickets/:id/partial-payment", () => {
  it("happy path: cobro parcial 30 € de 100 € → remaining 70", async () => {
    seedTicket();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/partial-payment`,
      headers: { authorization: `Bearer ${signSession()}` },
      payload: { amount: 30, method: "CARD" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.total).toBeCloseTo(100, 2);
    expect(body.collected).toBeCloseTo(30, 2);
    expect(body.remaining).toBeCloseTo(70, 2);
    expect(body.readyToClose).toBe(false);
    expect(state.partials).toHaveLength(1);
  });

  it("cobros sucesivos suman: 30 + 70 → readyToClose=true", async () => {
    seedTicket({ partialPayments: [{ amount: 30 }] });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/partial-payment`,
      headers: { authorization: `Bearer ${signSession()}` },
      payload: { amount: 70, method: "CASH", cashAmount: 100 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.collected).toBeCloseTo(100, 2);
    expect(body.remaining).toBeCloseTo(0, 2);
    expect(body.readyToClose).toBe(true);
  });

  it("amount > remaining → 400 AMOUNT_EXCEEDS_REMAINING", async () => {
    seedTicket();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/partial-payment`,
      headers: { authorization: `Bearer ${signSession()}` },
      payload: { amount: 150, method: "CASH" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("AMOUNT_EXCEEDS_REMAINING");
    expect(res.json().remaining).toBeCloseTo(100, 2);
  });

  it("ticket no DRAFT → 404", async () => {
    seedTicket({ status: "PAID" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/partial-payment`,
      headers: { authorization: `Bearer ${signSession()}` },
      payload: { amount: 10, method: "CASH" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("TICKET_NOT_FOUND_OR_NOT_DRAFT");
  });

  it("register mismatch → 403", async () => {
    seedTicket({ registerId: "ffffffff-ffff-ffff-ffff-ffffffffffff" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/partial-payment`,
      headers: { authorization: `Bearer ${signSession()}` },
      payload: { amount: 10, method: "CASH" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("REGISTER_MISMATCH");
  });

  it("ticket sin líneas → 400 TICKET_EMPTY", async () => {
    seedTicket({ lines: [] });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/partial-payment`,
      headers: { authorization: `Bearer ${signSession()}` },
      payload: { amount: 10, method: "CASH" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("TICKET_EMPTY");
  });
});
