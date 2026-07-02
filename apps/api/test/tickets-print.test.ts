// v1.4-Impresoras-Fase-1 Lote 2 · tests del endpoint print/escpos.
//
// Cubrimos:
//   - target=usb → 200 + binary octet-stream con la cabecera ESC @.
//   - target=wifi sin printerConfigId → resuelve config activa sin
//     sección y manda por TCP (sendOverTcp mockeado).
//   - target=wifi cuando el TCP falla → 502 + lastErrorMsg poblado.
//   - 403 si el register del cashier no coincide.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_TICKET_URL = "https://tickets.example";

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001";
const STORE = "00000000-0000-0000-0000-000000000002";
const REGISTER = "00000000-0000-0000-0000-000000000003";
const DEVICE = "00000000-0000-0000-0000-000000000004";
const CASHIER = "00000000-0000-0000-0000-000000000005";
const TICKET = "00000000-0000-0000-0000-000000000006";
const PRINTER_TICKET = "00000000-0000-0000-0000-0000000000aa";

interface FakeTicket {
  id: string;
  tenantId: string;
  registerId: string;
  internalNumber: string;
  publicSlug: string;
  total: number;
  cashAmount: number | null;
  notes: string | null;
  paidAt: Date | null;
  createdAt: Date;
  table: { name: string } | null;
  user: { email: string; alias: string | null };
  register: { name: string; store: { name: string; fiscalAddress: unknown } };
  tenant: { name: string; receiptFooter: string | null; fiscalProfile: unknown };
  lines: Array<{
    nameSnapshot: string;
    units: number;
    unitPrice: number;
    unitPriceOverride: number | null;
    total: number;
  }>;
  payments: Array<{ method: string; amount: number }>;
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
  createdAt: Date;
}

const state = {
  tickets: new Map<string, FakeTicket>(),
  printers: new Map<string, FakePrinter>(),
};

const tcpStub = {
  mode: "ok" as "ok" | "throw",
  lastPayload: null as Uint8Array | null,
};

vi.mock("@mipiacetpv/escpos-builder", async () => {
  const actual = await vi.importActual<
    typeof import("@mipiacetpv/escpos-builder")
  >("@mipiacetpv/escpos-builder");
  return {
    ...actual,
    sendOverTcp: vi.fn(async (opts: { payload: Uint8Array }) => {
      tcpStub.lastPayload = opts.payload;
      if (tcpStub.mode === "throw") throw new Error("ECONNREFUSED test");
    }),
  };
});

const fakePrisma = {
  ticket: {
    findFirst: vi.fn(async ({ where }: any) => {
      const t = state.tickets.get(where.id);
      if (!t) return null;
      if (where.tenantId && t.tenantId !== where.tenantId) return null;
      return t;
    }),
  },
  printerConfig: {
    findFirst: vi.fn(async ({ where, orderBy: _orderBy }: any) => {
      for (const p of state.printers.values()) {
        if (where.id && p.id !== where.id) continue;
        if (where.registerId && p.registerId !== where.registerId) continue;
        if (where.active != null && p.active !== where.active) continue;
        if (where.mode && p.mode !== where.mode) continue;
        if (where.section !== undefined) {
          if (where.section === null && p.section !== null) continue;
          if (where.section !== null && p.section !== where.section) continue;
        }
        return p;
      }
      return null;
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
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}) as never,
  shutdown: async () => undefined,
}));

const { registerTicketPrintRoute } = await import("../src/tickets/print.js");
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
  await registerTicketPrintRoute(app);
  return app;
}

