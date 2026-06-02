// Tests del endpoint POST /tickets/:id/send-to-kitchen.
//
// Tras v1.4-Impresoras-Fase-1 Lote 4 el endpoint ya NO genera PDFs
// por defecto: agrupa por sección y manda comandas ESC/POS por TCP
// a cada printer WIFI configurado. Mantiene `?fallback=pdf` para
// pilotos sin impresoras todavía.

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
const STORE = "00000000-0000-0000-0000-000000000002";
const REGISTER = "00000000-0000-0000-0000-000000000003";
const DEVICE = "00000000-0000-0000-0000-000000000004";
const CASHIER = "00000000-0000-0000-0000-000000000005";
const TABLE = "00000000-0000-0000-0000-000000000006";
const TICKET = "00000000-0000-0000-0000-000000000007";
const PRODUCT_CAFE = "00000000-0000-0000-0000-00000000000a";
const PRODUCT_TAPAS = "00000000-0000-0000-0000-00000000000b";
const PRODUCT_AGUA = "00000000-0000-0000-0000-00000000000c";
const PRINTER_BARRA = "00000000-0000-0000-0000-0000000000aa";
const PRINTER_COCINA = "00000000-0000-0000-0000-0000000000bb";
const PRINTER_SALON = "00000000-0000-0000-0000-0000000000cc";

interface FakeTicket {
  id: string;
  tenantId: string;
  registerId: string;
  status: "DRAFT" | "PAID";
  tableId: string | null;
  diners: number | null;
  notes: string | null;
  lastSentRevision: number;
  lastSentAt: Date | null;
  table: { id: string; name: string } | null;
  register: { storeId: string };
  lines: Array<{
    id: string;
    productId: string | null;
    nameSnapshot: string;
    units: number;
    modifiers: unknown;
  }>;
}

interface FakeProduct {
  id: string;
  tenantId: string;
  tags: string[];
}

interface FakeTagSection {
  slug: string;
  section: "BARRA" | "COCINA" | "SALON";
  tenantId: string;
}

interface FakePrinter {
  id: string;
  registerId: string;
  active: boolean;
  mode: "USB" | "WIFI";
  ipAddress: string | null;
  port: number | null;
  timeoutMs: number;
  section: "BARRA" | "COCINA" | "SALON" | null;
  lastPrintOkAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMsg: string | null;
}

const state = {
  tickets: new Map<string, FakeTicket>(),
  products: new Map<string, FakeProduct>(),
  tagSections: [] as FakeTagSection[],
  printers: new Map<string, FakePrinter>(),
};

const tcpStub = {
  callsByHost: new Map<string, number>(),
  failures: new Set<string>(),
};

vi.mock("@mipiacetpv/escpos-builder", async () => {
  const actual = await vi.importActual<
    typeof import("@mipiacetpv/escpos-builder")
  >("@mipiacetpv/escpos-builder");
  return {
    ...actual,
    sendOverTcp: vi.fn(async (opts: { host: string }) => {
      tcpStub.callsByHost.set(
        opts.host,
        (tcpStub.callsByHost.get(opts.host) ?? 0) + 1,
      );
      if (tcpStub.failures.has(opts.host)) {
        throw new Error("ECONNREFUSED test");
      }
    }),
  };
});

const fakePrisma = {
  ticket: {
    findFirst: vi.fn(async ({ where }: any) => {
      const t = state.tickets.get(where.id);
      if (!t) return null;
      if (where.tenantId && t.tenantId !== where.tenantId) return null;
      if (where.status && t.status !== where.status) return null;
      return t;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = state.tickets.get(where.id);
      if (!t) throw new Error("ticket not found in fake");
      if (data.lastSentAt !== undefined) t.lastSentAt = data.lastSentAt;
      if (data.lastSentRevision !== undefined) {
        t.lastSentRevision = data.lastSentRevision;
      }
      return t;
    }),
  },
  product: {
    findMany: vi.fn(async ({ where }: any) => {
      const ids: string[] = where?.id?.in ?? [];
      const out: FakeProduct[] = [];
      for (const id of ids) {
        const p = state.products.get(id);
        if (!p) continue;
        if (where.tenantId && p.tenantId !== where.tenantId) continue;
        out.push(p);
      }
      return out;
    }),
  },
  tagSection: {
    findMany: vi.fn(async ({ where }: any) =>
      state.tagSections.filter(
        (t) => !where?.tenantId || t.tenantId === where.tenantId,
      ),
    ),
  },
  printerConfig: {
    findMany: vi.fn(async ({ where }: any) => {
      const out: FakePrinter[] = [];
      for (const p of state.printers.values()) {
        if (where.registerId && p.registerId !== where.registerId) continue;
        if (where.active != null && p.active !== where.active) continue;
        if (where.mode && p.mode !== where.mode) continue;
        if (where.section?.not !== undefined) {
          if (where.section.not === null && p.section === null) continue;
        }
        out.push(p);
      }
      return out;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const p = state.printers.get(where.id);
      if (!p) throw new Error("not found");
      for (const k of ["lastPrintOkAt", "lastErrorAt", "lastErrorMsg"] as const) {
        if (data[k] !== undefined) (p as any)[k] = data[k];
      }
      return p;
    }),
  },
  user: {
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      if (where.id !== CASHIER) throw new Error("not found");
      return { email: "barman@bar.es" };
    }),
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}) as never,
  shutdown: async () => undefined,
}));

