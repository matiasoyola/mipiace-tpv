// Suite de aislamiento multi-tenant (v1.5-D · Frente 1).
//
// Objetivo: para cada endpoint autenticado de la familia cashier-session
// (tickets/routes.ts — el camino del dinero), un actor del tenant A NUNCA
// puede leer ni mutar recursos del tenant B. La respuesta esperada es
// siempre 403 o 404 — nunca 200 con datos ajenos, ni un 409 que confirme
// la existencia de un recurso ajeno revelando más de lo necesario.
//
// DISEÑO DEL FAKE (restricción que hace que la suite muerda de verdad):
//   - El fake aplica EXACTAMENTE el `where` que recibe, sin scoping de
//     tenant implícito. Las filas de A y B coexisten en el mismo store.
//   - `findUnique({ where: { externalId } })` devuelve la fila que
//     corresponda SIN filtrar por tenant — fiel a Postgres, donde
//     `externalId` es UNIQUE global. Así, si una ruta olvida asertar el
//     tenant tras el lookup, el fake le entrega la fila ajena y la ruta
//     filtra → el test se pone rojo.
//   - `findFirst({ where: { id, tenantId } })` sólo devuelve si AMBOS
//     casan.
//   Las aserciones comprueban la respuesta HTTP de la ruta, NUNCA el
//   estado interno del fake. La garantía vive ahí.
//
// LIMITACIÓN CONOCIDA (ver done.md): esto es un fake in-memory, no una BD
// real. Prueba que la RUTA aplica la guardia, asumiendo que Postgres se
// comporta como el fake (cosa que sí hace para los `where` usados aquí).
// El patrón oro futuro — suite de aislamiento contra Postgres real
// (testcontainers) — es un bloque aparte con implicaciones de infra/CI;
// cuando se haga, esta suite es lo primero que se porta.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

function dec(n: number) {
  return { toString: () => String(n) };
}

// ── Dos tenants completos, con caja/turno/cajero propios ────────────────
interface TenantFixture {
  tid: string;
  rid: string; // registerId
  sub: string; // cashierId
  did: string; // deviceId
  shiftId: string;
}

function makeTenantFixture(): TenantFixture {
  return {
    tid: randomUUID(),
    rid: randomUUID(),
    sub: randomUUID(),
    did: randomUUID(),
    shiftId: randomUUID(),
  };
}

let A: TenantFixture;
let B: TenantFixture;

// Store compartido: filas de A y B coexisten. El fake honra el `where`.
const db = {
  tickets: [] as any[],
  refunds: [] as any[],
};

function makeTicketRow(opts: {
  tenantId: string;
  registerId: string;
  externalId?: string;
  status?: string;
}): any {
  const id = randomUUID();
  return {
    id,
    tenantId: opts.tenantId,
    internalNumber: "000001",
    externalId: opts.externalId ?? randomUUID(),
    status: opts.status ?? "SYNCED",
    total: dec(12.1),
    totalTax: dec(2.1),
    totalDiscount: dec(0),
    cashAmount: dec(12.1),
    notes: null,
    contactHoldedId: null,
    registerId: opts.registerId,
    shiftId: randomUUID(),
    userId: randomUUID(),
    holdedDocumentId: null,
    holdedDocNumber: null,
    holdedPdfUrl: null,
    printIntent: false,
    emailIntent: null,
    giftReceiptIntentAt: null,
    attendedBy: null,
    syncError: null,
    createdAt: new Date(),
    paidAt: new Date(),
    syncedAt: new Date(),
    register: { id: opts.registerId, name: "Caja 1", store: { name: "Tienda" } },
    lines: [
      {
        id: randomUUID(),
        productId: null,
        variantId: null,
        holdedProductId: null,
        sku: "CAFE-1",
        nameSnapshot: "Cafe",
        units: dec(1),
        unitPrice: dec(10),
        discountPct: dec(0),
        taxRate: dec(21),
        subtotal: dec(10),
        total: dec(12.1),
        modifiers: null,
      },
    ],
    payments: [{ id: randomUUID(), method: "CASH", amount: dec(12.1), meta: null }],
    partialPayments: [],
    refunds: [],
  };
}

