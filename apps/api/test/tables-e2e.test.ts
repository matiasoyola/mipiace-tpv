// v1.0-pilotos · Lote 1: suite E2E del flujo de mesas HOSPITALITY.
//
// Recorre el ciclo completo de B7 contra los tres módulos de rutas
// reales (operativa + grouping + tickets/checkout) con una BD fake
// in-memory lo bastante rica para sostener el flujo entero:
//
//   abrir mesa → añadir líneas → mover línea → agrupar → desagrupar
//   (reversibilidad via originalTableId) → checkout → internalNumber
//   → upload a Holded (mock) → estados consistentes.
//
// Además cubre los casos defensivos que el bloque pide explícitamente:
//   - dos cajas sobre la misma mesa (semántica last-writer-wins + 403)
//   - DRAFT no cobrable dos veces (sequential 409 + claim en tx)
//   - agrupar mesa con ticket en otra mesa ya agrupada (409)
//   - eventos WS table.* publicados FUERA de la transacción (post-COMMIT)

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
const STORE = "00000000-0000-0000-0000-000000000002";
const REGISTER_A = "00000000-0000-0000-0000-000000000003";
const REGISTER_B = "00000000-0000-0000-0000-000000000033";
const DEVICE = "00000000-0000-0000-0000-000000000004";
const CASHIER_A = "00000000-0000-0000-0000-000000000005";
const CASHIER_B = "00000000-0000-0000-0000-000000000055";
const SHIFT_A = "00000000-0000-0000-0000-000000000006";
const SHIFT_B = "00000000-0000-0000-0000-000000000066";
const MESA_1 = "00000000-0000-0000-0000-0000000000a1";
const MESA_2 = "00000000-0000-0000-0000-0000000000a2";
const MESA_3 = "00000000-0000-0000-0000-0000000000a3";
const MESA_4 = "00000000-0000-0000-0000-0000000000a4";
const GROUP_AVENA = "00000000-0000-0000-0000-0000000000f1";
const MOD_AVENA = "00000000-0000-0000-0000-0000000000f2";

// ── Estado in-memory ─────────────────────────────────────────────────

interface FakeTicket {
  id: string;
  tenantId: string;
  registerId: string;
  shiftId: string;
  userId: string;
  internalNumber: string;
  externalId: string;
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

interface FakeLine {
  id: string;
  ticketId: string;
  productId: string | null;
  variantId: string | null;
  holdedProductId: string | null;
  sku: string;
  nameSnapshot: string;
  units: unknown;
  unitPrice: unknown;
  discountPct: unknown;
  taxRate: unknown;
  subtotal: unknown;
  total: unknown;
  modifiers: unknown;
  originalTableId: string | null;
}

interface FakeTable {
  id: string;
  storeId: string;
  name: string;
  zone: string;
  capacity: number;
  deletedAt: Date | null;
  groupedIntoTableId: string | null;
}

const state = {
  tickets: new Map<string, FakeTicket>(),
  lines: new Map<string, FakeLine>(),
  tables: new Map<string, FakeTable>(),
  payments: new Map<string, Array<{ id: string; method: string; amount: unknown; meta: unknown }>>(),
  registers: new Map<
    string,
    { id: string; storeId: string; name: string; ticketCounter: number; deletedAt: null }
  >(),
  shifts: [] as Array<{ id: string; registerId: string; closedAt: null; openedAt: Date }>,
  holdedUploads: new Map<string, { externalId: string; status: string; kind: string }>(),
  // Profundidad de transacción al momento de cada broadcast — para
  // asegurar que los eventos WS se publican tras el COMMIT.
  txDepth: 0,
  // Simula una lectura stale del pre-check de checkout (carrera de dos
  // cajas): la próxima ticket.findFirst devuelve este status.
  staleStatusOnce: null as string | null,
};

function linesOf(ticketId: string): FakeLine[] {
  return [...state.lines.values()].filter((l) => l.ticketId === ticketId);
}

function tableInclude(t: FakeTicket) {
  const table = t.tableId ? state.tables.get(t.tableId) : null;
  return table
    ? { id: table.id, name: table.name, zone: table.zone, capacity: table.capacity }
    : null;
}

// Materializa relaciones pedidas vía `include` o `select` (los handlers
// usan ambos estilos). Los escalares se devuelven siempre completos —
// suficiente para la suite.
function materialize(t: FakeTicket, rel?: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...t };
  if (!rel) return out;
  if (rel.lines) out.lines = linesOf(t.id);
  if (rel.table) out.table = tableInclude(t);
  if (rel.payments) out.payments = state.payments.get(t.id) ?? [];
  if (rel.partialPayments) out.partialPayments = [];
  if (rel.refunds) out.refunds = [];
  if (rel.register) {
    const reg = state.registers.get(t.registerId)!;
    out.register = {
      id: reg.id,
      name: reg.name,
      storeId: reg.storeId,
      store: { name: "Bar Test" },
    };
  }
  return out;
}