function seedTicket(overrides: Partial<FakeTicket> = {}): FakeTicket {
  const t: FakeTicket = {
    id: TICKET,
    tenantId: TENANT,
    registerId: REGISTER,
    internalNumber: "TICKET 000001",
    publicSlug: "abc123def4567890",
    total: 12.5,
    cashAmount: 20,
    notes: null,
    paidAt: new Date("2026-06-02T12:00:00Z"),
    createdAt: new Date("2026-06-02T11:55:00Z"),
    table: null,
    user: { email: "ana@bar.es", alias: null },
    register: {
      name: "Caja 1",
      store: {
        name: "Bar Quevedo",
        fiscalAddress: { address: "c/ Mayor 5", city: "Madrid", postalCode: "28001" },
      },
    },
    tenant: { name: "Bar Quevedo", receiptFooter: "Gracias", fiscalProfile: null },
    lines: [
      {
        nameSnapshot: "Café",
        units: 2,
        unitPrice: 1.5,
        unitPriceOverride: null,
        total: 3,
      },
      {
        nameSnapshot: "Tostada",
        units: 1,
        unitPrice: 9.5,
        unitPriceOverride: null,
        total: 9.5,
      },
    ],
    payments: [{ method: "CASH", amount: 12.5 }],
    ...overrides,
  };
  state.tickets.set(t.id, t);
  return t;
}

function seedWifiPrinter(overrides: Partial<FakePrinter> = {}): FakePrinter {
  const p: FakePrinter = {
    id: PRINTER_TICKET,
    registerId: REGISTER,
    active: true,
    mode: "WIFI",
    ipAddress: "192.168.1.50",
    port: 9100,
    timeoutMs: 3000,
    section: null,
    lastPrintOkAt: null,
    lastErrorAt: null,
    lastErrorMsg: null,
    createdAt: new Date(),
    ...overrides,
  };
  state.printers.set(p.id, p);
  return p;
}

beforeEach(() => {
  state.tickets.clear();
  state.printers.clear();
  tcpStub.mode = "ok";
  tcpStub.lastPayload = null;
  vi.clearAllMocks();
});

describe("POST /tickets/:id/print/escpos", () => {
  // v1.7-alias-cajeros: el ticket impreso lleva el alias del cajero;
  // los users legacy sin alias siguen imprimiendo el email recortado.
  it("cashierLabel usa el alias cuando existe", async () => {
    seedTicket({ user: { email: "m.garcia.1987@gmail.com", alias: "Maria" } });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/print/escpos?target=usb`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.rawPayload.toString("latin1");
    expect(body).toContain("Cajero: Maria");
    expect(body).not.toContain("m.garcia.1987");
  });

  it("cashierLabel sin alias → fallback al email recortado", async () => {
    seedTicket({ user: { email: "m.garcia.1987@gmail.com", alias: null } });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/print/escpos?target=usb`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.rawPayload.toString("latin1");
    expect(body).toContain("Cajero: m.garcia.1987");
    expect(body).not.toContain("@gmail.com");
  });

  it("target=usb devuelve binary octet-stream con ESC @", async () => {
    seedTicket();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/print/escpos?target=usb`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.rawPayload[0]).toBe(0x1b);
    expect(res.rawPayload[1]).toBe(0x40);
    // No tocamos tcp en USB.
    expect(tcpStub.lastPayload).toBeNull();
  });

  it("target=wifi sin id resuelve printer activo sin sección y manda TCP", async () => {
    seedTicket();
    seedWifiPrinter();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/print/escpos?target=wifi`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(tcpStub.lastPayload).not.toBeNull();
    // Payload arranca con ESC @.
    expect(tcpStub.lastPayload![0]).toBe(0x1b);
    // lastPrintOkAt rellenado.
    expect(state.printers.get(PRINTER_TICKET)!.lastPrintOkAt).toBeInstanceOf(Date);
  });

  it("target=wifi sin impresora configurada → 409", async () => {
    seedTicket();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/print/escpos?target=wifi`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("PRINTER_NOT_CONFIGURED");
  });

  it("target=wifi cuando TCP falla → 502 y registra lastErrorMsg", async () => {
    seedTicket();
    seedWifiPrinter();
    tcpStub.mode = "throw";
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/print/escpos?target=wifi`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("PRINT_FAILED");
    expect(state.printers.get(PRINTER_TICKET)!.lastErrorMsg).toContain(
      "ECONNREFUSED",
    );
  });

  it("403 si el register del cashier no coincide con el del ticket", async () => {
    seedTicket({
      registerId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/print/escpos?target=usb`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("REGISTER_MISMATCH");
  });

  it("404 si el ticket no existe", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/print/escpos?target=usb`,
      headers: { authorization: `Bearer ${signSession()}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
