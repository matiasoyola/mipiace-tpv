// auditoria-sirope (#17) · `POST /refunds` en las dos cuentas que el
// 18-10 no podían devolver nada.
//
//   · Cafetería Sirope SIN Holded: el ticket nace `PAID`.
//   · Cafetería Sirope EN ENSAYO: el ticket nace `TEST` y no hay ninguna
//     sesión de cajero técnico detrás.
//
// El servidor ya aceptaba los dos antes del bloque; lo que no existía era
// una regla común con el TPV, que escondía el botón. Estos tests fijan la
// mitad del servidor —y el mensaje, que decía «sincronizado con Holded» a
// un comercio que no usa Holded.

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
/** Lo que contesta `tenant.findUniqueOrThrow` en cada prueba: es la
 *  cuenta que estamos describiendo (con Holded o sin él, en ensayo o
 *  facturando). */
let tenantRow: {
  holdedEnabled: boolean;
  holdedApiKeyCiphertext: string | null;
  facturaDesde: Date | null;
};
const refundsByExternalId = new Map<string, any>();
const holdedUploadsByExternalId = new Map<string, any>();

const fakePrisma = {
  tenant: {
    findUniqueOrThrow: vi.fn(async () => tenantRow),
  },
  refund: {
    findUnique: vi.fn(
      async ({ where }: any) => refundsByExternalId.get(where.externalId) ?? null,
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
      if (data.ticketCounter?.increment) {
        ticketCounter += data.ticketCounter.increment;
      }
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

function cashierToken(purpose?: string) {
  return jwt.sign(
    {
      sub: CASHIER,
      tid: TENANT,
      did: DEVICE,
      rid: REGISTER,
      role: "CASHIER",
      type: "cashier",
      ...(purpose ? { purpose } : {}),
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
        nameSnapshot: "Tostada con tomate",
        sku: "TOS-1",
        units: dec(2),
        unitPrice: dec(2.5),
        discountPct: dec(0),
        taxRate: dec(10),
      },
    ],
    payments: [{ method: "CASH" }],
    refunds: [],
  };
}

async function postRefund(app: any, purpose?: string) {
  return app.inject({
    method: "POST",
    url: "/refunds",
    headers: { authorization: `Bearer ${cashierToken(purpose)}` },
    payload: {
      externalId: randomUUID(),
      originalTicketId: TICKET_ID,
      lines: [{ ticketLineId: LINE_ID, units: 1 }],
    },
  });
}

/** Sirope hoy: sin Holded y facturando (tras «Empezar a facturar»). */
const SIN_HOLDED_FACTURANDO = {
  holdedEnabled: false,
  holdedApiKeyCiphertext: null,
  facturaDesde: new Date("2026-06-01T00:00:00Z"),
};
/** Sirope el 18-10: sin Holded y en ensayo. */
const SIN_HOLDED_EN_ENSAYO = {
  holdedEnabled: false,
  holdedApiKeyCiphertext: null,
  facturaDesde: null,
};
/** Un comercio con Holded y facturando, el caso de siempre. */
const CON_HOLDED = {
  holdedEnabled: true,
  holdedApiKeyCiphertext: "cipher",
  facturaDesde: new Date("2026-01-01T00:00:00Z"),
};

beforeEach(() => {
  ticketCounter = 0;
  refundsByExternalId.clear();
  holdedUploadsByExternalId.clear();
  tenantRow = CON_HOLDED;
  vi.clearAllMocks();
});

describe("POST /refunds · cuenta sin Holded (#17)", () => {
  it("devuelve un ticket PAID", () => {
    tenantRow = SIN_HOLDED_FACTURANDO;
    originalTicket = makeTicket("PAID");
    return buildApp()
      .then(postRefund)
      .then((res: any) => {
        expect(res.statusCode).toBe(201);
        const created = [...refundsByExternalId.values()][0];
        // Sin destino en Holded el abono nace PAID, igual que su venta.
        expect(created.status).toBe("PAID");
        expect(enqueueRefundUpload).not.toHaveBeenCalled();
      });
  });
});

describe("POST /refunds · cuenta en ensayo (#17)", () => {
  it("devuelve un ticket TEST sin sesión de cajero técnico", async () => {
    tenantRow = SIN_HOLDED_EN_ENSAYO;
    originalTicket = makeTicket("TEST");
    const app = await buildApp();
    const res = await postRefund(app);

    expect(res.statusCode).toBe(201);
    const created = [...refundsByExternalId.values()][0];
    expect(created.status).toBe("TEST");
    expect(enqueueRefundUpload).not.toHaveBeenCalled();
  });

  it("un TEST de una cuenta que YA factura se rechaza, y el motivo no habla de Holded", async () => {
    tenantRow = SIN_HOLDED_FACTURANDO;
    originalTicket = makeTicket("TEST");
    const app = await buildApp();
    const res = await postRefund(app);

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe("TICKET_NOT_REFUNDABLE");
    expect(body.message).not.toMatch(/Holded/i);
  });

  it("un TEST con sesión de cajero técnico sigue devolviéndose (v1.9.5)", async () => {
    tenantRow = CON_HOLDED;
    originalTicket = makeTicket("TEST");
    const app = await buildApp();
    const res = await postRefund(app, "test-cashier");

    expect(res.statusCode).toBe(201);
    expect([...refundsByExternalId.values()][0].status).toBe("TEST");
  });
});

describe("POST /refunds · lo que sigue sin devolverse (#17)", () => {
  it.each([
    ["DRAFT", /no está cobrado/i],
    ["VOIDED", /ya está anulado/i],
    ["SYNC_FAILED", /sincroniz/i],
  ])("%s → 409 con su motivo", async (status, patron) => {
    tenantRow = SIN_HOLDED_EN_ENSAYO;
    originalTicket = makeTicket(status);
    const app = await buildApp();
    const res = await postRefund(app);

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(patron);
  });
});
