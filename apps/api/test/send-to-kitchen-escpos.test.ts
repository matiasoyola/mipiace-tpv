// v1.4-Impresoras-Fase-1 Lote 2 · tests del endpoint send-to-kitchen/escpos.
//
// Cubrimos:
//   - happy path: 2 secciones (BARRA + COCINA), ambas WIFI configuradas,
//     manda 2 payloads TCP y devuelve resumen ok.
//   - sección sin printer configurado → 409 ANTES de mandar nada.
//   - el ticket NO se marca lastSentAt si todas las secciones fallan.

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
const P_CAFE = "00000000-0000-0000-0000-00000000000a";
const P_TAPAS = "00000000-0000-0000-0000-00000000000b";
const PRINTER_BARRA = "00000000-0000-0000-0000-0000000000aa";
const PRINTER_COCINA = "00000000-0000-0000-0000-0000000000bb";

interface FakeTicket {
  id: string;
  tenantId: string;
  registerId: string;
  status: string;
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
  printers: new Map<string, FakePrinter>(),
  products: new Map<string, { id: string; tenantId: string; tags: string[] }>(),
  tagSections: [] as Array<{
    slug: string;
    section: "BARRA" | "COCINA" | "SALON";
    tenantId: string;
  }>,
};

const tcpStub = {
  failures: new Set<string>(), // hosts en los que sendOverTcp falla
  callsByHost: new Map<string, number>(),
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
      if (!t) throw new Error("not found");
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
      const out: typeof state.products extends Map<string, infer T> ? T[] : never[] = [];
      for (const id of ids) {
        const p = state.products.get(id);
        if (!p) continue;
        if (where.tenantId && p.tenantId !== where.tenantId) continue;
        (out as any).push(p);
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
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

const { registerSendToKitchenEscposRoute } = await import(
  "../src/tickets/send-to-kitchen-escpos.js"
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
  await registerSendToKitchenEscposRoute(app);
  return app;
}

function seedTicket(): FakeTicket {
  const t: FakeTicket = {
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
        productId: P_CAFE,
        nameSnapshot: "Café cortado",
        units: 2,
        modifiers: null,
      },
      {
        id: "L2",
        productId: P_TAPAS,
        nameSnapshot: "Patatas bravas",
        units: 1,
        modifiers: ["Sin pimentón"],
      },
    ],
  };
  state.tickets.set(t.id, t);
  return t;
}

beforeEach(() => {
  state.tickets.clear();
  state.printers.clear();
  state.products.clear();
  state.tagSections.length = 0;
  tcpStub.failures.clear();
  tcpStub.callsByHost.clear();
  vi.clearAllMocks();

  state.products.set(P_CAFE, { id: P_CAFE, tenantId: TENANT, tags: ["bebidas"] });
  state.products.set(P_TAPAS, { id: P_TAPAS, tenantId: TENANT, tags: ["comida"] });
  state.tagSections.push(
    { slug: "bebidas", section: "BARRA", tenantId: TENANT },
    { slug: "comida", section: "COCINA", tenantId: TENANT },
  );
});

describe("POST /tickets/:id/send-to-kitchen/escpos", () => {
  it("happy path: 2 secciones imprimen OK por TCP", async () => {
    seedTicket();
    state.printers.set(PRINTER_BARRA, {
      id: PRINTER_BARRA,
      registerId: REGISTER,
      active: true,
      mode: "WIFI",
      ipAddress: "192.168.1.10",
      port: 9100,
      timeoutMs: 3000,
      section: "BARRA",
      lastPrintOkAt: null,
      lastErrorAt: null,
      lastErrorMsg: null,
    });
    state.printers.set(PRINTER_COCINA, {
      id: PRINTER_COCINA,
      registerId: REGISTER,
      active: true,
      mode: "WIFI",
      ipAddress: "192.168.1.11",
      port: 9100,
      timeoutMs: 3000,
      section: "COCINA",
      lastPrintOkAt: null,
      lastErrorAt: null,
      lastErrorMsg: null,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen/escpos`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.revision).toBe(1);
    expect(body.sections).toHaveLength(2);
    for (const s of body.sections) {
      expect(s.ok).toBe(true);
    }
    expect(tcpStub.callsByHost.get("192.168.1.10")).toBe(1);
    expect(tcpStub.callsByHost.get("192.168.1.11")).toBe(1);
    expect(state.tickets.get(TICKET)!.lastSentRevision).toBe(1);
  });

  it("falta printer para una sección con líneas → 409 sin mandar nada", async () => {
    seedTicket();
    // Sólo configuramos BARRA, pero el ticket también tiene COCINA.
    state.printers.set(PRINTER_BARRA, {
      id: PRINTER_BARRA,
      registerId: REGISTER,
      active: true,
      mode: "WIFI",
      ipAddress: "192.168.1.10",
      port: 9100,
      timeoutMs: 3000,
      section: "BARRA",
      lastPrintOkAt: null,
      lastErrorAt: null,
      lastErrorMsg: null,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen/escpos`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("PRINTER_NOT_CONFIGURED_FOR_SECTION");
    expect(res.json().missingSection).toBe("COCINA");
    // Nada mandado por TCP.
    expect(tcpStub.callsByHost.size).toBe(0);
  });

  it("si todas las secciones fallan → 502 y NO actualiza lastSentAt", async () => {
    seedTicket();
    state.printers.set(PRINTER_BARRA, {
      id: PRINTER_BARRA,
      registerId: REGISTER,
      active: true,
      mode: "WIFI",
      ipAddress: "192.168.1.10",
      port: 9100,
      timeoutMs: 3000,
      section: "BARRA",
      lastPrintOkAt: null,
      lastErrorAt: null,
      lastErrorMsg: null,
    });
    state.printers.set(PRINTER_COCINA, {
      id: PRINTER_COCINA,
      registerId: REGISTER,
      active: true,
      mode: "WIFI",
      ipAddress: "192.168.1.11",
      port: 9100,
      timeoutMs: 3000,
      section: "COCINA",
      lastPrintOkAt: null,
      lastErrorAt: null,
      lastErrorMsg: null,
    });
    tcpStub.failures.add("192.168.1.10");
    tcpStub.failures.add("192.168.1.11");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/send-to-kitchen/escpos`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.sections.every((s: any) => !s.ok)).toBe(true);
    expect(state.tickets.get(TICKET)!.lastSentAt).toBeNull();
    expect(state.tickets.get(TICKET)!.lastSentRevision).toBe(0);
    expect(state.printers.get(PRINTER_BARRA)!.lastErrorMsg).toContain(
      "ECONNREFUSED",
    );
  });
});