function matchTicket(t: FakeTicket, where: Record<string, unknown>): boolean {
  if (where.id && t.id !== where.id) return false;
  if (where.tenantId && t.tenantId !== where.tenantId) return false;
  if (where.status && t.status !== where.status) return false;
  if (where.tableId) {
    const cond = where.tableId as { in?: string[] } | string;
    if (typeof cond === "string") {
      if (t.tableId !== cond) return false;
    } else if (cond.in && (!t.tableId || !cond.in.includes(t.tableId))) {
      return false;
    }
  }
  return true;
}

function matchLine(l: FakeLine, where: Record<string, unknown>): boolean {
  if (where.id) {
    const cond = where.id as { in?: string[] } | string;
    if (typeof cond === "string") {
      if (l.id !== cond) return false;
    } else if (cond.in && !cond.in.includes(l.id)) return false;
  }
  if (where.ticketId && l.ticketId !== where.ticketId) return false;
  if ("originalTableId" in where && l.originalTableId !== where.originalTableId) {
    return false;
  }
  return true;
}

function matchTable(tb: FakeTable, where: Record<string, unknown>): boolean {
  if (where.id) {
    const cond = where.id as { in?: string[] } | string;
    if (typeof cond === "string") {
      if (tb.id !== cond) return false;
    } else if (cond.in && !cond.in.includes(tb.id)) return false;
  }
  if ("deletedAt" in where && where.deletedAt === null && tb.deletedAt !== null) {
    return false;
  }
  if (where.storeId && tb.storeId !== where.storeId) return false;
  if ("groupedIntoTableId" in where && tb.groupedIntoTableId !== where.groupedIntoTableId) {
    return false;
  }
  // store: { tenantId } — un solo tenant en la suite.
  return true;
}

