// Tests del worker upload-ticket (B4 §1.3). Mocks Prisma + ApiKeyClient
// para validar las transiciones de estado: happy path (POST + GET-back +
// /pay + GET-back → SYNCED), silent reject permanente, error 4xx
// permanente, error 5xx transitorio.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it, vi } from "vitest";

import { encryptSecret } from "../src/crypto.js";

interface FakeTicket {
  id: string;
  externalId: string;
  tenantId: string;
  registerId: string;
  status: string;
  total: number;
  paidAt: Date;
  holdedDocumentId: string | null;
  holdedDocNumber: string | null;
  notes: string | null;
  syncedAt: Date | null;
  syncError: unknown;
}
interface FakeUpload {
  externalId: string;
  status: string;
  attempts: number;
  holdedDocumentId: string | null;
  lastError: unknown;
}

const tickets = new Map<string, FakeTicket>();
const uploads = new Map<string, FakeUpload>();
let tenantKey = "";

const fakePrisma = {
  ticket: {
    findUnique: vi.fn(async ({ where }: any) => {
      const t = tickets.get(where.externalId);
      if (!t) return null;
      return {
        ...t,
        total: { toString: () => String(t.total) } as any,
        lines: [
          {
            id: "l1",
            nameSnapshot: "Cafetera",
            sku: "SKU-1",
            units: { toString: () => "1" },
            unitPrice: { toString: () => "10" },
            discountPct: { toString: () => "0" },
            taxRate: { toString: () => "21" },
          },
        ],
        payments: [{ method: "CASH", amount: { toString: () => String(t.total) } }],
        tenant: {
          id: t.tenantId,
          holdedApiKeyCiphertext: tenantKey,
        },
        register: { numSerieHolded: null },
      };
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = tickets.get(where.externalId);
      if (!t) throw new Error("not found");
      Object.assign(t, data);
      return t;
    }),
  },
  holdedUpload: {
    update: vi.fn(async ({ where, data }: any) => {
      const u = uploads.get(where.externalId);
      if (!u) throw new Error("not found");
      Object.assign(u, data);
      return u;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const u = uploads.get(where.externalId);
      if (!u) return { count: 0 };
      if (data.attempts?.increment != null) u.attempts += data.attempts.increment;
      return { count: 1 };
    }),
  },
  ticketEmailJob: {
    findFirst: vi.fn(async () => null),
  },
  $transaction: vi.fn(async (ops: any[]) => {
    return await Promise.all(ops.map((p) => (typeof p === "function" ? p(fakePrisma) : p)));
  }),
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

vi.mock("../src/queues/ticket-email.js", () => ({
  enqueueTicketEmail: async () => undefined,
}));

import { uploadTicket } from "../src/tickets/upload-ticket.js";
import { ApiKeyClient, HoldedApiError } from "@mipiacetpv/holded-client";

beforeEach(() => {
  tickets.clear();
  uploads.clear();
  vi.clearAllMocks();
  tenantKey = encryptSecret("test-api-key", process.env.HOLDED_KEY_ENCRYPTION_SECRET!);
});

function seedTicket(externalId: string, total = 12.1): void {
  tickets.set(externalId, {
    id: "ticket-1",
    externalId,
    tenantId: "tenant-1",
    registerId: "reg-1",
    status: "PENDING_SYNC",
    total,
    paidAt: new Date(),
    holdedDocumentId: null,
    holdedDocNumber: null,
    notes: null,
    syncedAt: null,
    syncError: null,
  });
  uploads.set(externalId, {
    externalId,
    status: "PENDING",
    attempts: 0,
    holdedDocumentId: null,
    lastError: null,
  });
}

function mockHoldedClient(responses: unknown[]): ApiKeyClient {
  const queue = [...responses];
  return {
    request: vi.fn(async () => {
      if (queue.length === 0) throw new Error("client exhausted");
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    }),
  } as unknown as ApiKeyClient;
}

describe("uploadTicket", () => {
  it("happy path: POST + GET-back + /pay + GET-back → SYNCED", async () => {
    const externalId = randomUUID();
    seedTicket(externalId, 12.1);
    const client = mockHoldedClient([
      { id: "doc-1" }, // POST salesreceipt
      {
        id: "doc-1",
        docNumber: "T260530",
        approvedAt: 1746979200,
        draft: null,
        total: 12.1,
        notes: `TPV-uuid: ${externalId}`,
        paymentsTotal: 0,
        paymentsPending: 12.1,
        products: [],
      },
      {
        // Pre-check idempotente de registerPaymentWithGetBack
        // (v1.3-hotfix10): doc aún sin pagar → sigue al POST /pay.
        id: "doc-1",
        docNumber: "T260530",
        total: 12.1,
        paymentsTotal: 0,
        paymentsPending: 12.1,
        notes: `TPV-uuid: ${externalId}`,
        products: [],
      },
      { status: 1, paymentId: "pay-1" }, // POST /pay
      {
        id: "doc-1",
        docNumber: "T260530",
        total: 12.1,
        paymentsTotal: 12.1,
        paymentsPending: 0,
        notes: `TPV-uuid: ${externalId}`,
        products: [],
      },
    ]);
    const res = await uploadTicket({
      externalId,
      prisma: fakePrisma as any,
      buildClient: () => client,
    });
    expect(res.kind).toBe("success");
    expect(tickets.get(externalId)!.status).toBe("SYNCED");
    expect(tickets.get(externalId)!.holdedDocumentId).toBe("doc-1");
    expect(tickets.get(externalId)!.holdedDocNumber).toBe("T260530");
    expect(uploads.get(externalId)!.status).toBe("DONE");
  });

  it("silent reject del salesreceipt → SYNC_FAILED, no se reintenta", async () => {
    const externalId = randomUUID();
    seedTicket(externalId, 12.1);
    const client = mockHoldedClient([
      { id: "doc-2" }, // POST
      {
        // GET-back: docNumber null
        id: "doc-2",
        docNumber: null,
        approvedAt: null,
        draft: true,
        total: 0,
        notes: `TPV-uuid: ${externalId}`,
        paymentsTotal: 0,
        paymentsPending: 0,
        products: [],
      },
    ]);
    const res = await uploadTicket({
      externalId,
      prisma: fakePrisma as any,
      buildClient: () => client,
    });
    expect(res.kind).toBe("permanent_failure");
    expect(tickets.get(externalId)!.status).toBe("SYNC_FAILED");
    expect(uploads.get(externalId)!.status).toBe("FAILED");
  });

  it("HTTP 422 en POST → permanent_failure", async () => {
    const externalId = randomUUID();
    seedTicket(externalId, 12.1);
    const client = mockHoldedClient([
      new HoldedApiError(422, "/salesreceipt", { info: "Wrong sku" }),
    ]);
    const res = await uploadTicket({
      externalId,
      prisma: fakePrisma as any,
      buildClient: () => client,
    });
    expect(res.kind).toBe("permanent_failure");
    expect(tickets.get(externalId)!.status).toBe("SYNC_FAILED");
  });

  it("HTTP 503 transitorio → propaga (BullMQ reintenta)", async () => {
    const externalId = randomUUID();
    seedTicket(externalId, 12.1);
    const client = mockHoldedClient([
      new HoldedApiError(503, "/salesreceipt", { info: "Bad gateway" }),
    ]);
    await expect(
      uploadTicket({
        externalId,
        prisma: fakePrisma as any,
        buildClient: () => client,
      }),
    ).rejects.toBeInstanceOf(HoldedApiError);
    // El ticket sigue en PENDING_SYNC (no marca FAILED en transient).
    expect(tickets.get(externalId)!.status).toBe("PENDING_SYNC");
  });

  it("idempotente: ticket ya SYNCED → skipped", async () => {
    const externalId = randomUUID();
    seedTicket(externalId, 12.1);
    tickets.get(externalId)!.status = "SYNCED";
    const client = mockHoldedClient([]);
    const res = await uploadTicket({
      externalId,
      prisma: fakePrisma as any,
      buildClient: () => client,
    });
    expect(res.kind).toBe("skipped");
  });
});