const { registerSendToKitchenRoute } = await import(
  "../src/tickets/send-to-kitchen.js"
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
  await registerSendToKitchenRoute(app);
  return app;
}

function seedFreshTicket(overrides: Partial<FakeTicket> = {}): FakeTicket {
  const ticket: FakeTicket = {
    id: TICKET,
    tenantId: TENANT,
    registerId: REGISTER,
    status: "DRAFT",
    tableId: TABLE,
    diners: 4,
    notes: null,
    lastSentRevision: 0,
    lastSentAt: null,
    table: { id: TABLE, name: "Mesa 7" },
    register: { storeId: STORE },
    lines: [
      {
        id: "L1",
        productId: PRODUCT_CAFE,
        nameSnapshot: "Café cortado",
        units: 2,
        modifiers: null,
      },
      {
        id: "L2",
        productId: PRODUCT_TAPAS,
        nameSnapshot: "Patatas bravas",
        units: 1,
        modifiers: ["Sin pimentón"],
      },
      {
        id: "L3",
        productId: PRODUCT_AGUA,
        nameSnapshot: "Agua con gas",
        units: 1,
        modifiers: null,
      },
    ],
    ...overrides,
  };
  state.tickets.set(ticket.id, ticket);
  return ticket;
}

function seedPrinter(
  id: string,
  section: "BARRA" | "COCINA" | "SALON",
  host: string,
): void {
  state.printers.set(id, {
    id,
    registerId: REGISTER,
    active: true,
    mode: "WIFI",
    ipAddress: host,
    port: 9100,
    timeoutMs: 3000,
    section,
    lastPrintOkAt: null,
    lastErrorAt: null,
    lastErrorMsg: null,
  });
}

beforeEach(() => {
  state.tickets.clear();
  state.products.clear();
  state.tagSections.length = 0;
  state.printers.clear();
  tcpStub.callsByHost.clear();
  tcpStub.failures.clear();
  vi.clearAllMocks();

  state.products.set(PRODUCT_CAFE, {
    id: PRODUCT_CAFE,
    tenantId: TENANT,
    tags: ["bebidas"],
  });
  state.products.set(PRODUCT_TAPAS, {
    id: PRODUCT_TAPAS,
    tenantId: TENANT,
    tags: ["comida"],
  });
  state.products.set(PRODUCT_AGUA, {
    id: PRODUCT_AGUA,
    tenantId: TENANT,
    tags: ["bebidas"],
  });

  state.tagSections.push(
    { slug: "bebidas", section: "BARRA", tenantId: TENANT },
    { slug: "comida", section: "COCINA", tenantId: TENANT },
  );
});

describe("POST /tickets/:id/send-to-kitchen (ESC/POS por defecto)", () => {
  it("agrupa líneas por sección y manda comanda TCP a cada printer", async () => {
    seedFreshTicket();
    seedPrinter(PRINTER_BARRA, "BARRA", "192.168.1.10");
    seedPrinter(PRINTER_COCINA, "COCINA", "192.168.1.11");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.revision).toBe(1);
    expect(body.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.sections).toHaveLength(2);
    for (const s of body.sections) {
      expect(s.ok).toBe(true);
    }
    expect(tcpStub.callsByHost.get("192.168.1.10")).toBe(1);
    expect(tcpStub.callsByHost.get("192.168.1.11")).toBe(1);
    const updated = state.tickets.get(TICKET)!;
    expect(updated.lastSentRevision).toBe(1);
    expect(updated.lastSentAt).toBeInstanceOf(Date);
  });

  it("falta printer para una sección con líneas → 409", async () => {
    seedFreshTicket();
    // Solo configuramos BARRA; COCINA queda sin printer.
    seedPrinter(PRINTER_BARRA, "BARRA", "192.168.1.10");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("PRINTER_NOT_CONFIGURED_FOR_SECTION");
    expect(res.json().missingSection).toBe("COCINA");
  });

  it("404 si el ticket no es DRAFT", async () => {
    seedFreshTicket({ status: "PAID" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("TICKET_NOT_FOUND_OR_NOT_DRAFT");
  });

  it("403 si el register del cashier no coincide con el del ticket", async () => {
    seedFreshTicket({ registerId: "ffffffff-ffff-ffff-ffff-ffffffffffff" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("REGISTER_MISMATCH");
  });

  it("400 si el ticket no tiene líneas", async () => {
    seedFreshTicket({ lines: [] });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("EMPTY_TICKET");
  });
});

describe("POST /tickets/:id/send-to-kitchen?fallback=pdf (legacy)", () => {
  it("genera PDFs base64 sin necesitar PrinterConfig", async () => {
    seedFreshTicket();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen?fallback=pdf`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sections).toHaveLength(2);
    for (const sec of body.sections) {
      const bytes = Buffer.from(sec.pdfBase64, "base64");
      expect(bytes.length).toBeGreaterThan(100);
      expect(bytes.slice(0, 4).toString("ascii")).toBe("%PDF");
    }
    expect(tcpStub.callsByHost.size).toBe(0);
  });

  it("fallback=pdf: líneas sin tag caen a SALON sin necesidad de printer", async () => {
    seedFreshTicket({
      lines: [
        {
          id: "L1",
          productId: PRODUCT_CAFE,
          nameSnapshot: "Café cortado",
          units: 1,
          modifiers: null,
        },
      ],
    });
    state.tagSections.length = 0;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen?fallback=pdf`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sections).toHaveLength(1);
    expect(body.sections[0].section).toBe("SALON");
  });
});
