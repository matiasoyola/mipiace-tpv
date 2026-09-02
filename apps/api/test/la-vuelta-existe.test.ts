// v1.15-la-vuelta-existe · el bloque entero visto desde el servidor.
//
// El caso canónico es el de la auditoría del 2026-09-02 (hallazgo B1):
// un turno con dos tickets, 4,70 € y 3,00 €, el segundo pagado con un
// billete de 5. Ventas 7,70 €, efectivo esperado 5,00 €, descuadre
// 0,00 €. Antes de este bloque el Z decía 9,70 € / 7,00 € / −2,00 €.
//
// La cadena que se prueba aquí va del payload del TPV al arqueo, sin
// tocar `z-breakdown.ts`: los pagos que persisten las rutas se agrupan
// igual que hace `shift/breakdown-sums.ts` (Σ `TicketPayment.amount` por
// método) y se meten en `computeZBreakdown` tal cual. Si el origen
// vuelve a guardar lo entregado, el Z vuelve a mentir y estos tests se
// ponen rojos.
//
// Prisma falso, mismo patrón que `tickets-route.test.ts` y
// `checkout-idempotency.test.ts`, extendido para cubrir las DOS puertas
// de entrada: venta rápida (`POST /tickets`) y cobro de mesa
// (`POST /tickets/:id/checkout`).

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeZBreakdown } from "../src/shift/z-breakdown.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const STORE = "00000000-0000-0000-0000-000000000002";
const REGISTER = "00000000-0000-0000-0000-000000000003";
const DEVICE = "00000000-0000-0000-0000-000000000004";
const CASHIER = "00000000-0000-0000-0000-000000000005";
const SHIFT = "00000000-0000-0000-0000-000000000006";
const MESA = "00000000-0000-0000-0000-0000000000a1";

interface StoredPayment {
  id: string;
  method: string;
  amount: number;
}

interface StoredTicket {
  id: string;
  tenantId: string;
  registerId: string;
  shiftId: string;
  userId: string;
  externalId: string;
  checkoutExternalId: string | null;
  internalNumber: string;
  publicSlug: string;
  status: string;
  tableId: string | null;
  diners: number | null;
  total: number;
  totalTax: number;
  totalDiscount: number;
  cashAmount: number | null;
  notes: string | null;
  contactHoldedId: string | null;
  printIntent: boolean;
  emailIntent: string | null;
  giftReceiptIntentAt: Date | null;
  discountAuthorizedBy: string | null;
  attendedBy: string | null;
  creditPending: number | null;
  holdedDocumentId: string | null;
  holdedDocNumber: string | null;
  holdedPdfUrl: string | null;
  syncError: unknown;
  createdAt: Date;
  paidAt: Date | null;
  syncedAt: Date | null;
}

const state = {
  tickets: new Map<string, StoredTicket>(),
  byExternalId: new Map<string, string>(),
  lines: [] as Array<Record<string, unknown> & { id: string; ticketId: string }>,
  payments: new Map<string, StoredPayment[]>(),
  ticketCounter: 0,
};

// Decimal-ish: las rutas envuelven los números en `new Prisma.Decimal`.
function dec(v: unknown): number {
  if (v == null) return 0;
  return Number((v as { toString(): string }).toString());
}

function decOrNull(v: unknown): number | null {
  return v == null ? null : dec(v);
}

function linesOf(ticketId: string) {
  return state.lines.filter((l) => l.ticketId === ticketId);
}

function materialize(t: StoredTicket, rel?: Record<string, unknown>) {
  const out: Record<string, unknown> = {
    ...t,
    total: { toString: () => String(t.total) },
    totalTax: { toString: () => String(t.totalTax) },
    totalDiscount: { toString: () => String(t.totalDiscount) },
    cashAmount:
      t.cashAmount == null ? null : { toString: () => String(t.cashAmount) },
  };
  if (!rel) return out;
  if (rel.lines) {
    out.lines = linesOf(t.id).map((l) => ({
      ...l,
      units: { toString: () => String(l.units) },
      unitPrice: { toString: () => String(l.unitPrice) },
      discountPct: { toString: () => String(l.discountPct) },
      taxRate: { toString: () => String(l.taxRate) },
      subtotal: { toString: () => String(l.subtotal) },
      total: { toString: () => String(l.total) },
    }));
  }
  if (rel.table) out.table = null;
  if (rel.payments) {
    out.payments = (state.payments.get(t.id) ?? []).map((p) => ({
      ...p,
      amount: { toString: () => String(p.amount) },
      meta: null,
    }));
  }
  if (rel.partialPayments) out.partialPayments = [];
  if (rel.refunds) out.refunds = [];
  if (rel.register) {
    out.register = {
      id: REGISTER,
      name: "Caja 1",
      storeId: STORE,
      store: { name: "Cafetería Sirope" },
    };
  }
  return out;
}

