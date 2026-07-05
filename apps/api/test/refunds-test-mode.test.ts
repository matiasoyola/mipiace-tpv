// v1.9.5-formacion · Frente 1: devoluciones ENSAYABLES en modo prueba.
//
// Un ticket TEST (venta del cajero técnico en modo prueba) es
// devolvible, pero el refund resultante hereda el gate fiscal: nace con
// status TEST, su HoldedUpload nace SKIPPED y NUNCA se encola contra
// Holded. Un refund de un ticket real (SYNCED) sigue igual: PENDING_SYNC
// + HoldedUpload PENDING + job encolado.

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
const holdedUploadsByExternalId = new Map<string, any>();

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
    findFirst: vi.fn(async () => ({ id: "shift-open" })),
  },
  holdedUpload: {
    upsert: vi.fn(async ({ where, create }: any) => {
      holdedUploadsByExternalId.set(where.externalId, create);
      return create;
    }),
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

const enqueueRefundUpload = vi.fn(async () => undefined);

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));
vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: async () => undefined,
}));
vi.mock("../src/queues/refund-upload.js", () => ({
  enqueueRefundUpload: (...args: unknown[]) => enqueueRefundUpload(...(args as [])),
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

function makeTicket(status: string) {
  return {
    id: TICKET_ID,
    tenantId: TENANT,
    registerId: REGISTER,
    status,
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
    refunds: [],
  };
}

async function postRefund(app: any) {
  return app.inject({
    method: "POST",
    url: "/refunds",
    headers: { authorization: `Bearer ${cashierToken()}` },
    payload: {
      externalId: randomUUID(),
      originalTicketId: TICKET_ID,
      lines: [{ ticketLineId: LINE_ID, units: 1 }],
    },
  });
}

beforeEach(() => {
  ticketCounter = 0;
  refundsByExternalId.clear();
  holdedUploadsByExternalId.clear();
  vi.clearAllMocks();
});

describe("POST /refunds · modo prueba (Frente 1)", () => {
  it("refund de ticket TEST nace SKIPPED y NO se encola contra Holded", async () => {
    originalTicket = makeTicket("TEST");
    const app = await buildApp();
    const res = await postRefund(app);

    expect(res.statusCode).toBe(201);
    const created = [...refundsByExternalId.values()][0];
    expect(created.status).toBe("TEST");
    const upload = [...holdedUploadsByExternalId.values()][0];
    expect(upload.status).toBe("SKIPPED");
    expect(upload.lastError).toEqual({ skipped: "test_mode" });
    // El gate fiscal es sagrado: jamás encolamos un refund de prueba.
    expect(enqueueRefundUpload).not.toHaveBeenCalled();
  });

  it("refund de ticket SYNCED sigue intacto: PENDING_SYNC + PENDING + encolado", async () => {
    originalTicket = makeTicket("SYNCED");
    const app = await buildApp();
    const res = await postRefund(app);

    expect(res.statusCode).toBe(201);
    const created = [...refundsByExternalId.values()][0];
    expect(created.status).toBe("PENDING_SYNC");
    const upload = [...holdedUploadsByExternalId.values()][0];
    expect(upload.status).toBe("PENDING");
    expect(enqueueRefundUpload).toHaveBeenCalledTimes(1);
  });
});
