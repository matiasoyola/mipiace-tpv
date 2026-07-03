// v1.4-Bugs-Operativos Lote 1 · cierre de turno con PIN del cajero.
//
// Cubre la regresión detectada con Peluquería Sole: el cierre exigía PIN
// de OWNER/MANAGER, lo que bloqueaba a la empleada CASHIER cuando había
// tickets SYNC_FAILED en el turno. La regla nueva es:
//   - El PIN del cajero autenticado vale (default).
//   - El opt-in `requireOwnerPinForCashClose=true` mantiene la política
//     antigua para tenants que quieran restringir a OWNER/MANAGER.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.Z_REPORT_STORAGE_ROOT = "/tmp/z-reports-test";

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001";
const STORE = "00000000-0000-0000-0000-000000000002";
const REGISTER = "00000000-0000-0000-0000-000000000003";
const DEVICE = "00000000-0000-0000-0000-000000000004";
const CASHIER = "00000000-0000-0000-0000-000000000005";
const OWNER = "00000000-0000-0000-0000-000000000006";
const SHIFT = "00000000-0000-0000-0000-00000000000e";

const CASHIER_PIN = "1234";
const OWNER_PIN = "9999";

interface FakeTenantRow {
  id: string;
  requireManagerPinForForceClose: boolean;
  requireOwnerPinForCashClose: boolean;
  lastIncrementalSyncAt: Date | null;
  holdedApiKeyCiphertext: string | null;
}

interface FakeUser {
  id: string;
  tenantId: string;
  email: string;
  role: "OWNER" | "MANAGER" | "CASHIER";
  pinHash: string | null;
}

interface FakeShift {
  id: string;
  registerId: string;
  userId: string;
  closedAt: Date | null;
  cashOpening: { toString: () => string } & { valueOf: () => number };
  openedAt: Date;
  register: {
    id: string;
    name: string;
    store: { id: string; name: string; tenantId: string };
  };
}

const state = {
  tenant: null as FakeTenantRow | null,
  users: new Map<string, FakeUser>(),
  shifts: new Map<string, FakeShift>(),
  tickets: [] as Array<{ shiftId: string; status: string }>,
  refunds: [] as Array<{
    shiftId: string;
    status: string;
    method?: string;
    total?: number;
  }>,
  payments: [] as Array<{ shiftId: string; method: string; amount: number }>,
  cashCounts: [] as Array<{ shiftId: string; kind: string }>,
};

function dec(n: number) {
  return {
    toString: () => String(n),
    valueOf: () => n,
  } as { toString: () => string; valueOf: () => number };
}