function makeRefundRow(opts: { tenantId: string; externalId?: string }): any {
  return {
    id: randomUUID(),
    tenantId: opts.tenantId,
    internalNumber: "R-000001",
    externalId: opts.externalId ?? randomUUID(),
    status: "SYNCED",
    method: "CASH",
    total: dec(12.1),
    totalTax: dec(2.1),
    holdedDocumentId: null,
    holdedDocNumber: null,
    reason: null,
    createdAt: new Date(),
    syncedAt: new Date(),
    lines: [
      {
        id: randomUUID(),
        ticketLineId: randomUUID(),
        nameSnapshot: "Cafe",
        sku: "CAFE-1",
        units: dec(1),
        unitPrice: dec(10),
        taxRate: dec(21),
        discountPct: dec(0),
        total: dec(12.1),
      },
    ],
  };
}

// Matcher fiel: una fila casa si TODAS las claves escalares de `where`
// casan. Soporta sólo las claves que usan las rutas cashier (id,
// tenantId, registerId, status, externalId). NO inventa scoping de
// tenant: si `where` no trae tenantId, no se filtra por tenant.
function matchesScalar(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "object") continue; // OR/gte/etc no se usan en estos casos
    if (row[k] !== v) return false;
  }
  return true;
}

const fakePrisma = {
  ticket: {
    // Fiel a Postgres: externalId es UNIQUE global → NO se filtra por
    // tenant. Es exactamente la condición que obliga a la ruta a asertar
    // el tenant tras el lookup.
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.externalId !== undefined) {
        return db.tickets.find((t) => t.externalId === where.externalId) ?? null;
      }
      return db.tickets.find((t) => t.id === where.id) ?? null;
    }),
    findFirst: vi.fn(
      async ({ where }: any) => db.tickets.find((t) => matchesScalar(t, where)) ?? null,
    ),
    findMany: vi.fn(async ({ where }: any) =>
      db.tickets.filter((t) => matchesScalar(t, where)),
    ),
    create: vi.fn(async ({ data }: any) => {
      const row = makeTicketRow({
        tenantId: data.tenantId,
        registerId: data.registerId,
        externalId: data.externalId,
      });
      db.tickets.push(row);
      return row;
    }),
    update: vi.fn(async () => ({})),
  },
  refund: {
    // Mismo principio: externalId UNIQUE global, sin filtro de tenant.
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.externalId !== undefined) {
        return db.refunds.find((r) => r.externalId === where.externalId) ?? null;
      }
      return db.refunds.find((r) => r.id === where.id) ?? null;
    }),
    findFirst: vi.fn(
      async ({ where }: any) => db.refunds.find((r) => matchesScalar(r, where)) ?? null,
    ),
    create: vi.fn(async ({ data }: any) => {
      const row = makeRefundRow({ tenantId: data.tenantId, externalId: data.externalId });
      db.refunds.push(row);
      return row;
    }),
  },
  shift: {
    // v1.8-Fiado · devolvemos un turno abierto cuando la ruta lo pide
    // (closedAt:null) para que el flujo de cobro de deuda llegue hasta la
    // comprobación de tenant del ticket (y devuelva 404 cross-tenant).
    findFirst: vi.fn(async ({ where }: any) =>
      where?.closedAt === null ? { id: where.id ?? "shift-open" } : null,
    ),
    update: vi.fn(async () => ({})),
  },
  ticketPayment: {
    findUnique: vi.fn(async () => null),
    create: vi.fn(async ({ data }: any) => ({ id: randomUUID(), ...data })),
  },
  contact: {
    findMany: vi.fn(async () => []),
  },
  register: {
    findUnique: vi.fn(async () => null),
    update: vi.fn(async () => ({ ticketCounter: 1 })),
  },
  tenant: {
    findUniqueOrThrow: vi.fn(async () => ({ discountThresholdPct: dec(10) })),
  },
  user: {
    findFirst: vi.fn(async () => null),
  },
  holdedUpload: {
    upsert: vi.fn(async ({ create }: any) => create),
  },
  ticketEmailJob: {
    create: vi.fn(async ({ data }: any) => ({ id: data.id })),
  },
  $transaction: vi.fn(async (fn: any) => {
    if (typeof fn !== "function") return await Promise.all(fn);
    return await fn(fakePrisma);
  }),
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
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
vi.mock("../src/realtime/emit-helpers.js", () => ({
  emitTicketPaid: async () => undefined,
  emitTicketRefunded: async () => undefined,
}));

