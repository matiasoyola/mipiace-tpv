// v1.8-Fiado · flujo de venta a crédito de punta a punta.
//
// Cubre:
//   - POST /tickets creditSale → ON_CREDIT, creditPending=total, NO
//     encola upload (gate), exige flag + contacto.
//   - GET /credits → deuda agregada por contacto, búsqueda por nombre.
//   - POST /credit-payments → parcial (sigue ON_CREDIT), idempotencia,
//     no-sobrepago (409), saldo total → PAID + encola upload una vez.
//   - POST /credit-void → PIN encargado, 409 si hay cobros parciales.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { Prisma } from "@mipiacetpv/db";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001";
const CASHIER = "00000000-0000-0000-0000-000000000002";
const REGISTER = "00000000-0000-0000-0000-000000000003";
const DEVICE = "00000000-0000-0000-0000-000000000004";
const SHIFT = "00000000-0000-0000-0000-000000000005";
const MANAGER = "00000000-0000-0000-0000-000000000009";
const CONTACT = "holded-contact-abc";

let ticketCounter = 0;
let creditSalesEnabled = true;
const ticketsById = new Map<string, any>();
const ticketsByExternal = new Map<string, any>();
const paymentsByExternal = new Map<string, any>();
const uploads = new Map<string, any>();
const enqueued: string[] = [];

function decimalize(t: any) {
  // Devuelve el ticket con los campos numéricos como Prisma.Decimal
  // (lo que devuelve Postgres). Number(...) los reconvierte.
  return t;
}

const fakePrisma: any = {
  ticket: {
    findUnique: vi.fn(async ({ where }: any) =>
      where.externalId ? (ticketsByExternal.get(where.externalId) ?? null) : null,
    ),
    findFirst: vi.fn(async ({ where }: any) => {
      const t = where.id ? ticketsById.get(where.id) : null;
      if (!t) return null;
      if (where.tenantId && t.tenantId !== where.tenantId) return null;
      return decimalize(t);
    }),
    findMany: vi.fn(async ({ where }: any) => {
      return [...ticketsById.values()].filter(
        (t) =>
          t.tenantId === where.tenantId &&
          t.creditPending != null &&
          Number(t.creditPending) > 0,
      );
    }),
    create: vi.fn(async ({ data }: any) => {
      const id = randomUUID();
      const t = {
        id,
        ...data,
        createdAt: new Date(),
        paidAt: data.paidAt ?? new Date(),
        register: { id: REGISTER, name: "Caja 1", store: { name: "T1" } },
        lines: (data.lines?.create ?? []).map((l: any, i: number) => ({
          id: `l${i}`,
          ...l,
          units: { toString: () => String(l.units) },
          unitPrice: { toString: () => String(l.unitPrice) },
          discountPct: { toString: () => String(l.discountPct) },
          taxRate: { toString: () => String(l.taxRate) },
          subtotal: { toString: () => String(l.subtotal) },
          total: { toString: () => String(l.total) },
        })),
        payments: (data.payments?.create ?? []).map((p: any, i: number) => ({
          id: `p${i}`,
          method: p.method,
          amount: { toString: () => String(p.amount) },
        })),
        refunds: [],
        _count: { payments: (data.payments?.create ?? []).length },
      };
      ticketsById.set(id, t);
      ticketsByExternal.set(data.externalId, t);
      return t;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = ticketsById.get(where.id);
      Object.assign(t, data);
      return t;
    }),
  },
  ticketPayment: {
    findUnique: vi.fn(async ({ where }: any) =>
      paymentsByExternal.get(where.externalId) ?? null,
    ),
    create: vi.fn(async ({ data }: any) => {
      const p = { id: randomUUID(), ...data };
      if (data.externalId) paymentsByExternal.set(data.externalId, p);
      const t = ticketsById.get(data.ticketId);
      if (t) t._count = { payments: (t._count?.payments ?? 0) + 1 };
      return p;
    }),
  },
  contact: {
    findMany: vi.fn(async () => [{ holdedContactId: CONTACT, name: "Juan Deudor" }]),
    findFirst: vi.fn(async () => ({ name: "Juan Deudor" })),
  },
  register: {
    update: vi.fn(async ({ data }: any) => {
      if (data.ticketCounter?.increment) ticketCounter += data.ticketCounter.increment;
      return { ticketCounter };
    }),
  },
  shift: {
    findFirst: vi.fn(async ({ where }: any) => (where.id === SHIFT ? { id: SHIFT } : null)),
    update: vi.fn(async () => ({})),
  },
  holdedUpload: {
    upsert: vi.fn(async ({ where, create }: any) => {
      if (uploads.has(where.externalId)) return uploads.get(where.externalId);
      uploads.set(where.externalId, { ...create });
      return uploads.get(where.externalId);
    }),
  },
  tenant: {
    findUniqueOrThrow: vi.fn(async () => ({
      discountThresholdPct: { toString: () => "10" },
      creditSalesEnabled,
    })),
  },
  user: {
    findFirst: vi.fn(async () => ({ email: "jefe@bar.es" })),
  },
  $transaction: vi.fn(async (fn: any) => {
    if (typeof fn !== "function") return await Promise.all(fn);
    return await fn(fakePrisma);
  }),
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));
vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: async (externalId: string) => {
    enqueued.push(externalId);
  },
}));
vi.mock("../src/queues/ticket-email.js", () => ({ enqueueTicketEmail: async () => undefined }));
vi.mock("../src/queues/refund-upload.js", () => ({ enqueueRefundUpload: async () => undefined }));
vi.mock("../src/realtime/emit-helpers.js", () => ({
  emitTicketPaid: async () => undefined,
  emitTicketRefunded: async () => undefined,
}));
vi.mock("../src/tickets/email-trigger.js", () => ({
  maybeEnqueueAutoEmail: async () => undefined,
}));

