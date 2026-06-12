// v1.0-mesas-frontend · Lote 2: idempotencia de POST /tickets/:id/checkout
// con `externalId` (GET-back como en POST /tickets). Contra el handler
// real con BD fake in-memory — mismo patrón que tables-e2e.test.ts pero
// recortado a lo que el checkout necesita.
//
// La carrera de dos cajas YA está cerrada por el claim updateMany en tx
// (v1.0-pilotos Lote 1); esto cubre el REINTENTO DE RED del mismo
// dispositivo: dos checkouts con el mismo externalId → un solo cobro.

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
const REGISTER = "00000000-0000-0000-0000-000000000003";
const DEVICE = "00000000-0000-0000-0000-000000000004";
const CASHIER = "00000000-0000-0000-0000-000000000005";
const SHIFT = "00000000-0000-0000-0000-000000000006";
const MESA = "00000000-0000-0000-0000-0000000000a1";

interface FakeTicket {
  id: string;
  tenantId: string;
  registerId: string;
  shiftId: string;
  userId: string;
  internalNumber: string;
  externalId: string;
  checkoutExternalId: string | null;
  publicSlug: string;
  status: string;
  tableId: string | null;
  diners: number | null;
  total: unknown;
  totalTax: unknown;
  totalDiscount: unknown;
  notes: string | null;
  contactHoldedId: string | null;
  cashAmount: unknown;
  printIntent: boolean;
  emailIntent: string | null;
  giftReceiptIntentAt: Date | null;
  discountAuthorizedBy: string | null;
  attendedBy: string | null;
  holdedDocumentId: string | null;
  holdedDocNumber: string | null;
  holdedPdfUrl: string | null;
  syncError: unknown;
  createdAt: Date;
  paidAt: Date | null;
  syncedAt: Date | null;
}

const state = {
  tickets: new Map<string, FakeTicket>(),
  lines: [] as Array<Record<string, unknown> & { id: string; ticketId: string }>,
  payments: new Map<string, Array<{ id: string; method: string; amount: unknown; meta: unknown }>>(),
  ticketCounter: 0,
  holdedUploads: new Map<string, { externalId: string; status: string }>(),
  // Simula la lectura stale del pre-check (las dos requests pasaron el
  // check de status antes de que la primera comiteara).
  staleStatusOnce: null as string | null,
};

function linesOf(ticketId: string) {
  return state.lines.filter((l) => l.ticketId === ticketId);
}

function materialize(t: FakeTicket, rel?: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...t };
  if (!rel) return out;
  if (rel.lines) out.lines = linesOf(t.id);
  if (rel.table) out.table = null;
  if (rel.payments) out.payments = state.payments.get(t.id) ?? [];
  if (rel.partialPayments) out.partialPayments = [];
  if (rel.refunds) out.refunds = [];
  if (rel.register) {
    out.register = {
      id: REGISTER,
      name: "Caja 1",
      storeId: "00000000-0000-0000-0000-000000000002",
      store: { name: "Bar Test" },
    };
  }
  return out;
}

function applyUpdate(t: FakeTicket, data: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(data)) {
    if (k === "payments") {
      const nested = v as {
        deleteMany?: object;
        create?: Array<{ method: string; amount: unknown; meta: unknown }>;
      };
      if (nested.deleteMany) state.payments.set(t.id, []);
      if (nested.create) {
        const arr = state.payments.get(t.id) ?? [];
        for (const p of nested.create) {
          arr.push({ id: randomUUID(), method: p.method, amount: p.amount, meta: p.meta });
        }
        state.payments.set(t.id, arr);
      }
      continue;
    }
    (t as unknown as Record<string, unknown>)[k] = v;
  }
}

const fakePrisma: Record<string, unknown> = {
  ticket: {
    findFirst: vi.fn(async ({ where, include, select }: any) => {
      const t = state.tickets.get(where.id);
      if (!t) return null;
      if (where.tenantId && t.tenantId !== where.tenantId) return null;
      if (state.staleStatusOnce) {
        const stale = { ...t, status: state.staleStatusOnce };
        state.staleStatusOnce = null;
        return materialize(stale as FakeTicket, include ?? select);
      }
      return materialize(t, include ?? select);
    }),
    update: vi.fn(async ({ where, data, include, select }: any) => {
      const t = state.tickets.get(where.id);
      if (!t) throw new Error("ticket not found");
      applyUpdate(t, data);
      return materialize(t, include ?? select);
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const t = state.tickets.get(where.id);
      if (!t || (where.status && t.status !== where.status)) return { count: 0 };
      applyUpdate(t, data);
      return { count: 1 };
    }),
  },
  register: {
    update: vi.fn(async () => {
      state.ticketCounter += 1;
      return { ticketCounter: state.ticketCounter };
    }),
    findUnique: vi.fn(async () => ({
      storeId: "00000000-0000-0000-0000-000000000002",
    })),
  },
  shift: {
    update: vi.fn(async () => ({})),
  },
  user: {
    findUnique: vi.fn(async () => ({ email: "caja1@bar.es" })),
    findUniqueOrThrow: vi.fn(async () => ({ email: "caja1@bar.es" })),
    findFirst: vi.fn(async () => null),
  },
  tenant: {
    findUniqueOrThrow: vi.fn(async () => ({ discountThresholdPct: 10 })),
  },
  holdedUpload: {
    upsert: vi.fn(async ({ where, create }: any) => {
      if (!state.holdedUploads.has(where.externalId)) {
        state.holdedUploads.set(where.externalId, {
          externalId: create.externalId,
          status: create.status,
        });
      }
      return state.holdedUploads.get(where.externalId);
    }),
  },
  table: {
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(fakePrisma)),
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }) as never,
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
vi.mock("../src/tickets/email-trigger.js", () => ({
  maybeEnqueueAutoEmail: async () => ({ enqueued: false }),
}));