function applyPaymentsNested(ticketId: string, nested: unknown): void {
  const n = nested as {
    deleteMany?: object;
    create?: Array<{ method: string; amount: unknown }>;
  };
  if (n.deleteMany) state.payments.set(ticketId, []);
  if (n.create) {
    const arr = state.payments.get(ticketId) ?? [];
    for (const p of n.create) {
      arr.push({ id: randomUUID(), method: p.method, amount: dec(p.amount) });
    }
    state.payments.set(ticketId, arr);
  }
}

function applyUpdate(t: StoredTicket, data: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(data)) {
    if (k === "payments") {
      applyPaymentsNested(t.id, v);
      continue;
    }
    if (k === "total" || k === "totalTax" || k === "totalDiscount") {
      (t as unknown as Record<string, unknown>)[k] = dec(v);
      continue;
    }
    if (k === "cashAmount") {
      t.cashAmount = decOrNull(v);
      continue;
    }
    (t as unknown as Record<string, unknown>)[k] = v;
  }
}

const fakePrisma: Record<string, unknown> = {
  ticket: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.externalId) {
        const id = state.byExternalId.get(where.externalId);
        return id ? materialize(state.tickets.get(id)!) : null;
      }
      return null;
    }),
    findFirst: vi.fn(async ({ where, include, select }: any) => {
      const t = where.id ? state.tickets.get(where.id) : undefined;
      if (!t) return null;
      if (where.tenantId && t.tenantId !== where.tenantId) return null;
      return materialize(t, include ?? select);
    }),
    create: vi.fn(async ({ data, include }: any) => {
      const id = randomUUID();
      const t: StoredTicket = {
        id,
        tenantId: data.tenantId ?? TENANT,
        registerId: REGISTER,
        shiftId: SHIFT,
        userId: CASHIER,
        externalId: data.externalId,
        checkoutExternalId: null,
        internalNumber: data.internalNumber,
        publicSlug: data.publicSlug,
        status: data.status,
        tableId: null,
        diners: null,
        total: dec(data.total),
        totalTax: dec(data.totalTax),
        totalDiscount: dec(data.totalDiscount),
        cashAmount: decOrNull(data.cashAmount),
        notes: data.notes ?? null,
        contactHoldedId: data.contactHoldedId ?? null,
        printIntent: data.printIntent ?? true,
        emailIntent: data.emailIntent ?? null,
        giftReceiptIntentAt: data.giftReceiptIntentAt ?? null,
        discountAuthorizedBy: data.discountAuthorizedBy ?? null,
        attendedBy: data.attendedBy ?? null,
        creditPending: decOrNull(data.creditPending),
        holdedDocumentId: null,
        holdedDocNumber: null,
        holdedPdfUrl: null,
        syncError: null,
        createdAt: new Date(),
        paidAt: data.paidAt ?? new Date(),
        syncedAt: null,
      };
      state.tickets.set(id, t);
      state.byExternalId.set(t.externalId, id);
      for (const l of data.lines?.create ?? []) {
        state.lines.push({
          id: randomUUID(),
          ticketId: id,
          ...l,
          units: dec(l.units),
          unitPrice: dec(l.unitPrice),
          discountPct: dec(l.discountPct),
          taxRate: dec(l.taxRate),
          subtotal: dec(l.subtotal),
          total: dec(l.total),
        });
      }
      applyPaymentsNested(id, data.payments);
      return materialize(t, include);
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
    findUnique: vi.fn(async () => ({ storeId: STORE })),
  },
  shift: {
    findFirst: vi.fn(async ({ where }: any) =>
      where.id === SHIFT ? { id: SHIFT } : null,
    ),
    update: vi.fn(async () => ({})),
  },
  user: {
    findUnique: vi.fn(async () => ({ email: "caja1@sirope.es" })),
    findUniqueOrThrow: vi.fn(async () => ({ email: "caja1@sirope.es" })),
    findFirst: vi.fn(async () => null),
  },
  tenant: {
    findUniqueOrThrow: vi.fn(async () => ({ discountThresholdPct: 10 })),
  },
  holdedUpload: { upsert: vi.fn(async () => ({})) },
  ticketEmailJob: { create: vi.fn(async () => ({ id: randomUUID() })) },
  table: { updateMany: vi.fn(async () => ({ count: 0 })) },
  $transaction: vi.fn(async (fn: any) =>
    typeof fn === "function" ? fn(fakePrisma) : Promise.all(fn),
  ),
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
  const app = Fastify({ logger: false });
  await registerTicketRoutes(app);
  return app;
}