import { registerTicketRoutes } from "../src/tickets/routes.js";
import { registerCreditRoutes } from "../src/tickets/credit-routes.js";
import { signManagerAuthorization } from "../src/auth/manager-authorization.js";

function cashierToken() {
  return jwt.sign(
    { sub: CASHIER, tid: TENANT, did: DEVICE, rid: REGISTER, role: "CASHIER", type: "cashier" },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: "30m" },
  );
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerTicketRoutes(app);
  await registerCreditRoutes(app);
  return app;
}

const AUTH = () => ({ authorization: `Bearer ${cashierToken()}` });

async function sellOnCredit(app: any, opts: { contact?: string | null } = {}) {
  const externalId = randomUUID();
  const res = await app.inject({
    method: "POST",
    url: "/tickets",
    headers: AUTH(),
    payload: {
      externalId,
      registerId: REGISTER,
      shiftId: SHIFT,
      creditSale: true,
      contactHoldedId: opts.contact === undefined ? CONTACT : opts.contact ?? undefined,
      lines: [
        { nameSnapshot: "Saco pipas", sku: "PIPAS-1", units: 1, unitPrice: 10, discountPct: 0, taxRate: 0 },
      ],
      payments: [],
    },
  });
  return { res, externalId };
}

beforeEach(() => {
  ticketsById.clear();
  ticketsByExternal.clear();
  paymentsByExternal.clear();
  uploads.clear();
  enqueued.length = 0;
  ticketCounter = 0;
  creditSalesEnabled = true;
  vi.clearAllMocks();
});

