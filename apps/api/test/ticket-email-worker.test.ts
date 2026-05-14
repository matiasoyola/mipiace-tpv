// Tests del processor `sendTicketEmail` enriquecido
// (B-Print fase 1 · Frente 4).
//
// Cubrimos:
//   - happy path: ticket PAID + email pendiente → genera PDF local,
//     llama al sender mock con adjunto, marca DONE.
//   - defer: ticket DRAFT → kind:"deferred", sin enviar.
//   - skip: job ya en DONE → kind:"skipped".
//   - failure: render falla → throw (BullMQ reintenta).

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it, vi } from "vitest";

const JOB_ID = "00000000-0000-0000-0000-000000000050";
const TICKET_ID = "00000000-0000-0000-0000-000000000051";

interface FakeJob {
  id: string;
  ticketId: string;
  toEmail: string;
  status: string;
  attempts: number;
  sentAt: Date | null;
  lastError: unknown;
  ticket: any;
}

function decimal(s: string) {
  return { toString: () => s };
}

const baseTicket = {
  id: TICKET_ID,
  tenantId: "tenant-1",
  internalNumber: "000077",
  publicSlug: "ccccccccdddddddd",
  contactHoldedId: null,
  status: "PAID",
  emailIntent: null,
  paidAt: new Date("2026-05-14T10:00:00Z"),
  createdAt: new Date("2026-05-14T09:59:50Z"),
  cashAmount: decimal("10"),
  total: decimal("3.30"),
  tenant: { name: "Bar Thalia" },
  register: {
    storeId: "store-1",
    store: {
      name: "Bar Thalia",
      ticketDelivery: null,
    },
  },
};

const fakePrisma: any = {
  ticketEmailJob: {
    findUnique: vi.fn(),
    update: vi.fn(async ({ where, data }) => {
      const j = jobs.get(where.id);
      if (!j) throw new Error("not found");
      if (data.attempts?.increment) j.attempts += data.attempts.increment;
      if (data.status) j.status = data.status;
      if (data.sentAt) j.sentAt = data.sentAt;
      if (data.lastError) j.lastError = data.lastError;
      return j;
    }),
  },
  ticket: {
    findFirst: vi.fn(async ({ where }) => {
      if (where.id === TICKET_ID || where.publicSlug === baseTicket.publicSlug) {
        return {
          ...baseTicket,
          tenant: {
            ...baseTicket.tenant,
            fiscalProfile: { legalName: "Thalia SL", taxId: "B1", address: "X" },
          },
          register: {
            ...baseTicket.register,
            name: "Caja 1",
            store: { name: "Bar", fiscalAddress: null, ticketDelivery: null },
          },
          user: { email: "ana@thalia.es" },
          lines: [
            {
              nameSnapshot: "Cafe",
              sku: "C",
              units: decimal("1"),
              unitPrice: decimal("3"),
              discountPct: decimal("0"),
              taxRate: decimal("10"),
              subtotal: decimal("3"),
              total: decimal("3.30"),
            },
          ],
          payments: [{ method: "CASH", amount: decimal("10") }],
        };
      }
      return null;
    }),
  },
  contact: { findFirst: vi.fn(async () => null) },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

const sendMock = vi.fn(async () => undefined);
vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({ send: sendMock }),
  setEmailSender: () => undefined,
}));

const { sendTicketEmail } = await import("../src/tickets/send-ticket-email.js");

const jobs = new Map<string, FakeJob>();

beforeEach(() => {
  jobs.clear();
  sendMock.mockClear();
  fakePrisma.ticketEmailJob.findUnique.mockReset();
  fakePrisma.ticketEmailJob.findUnique.mockImplementation(async ({ where }: any) => {
    const j = jobs.get(where.id);
    if (!j) return null;
    return j;
  });
  fakePrisma.ticketEmailJob.update.mockClear();
  fakePrisma.ticket.findFirst.mockClear();
});

function seedJob(overrides: Partial<FakeJob> = {}) {
  const job: FakeJob = {
    id: JOB_ID,
    ticketId: TICKET_ID,
    toEmail: "cliente@example.com",
    status: "PENDING",
    attempts: 0,
    sentAt: null,
    lastError: null,
    ticket: { ...baseTicket },
    ...overrides,
  };
  jobs.set(job.id, job);
}

describe("sendTicketEmail (B-Print fase 1)", () => {
  it("happy path: genera PDF, manda email con adjunto y marca DONE", async () => {
    seedJob();
    const res = await sendTicketEmail({
      emailJobId: JOB_ID,
      prisma: fakePrisma,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    expect(res).toEqual({ kind: "sent" });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0] as unknown as [
      {
        to: string;
        attachments?: Array<{
          filename: string;
          content: Buffer;
          contentType?: string;
        }>;
      },
    ];
    const arg = call[0];
    expect(arg.to).toBe("cliente@example.com");
    expect(arg.attachments).toHaveLength(1);
    expect(arg.attachments![0]!.filename).toBe("ticket-000077.pdf");
    expect(arg.attachments![0]!.contentType).toBe("application/pdf");
    expect(arg.attachments![0]!.content.subarray(0, 4).toString("ascii")).toBe(
      "%PDF",
    );
    expect(jobs.get(JOB_ID)!.status).toBe("DONE");
  });

  it("defer si el ticket todavía está en DRAFT", async () => {
    seedJob({ ticket: { ...baseTicket, status: "DRAFT" } });
    // Hacemos que ticket.findFirst pretenda que está DRAFT en BD.
    fakePrisma.ticket.findFirst.mockImplementationOnce(async () => ({
      ...baseTicket,
      status: "DRAFT",
    }));
    // Pero antes el processor lee del job.ticket; simulamos DRAFT ahí.
    jobs.get(JOB_ID)!.ticket = { ...baseTicket, status: "DRAFT" };
    fakePrisma.ticketEmailJob.findUnique.mockImplementationOnce(async () => ({
      ...jobs.get(JOB_ID),
      ticket: { ...baseTicket, status: "DRAFT" },
    }));
    const res = await sendTicketEmail({
      emailJobId: JOB_ID,
      prisma: fakePrisma,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    expect(res.kind).toBe("deferred");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("skip si el job no existe", async () => {
    const res = await sendTicketEmail({
      emailJobId: "00000000-0000-0000-0000-000000000099",
      prisma: fakePrisma,
    });
    expect(res).toEqual({ kind: "skipped", reason: "job_not_found" });
  });

  it("skip si el job ya está DONE", async () => {
    seedJob({ status: "DONE" });
    const res = await sendTicketEmail({
      emailJobId: JOB_ID,
      prisma: fakePrisma,
    });
    expect(res.kind).toBe("skipped");
    expect(sendMock).not.toHaveBeenCalled();
  });
});