// Café con leche 1,20 € brutos al 10% → línea de 1,20; el total del
// ticket sale de `computeTicket`, no de aquí.
function line(name: string, unitPriceGross: number, taxRate = 10) {
  const net = Math.round((unitPriceGross / (1 + taxRate / 100)) * 10000) / 10000;
  return {
    nameSnapshot: name,
    sku: name.toUpperCase().replace(/\s+/g, "-"),
    units: 1,
    unitPrice: net,
    discountPct: 0,
    taxRate,
  };
}

async function quickSale(
  app: Awaited<ReturnType<typeof buildApp>>,
  lines: ReturnType<typeof line>[],
  payments: Array<{ method: string; amount: number }>,
  cashAmount?: number,
) {
  return app.inject({
    method: "POST",
    url: "/tickets",
    headers: auth(),
    payload: {
      externalId: randomUUID(),
      registerId: REGISTER,
      shiftId: SHIFT,
      lines,
      payments,
      ...(cashAmount != null ? { cashAmount } : {}),
    },
  });
}

function seedDraft(total: number, totalTax: number): StoredTicket {
  const id = randomUUID();
  const t: StoredTicket = {
    id,
    tenantId: TENANT,
    registerId: REGISTER,
    shiftId: SHIFT,
    userId: CASHIER,
    externalId: randomUUID(),
    checkoutExternalId: null,
    internalNumber: `D-${id.slice(0, 8)}`,
    publicSlug: id.slice(0, 16),
    status: "DRAFT",
    tableId: MESA,
    diners: 2,
    total,
    totalTax,
    totalDiscount: 0,
    cashAmount: null,
    notes: null,
    contactHoldedId: null,
    printIntent: true,
    emailIntent: null,
    giftReceiptIntentAt: null,
    discountAuthorizedBy: null,
    attendedBy: null,
    creditPending: null,
    holdedDocumentId: null,
    holdedDocNumber: null,
    holdedPdfUrl: null,
    syncError: null,
    createdAt: new Date(),
    paidAt: null,
    syncedAt: null,
  };
  state.tickets.set(id, t);
  return t;
}

/** Lo que hace `shift/breakdown-sums.ts`: Σ amount por método. */
function paymentsByMethod(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const rows of state.payments.values()) {
    for (const p of rows) {
      out[p.method] = Math.round(((out[p.method] ?? 0) + p.amount) * 100) / 100;
    }
  }
  return out;
}

function paymentsOf(ticketId: string): StoredPayment[] {
  return state.payments.get(ticketId) ?? [];
}

function lastTicket(): StoredTicket {
  return [...state.tickets.values()].pop()!;
}

beforeEach(() => {
  state.tickets.clear();
  state.byExternalId.clear();
  state.lines = [];
  state.payments.clear();
  state.ticketCounter = 0;
});