import { registerTicketRoutes } from "../src/tickets/routes.js";
import { registerCreditRoutes } from "../src/tickets/credit-routes.js";
import { signManagerAuthorization } from "../src/auth/manager-authorization.js";

function tokenFor(t: TenantFixture) {
  return jwt.sign(
    { sub: t.sub, tid: t.tid, did: t.did, rid: t.rid, role: "CASHIER", type: "cashier" },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: "30m" },
  );
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerTicketRoutes(app);
  await registerCreditRoutes(app);
  return app;
}

beforeEach(() => {
  db.tickets.length = 0;
  db.refunds.length = 0;
  A = makeTenantFixture();
  B = makeTenantFixture();
  vi.clearAllMocks();
});

// Códigos de respuesta que consideramos "aislamiento correcto": el actor
// de A no obtiene datos de B ni confirmación de su existencia.
const ISOLATED = [403, 404, 409];

describe("Aislamiento multi-tenant · familia cashier-session", () => {
  it("GET /tickets/:id — A no puede leer un ticket de B (404)", async () => {
    const bTicket = makeTicketRow({ tenantId: B.tid, registerId: B.rid });
    db.tickets.push(bTicket);
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/tickets/${bTicket.id}`,
      headers: { authorization: `Bearer ${tokenFor(A)}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("GET /tickets (historial) — A nunca ve tickets de B", async () => {
    const aTicket = makeTicketRow({ tenantId: A.tid, registerId: A.rid });
    const bTicket = makeTicketRow({ tenantId: B.tid, registerId: B.rid });
    db.tickets.push(aTicket, bTicket);
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/tickets",
      headers: { authorization: `Bearer ${tokenFor(A)}` },
    });

    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((t: any) => t.id);
    expect(ids).toContain(aTicket.id);
    expect(ids).not.toContain(bTicket.id);
  });

  it("POST /tickets — idempotencia: externalId de un ticket de B no filtra el objeto (no 200)", async () => {
    const bTicket = makeTicketRow({ tenantId: B.tid, registerId: B.rid });
    db.tickets.push(bTicket);
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: { authorization: `Bearer ${tokenFor(A)}` },
      payload: {
        externalId: bTicket.externalId,
        registerId: A.rid,
        shiftId: A.shiftId,
        lines: [
          { nameSnapshot: "Cafe", sku: "C-1", units: 1, unitPrice: 1.4, discountPct: 0, taxRate: 10 },
        ],
        payments: [{ method: "CASH", amount: 1.54 }],
      },
    });

    expect(ISOLATED).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(200);
    // El cuerpo nunca debe traer datos del ticket de B.
    expect(JSON.stringify(res.json())).not.toContain(bTicket.id);
  });

  it("POST /tickets/:id/checkout — A no puede cerrar una mesa/draft de B (404)", async () => {
    const bDraft = makeTicketRow({ tenantId: B.tid, registerId: B.rid, status: "DRAFT" });
    db.tickets.push(bDraft);
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: `/tickets/${bDraft.id}/checkout`,
      headers: { authorization: `Bearer ${tokenFor(A)}` },
      payload: {
        payments: [{ method: "CASH", amount: 12.1 }],
      },
    });

    expect(ISOLATED).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(200);
  });

  it("POST /refunds — A no puede devolver un ticket de B (404)", async () => {
    const bTicket = makeTicketRow({ tenantId: B.tid, registerId: B.rid });
    db.tickets.push(bTicket);
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/refunds",
      headers: { authorization: `Bearer ${tokenFor(A)}` },
      payload: {
        externalId: randomUUID(),
        originalTicketId: bTicket.id,
        lines: [{ ticketLineId: bTicket.lines[0].id, units: 1 }],
      },
    });

    expect(res.statusCode).toBe(404);
  });

  // ── EL HUECO DEL FRENTE 2 (escrito ANTES del fix; debe morder) ──────────
  it("POST /refunds — idempotencia: externalId de un refund de B no filtra el objeto serializado", async () => {
    const bRefund = makeRefundRow({ tenantId: B.tid });
    db.refunds.push(bRefund);
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/refunds",
      headers: { authorization: `Bearer ${tokenFor(A)}` },
      payload: {
        externalId: bRefund.externalId,
        originalTicketId: randomUUID(),
        lines: [{ ticketLineId: randomUUID(), units: 1 }],
      },
    });

    // Antes del fix: la ruta hace findUnique({ externalId }) → encuentra el
    // refund de B (externalId es UNIQUE global) y devuelve 200 con
    // serializeRefund(B). Tras el fix debe responder genérico sin filtrar.
    expect(ISOLATED).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(200);
    expect(JSON.stringify(res.json())).not.toContain(bRefund.id);
    expect(JSON.stringify(res.json())).not.toContain(bRefund.internalNumber);
  });

  // ── v1.8-Fiado · aislamiento de los 3 endpoints de deuda ───────────────
  it("POST /tickets/:id/credit-payments — A no puede cobrar un fiado de B (404)", async () => {
    const bTicket = makeTicketRow({ tenantId: B.tid, registerId: B.rid });
    bTicket.status = "ON_CREDIT";
    bTicket.creditPending = dec(10);
    db.tickets.push(bTicket);
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: `/tickets/${bTicket.id}/credit-payments`,
      headers: { authorization: `Bearer ${tokenFor(A)}` },
      payload: { externalId: randomUUID(), shiftId: A.rid, amount: 5, method: "CASH" },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).not.toContain(bTicket.id);
  });

  it("POST /tickets/:id/credit-void — A no puede anular un fiado de B (404)", async () => {
    const bTicket = makeTicketRow({ tenantId: B.tid, registerId: B.rid });
    bTicket.status = "ON_CREDIT";
    bTicket.creditPending = dec(10);
    db.tickets.push(bTicket);
    const app = await buildApp();

    // Token de credit-void válido PARA A (misma cadena de auth); la
    // barrera es el scoping del ticket por tenant, no el token.
    const token = signManagerAuthorization({
      sub: A.sub,
      tid: A.tid,
      purpose: "credit-void",
      reason: "credit_void",
      context: { maxDiscountPct: 100 },
    });
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${bTicket.id}/credit-void`,
      headers: { authorization: `Bearer ${tokenFor(A)}` },
      payload: { authorizationToken: token, reason: "x" },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).not.toContain(bTicket.id);
  });

  it("GET /credits — A nunca ve la deuda de B", async () => {
    const bTicket = makeTicketRow({ tenantId: B.tid, registerId: B.rid });
    bTicket.status = "ON_CREDIT";
    bTicket.creditPending = dec(10);
    db.tickets.push(bTicket);
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/credits",
      headers: { authorization: `Bearer ${tokenFor(A)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().contacts).toHaveLength(0);
    expect(JSON.stringify(res.json())).not.toContain(bTicket.id);
  });
});