describe("POST /tickets creditSale", () => {
  it("crea ON_CREDIT con creditPending=total y NO encola upload", async () => {
    const app = await buildApp();
    const { res, externalId } = await sellOnCredit(app);
    expect(res.statusCode).toBe(201);
    expect(res.json().ticket.status).toBe("ON_CREDIT");
    expect(enqueued).toHaveLength(0);
    expect(uploads.has(externalId)).toBe(false);
    const t = ticketsByExternal.get(externalId);
    expect(Number(t.creditPending)).toBe(10);
  });

  it("400 si el flag creditSalesEnabled está OFF", async () => {
    creditSalesEnabled = false;
    const app = await buildApp();
    const { res } = await sellOnCredit(app);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("CREDIT_SALES_DISABLED");
  });

  it("400 si falta contacto (deudor)", async () => {
    const app = await buildApp();
    const { res } = await sellOnCredit(app, { contact: null });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("CREDIT_SALE_REQUIRES_CONTACT");
  });

  it("400 si un fiado trae pagos", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: AUTH(),
      payload: {
        externalId: randomUUID(),
        registerId: REGISTER,
        shiftId: SHIFT,
        creditSale: true,
        contactHoldedId: CONTACT,
        lines: [{ nameSnapshot: "X", sku: "X-1", units: 1, unitPrice: 10, discountPct: 0, taxRate: 0 }],
        payments: [{ method: "CASH", amount: 10 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("CREDIT_SALE_WITH_PAYMENTS");
  });
});

describe("GET /credits", () => {
  it("agrega la deuda por contacto con nombre y nº tickets", async () => {
    const app = await buildApp();
    await sellOnCredit(app);
    await sellOnCredit(app);
    const res = await app.inject({ method: "GET", url: "/credits", headers: AUTH() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].name).toBe("Juan Deudor");
    expect(body.contacts[0].balance).toBe(20);
    expect(body.contacts[0].ticketCount).toBe(2);
  });

  it("filtra por nombre de contacto", async () => {
    const app = await buildApp();
    await sellOnCredit(app);
    const hit = await app.inject({ method: "GET", url: "/credits?search=juan", headers: AUTH() });
    expect(hit.json().contacts).toHaveLength(1);
    const miss = await app.inject({ method: "GET", url: "/credits?search=zzz", headers: AUTH() });
    expect(miss.json().contacts).toHaveLength(0);
  });
});

describe("POST /tickets/:id/credit-payments", () => {
  it("cobro parcial: sigue ON_CREDIT y no encola", async () => {
    const app = await buildApp();
    const { externalId } = await sellOnCredit(app);
    const ticketId = ticketsByExternal.get(externalId).id;
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${ticketId}/credit-payments`,
      headers: AUTH(),
      payload: { externalId: randomUUID(), shiftId: SHIFT, amount: 4, method: "CASH" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().settled).toBe(false);
    expect(Number(res.json().ticket.creditPending)).toBe(6);
    expect(res.json().ticket.status).toBe("ON_CREDIT");
    expect(enqueued).toHaveLength(0);
  });

  it("saldo total: PAID + encola upload una sola vez", async () => {
    const app = await buildApp();
    const { externalId } = await sellOnCredit(app);
    const ticketId = ticketsByExternal.get(externalId).id;
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${ticketId}/credit-payments`,
      headers: AUTH(),
      payload: { externalId: randomUUID(), shiftId: SHIFT, amount: 10, method: "CARD" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().settled).toBe(true);
    expect(res.json().ticket.status).toBe("PAID");
    expect(enqueued).toEqual([externalId]);
    expect(uploads.has(externalId)).toBe(true);
  });

  it("no-sobrepago: 409 si el cobro supera la deuda", async () => {
    const app = await buildApp();
    const { externalId } = await sellOnCredit(app);
    const ticketId = ticketsByExternal.get(externalId).id;
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${ticketId}/credit-payments`,
      headers: AUTH(),
      payload: { externalId: randomUUID(), shiftId: SHIFT, amount: 15, method: "CASH" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("CREDIT_OVERPAY");
  });

  it("idempotencia: mismo externalId de cobro no duplica", async () => {
    const app = await buildApp();
    const { externalId } = await sellOnCredit(app);
    const ticketId = ticketsByExternal.get(externalId).id;
    const payExternal = randomUUID();
    const first = await app.inject({
      method: "POST",
      url: `/tickets/${ticketId}/credit-payments`,
      headers: AUTH(),
      payload: { externalId: payExternal, shiftId: SHIFT, amount: 4, method: "CASH" },
    });
    expect(first.statusCode).toBe(201);
    const retry = await app.inject({
      method: "POST",
      url: `/tickets/${ticketId}/credit-payments`,
      headers: AUTH(),
      payload: { externalId: payExternal, shiftId: SHIFT, amount: 4, method: "CASH" },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().duplicate).toBe(true);
    // La deuda sólo bajó una vez.
    expect(Number(ticketsByExternal.get(externalId).creditPending)).toBe(6);
  });
});

describe("POST /tickets/:id/credit-void", () => {
  function voidToken(purpose: "credit-void" | "discount-override" = "credit-void") {
    return signManagerAuthorization({
      sub: MANAGER,
      tid: TENANT,
      purpose,
      reason: "credit_void",
      context: { maxDiscountPct: 100 },
    });
  }

  it("anula un fiado sin cobros → VOIDED", async () => {
    const app = await buildApp();
    const { externalId } = await sellOnCredit(app);
    const ticketId = ticketsByExternal.get(externalId).id;
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${ticketId}/credit-void`,
      headers: AUTH(),
      payload: { authorizationToken: voidToken(), reason: "Cliente devolvió género" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ticket.status).toBe("VOIDED");
    expect(Number(ticketsByExternal.get(externalId).creditPending)).toBe(0);
  });

  it("409 si el fiado ya tiene cobros parciales", async () => {
    const app = await buildApp();
    const { externalId } = await sellOnCredit(app);
    const ticketId = ticketsByExternal.get(externalId).id;
    await app.inject({
      method: "POST",
      url: `/tickets/${ticketId}/credit-payments`,
      headers: AUTH(),
      payload: { externalId: randomUUID(), shiftId: SHIFT, amount: 4, method: "CASH" },
    });
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${ticketId}/credit-void`,
      headers: AUTH(),
      payload: { authorizationToken: voidToken(), reason: "x" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("CREDIT_HAS_PAYMENTS");
  });

  it("403 si el token es de descuento, no de credit-void", async () => {
    const app = await buildApp();
    const { externalId } = await sellOnCredit(app);
    const ticketId = ticketsByExternal.get(externalId).id;
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${ticketId}/credit-void`,
      headers: AUTH(),
      payload: { authorizationToken: voidToken("discount-override"), reason: "x" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// Silencia el no-op helper para el linter.
void Prisma;