const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { getStoreEventBus } = await import("../src/realtime/store-event-bus.js");

vi.spyOn(getStoreEventBus(), "broadcast").mockImplementation(() => {});

function auth() {
  return {
    authorization: `Bearer ${signCashierSession(
      { sub: CASHIER, tid: TENANT, did: DEVICE, rid: REGISTER, role: "CASHIER" },
      10,
    )}`,
  };
}

async function buildApp() {
  const app = Fastify();
  await registerTicketRoutes(app);
  return app;
}

function seedDraft(): FakeTicket {
  const t: FakeTicket = {
    id: randomUUID(),
    tenantId: TENANT,
    registerId: REGISTER,
    shiftId: SHIFT,
    userId: CASHIER,
    internalNumber: `D-${randomUUID()}`,
    externalId: randomUUID(),
    checkoutExternalId: null,
    publicSlug: randomUUID().slice(0, 16),
    status: "DRAFT",
    tableId: MESA,
    diners: 2,
    total: 1.65,
    totalTax: 0.15,
    totalDiscount: 0,
    notes: null,
    contactHoldedId: null,
    cashAmount: null,
    printIntent: true,
    emailIntent: null,
    giftReceiptIntentAt: null,
    discountAuthorizedBy: null,
    attendedBy: null,
    holdedDocumentId: null,
    holdedDocNumber: null,
    holdedPdfUrl: null,
    syncError: null,
    createdAt: new Date(),
    paidAt: null,
    syncedAt: null,
  };
  state.tickets.set(t.id, t);
  state.lines.push({
    id: randomUUID(),
    ticketId: t.id,
    productId: null,
    variantId: null,
    holdedProductId: null,
    sku: "CAFE",
    nameSnapshot: "Café solo",
    units: 1,
    unitPrice: 1.5,
    discountPct: 0,
    taxRate: 10,
    subtotal: 1.5,
    total: 1.65,
    modifiers: null,
    originalTableId: null,
  });
  return t;
}

async function checkout(
  app: Awaited<ReturnType<typeof buildApp>>,
  ticketId: string,
  body: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: `/tickets/${ticketId}/checkout`,
    headers: auth(),
    payload: { payments: [{ method: "CASH", amount: 1.65 }], ...body },
  });
}

beforeEach(() => {
  state.tickets.clear();
  state.lines = [];
  state.payments.clear();
  state.holdedUploads.clear();
  state.ticketCounter = 0;
  state.staleStatusOnce = null;
});

describe("checkout de mesa · idempotencia con externalId", () => {
  it("persiste checkoutExternalId y cobra una sola vez", async () => {
    const app = await buildApp();
    const draft = seedDraft();
    const externalId = randomUUID();

    const first = await checkout(app, draft.id, { externalId });
    expect(first.statusCode).toBe(200);
    expect(first.json().duplicate).toBeUndefined();
    expect(draft.checkoutExternalId).toBe(externalId);
    expect(draft.status).toBe("PENDING_SYNC");
    expect(draft.internalNumber).toBe("000001");
  });

  it("reintento de red con el mismo externalId → 200 duplicate, un solo cobro", async () => {
    const app = await buildApp();
    const draft = seedDraft();
    const externalId = randomUUID();

    const first = await checkout(app, draft.id, { externalId });
    expect(first.statusCode).toBe(200);

    const retry = await checkout(app, draft.id, { externalId });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().duplicate).toBe(true);
    expect(retry.json().ticket.id).toBe(draft.id);
    // El contador fiscal no se quemó dos veces y el pago no se duplicó.
    expect(state.ticketCounter).toBe(1);
    expect(state.payments.get(draft.id)).toHaveLength(1);
  });

  it("externalId DISTINTO sobre ticket ya cobrado → 409 (otra caja)", async () => {
    const app = await buildApp();
    const draft = seedDraft();

    const first = await checkout(app, draft.id, { externalId: randomUUID() });
    expect(first.statusCode).toBe(200);

    const other = await checkout(app, draft.id, { externalId: randomUUID() });
    expect(other.statusCode).toBe(409);
    expect(other.json().error).toBe("TICKET_ALREADY_PAID");
    expect(state.ticketCounter).toBe(1);
  });

  it("carrera (pre-check stale) con el mismo externalId → GET-back 200, sin quemar serie", async () => {
    const app = await buildApp();
    const draft = seedDraft();
    const externalId = randomUUID();

    const first = await checkout(app, draft.id, { externalId });
    expect(first.statusCode).toBe(200);

    // El pre-check del reintento lee un snapshot stale donde el ticket
    // aún era DRAFT; el claim updateMany devuelve count=0 y el handler
    // re-lee: checkoutExternalId coincide → 200 duplicate.
    state.staleStatusOnce = "DRAFT";
    const retry = await checkout(app, draft.id, { externalId });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().duplicate).toBe(true);
    expect(state.ticketCounter).toBe(1);
    expect(state.payments.get(draft.id)).toHaveLength(1);
  });

  it("back-compat: checkout sin externalId cobra; el reintento sin externalId → 409", async () => {
    const app = await buildApp();
    const draft = seedDraft();

    const first = await checkout(app, draft.id, {});
    expect(first.statusCode).toBe(200);
    expect(draft.checkoutExternalId).toBeNull();

    const retry = await checkout(app, draft.id, {});
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error).toBe("TICKET_ALREADY_PAID");
  });
});