function applyTicketUpdate(t: FakeTicket, data: Record<string, unknown>): void {
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
      const rel = include ?? select;
      for (const t of state.tickets.values()) {
        if (matchTicket(t, where)) {
          if (state.staleStatusOnce && where.id) {
            const stale = { ...t, status: state.staleStatusOnce };
            state.staleStatusOnce = null;
            return materialize(stale as FakeTicket, rel);
          }
          return materialize(t, rel);
        }
      }
      return null;
    }),
    findMany: vi.fn(async ({ where }: any) =>
      [...state.tickets.values()].filter((t) => matchTicket(t, where)),
    ),
    findUniqueOrThrow: vi.fn(async ({ where, include }: any) => {
      const t = state.tickets.get(where.id);
      if (!t) throw new Error("ticket not found");
      return materialize(t, include ?? { lines: true, table: true });
    }),
    create: vi.fn(async ({ data, include, select }: any) => {
      const t: FakeTicket = {
        id: data.id ?? randomUUID(),
        tenantId: data.tenantId,
        registerId: data.registerId,
        shiftId: data.shiftId,
        userId: data.userId,
        internalNumber: data.internalNumber,
        externalId: data.externalId,
        publicSlug: data.publicSlug,
        status: data.status,
        tableId: data.tableId ?? null,
        diners: data.diners ?? null,
        total: data.total,
        totalTax: data.totalTax,
        totalDiscount: data.totalDiscount,
        notes: null,
        contactHoldedId: null,
        cashAmount: null,
        printIntent: data.printIntent ?? false,
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
      return materialize(t, include ?? select);
    }),
    update: vi.fn(async ({ where, data, include, select }: any) => {
      const t = state.tickets.get(where.id);
      if (!t) throw new Error("ticket not found");
      applyTicketUpdate(t, data);
      return materialize(t, include ?? select);
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const t of state.tickets.values()) {
        if (matchTicket(t, where)) {
          applyTicketUpdate(t, data);
          count += 1;
        }
      }
      return { count };
    }),
  },
  ticketLine: {
    create: vi.fn(async ({ data }: any) => {
      const l: FakeLine = {
        id: data.id ?? randomUUID(),
        ticketId: data.ticketId,
        productId: data.productId ?? null,
        variantId: data.variantId ?? null,
        holdedProductId: data.holdedProductId ?? null,
        sku: data.sku,
        nameSnapshot: data.nameSnapshot,
        units: data.units,
        unitPrice: data.unitPrice,
        discountPct: data.discountPct,
        taxRate: data.taxRate,
        subtotal: data.subtotal,
        total: data.total,
        modifiers: data.modifiers === undefined ? null : data.modifiers,
        originalTableId: null,
      };
      // Prisma.JsonNull → null en BD.
      if (l.modifiers && typeof l.modifiers === "object" && !Array.isArray(l.modifiers)) {
        l.modifiers = null;
      }
      state.lines.set(l.id, l);
      return l;
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const l of state.lines.values()) if (matchLine(l, where)) return l;
      return null;
    }),
    findMany: vi.fn(async ({ where }: any) =>
      [...state.lines.values()].filter((l) => matchLine(l, where)),
    ),
    update: vi.fn(async ({ where, data }: any) => {
      const l = state.lines.get(where.id);
      if (!l) throw new Error("line not found");
      for (const [k, v] of Object.entries(data)) {
        if (k === "modifiers" && v && typeof v === "object" && !Array.isArray(v)) {
          l.modifiers = null; // Prisma.JsonNull
        } else {
          (l as unknown as Record<string, unknown>)[k] = v;
        }
      }
      return l;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const l of state.lines.values()) {
        if (matchLine(l, where)) {
          Object.assign(l, data);
          count += 1;
        }
      }
      return { count };
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      let count = 0;
      for (const [id, l] of state.lines) {
        if (matchLine(l, where)) {
          state.lines.delete(id);
          count += 1;
        }
      }
      return { count };
    }),
  },
  table: {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const tb of state.tables.values()) if (matchTable(tb, where)) return tb;
      return null;
    }),
    findMany: vi.fn(async ({ where }: any) =>
      [...state.tables.values()].filter((tb) => matchTable(tb, where)),
    ),
    findUnique: vi.fn(async ({ where }: any) => state.tables.get(where.id) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where, select }: any) => {
      const tb = state.tables.get(where.id);
      if (!tb) throw new Error("table not found");
      if (select?.store) return { store: { tenantId: TENANT } };
      return tb;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const tb of state.tables.values()) {
        if (matchTable(tb, where)) {
          Object.assign(tb, data);
          count += 1;
        }
      }
      return { count };
    }),
  },
  register: {
    findFirst: vi.fn(async ({ where }: any) => {
      const r = state.registers.get(where.id);
      if (!r) return null;
      if (where.storeId && r.storeId !== where.storeId) return null;
      return r;
    }),
    findUnique: vi.fn(async ({ where }: any) => state.registers.get(where.id) ?? null),
    update: vi.fn(async ({ where, data }: any) => {
      const r = state.registers.get(where.id);
      if (!r) throw new Error("register not found");
      if (data.ticketCounter?.increment) r.ticketCounter += data.ticketCounter.increment;
      return { ticketCounter: r.ticketCounter };
    }),
  },
  shift: {
    findFirst: vi.fn(async ({ where }: any) =>
      state.shifts.find((s) => s.registerId === where.registerId && s.closedAt === null) ??
      null,
    ),
    findFirstOrThrow: vi.fn(async ({ where }: any) => {
      const s = state.shifts.find(
        (sh) => sh.registerId === where.registerId && sh.closedAt === null,
      );
      if (!s) throw new Error("shift not found");
      return s;
    }),
    update: vi.fn(async () => ({})),
  },
  user: {
    findUnique: vi.fn(async ({ where }: any) => ({
      email: where.id === CASHIER_B ? "caja2@bar.es" : "caja1@bar.es",
    })),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => ({
      email: where.id === CASHIER_B ? "caja2@bar.es" : "caja1@bar.es",
    })),
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
          kind: create.kind,
        });
      }
      return state.holdedUploads.get(where.externalId);
    }),
  },
  modifierGroup: {
    findMany: vi.fn(async ({ where }: any) => {
      if (!where.id.in.includes(GROUP_AVENA)) return [];
      return [
        {
          id: GROUP_AVENA,
          name: "Leche",
          exclusive: true,
          required: false,
          modifiers: [{ id: MOD_AVENA, label: "Avena", priceDeltaCents: 30 }],
        },
      ];
    }),
  },
  productModifierGroup: {
    findMany: vi.fn(async () => []),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    state.txDepth += 1;
    try {
      return await fn(fakePrisma);
    } finally {
      state.txDepth -= 1;
    }
  }),
};

const enqueueTicketUploadMock = vi.fn(async (_externalId: string) => undefined);

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }) as never,
  shutdown: async () => undefined,
}));
vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: (externalId: string) => enqueueTicketUploadMock(externalId),
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