describe("v1.15 §1 · payments[].amount es lo aplicado, nunca lo entregado", () => {
  it("venta rápida: 3,00 € con un billete de 5 persiste 3,00 y guarda 5,00 en cashAmount", async () => {
    const app = await buildApp();
    const res = await quickSale(
      app,
      [line("Cafe con leche", 1.2), line("Tostada", 1.8)],
      [{ method: "CASH", amount: 5 }],
      5,
    );
    expect(res.statusCode).toBe(201);
    const t = lastTicket();
    expect(t.total).toBeCloseTo(3, 2);
    expect(paymentsOf(t.id)).toEqual([
      expect.objectContaining({ method: "CASH", amount: 3 }),
    ]);
    expect(t.cashAmount).toBe(5);
  });

  it("cobro de mesa: el checkout entra por la misma puerta", async () => {
    const app = await buildApp();
    const draft = seedDraft(3, 0.27);
    state.lines.push({
      id: randomUUID(),
      ticketId: draft.id,
      productId: null,
      variantId: null,
      holdedProductId: null,
      sku: "MENU",
      nameSnapshot: "Menú",
      units: 1,
      unitPrice: 2.7273,
      discountPct: 0,
      taxRate: 10,
      subtotal: 2.73,
      total: 3,
      modifiers: null,
      originalTableId: null,
    });
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${draft.id}/checkout`,
      headers: auth(),
      payload: {
        externalId: randomUUID(),
        payments: [{ method: "CASH", amount: 5 }],
        cashAmount: 5,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(paymentsOf(draft.id)).toEqual([
      expect.objectContaining({ method: "CASH", amount: 3 }),
    ]);
    expect(state.tickets.get(draft.id)!.cashAmount).toBe(5);
  });

  it("mixto: el exceso lo absorbe el efectivo y la tarjeta se persiste íntegra", async () => {
    const app = await buildApp();
    // 4,70 € cobrados con 2,70 de tarjeta y un billete de 5.
    const res = await quickSale(
      app,
      [line("Desayuno", 4.7)],
      [
        { method: "CASH", amount: 5 },
        { method: "CARD", amount: 2.7 },
      ],
      5,
    );
    expect(res.statusCode).toBe(201);
    const rows = paymentsOf(lastTicket().id);
    expect(rows.map((p) => [p.method, p.amount])).toEqual([
      ["CASH", 2],
      ["CARD", 2.7],
    ]);
    expect(rows.reduce((a, p) => a + p.amount, 0)).toBeCloseTo(4.7, 2);
  });

  it("cliente viejo que manda el billete SIN cashAmount: se deriva y no se pierde la vuelta", async () => {
    // Es el ticket que sube un APK 1.14.1 desde su outbox después de
    // que la API se actualice. Se normaliza en vez de rechazarse: la
    // venta ya ocurrió físicamente.
    const app = await buildApp();
    const res = await quickSale(app, [line("Cafe", 3)], [
      { method: "CASH", amount: 5 },
    ]);
    expect(res.statusCode).toBe(201);
    const t = lastTicket();
    expect(paymentsOf(t.id)[0]!.amount).toBe(3);
    expect(t.cashAmount).toBe(5);
  });

  it("no se persiste un pago mayor que su parte del total: exceso en tarjeta → 400", async () => {
    const app = await buildApp();
    const res = await quickSale(
      app,
      [line("Desayuno", 4.7)],
      [{ method: "CARD", amount: 6 }],
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("PAYMENT_EXCEEDS_TOTAL");
    expect(state.tickets.size).toBe(0);
  });

  it("la tolerancia de un céntimo sigue entrando", async () => {
    const app = await buildApp();
    const res = await quickSale(
      app,
      [line("Desayuno", 4.7)],
      [{ method: "CARD", amount: 4.71 }],
    );
    expect(res.statusCode).toBe(201);
  });
});

describe("v1.15 · el turno de la auditoría cuadra", () => {
  // Los dos tickets del AP11 del 2026-09-02:
  //   #000019 = 4,70 € cobrado MIXTO (2,00 en efectivo + 2,70 en tarjeta,
  //             que es el reparto que describe el hallazgo C2), y
  //   #000020 = 3,00 € pagado con un billete de 5.
  //
  // De ahí salen los cuatro números del Z que reportó la auditoría:
  //   ventas 9,70 € (real 7,70) y efectivo 7,00 € (real 5,00).
  async function seedAuditShift() {
    const app = await buildApp();
    await quickSale(
      app,
      [line("Desayuno 1", 4.7)],
      [
        { method: "CASH", amount: 2 },
        { method: "CARD", amount: 2.7 },
      ],
      2,
    );
    await quickSale(app, [line("Desayuno 4", 3)], [
      { method: "CASH", amount: 5 },
    ], 5);
  }

  it("ventas del día = Σ totales de ticket, no Σ de lo entregado", async () => {
    await seedAuditShift();
    const z = computeZBreakdown({
      cashOpening: 50,
      paymentsByMethod: paymentsByMethod(),
      refundsByMethod: {},
    });
    // Antes de v1.15: 9,70 €.
    expect(z.grossSales).toBe(7.7);
    const totals = [...state.tickets.values()].reduce((a, t) => a + t.total, 0);
    expect(z.grossSales).toBeCloseTo(totals, 2);
  });

  it("efectivo esperado en el cajón = ventas en efectivo, no lo entregado", async () => {
    await seedAuditShift();
    const z = computeZBreakdown({
      cashOpening: 50,
      paymentsByMethod: paymentsByMethod(),
      refundsByMethod: {},
    });
    // Antes de v1.15: 7,00 € de ventas CASH (2,00 + el billete de 5) y
    // 57,00 € de efectivo esperado en el cajón.
    expect(z.methods.find((m) => m.method === "CASH")!.net).toBe(5);
    expect(z.methods.find((m) => m.method === "CARD")!.net).toBe(2.7);
    expect(z.cashTheoretical).toBe(55);
  });

  it("con el cajón contado de verdad, el descuadre es 0,00 €", async () => {
    await seedAuditShift();
    // El cajero cuenta el fondo (50) más lo que hay en el cajón: los
    // 2,00 en efectivo del primer ticket y los 3,00 del segundo — la
    // vuelta de 2,00 salió del cajón y no está, y los 2,70 de tarjeta
    // nunca entraron.
    const counted = 50 + 2 + 3;
    const z = computeZBreakdown({
      cashOpening: 50,
      paymentsByMethod: paymentsByMethod(),
      refundsByMethod: {},
      counted: { CASH: counted },
    });
    // Antes de v1.15 esto daba −2,00 € con el cajón perfectamente
    // cuadrado, y el faltante se le apuntaba a quien estuviera en barra.
    expect(counted - z.cashTheoretical).toBeCloseTo(0, 2);
  });
});