const fakePrisma = {
  tenant: {
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      if (!state.tenant || state.tenant.id !== where.id)
        throw new Error("tenant not found");
      return state.tenant;
    }),
  },
  shift: {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const s of state.shifts.values()) {
        if (where.id && s.id !== where.id) continue;
        if (where.registerId && s.registerId !== where.registerId) continue;
        if (where.closedAt === null && s.closedAt !== null) continue;
        return s;
      }
      return null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const s = state.shifts.get(where.id);
      if (!s) throw new Error("shift not found");
      if (data.closedAt) s.closedAt = data.closedAt;
      return {
        id: s.id,
        closedAt: s.closedAt,
        zReportPdfPath: data.zReportPdfPath ?? null,
      };
    }),
    // v1.5-B §3.b: la apertura ya no consulta health — estos tests
    // ejercitan POST /shift/open con tenant "bloqueado".
    create: vi.fn(async ({ data }: any) => {
      const id = "00000000-0000-0000-0000-0000000000ff";
      state.shifts.set(id, {
        id,
        registerId: data.registerId,
        userId: data.userId,
        closedAt: null,
        cashOpening: data.cashOpening,
        openedAt: data.openedAt,
        register: {
          id: REGISTER,
          name: "Caja principal",
          store: { id: STORE, name: "Sole", tenantId: TENANT },
        },
      });
      return { id, openedAt: data.openedAt, cashOpening: data.cashOpening };
    }),
  },
  ticket: {
    groupBy: vi.fn(async ({ where }: any) => {
      const filtered = state.tickets.filter(
        (t) =>
          t.shiftId === where.shiftId &&
          (where.status?.in
            ? where.status.in.includes(t.status)
            : t.status === where.status),
      );
      const map = new Map<string, number>();
      for (const t of filtered) map.set(t.status, (map.get(t.status) ?? 0) + 1);
      return [...map.entries()].map(([status, _count]) => ({
        status,
        _count,
      }));
    }),
    count: vi.fn(async ({ where }: any) => {
      return state.tickets.filter((t) => t.shiftId === where.shiftId).length;
    }),
    // v1.8-Fiado · agregado de fiados vendidos en el turno (ON_CREDIT).
    aggregate: vi.fn(async ({ where }: any) => {
      const filtered = state.tickets.filter(
        (t) => t.shiftId === where.shiftId && t.status === where.status,
      );
      const total = filtered.reduce((acc, t) => acc + Number(t.total ?? 0), 0);
      return { _count: { _all: filtered.length }, _sum: { total } };
    }),
    findMany: vi.fn(async ({ where }: any) => {
      return state.tickets
        .filter((t) => t.shiftId === where.shiftId && t.status === where.status)
        .map((t, i) => ({
          id: `t-${i}`,
          internalNumber: `T-${i}`,
          total: dec(0),
          syncError: { reason: "silent_reject" },
          createdAt: new Date(),
        }));
    }),
  },
  refund: {
    // Dos usos: sync-health agrupa por status (_count) y el desglose Z
    // (v1.0-pilotos Lote 3) agrupa por method (_sum.total).
    groupBy: vi.fn(async ({ by, where }: any) => {
      const filtered = state.refunds.filter((r) => {
        if (r.shiftId !== where.shiftId) return false;
        if (where.status?.in) return where.status.in.includes(r.status);
        if (where.status?.notIn) return !where.status.notIn.includes(r.status);
        return true;
      });
      if (by.includes("method")) {
        const map = new Map<string | null, number>();
        for (const r of filtered) {
          const key = r.method ?? null;
          map.set(key, (map.get(key) ?? 0) + (r.total ?? 0));
        }
        return [...map.entries()].map(([method, total]) => ({
          method,
          _sum: { total },
        }));
      }
      const map = new Map<string, number>();
      for (const r of filtered) map.set(r.status, (map.get(r.status) ?? 0) + 1);
      return [...map.entries()].map(([status, _count]) => ({ status, _count }));
    }),
    count: vi.fn(async ({ where }: any) =>
      state.refunds.filter(
        (r) =>
          r.shiftId === where.shiftId &&
          (!where.status?.notIn || !where.status.notIn.includes(r.status)),
      ).length,
    ),
    findMany: vi.fn(async () => []),
  },
  ticketPayment: {
    groupBy: vi.fn(async ({ where }: any) => {
      const map = new Map<string, number>();
      for (const p of state.payments) {
        if (where.collectedInShiftId) {
          // v1.8-Fiado · cobros de deuda imputados a este turno.
          if ((p.collectedInShiftId ?? null) !== where.collectedInShiftId) continue;
        } else {
          // Ventas normales: por turno de la venta, excluyendo cobros de
          // deuda (collectedInShiftId no nulo).
          if (p.shiftId !== where.ticket.shiftId) continue;
          if ((p.collectedInShiftId ?? null) !== null) continue;
        }
        map.set(p.method, (map.get(p.method) ?? 0) + p.amount);
      }
      return [...map.entries()].map(([method, amount]) => ({
        method,
        _sum: { amount },
      }));
    }),
    aggregate: vi.fn(async ({ where }: any) => {
      let total = 0;
      for (const p of state.payments) {
        if (p.shiftId === where.ticket.shiftId && p.method === where.method)
          total += p.amount;
      }
      return { _sum: { amount: total } };
    }),
  },
  user: {
    findMany: vi.fn(async ({ where }: any) => {
      const out: FakeUser[] = [];
      for (const u of state.users.values()) {
        if (where.tenantId && u.tenantId !== where.tenantId) continue;
        if (where.pinHash?.not === null && u.pinHash === null) continue;
        const orMatches =
          !where.OR ||
          where.OR.some((clause: any) => {
            if (clause.id && u.id === clause.id) return true;
            if (clause.role?.in && clause.role.in.includes(u.role)) return true;
            return false;
          });
        if (!orMatches) continue;
        out.push(u);
      }
      return out;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const u = state.users.get(where.id);
      if (!u) throw new Error("user not found");
      return u;
    }),
  },
  shiftCashCount: {
    findFirst: vi.fn(async ({ where }: any) => {
      return (
        state.cashCounts.find(
          (c) => c.shiftId === where.shiftId && c.kind === where.kind,
        ) ?? null
      );
    }),
    create: vi.fn(async ({ data }: any) => {
      state.cashCounts.push({ shiftId: data.shiftId, kind: data.kind });
      return data;
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}) as never,
  shutdown: async () => undefined,
}));