const { registerTableOperativaRoutes } = await import("../src/tables/operativa.js");
const { registerTableGroupingRoutes } = await import("../src/tables/grouping.js");
const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { getStoreEventBus } = await import("../src/realtime/store-event-bus.js");

// Captura de broadcasts con la profundidad de tx en el momento de la
// llamada: txDepth > 0 significaría "evento emitido ANTES del commit".
const broadcasts: Array<{ event: { type: string }; txDepthAtEmit: number }> = [];
vi.spyOn(getStoreEventBus(), "broadcast").mockImplementation(
  (_storeId: string, event: { type: string }) => {
    broadcasts.push({ event, txDepthAtEmit: state.txDepth });
  },
);

function auth(cashier: "A" | "B" = "A") {
  return {
    authorization: `Bearer ${signCashierSession(
      {
        sub: cashier === "A" ? CASHIER_A : CASHIER_B,
        tid: TENANT,
        did: DEVICE,
        rid: cashier === "A" ? REGISTER_A : REGISTER_B,
        role: "CASHIER",
      },
      10,
    )}`,
  };
}

async function buildApp() {
  const app = Fastify();
  await registerTableOperativaRoutes(app);
  await registerTableGroupingRoutes(app);
  await registerTicketRoutes(app);
  return app;
}

function seedTable(id: string, name: string): void {
  state.tables.set(id, {
    id,
    storeId: STORE,
    name,
    zone: "SALON",
    capacity: 4,
    deletedAt: null,
    groupedIntoTableId: null,
  });
}

const CAFE = {
  nameSnapshot: "Café solo",
  sku: "CAFE",
  units: 1,
  unitPrice: 1.5,
  discountPct: 0,
  taxRate: 10,
};

async function openTable(app: Awaited<ReturnType<typeof buildApp>>, tableId: string) {
  return app.inject({
    method: "POST",
    url: `/tables/${tableId}/open`,
    headers: auth(),
    payload: {},
  });
}

async function addLine(
  app: Awaited<ReturnType<typeof buildApp>>,
  tableId: string,
  body: Record<string, unknown> = CAFE,
  cashier: "A" | "B" = "A",
) {
  return app.inject({
    method: "POST",
    url: `/tables/${tableId}/lines`,
    headers: auth(cashier),
    payload: body,
  });
}

async function checkout(
  app: Awaited<ReturnType<typeof buildApp>>,
  ticketId: string,
  payments: Array<{ method: string; amount: number }>,
  cashier: "A" | "B" = "A",
) {
  return app.inject({
    method: "POST",
    url: `/tickets/${ticketId}/checkout`,
    headers: auth(cashier),
    payload: { payments },
  });
}

function draftOf(tableId: string): FakeTicket {
  const t = [...state.tickets.values()].find(
    (tk) => tk.tableId === tableId && tk.status === "DRAFT",
  );
  if (!t) throw new Error(`no DRAFT en mesa ${tableId}`);
  return t;
}

beforeEach(() => {
  state.tickets.clear();
  state.lines.clear();
  state.tables.clear();
  state.payments.clear();
  state.registers.clear();
  state.holdedUploads.clear();
  state.shifts = [
    { id: SHIFT_A, registerId: REGISTER_A, closedAt: null, openedAt: new Date() },
    { id: SHIFT_B, registerId: REGISTER_B, closedAt: null, openedAt: new Date() },
  ];
  state.txDepth = 0;
  state.staleStatusOnce = null;
  broadcasts.length = 0;
  enqueueTicketUploadMock.mockClear();

  state.registers.set(REGISTER_A, {
    id: REGISTER_A,
    storeId: STORE,
    name: "Caja 1",
    ticketCounter: 0,
    deletedAt: null,
  });
  state.registers.set(REGISTER_B, {
    id: REGISTER_B,
    storeId: STORE,
    name: "Caja 2",
    ticketCounter: 0,
    deletedAt: null,
  });
  seedTable(MESA_1, "Mesa 1");
  seedTable(MESA_2, "Mesa 2");
  seedTable(MESA_3, "Mesa 3");
  seedTable(MESA_4, "Mesa 4");
});

