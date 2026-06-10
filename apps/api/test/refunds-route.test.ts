// Tests de POST /refunds (v1.5-consistencia-A §3.c): el cálculo de
// `alreadyRefunded` sólo cuenta refunds en estados efectivos
// (PENDING_SYNC/SYNCED/PAID). Un refund SYNC_FAILED previo no debe
// bloquear devoluciones legítimas; un doble refund efectivo de la
// misma unidad sigue rechazado.

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
const TICKET_ID = "00000000-0000-0000-0000-00000000000a";
const LINE_ID = "00000000-0000-0000-0000-00000000000b";

function dec(n: number) {
  return { toString: () => String(n) };
}

let ticketCounter = 0;
let originalTicket: any;
const refundsByExternalId = new Map<string, any>();

const fakePrisma = {
  refund: {
    findUnique: vi.fn(async ({ where }: any) =>
      refundsByExternalId.get(where.externalId) ?? null,
    ),
    create: vi.fn(async ({ data }: any) => {
      const r = {
        id: randomUUID(),
        ...data,
        total: dec(Number(data.total)),
        totalTax: dec(Number(data.totalTax)),
        holdedDocumentId: null,
        holdedDocNumber: null,
        createdAt: new Date(),
        syncedAt: null,
        lines: data.lines.create.map((l: any, i: number) => ({
          id: `rl${i}`,
          ...l,
          units: dec(Number(l.units)),
          total: dec(Number(l.total)),
          unitPrice: dec(Number(l.unitPrice)),
          taxRate: dec(Number(l.taxRate)),
          discountPct: dec(Number(l.discountPct)),
        })),
      };
      refundsByExternalId.set(data.externalId, r);
      return r;
    }),
  },
  ticket: {
    findFirst: vi.fn(async ({ where }: any) =>
      where.id === TICKET_ID ? originalTicket : null,
    ),
  },
  register: {
    update: vi.fn(async ({ data }: any) => {
      if (data.ticketCounter?.increment) ticketCounter += data.ticketCounter.increment;
      return { ticketCounter };
    }),
  },
  shift: {
    findFirst: vi.fn(async () => null),
  },
  holdedUpload: {
    upsert: vi.fn(async ({ create }: any) => create),
  },
  $transaction: vi.fn(async (fn: any) => {
    const counterSnapshot = ticketCounter;
    try {
      return await fn(fakePrisma);
    } catch (err) {
      ticketCounter = counterSnapshot;
      throw err;
    }
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
vi.mock("../src/realtime/emit-helpers.js", () => ({
  emitTicketPaid: async () => undefined,
  emitTicketRefunded: async () => undefined,
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

// Ticket SYNCED con una línea de 2 unidades a 10 € + 21%.
function makeOriginalTicket(refunds: any[]) {
  return {
    id: TICKET_ID,
    tenantId: TENANT,
    registerId: REGISTER,
    status: "SYNCED",
    lines: [
      {
        id: LINE_ID,
        nameSnapshot: "Camiseta",
        sku: "CAM-1",
        units: dec(2),
        unitPrice: dec(10),
        discountPct: dec(0),
        taxRate: dec(21),
      },
    ],
    payments: [{ method: "CASH" }],
    refunds,
  };
}

function makePriorRefund(status: string, units: number) {
  return {
    id: randomUUID(),
    status,
    lines: [{ ticketLineId: LINE_ID, units: dec(units) }],
  };
}

beforeEach(() => {
  ticketCounter = 0;
  refundsByExternalId.clear();
  vi.clearAllMocks();
});

describe("POST /refunds · alreadyRefunded por status", () => {
  it("refund SYNC_FAILED previo no bloquea un refund nuevo de las mismas líneas", async () => {
    originalTicket = makeOriginalTicket([makePriorRefund("SYNC_FAILED", 2)]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/refunds",
      headers: { authorization: `Bearer ${cashierToken()}` },
      payload: {
        externalId: randomUUID(),
        originalTicketId: TICKET_ID,
        lines: [{ ticketLineId: LINE_ID, units: 2 }],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().refund.internalNumber).toBe("R-000001");
  });

  it("doble refund efectivo de la misma unidad sigue rechazado", async () => {
    originalTicket = makeOriginalTicket([makePriorRefund("SYNCED", 2)]);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/refunds",
      headers: { authorization: `Bearer ${cashierToken()}` },
      payload: {
        externalId: randomUUID(),
        originalTicketId: TICKET_ID,
        lines: [{ ticketLineId: LINE_ID, units: 1 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("REFUND_EXCEEDS_ORIGINAL");
  });

  it("refund PENDING_SYNC previo cuenta como devuelto (parcial)", async () => {
    originalTicket = makeOriginalTicket([makePriorRefund("PENDING_SYNC", 1)]);
    const app = await buildApp();
    // Queda 1 devolvible: pedir 2 → 400; pedir 1 → 201.
    const tooMany = await app.inject({
      method: "POST",
      url: "/refunds",
      headers: { authorization: `Bearer ${cashierToken()}` },
      payload: {
        externalId: randomUUID(),
        originalTicketId: TICKET_ID,
        lines: [{ ticketLineId: LINE_ID, units: 2 }],
      },
    });
    expect(tooMany.statusCode).toBe(400);
    const ok = await app.inject({
      method: "POST",
      url: "/refunds",
      headers: { authorization: `Bearer ${cashierToken()}` },
      payload: {
        externalId: randomUUID(),
        originalTicketId: TICKET_ID,
        lines: [{ ticketLineId: LINE_ID, units: 1 }],
      },
    });
    expect(ok.statusCode).toBe(201);
  });

  // §3.a aplicado a refunds: fallo dentro de la tx no quema número.
  it("fallo dentro de la transacción → ticketCounter no avanza", async () => {
    originalTicket = makeOriginalTicket([]);
    (fakePrisma.refund.create as any).mockImplementationOnce(async () => {
      throw new Error("simulated constraint violation");
    });
    const app = await buildApp();
    const failed = await app.inject({
      method: "POST",
      url: "/refunds",
      headers: { authorization: `Bearer ${cashierToken()}` },
      payload: {
        externalId: randomUUID(),
        originalTicketId: TICKET_ID,
        lines: [{ ticketLineId: LINE_ID, units: 1 }],
      },
    });
    expect(failed.statusCode).toBe(500);
    expect(ticketCounter).toBe(0);
  });
});