// El generador de Z-PDF escribe en disco. Lo mockeamos a un path constante.
vi.mock("../src/shift/z-report.js", () => ({
  generateZReportPdf: vi.fn(async () => "/tmp/z-test.pdf"),
}));

const { registerShiftRoutes } = await import("../src/shift/routes.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { hashPassword } = await import("../src/auth/passwords.js");

function signSession(role: "OWNER" | "MANAGER" | "CASHIER" = "CASHIER") {
  return signCashierSession(
    {
      sub: role === "OWNER" ? OWNER : CASHIER,
      tid: TENANT,
      did: DEVICE,
      rid: REGISTER,
      role,
    },
    10,
  );
}

async function buildApp() {
  const app = Fastify();
  await registerShiftRoutes(app);
  return app;
}

beforeEach(async () => {
  state.tenant = {
    id: TENANT,
    requireManagerPinForForceClose: true,
    requireOwnerPinForCashClose: false,
    // sync reciente para que health=ok (lastSyncAgeMs < 24h)
    lastIncrementalSyncAt: new Date(),
    holdedApiKeyCiphertext: "fake-cipher",
  };
  state.users.clear();
  state.users.set(CASHIER, {
    id: CASHIER,
    tenantId: TENANT,
    email: "maoysa@gmail.com",
    role: "CASHIER",
    pinHash: await hashPassword(CASHIER_PIN),
  });
  state.users.set(OWNER, {
    id: OWNER,
    tenantId: TENANT,
    email: "sole@peluqueriasole.es",
    role: "OWNER",
    pinHash: await hashPassword(OWNER_PIN),
  });
  state.shifts.clear();
  state.shifts.set(SHIFT, {
    id: SHIFT,
    registerId: REGISTER,
    userId: CASHIER,
    closedAt: null,
    cashOpening: dec(100),
    openedAt: new Date(Date.now() - 60 * 60 * 1000),
    register: {
      id: REGISTER,
      name: "Caja principal",
      store: { id: STORE, name: "Sole", tenantId: TENANT },
    },
  });
  state.tickets = [];
  state.refunds = [];
  state.payments = [];
  state.cashCounts = [];
  vi.clearAllMocks();
});

describe("POST /shift/:id/close · PIN del cajero", () => {
  it("CASHIER cierra su propio turno sin tickets fallados → 200 sin PIN", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/shift/${SHIFT}/close`,
      headers: { authorization: `Bearer ${signSession("CASHIER")}` },
      payload: {
        cashCounted: 100,
        methodTotals: { CASH: 100 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.shift.id).toBe(SHIFT);
    expect(body.forceClose).toBe(false);
  });

  it("CASHIER cierra su propio turno con SYNC_FAILED → 200 si manda SU PIN", async () => {
    // Sembramos un ticket SYNC_FAILED + syncFailureAccepted=true.
    state.tickets.push({ shiftId: SHIFT, status: "SYNC_FAILED" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/shift/${SHIFT}/close`,
      headers: { authorization: `Bearer ${signSession("CASHIER")}` },
      payload: {
        cashCounted: 100,
        methodTotals: { CASH: 100 },
        syncFailureAccepted: true,
        managerPin: CASHIER_PIN,
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("CASHIER con SYNC_FAILED y PIN del OWNER → 200 (back-compat encargado físico)", async () => {
    state.tickets.push({ shiftId: SHIFT, status: "SYNC_FAILED" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/shift/${SHIFT}/close`,
      headers: { authorization: `Bearer ${signSession("CASHIER")}` },
      payload: {
        cashCounted: 100,
        methodTotals: { CASH: 100 },
        syncFailureAccepted: true,
        managerPin: OWNER_PIN,
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("CASHIER con SYNC_FAILED y PIN incorrecto → 403 INVALID_MANAGER_PIN", async () => {
    state.tickets.push({ shiftId: SHIFT, status: "SYNC_FAILED" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/shift/${SHIFT}/close`,
      headers: { authorization: `Bearer ${signSession("CASHIER")}` },
      payload: {
        cashCounted: 100,
        methodTotals: { CASH: 100 },
        syncFailureAccepted: true,
        managerPin: "0000",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("INVALID_MANAGER_PIN");
  });

  it("requireOwnerPinForCashClose=true → PIN del CASHIER rechazado, OWNER aceptado", async () => {
    state.tenant!.requireOwnerPinForCashClose = true;
    state.tickets.push({ shiftId: SHIFT, status: "SYNC_FAILED" });
    const app = await buildApp();

    // Su propio PIN ya NO vale.
    const denied = await app.inject({
      method: "POST",
      url: `/shift/${SHIFT}/close`,
      headers: { authorization: `Bearer ${signSession("CASHIER")}` },
      payload: {
        cashCounted: 100,
        methodTotals: { CASH: 100 },
        syncFailureAccepted: true,
        managerPin: CASHIER_PIN,
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toBe("INVALID_MANAGER_PIN");

    // OWNER sí.
    const ok = await app.inject({
      method: "POST",
      url: `/shift/${SHIFT}/close`,
      headers: { authorization: `Bearer ${signSession("CASHIER")}` },
      payload: {
        cashCounted: 100,
        methodTotals: { CASH: 100 },
        syncFailureAccepted: true,
        managerPin: OWNER_PIN,
      },
    });
    expect(ok.statusCode).toBe(200);
  });
});

// v1.5-consistencia-B §3.b — decisión de producto (2026-06-11): un
// problema de sync nunca cierra el negocio. El gate 409 TENANT_BLOCKED
// de B6 §3.2 desaparece de apertura y cierre: con >48h sin sync o sin
// API key, el turno se abre/cierra igualmente (el aviso vive en los
// banners del TPV y del admin).
describe("v1.5-B §3.b · health blocked ya no bloquea abrir/cerrar turno", () => {
  it("cierre con >48h sin sync → 200 (antes 409 TENANT_BLOCKED)", async () => {
    state.tenant!.lastIncrementalSyncAt = new Date(Date.now() - 50 * 3600 * 1000);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/shift/${SHIFT}/close`,
      headers: { authorization: `Bearer ${signSession("CASHIER")}` },
      payload: { cashCounted: 100, methodTotals: { CASH: 100 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().shift.id).toBe(SHIFT);
  });

  it("cierre sin API key de Holded → 200 (antes 409 TENANT_BLOCKED)", async () => {
    state.tenant!.holdedApiKeyCiphertext = null;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/shift/${SHIFT}/close`,
      headers: { authorization: `Bearer ${signSession("CASHIER")}` },
      payload: { cashCounted: 100, methodTotals: { CASH: 100 } },
    });
    expect(res.statusCode).toBe(200);
  });

  it("apertura con >48h sin sync → 201 (antes 409 TENANT_BLOCKED)", async () => {
    state.tenant!.lastIncrementalSyncAt = new Date(Date.now() - 50 * 3600 * 1000);
    state.shifts.clear(); // sin turno abierto en la caja
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/shift/open",
      headers: { authorization: `Bearer ${signSession("CASHIER")}` },
      payload: { cashOpening: 100 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().shift.id).toBeTruthy();
  });

  it("apertura sin API key de Holded → 201 (antes 409 TENANT_BLOCKED)", async () => {
    state.tenant!.holdedApiKeyCiphertext = null;
    state.shifts.clear();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/shift/open",
      headers: { authorization: `Bearer ${signSession("CASHIER")}` },
      payload: { cashOpening: 100 },
    });
    expect(res.statusCode).toBe(201);
  });
});

// v1.0-pilotos · Lote 3 (#28): el cierre calcula el desglose por método
// (bruto / devoluciones / neto) y se lo pasa al Z PDF y a la respuesta.
describe("v1.0-pilotos Lote 3 · desglose Z por método con devoluciones", () => {
  it("pagos mixtos + devolución en efectivo → teórico de caja resta la devolución", async () => {
    state.payments.push(
      { shiftId: SHIFT, method: "CASH", amount: 200 },
      { shiftId: SHIFT, method: "CARD", amount: 300 },
      { shiftId: SHIFT, method: "BIZUM", amount: 15 },
    );
    state.refunds.push({
      shiftId: SHIFT,
      status: "SYNCED",
      method: "CASH",
      total: 25.5,
    });
    const app = await buildApp();
    // contado = 100 fondo + 200 cash − 25.50 devolución = 274.50 → descuadre 0.
    const res = await app.inject({
      method: "POST",
      url: `/shift/${SHIFT}/close`,
      headers: { authorization: `Bearer ${signSession("CASHIER")}` },
      payload: { cashCounted: 274.5, methodTotals: { CASH: 274.5, CARD: 300 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.descuadre).toBeCloseTo(0, 2);
    expect(body.breakdown.cashTheoretical).toBeCloseTo(274.5, 2);
    expect(body.breakdown.grossSales).toBeCloseTo(515, 2);
    expect(body.breakdown.refundsTotal).toBeCloseTo(25.5, 2);
    expect(body.breakdown.netSales).toBeCloseTo(489.5, 2);
    const cash = body.breakdown.methods.find((m: any) => m.method === "CASH");
    expect(cash).toMatchObject({ gross: 200, refunds: 25.5, net: 174.5 });
    const card = body.breakdown.methods.find((m: any) => m.method === "CARD");
    expect(card).toMatchObject({ gross: 300, refunds: 0, net: 300, counted: 300 });

    // El Z PDF recibió el mismo desglose + contador real de devoluciones.
    const { generateZReportPdf } = await import("../src/shift/z-report.js");
    const zInput = (generateZReportPdf as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(zInput.breakdown.netSales).toBeCloseTo(489.5, 2);
    expect(zInput.refundsCount).toBe(1);
  });

  it("cash-count Z devuelve el desglose del cierre (consistente con el PDF)", async () => {
    state.payments.push({ shiftId: SHIFT, method: "CASH", amount: 50 });
    state.refunds.push({
      shiftId: SHIFT,
      status: "SYNCED",
      method: "CARD",
      total: 10,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/shift/${SHIFT}/cash-count`,
      headers: { authorization: `Bearer ${signSession("CASHIER")}` },
      payload: { kind: "Z", denominations: { "100": 1, "50": 1 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 100 fondo + 50 cash neto = 150 teórico; contado 150 → descuadre 0.
    expect(body.cashTheoretical).toBeCloseTo(150, 2);
    expect(body.descuadre).toBeCloseTo(0, 2);
    const card = body.breakdown.methods.find((m: any) => m.method === "CARD");
    expect(card).toMatchObject({ gross: 0, refunds: 10, net: -10 });
  });

  it("arqueo X intermedio también desglosa y resta devoluciones en efectivo", async () => {
    state.payments.push({ shiftId: SHIFT, method: "CASH", amount: 80 });
    state.refunds.push({
      shiftId: SHIFT,
      status: "SYNCED",
      method: "CASH",
      total: 30,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/shift/${SHIFT}/cash-count`,
      headers: { authorization: `Bearer ${signSession("CASHIER")}` },
      payload: { kind: "X", denominations: { "100": 1, "50": 1 } },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // 100 fondo + 80 − 30 = 150 → descuadre 0 con 150 contados.
    expect(body.cashTheoretical).toBeCloseTo(150, 2);
    expect(body.descuadre).toBeCloseTo(0, 2);
    expect(body.breakdown.methods[0]).toMatchObject({
      method: "CASH",
      gross: 80,
      refunds: 30,
      net: 50,
    });
  });
});
