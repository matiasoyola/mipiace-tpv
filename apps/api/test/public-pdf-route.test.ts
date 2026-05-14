// Tests del endpoint público GET /tickets/:publicSlug/pdf
// (B-Print fase 1 · Frente 3). Sin auth — la URL es una capability
// (~96 bits). 404 si DRAFT o slug inexistente. 200 application/pdf
// si el ticket está cobrado.

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
const TICKET_ID = "00000000-0000-0000-0000-000000000010";

function decimal(s: string) {
  return { toString: () => s };
}

const baseTicket = {
  id: TICKET_ID,
  tenantId: TENANT,
  internalNumber: "000042",
  publicSlug: "aaaaaaaabbbbbbbb",
  contactHoldedId: null as string | null,
  status: "PAID",
  emailIntent: null as string | null,
  paidAt: new Date("2026-05-14T10:30:00Z"),
  createdAt: new Date("2026-05-14T10:29:50Z"),
  cashAmount: decimal("10"),
  total: decimal("6.93"),
  tenant: {
    name: "Bar Thalia",
    fiscalProfile: {
      legalName: "Thalia SL",
      taxId: "B12345678",
      address: "Calle Mayor 10",
    },
  },
  register: {
    name: "Caja 1",
    store: { name: "Bar Thalia · Centro", fiscalAddress: { address: "Mayor 10" } },
  },
  user: { email: "ana@thalia.es" },
  lines: [
    {
      nameSnapshot: "Cafe",
      sku: "CAFE",
      units: decimal("2"),
      unitPrice: decimal("1.50"),
      discountPct: decimal("0"),
      taxRate: decimal("10"),
      subtotal: decimal("3"),
      total: decimal("3.30"),
    },
  ],
  payments: [{ method: "CASH", amount: decimal("10") }],
};

const tickets = new Map<string, typeof baseTicket>();

const fakePrisma = {
  ticket: {
    findUnique: vi.fn(async ({ where, select }: any) => {
      void select;
      const t = tickets.get(where.publicSlug ?? where.id ?? "");
      if (!t) return null;
      return { status: t.status };
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      if (where.publicSlug) return tickets.get(where.publicSlug) ?? null;
      if (where.id) return tickets.get(where.id) ?? null;
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

const { registerPublicTicketPdfRoute } = await import(
  "../src/tickets/public-pdf-route.js"
);

beforeEach(() => {
  tickets.clear();
  vi.clearAllMocks();
  tickets.set(baseTicket.publicSlug, { ...baseTicket });
  tickets.set(baseTicket.id, { ...baseTicket });
});

async function buildApp() {
  const app = Fastify();
  await registerPublicTicketPdfRoute(app);
  return app;
}

describe("GET /tickets/:publicSlug/pdf", () => {
  it("200 application/pdf cuando el slug es válido y el ticket está PAID", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/tickets/${baseTicket.publicSlug}/pdf`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("ticket-000042.pdf");
    const head = res.rawPayload.subarray(0, 4).toString("ascii");
    expect(head).toBe("%PDF");
  });

  it("404 cuando el slug no existe", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/tickets/0000000000000000/pdf",
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 cuando el slug está en formato inválido (no hex 16)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/tickets/zzzzzzzzzzzzzzzz/pdf",
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 cuando el ticket está DRAFT (todavía no emitido)", async () => {
    const app = await buildApp();
    tickets.set(baseTicket.publicSlug, { ...baseTicket, status: "DRAFT" });
    const res = await app.inject({
      method: "GET",
      url: `/tickets/${baseTicket.publicSlug}/pdf`,
    });
    expect(res.statusCode).toBe(404);
  });
});