describe("E2E mesas · ciclo completo", () => {
  it("abrir → líneas → mover línea → agrupar → desagrupar → checkout → upload", async () => {
    const app = await buildApp();

    // 1 · Abrir Mesa 1 con comensales.
    const open = await app.inject({
      method: "POST",
      url: `/tables/${MESA_1}/open`,
      headers: auth(),
      payload: { diners: 3 },
    });
    expect(open.statusCode).toBe(201);
    const opened = open.json().ticket;
    expect(opened.status).toBe("DRAFT");
    expect(opened.diners).toBe(3);
    // El DRAFT no consume serie fiscal — placeholder D-<uuid>.
    expect(draftOf(MESA_1).internalNumber).toMatch(/^D-/);
    expect(broadcasts.at(-1)?.event.type).toBe("table.opened");

    // 2 · Dos líneas en Mesa 1 (idempotencia incluida).
    const lineExternalId = randomUUID();
    const add1 = await addLine(app, MESA_1, { ...CAFE, lineExternalId });
    expect(add1.statusCode).toBe(201);
    const dup = await addLine(app, MESA_1, { ...CAFE, lineExternalId });
    expect(dup.statusCode).toBe(200);
    expect(dup.json().duplicate).toBe(true);
    const add2 = await addLine(app, MESA_1, {
      ...CAFE,
      nameSnapshot: "Tostada",
      sku: "TOSTADA",
      unitPrice: 2.5,
    });
    expect(add2.statusCode).toBe(201);
    const mesa1Draft = draftOf(MESA_1);
    expect(linesOf(mesa1Draft.id)).toHaveLength(2);
    // 1.50·1.10 + 2.50·1.10 = 4.40
    expect(Number(mesa1Draft.total)).toBeCloseTo(4.4, 2);

    // 3 · Mover la tostada a Mesa 2 → registra originalTableId.
    const tostada = linesOf(mesa1Draft.id).find((l) => l.sku === "TOSTADA")!;
    const move = await app.inject({
      method: "POST",
      url: `/tickets/${mesa1Draft.id}/lines/move`,
      headers: auth(),
      payload: { lineIds: [tostada.id], destinationTableId: MESA_2 },
    });
    expect(move.statusCode).toBe(200);
    const mesa2Draft = draftOf(MESA_2);
    expect(state.lines.get(tostada.id)!.ticketId).toBe(mesa2Draft.id);
    expect(state.lines.get(tostada.id)!.originalTableId).toBe(MESA_1);
    expect(Number(mesa1Draft.total)).toBeCloseTo(1.65, 2);
    expect(Number(mesa2Draft.total)).toBeCloseTo(2.75, 2);
    expect(broadcasts.at(-1)?.event.type).toBe("table.linesMoved");

    // 4 · Agrupar Mesa 2 dentro de Mesa 1 → ticket de Mesa 2 VOIDED,
    // líneas absorbidas por el principal.
    const group = await app.inject({
      method: "POST",
      url: `/tables/${MESA_1}/group`,
      headers: auth(),
      payload: { tablesToAbsorbIds: [MESA_2] },
    });
    expect(group.statusCode).toBe(200);
    expect(state.tables.get(MESA_2)!.groupedIntoTableId).toBe(MESA_1);
    expect(state.tickets.get(mesa2Draft.id)!.status).toBe("VOIDED");
    expect(linesOf(mesa1Draft.id)).toHaveLength(2);
    expect(Number(mesa1Draft.total)).toBeCloseTo(4.4, 2);
    // La línea movida conserva su PRIMER origen (MESA_1): reversible.
    expect(state.lines.get(tostada.id)!.originalTableId).toBe(MESA_1);
    expect(broadcasts.at(-1)?.event.type).toBe("table.grouped");

    // 5 · Desagrupar → Mesa 2 queda libre (la tostada vuelve a su
    // origen histórico, Mesa 1, así que Mesa 2 no recibe ticket).
    const ungroup = await app.inject({
      method: "POST",
      url: `/tables/${MESA_1}/ungroup`,
      headers: auth(),
    });
    expect(ungroup.statusCode).toBe(200);
    expect(state.tables.get(MESA_2)!.groupedIntoTableId).toBeNull();
    expect(broadcasts.at(-1)?.event.type).toBe("table.ungrouped");

    // 6 · Checkout de Mesa 1 → internalNumber fiscal + upload Holded.
    const pay = await checkout(app, mesa1Draft.id, [
      { method: "CARD", amount: 4.4 },
    ]);
    expect(pay.statusCode).toBe(200);
    expect(mesa1Draft.status).toBe("PENDING_SYNC");
    expect(mesa1Draft.internalNumber).toBe("000001");
    expect(mesa1Draft.paidAt).not.toBeNull();
    expect(state.payments.get(mesa1Draft.id)).toHaveLength(1);
    expect(state.holdedUploads.get(mesa1Draft.externalId)?.status).toBe("PENDING");
    expect(enqueueTicketUploadMock).toHaveBeenCalledWith(mesa1Draft.externalId);
    expect(broadcasts.map((b) => b.event.type)).toContain("table.paid");
    expect(broadcasts.map((b) => b.event.type)).toContain("ticket.paid");

    // 7 · TODOS los eventos WS se emitieron fuera de transacción
    // (post-COMMIT) — txDepth 0 en el momento del broadcast.
    expect(broadcasts.length).toBeGreaterThanOrEqual(6);
    for (const b of broadcasts) {
      expect(b.txDepthAtEmit, `evento ${b.event.type} emitido dentro de tx`).toBe(0);
    }
  });

  it("desagrupar devuelve a la mesa absorbida sus líneas (reversibilidad via originalTableId)", async () => {
    const app = await buildApp();
    await addLine(app, MESA_1, CAFE);
    await addLine(app, MESA_2, { ...CAFE, nameSnapshot: "Caña", sku: "CANA", unitPrice: 2 });
    const mesa2Ticket = draftOf(MESA_2);

    const group = await app.inject({
      method: "POST",
      url: `/tables/${MESA_1}/group`,
      headers: auth(),
      payload: { tablesToAbsorbIds: [MESA_2] },
    });
    expect(group.statusCode).toBe(200);
    const mainTicket = draftOf(MESA_1);
    expect(linesOf(mainTicket.id)).toHaveLength(2);
    expect(state.tickets.get(mesa2Ticket.id)!.status).toBe("VOIDED");

    const ungroup = await app.inject({
      method: "POST",
      url: `/tables/${MESA_1}/ungroup`,
      headers: auth(),
    });
    expect(ungroup.statusCode).toBe(200);
    // Mesa 2 recupera un DRAFT nuevo con su línea original.
    const restored = draftOf(MESA_2);
    expect(restored.id).not.toBe(mesa2Ticket.id);
    const restoredLines = linesOf(restored.id);
    expect(restoredLines).toHaveLength(1);
    expect(restoredLines[0]!.sku).toBe("CANA");
    expect(restoredLines[0]!.originalTableId).toBeNull();
    expect(Number(restored.total)).toBeCloseTo(2.2, 2);
    // El principal se queda sólo con lo suyo.
    expect(linesOf(mainTicket.id)).toHaveLength(1);
    expect(Number(mainTicket.total)).toBeCloseTo(1.65, 2);
  });

  it("mover línea con modifiers de pago conserva el delta en los totales (bug Lote 1)", async () => {
    const app = await buildApp();
    // Café con leche de avena (+0,30) vía selección estructurada.
    const add = await addLine(app, MESA_1, {
      ...CAFE,
      modifierSelections: [{ groupId: GROUP_AVENA, modifierId: MOD_AVENA }],
    });
    expect(add.statusCode).toBe(201);
    const mesa1Draft = draftOf(MESA_1);
    // (1.50 + 0.30) · 1.10 = 1.98
    expect(Number(mesa1Draft.total)).toBeCloseTo(1.98, 2);

    const line = linesOf(mesa1Draft.id)[0]!;
    const move = await app.inject({
      method: "POST",
      url: `/tickets/${mesa1Draft.id}/lines/move`,
      headers: auth(),
      payload: { lineIds: [line.id], destinationTableId: MESA_2 },
    });
    expect(move.statusCode).toBe(200);
    // ANTES del fix el recálculo de grouping ignoraba el delta y el
    // destino quedaba en 1.65 — cobro inferior a lo servido.
    expect(Number(draftOf(MESA_2).total)).toBeCloseTo(1.98, 2);
    expect(Number(mesa1Draft.total)).toBeCloseTo(0, 2);
  });
});

describe("E2E mesas · agrupaciones defensivas", () => {
  it("agrupar una mesa que ya pertenece a otro grupo → 409 TABLE_ALREADY_GROUPED", async () => {
    const app = await buildApp();
    await addLine(app, MESA_2, CAFE);
    // Mesa 2 absorbida por Mesa 1.
    await app.inject({
      method: "POST",
      url: `/tables/${MESA_1}/group`,
      headers: auth(),
      payload: { tablesToAbsorbIds: [MESA_2] },
    });
    // Mesa 3 intenta absorber a Mesa 2 (con su ticket ya en el grupo
    // de Mesa 1) → 409.
    const res = await app.inject({
      method: "POST",
      url: `/tables/${MESA_3}/group`,
      headers: auth(),
      payload: { tablesToAbsorbIds: [MESA_2] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("TABLE_ALREADY_GROUPED");
  });

  it("usar como principal una mesa absorbida (grupo anidado) → 409 (fix Lote 1)", async () => {
    const app = await buildApp();
    await addLine(app, MESA_2, CAFE);
    await app.inject({
      method: "POST",
      url: `/tables/${MESA_1}/group`,
      headers: auth(),
      payload: { tablesToAbsorbIds: [MESA_2] },
    });
    // Mesa 2 (absorbida) como principal de Mesa 3 → grupo anidado que
    // el ungroup de Mesa 1 no sabría revertir. Antes del fix pasaba.
    const res = await app.inject({
      method: "POST",
      url: `/tables/${MESA_2}/group`,
      headers: auth(),
      payload: { tablesToAbsorbIds: [MESA_3] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("TABLE_ALREADY_GROUPED");
  });

  it("operativa directa sobre mesa absorbida → 409 TABLE_GROUPED (fix Lote 1)", async () => {
    const app = await buildApp();
    await addLine(app, MESA_2, CAFE);
    await app.inject({
      method: "POST",
      url: `/tables/${MESA_1}/group`,
      headers: auth(),
      payload: { tablesToAbsorbIds: [MESA_2] },
    });

    // Abrir la mesa absorbida → 409 (antes creaba un DRAFT fantasma
    // que tras el ungroup duplicaba la mesa en el mapa).
    const open = await openTable(app, MESA_2);
    expect(open.statusCode).toBe(409);
    expect(open.json().error).toBe("TABLE_GROUPED");

    // Añadir línea directa → mismo 409.
    const add = await addLine(app, MESA_2, CAFE);
    expect(add.statusCode).toBe(409);
    expect(add.json().error).toBe("TABLE_GROUPED");

    // Mover un ticket DRAFT a la mesa absorbida → 409.
    await addLine(app, MESA_3, CAFE);
    const move = await app.inject({
      method: "POST",
      url: `/tickets/${draftOf(MESA_3).id}/move-to-table`,
      headers: auth(),
      payload: { newTableId: MESA_2 },
    });
    expect(move.statusCode).toBe(409);
    expect(move.json().error).toBe("TABLE_GROUPED");

    // Mover líneas sueltas a la mesa absorbida → 409.
    const line3 = linesOf(draftOf(MESA_3).id)[0]!;
    const linesMove = await app.inject({
      method: "POST",
      url: `/tickets/${draftOf(MESA_3).id}/lines/move`,
      headers: auth(),
      payload: { lineIds: [line3.id], destinationTableId: MESA_2 },
    });
    expect(linesMove.statusCode).toBe(409);
    expect(linesMove.json().error).toBe("TABLE_GROUPED");
  });

  it("checkout del ticket principal libera las mesas absorbidas", async () => {
    const app = await buildApp();
    await addLine(app, MESA_1, CAFE);
    await addLine(app, MESA_2, CAFE);
    await app.inject({
      method: "POST",
      url: `/tables/${MESA_1}/group`,
      headers: auth(),
      payload: { tablesToAbsorbIds: [MESA_2] },
    });
    const main = draftOf(MESA_1);
    const res = await checkout(app, main.id, [{ method: "CASH", amount: 3.3 }]);
    expect(res.statusCode).toBe(200);
    expect(state.tables.get(MESA_2)!.groupedIntoTableId).toBeNull();
  });
});

describe("E2E mesas · doble cobro y doble caja", () => {
  it("un DRAFT no es cobrable dos veces: el segundo checkout → 409", async () => {
    const app = await buildApp();
    await addLine(app, MESA_1, CAFE);
    const draft = draftOf(MESA_1);

    const first = await checkout(app, draft.id, [{ method: "CASH", amount: 1.65 }]);
    expect(first.statusCode).toBe(200);
    expect(draft.internalNumber).toBe("000001");

    const second = await checkout(app, draft.id, [{ method: "CASH", amount: 1.65 }]);
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("TICKET_ALREADY_PAID");
    // El contador fiscal no se quemó dos veces.
    expect(state.registers.get(REGISTER_A)!.ticketCounter).toBe(1);
    expect(state.payments.get(draft.id)).toHaveLength(1);
  });

  it("carrera de dos cajas: el claim dentro de la tx corta el segundo cobro sin quemar serie (fix Lote 1)", async () => {
    const app = await buildApp();
    await addLine(app, MESA_1, CAFE);
    const draft = draftOf(MESA_1);

    const first = await checkout(app, draft.id, [{ method: "CASH", amount: 1.65 }]);
    expect(first.statusCode).toBe(200);

    // Simula el interleaving: el pre-check del segundo checkout lee un
    // snapshot stale donde el ticket aún era DRAFT (las dos cajas
    // pulsaron Cobrar a la vez). El claim updateMany de la tx debe
    // devolver count=0 y abortar con 409.
    state.staleStatusOnce = "DRAFT";
    const second = await checkout(app, draft.id, [{ method: "CASH", amount: 1.65 }]);
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("TICKET_ALREADY_PAID");
    expect(state.registers.get(REGISTER_A)!.ticketCounter).toBe(1);
    expect(draft.internalNumber).toBe("000001");
  });

  it("dos cajas sobre la misma mesa: añadir colabora, editar/cobrar exige la caja propietaria", async () => {
    const app = await buildApp();
    // Caja 1 abre la mesa y añade un café.
    await addLine(app, MESA_1, CAFE);
    const draft = draftOf(MESA_1);
    expect(draft.registerId).toBe(REGISTER_A);

    // Caja 2 añade una caña a la MISMA mesa → colaborativo, 201, y el
    // ticket sigue siendo de la caja 1 (last-writer-wins en líneas).
    const addB = await addLine(
      app,
      MESA_1,
      { ...CAFE, nameSnapshot: "Caña", sku: "CANA", unitPrice: 2 },
      "B",
    );
    expect(addB.statusCode).toBe(201);
    expect(linesOf(draft.id)).toHaveLength(2);
    expect(draft.registerId).toBe(REGISTER_A);

    // Caja 2 intenta editar una línea → 403 REGISTER_MISMATCH.
    const line = linesOf(draft.id)[0]!;
    const patchB = await app.inject({
      method: "PATCH",
      url: `/tickets/${draft.id}/lines/${line.id}`,
      headers: auth("B"),
      payload: { units: 5 },
    });
    expect(patchB.statusCode).toBe(403);
    expect(patchB.json().error).toBe("REGISTER_MISMATCH");

    // Caja 2 intenta cobrar → 403 REGISTER_MISMATCH.
    const payB = await checkout(app, draft.id, [{ method: "CASH", amount: 3.85 }], "B");
    expect(payB.statusCode).toBe(403);
    expect(payB.json().error).toBe("REGISTER_MISMATCH");

    // Caja 1 edita la misma línea después (último escritor gana).
    const patchA = await app.inject({
      method: "PATCH",
      url: `/tickets/${draft.id}/lines/${line.id}`,
      headers: auth("A"),
      payload: { units: 2 },
    });
    expect(patchA.statusCode).toBe(200);
    expect(Number(state.lines.get(line.id)!.units)).toBe(2);
  });
});

describe("E2E mesas · estados y validaciones", () => {
  it("checkout de mesa sin líneas → 400 TICKET_EMPTY", async () => {
    const app = await buildApp();
    await openTable(app, MESA_1);
    const res = await checkout(app, draftOf(MESA_1).id, [{ method: "CASH", amount: 0 }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("TICKET_EMPTY");
  });

  it("pagos por debajo del total → 400 PAYMENTS_MISMATCH", async () => {
    const app = await buildApp();
    await addLine(app, MESA_1, CAFE);
    const res = await checkout(app, draftOf(MESA_1).id, [{ method: "CASH", amount: 1.0 }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("PAYMENTS_MISMATCH");
  });

  it("vaciar mesa → DRAFT VOIDED + table.cleared y la mesa admite reapertura", async () => {
    const app = await buildApp();
    await addLine(app, MESA_1, CAFE);
    const draft = draftOf(MESA_1);
    const res = await app.inject({
      method: "DELETE",
      url: `/tickets/${draft.id}?reason=Cliente se fue`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(204);
    expect(state.tickets.get(draft.id)!.status).toBe("VOIDED");
    expect(broadcasts.at(-1)?.event.type).toBe("table.cleared");

    // Reapertura limpia: nuevo DRAFT distinto.
    const reopen = await openTable(app, MESA_1);
    expect(reopen.statusCode).toBe(201);
    expect(draftOf(MESA_1).id).not.toBe(draft.id);
  });

  it("mover ticket a mesa ocupada → 409 DESTINATION_OCCUPIED con el ticket ocupante", async () => {
    const app = await buildApp();
    await addLine(app, MESA_1, CAFE);
    await addLine(app, MESA_2, CAFE);
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${draftOf(MESA_1).id}/move-to-table`,
      headers: auth(),
      payload: { newTableId: MESA_2 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("DESTINATION_OCCUPIED");
    expect(res.json().occupiedByTicketId).toBe(draftOf(MESA_2).id);
  });

  it("operativa sin turno abierto → 409 SHIFT_NOT_OPEN", async () => {
    const app = await buildApp();
    state.shifts = [];
    const res = await openTable(app, MESA_1);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("SHIFT_NOT_OPEN");
  });
});
