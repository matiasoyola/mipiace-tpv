// Tests de los endpoints de la bandeja SYNC_FAILED del admin (B5 §2.1).
// Mockea Prisma en memoria + colas BullMQ no-op.

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
const OWNER = "11111111-1111-1111-1111-111111111111";

interface TicketRow {
  id: string;
  externalId: string;
  tenantId: string;
  registerId: string;
  internalNumber: string;
  status: "SYNC_FAILED" | "PENDING_SYNC" | "SYNCED";
  total: number;
  notes: string | null;
  syncError: unknown;
  holdedDocumentId: string | null;
  holdedDocNumber: string | null;
  createdAt: Date;
  paidAt: Date | null;
  lines: Array<{
    id: string;
    sku: string;
    nameSnapshot: string;
    units: number;
    unitPrice: number;
    discountPct: number;
    taxRate: number;
  }>;
  register: { id: string; name: string; numSerieHolded: string | null; storeId: string; store: { id: string; name: string } };
}

interface RefundRow {
  id: string;
  externalId: string;
  tenantId: string;
  registerId: string;
  internalNumber: string;
  status: "SYNC_FAILED" | "PENDING_SYNC" | "SYNCED";
  total: number;
  syncError: unknown;
  holdedDocumentId: string | null;
  holdedDocNumber: string | null;
  createdAt: Date;
  lines: Array<{
    id: string;
    sku: string;
    nameSnapshot: string;
    units: number;
    unitPrice: number;
    discountPct: number;
    taxRate: number;
  }>;
  register: { id: string; name: string; numSerieHolded: string | null; storeId: string; store: { id: string; name: string } } | null;
  originalTicket: { id: string; internalNumber: string; holdedDocumentId: string | null; holdedDocNumber: string | null };
}

const ticketStore = new Map<string, TicketRow>();
const refundStore = new Map<string, RefundRow>();
const uploadStore = new Map<string, { externalId: string; status: string; attempts: number; lastAttemptAt: Date | null; holdedDocumentId: string | null; lastError: unknown }>();

function decimalish(n: number) {
  return { toString: () => String(n) };
}

// S1-sello · la traza que deja la vía de corrección.
const correctionStore: Array<{
  id: string;
  ticketId: string;
  tableName: string;
  rowId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  author: string;
  userId: string | null;
  createdAt: Date;
}> = [];

const fakePrisma = {
  ticket: {
    findMany: vi.fn(async ({ where, include, orderBy, take }: any) => {
      void orderBy;
      void take;
      const rows = [...ticketStore.values()].filter((t) => {
        if (where.tenantId && t.tenantId !== where.tenantId) return false;
        if (where.status && t.status !== where.status) return false;
        return true;
      });
      return rows.map((r) => ({
        ...r,
        total: decimalish(r.total),
        lines: include?.lines ? r.lines.map((l) => ({
          ...l,
          units: decimalish(l.units),
          unitPrice: decimalish(l.unitPrice),
          discountPct: decimalish(l.discountPct),
          taxRate: decimalish(l.taxRate),
        })) : undefined,
        register: include?.register ? r.register : undefined,
      }));
    }),
    findFirst: vi.fn(async ({ where, include, select }: any) => {
      const found = [...ticketStore.values()].find((t) =>
        (where.id ? t.id === where.id : true) &&
        (where.tenantId ? t.tenantId === where.tenantId : true),
      );
      if (!found) return null;
      const ret: any = { ...found };
      ret.total = decimalish(found.total);
      if (include?.lines) {
        ret.lines = found.lines.map((l) => ({
          ...l,
          units: decimalish(l.units),
          unitPrice: decimalish(l.unitPrice),
          discountPct: decimalish(l.discountPct),
          taxRate: decimalish(l.taxRate),
        }));
      }
      if (include?.register) ret.register = found.register;
      void select;
      return ret;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = [...ticketStore.values()].find((t) =>
        where.id ? t.id === where.id : where.externalId ? t.externalId === where.externalId : false,
      );
      if (!row) throw new Error("ticket not found");
      Object.assign(row, data);
      return row;
    }),
  },
  refund: {
    findMany: vi.fn(async ({ where, include, orderBy, take }: any) => {
      void orderBy;
      void take;
      const rows = [...refundStore.values()].filter((r) => {
        if (where.tenantId && r.tenantId !== where.tenantId) return false;
        if (where.status && r.status !== where.status) return false;
        return true;
      });
      return rows.map((r) => ({
        ...r,
        total: decimalish(r.total),
        register: include?.register ? r.register : undefined,
        originalTicket: include?.originalTicket ? r.originalTicket : undefined,
      }));
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const r = [...refundStore.values()].find((x) =>
        (where.id ? x.id === where.id : true) &&
        (where.tenantId ? x.tenantId === where.tenantId : true),
      );
      return r ?? null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = [...refundStore.values()].find((r) =>
        where.id ? r.id === where.id : where.externalId ? r.externalId === where.externalId : false,
      );
      if (!row) throw new Error("refund not found");
      Object.assign(row, data);
      return row;
    }),
  },
  ticketLine: {
    update: vi.fn(async ({ where, data }: any) => {
      for (const t of ticketStore.values()) {
        const line = t.lines.find((l) => l.id === where.id);
        if (line) {
          Object.assign(line, data);
          return line;
        }
      }
      throw new Error("line not found");
    }),
  },
  user: {
    findUnique: vi.fn(async () => ({ email: "owner@t1.es", alias: "Owner" })),
  },
  // S1-sello · `record_ticket_correction` y el listado de correcciones
  // van por SQL crudo: la vía de corrección vive en el motor a propósito
  // (ver `tickets/corrections.ts`). El doble reproduce el contrato:
  // motivo obligatorio, valor anterior capturado, fila de traza escrita
  // y DESPUÉS el UPDATE.
  $queryRaw: vi.fn(async (query: any) => {
    const text: string = (query?.strings ?? []).join(" ");
    const values: unknown[] = query?.values ?? [];
    if (text.includes("record_ticket_correction")) {
      const [table, rowId, field, newValue, reason, author, userId] = values as [
        string, string, string, string | null, string, string, string | null,
      ];
      if (!reason || reason.trim() === "") {
        throw new Error("CORRECCION_SIN_MOTIVO: una corrección sin motivo no se escribe");
      }
      let oldValue: string | null = null;
      let applied = false;
      for (const t of ticketStore.values()) {
        const line = t.lines.find((l) => l.id === rowId);
        if (line && table === "ticket_lines") {
          oldValue = String((line as any)[field] ?? "");
          (line as any)[field] = newValue;
          correctionStore.push({
            id: `corr-${correctionStore.length + 1}`,
            ticketId: t.id,
            tableName: table,
            rowId,
            field,
            oldValue,
            newValue,
            reason: reason.trim(),
            author,
            userId: userId ?? null,
            createdAt: new Date(),
          });
          applied = true;
          break;
        }
      }
      if (!applied) {
        throw new Error(`CORRECCION_INVALIDA: la fila ${rowId} de ${table} no existe`);
      }
      return [{ id: `corr-${correctionStore.length}` }];
    }
    if (text.includes("ticket_corrections")) {
      const ticketId = values[0] as string;
      return correctionStore.filter((c) => c.ticketId === ticketId);
    }
    throw new Error(`$queryRaw no simulado: ${text}`);
  }),
  refundLine: {
    update: vi.fn(async ({ where, data }: any) => {
      for (const r of refundStore.values()) {
        const line = r.lines.find((l) => l.id === where.id);
        if (line) {
          Object.assign(line, data);
          return line;
        }
      }
      throw new Error("line not found");
    }),
  },
  holdedUpload: {
    findMany: vi.fn(async ({ where }: any) => {
      const ids: string[] = where.externalId?.in ?? [];
      return ids
        .map((id) => uploadStore.get(id))
        .filter((u): u is NonNullable<typeof u> => u != null);
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const u = uploadStore.get(where.externalId);
      if (!u) throw new Error("upload not found");
      Object.assign(u, data);
      return u;
    }),
  },
  $transaction: vi.fn(async (operations: any) => {
    if (typeof operations === "function") return await operations(fakePrisma);
    return await Promise.all(operations);
  }),
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const enqueueTicket = vi.fn(async () => undefined);
const enqueueRefund = vi.fn(async () => undefined);
vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: enqueueTicket,
}));
vi.mock("../src/queues/refund-upload.js", () => ({
  enqueueRefundUpload: enqueueRefund,
}));

const { registerAdminTicketsErrorsRoutes } = await import(
  "../src/admin/tickets-errors.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");

const OWNER_TOKEN = signAccessToken({ sub: OWNER, tid: TENANT, role: "OWNER" });

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerAdminTicketsErrorsRoutes(app);
  return app;
}

function seedTicket(opts: Partial<TicketRow> & { id: string; status: TicketRow["status"]; syncError?: unknown }): TicketRow {
  const t: TicketRow = {
    id: opts.id,
    externalId: opts.externalId ?? randomUUID(),
    tenantId: opts.tenantId ?? TENANT,
    registerId: opts.registerId ?? "reg-1",
    internalNumber: opts.internalNumber ?? "000042",
    status: opts.status,
    total: opts.total ?? 72,
    notes: opts.notes ?? null,
    syncError: opts.syncError ?? null,
    holdedDocumentId: opts.holdedDocumentId ?? null,
    holdedDocNumber: opts.holdedDocNumber ?? null,
    createdAt: opts.createdAt ?? new Date(),
    paidAt: opts.paidAt ?? new Date(),
    lines: opts.lines ?? [
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        sku: "CAFE-1",
        nameSnapshot: "Café",
        units: 1,
        unitPrice: 1.4,
        discountPct: 0,
        taxRate: 10,
      },
    ],
    register: opts.register ?? {
      id: "reg-1",
      name: "Caja 1",
      numSerieHolded: null,
      storeId: "store-1",
      store: { id: "store-1", name: "Tienda Principal" },
    },
  };
  ticketStore.set(t.id, t);
  uploadStore.set(t.externalId, {
    externalId: t.externalId,
    status: t.status === "SYNC_FAILED" ? "FAILED" : "PENDING",
    attempts: t.status === "SYNC_FAILED" ? 5 : 0,
    lastAttemptAt: t.status === "SYNC_FAILED" ? new Date() : null,
    holdedDocumentId: t.holdedDocumentId,
    lastError: t.syncError,
  });
  return t;
}

function seedRefund(opts: Partial<RefundRow> & { id: string; status: RefundRow["status"] }): RefundRow {
  const r: RefundRow = {
    id: opts.id,
    externalId: opts.externalId ?? randomUUID(),
    tenantId: opts.tenantId ?? TENANT,
    registerId: opts.registerId ?? "reg-1",
    internalNumber: opts.internalNumber ?? "R-000001",
    status: opts.status,
    total: opts.total ?? 12.1,
    syncError: opts.syncError ?? null,
    holdedDocumentId: opts.holdedDocumentId ?? null,
    holdedDocNumber: opts.holdedDocNumber ?? null,
    createdAt: opts.createdAt ?? new Date(),
    lines: opts.lines ?? [
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        sku: "CAFE-1",
        nameSnapshot: "Café",
        units: 1,
        unitPrice: 1.4,
        discountPct: 0,
        taxRate: 10,
      },
    ],
    register: opts.register ?? {
      id: "reg-1",
      name: "Caja 1",
      numSerieHolded: null,
      storeId: "store-1",
      store: { id: "store-1", name: "Tienda Principal" },
    },
    originalTicket: opts.originalTicket ?? {
      id: "orig-1",
      internalNumber: "000041",
      holdedDocumentId: null,
      holdedDocNumber: null,
    },
  };
  refundStore.set(r.id, r);
  uploadStore.set(r.externalId, {
    externalId: r.externalId,
    status: r.status === "SYNC_FAILED" ? "FAILED" : "PENDING",
    attempts: 3,
    lastAttemptAt: new Date(),
    holdedDocumentId: r.holdedDocumentId,
    lastError: r.syncError,
  });
  return r;
}

beforeEach(() => {
  correctionStore.length = 0;
  ticketStore.clear();
  refundStore.clear();
  uploadStore.clear();
  enqueueTicket.mockClear();
  enqueueRefund.mockClear();
  vi.clearAllMocks();
});

describe("GET /admin/tickets/sync-errors", () => {
  it("lista tickets + refunds SYNC_FAILED con badge y resumen de error", async () => {
    seedTicket({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "SYNC_FAILED",
      total: 72,
      syncError: { reason: "silent_reject", mismatches: [{ field: "total", expected: 72, actual: 97.2 }] },
    });
    seedRefund({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status: "SYNC_FAILED",
      syncError: { reason: "holded_4xx", message: "Holded API 422" },
    });
    // Un ticket SYNCED — NO debe aparecer.
    seedTicket({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "SYNCED" });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/admin/tickets/sync-errors",
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pendingCount).toBe(2);
    expect(body.items).toHaveLength(2);
    const ticketEntry = body.items.find((e: { kind: string }) => e.kind === "ticket");
    const refundEntry = body.items.find((e: { kind: string }) => e.kind === "refund");
    expect(ticketEntry).toBeTruthy();
    expect(refundEntry).toBeTruthy();
    expect(ticketEntry.errorSummary).toContain("total mismatch");
    expect(ticketEntry.errorSummary).toContain("97.20");
    expect(refundEntry.errorSummary).toContain("holded_4xx");
    expect(ticketEntry.attempts).toBe(5);
  });

  it("401 sin token de owner", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/admin/tickets/sync-errors",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /admin/tickets/:id/retry-sync", () => {
  it("re-encola el job y devuelve 202", async () => {
    const t = seedTicket({ id: "22222222-2222-4222-8222-222222222222", status: "SYNC_FAILED" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/tickets/${t.id}/retry-sync`,
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().jobId).toBe(`upload-ticket-${t.externalId}`);
    expect(enqueueTicket).toHaveBeenCalledWith(t.externalId);
    // ticket queda en PENDING_SYNC para que el worker lo procese.
    expect(ticketStore.get(t.id)?.status).toBe("PENDING_SYNC");
  });

  it("409 si el ticket ya está SYNCED", async () => {
    const t = seedTicket({ id: "11111111-1111-4111-8111-111111111111", status: "SYNCED" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/tickets/${t.id}/retry-sync`,
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(enqueueTicket).not.toHaveBeenCalled();
  });
});

describe("POST /admin/refunds/:id/retry-sync", () => {
  it("re-encola refund y devuelve jobId con prefijo upload-refund-", async () => {
    const r = seedRefund({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "SYNC_FAILED" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/refunds/${r.id}/retry-sync`,
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().jobId).toBe(`upload-refund-${r.externalId}`);
    expect(enqueueRefund).toHaveBeenCalledWith(r.externalId);
  });
});

describe("POST /admin/tickets/:id/mark-resolved", () => {
  it("marca SYNCED + persiste holdedDocumentId del owner", async () => {
    const t = seedTicket({ id: "22222222-2222-4222-8222-222222222222", status: "SYNC_FAILED" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/tickets/${t.id}/mark-resolved`,
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      payload: { holdedDocumentId: "doc_manual_123", holdedDocNumber: "T260513" },
    });
    expect(res.statusCode).toBe(200);
    const updated = ticketStore.get(t.id)!;
    expect(updated.status).toBe("SYNCED");
    expect(updated.holdedDocumentId).toBe("doc_manual_123");
    expect(updated.holdedDocNumber).toBe("T260513");
  });
});

describe("POST /admin/tickets/:id/edit-line-sku", () => {
  it("edita SKU, limpia docId parcial y re-encola", async () => {
    const t = seedTicket({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "SYNC_FAILED",
      holdedDocumentId: "doc_parcial_404",
      lines: [
        { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", sku: "BAD-SKU", nameSnapshot: "X", units: 1, unitPrice: 5, discountPct: 0, taxRate: 21 },
      ],
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/tickets/${t.id}/edit-line-sku`,
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      payload: {
        ticketLineId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        sku: "GOOD-SKU",
        // S1-sello · el motivo pasa a ser parte del contrato: el `sku`
        // identifica qué se vendió y entra en el sello de la venta.
        reason: "Holded rechazó BAD-SKU: no es el SKU canónico del producto",
      },
    });
    expect(res.statusCode).toBe(202);
    const updated = ticketStore.get(t.id)!;
    expect(updated.lines[0]?.sku).toBe("GOOD-SKU");
    // docId parcial se limpia para que el siguiente intento re-cree.
    expect(updated.holdedDocumentId).toBeNull();
    expect(enqueueTicket).toHaveBeenCalledWith(t.externalId);
    // S1-sello · y queda la traza, con el valor anterior y el motivo.
    expect(correctionStore).toHaveLength(1);
    expect(correctionStore[0]).toMatchObject({
      tableName: "ticket_lines",
      field: "sku",
      oldValue: "BAD-SKU",
      newValue: "GOOD-SKU",
      author: "owner@t1.es",
      reason: "Holded rechazó BAD-SKU: no es el SKU canónico del producto",
    });
  });

  // S1-sello · el sabotaje "escribir una corrección sin motivo".
  it("400 y NO escribe si falta el motivo", async () => {
    const t = seedTicket({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "SYNC_FAILED",
      lines: [
        { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", sku: "BAD-SKU", nameSnapshot: "X", units: 1, unitPrice: 5, discountPct: 0, taxRate: 21 },
      ],
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/tickets/${t.id}/edit-line-sku`,
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      payload: { ticketLineId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", sku: "GOOD-SKU" },
    });
    expect(res.statusCode).toBe(400);
    expect(ticketStore.get(t.id)!.lines[0]?.sku).toBe("BAD-SKU");
    expect(correctionStore).toHaveLength(0);
    expect(enqueueTicket).not.toHaveBeenCalled();
  });

  // S1-sello · la vista mínima: sin ella la tabla no sirve para lo único
  // para lo que existe, que es que alguien la mire.
  it("GET corrections devuelve el estado del sello y la traza", async () => {
    const t = seedTicket({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "SYNC_FAILED",
      lines: [
        { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", sku: "BAD-SKU", nameSnapshot: "X", units: 1, unitPrice: 5, discountPct: 0, taxRate: 21 },
      ],
    });
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/admin/tickets/${t.id}/edit-line-sku`,
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      payload: {
        ticketLineId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        sku: "GOOD-SKU",
        reason: "SKU no canónico",
      },
    });
    const res = await app.inject({
      method: "GET",
      url: `/admin/tickets/${t.id}/corrections`,
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.corrections).toHaveLength(1);
    expect(body.corrections[0].reason).toBe("SKU no canónico");
    expect(body.corrections[0].oldValue).toBe("BAD-SKU");
  });

  it("400 si la línea no pertenece al ticket", async () => {
    const t = seedTicket({ id: "22222222-2222-4222-8222-222222222222", status: "SYNC_FAILED" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/tickets/${t.id}/edit-line-sku`,
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
      payload: { ticketLineId: "ffffffff-ffff-4fff-8fff-ffffffffffff", sku: "WHATEVER" },
    });
    expect(res.statusCode).toBe(400);
    expect(enqueueTicket).not.toHaveBeenCalled();
  });
});

describe("GET /admin/tickets/:id/holded-payload-preview", () => {
  it("devuelve el payload exacto que enviaría el worker", async () => {
    const t = seedTicket({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "SYNC_FAILED",
      total: 1.54,
      paidAt: new Date("2026-05-13T10:00:00Z"),
      lines: [
        { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", sku: "CAFE-1", nameSnapshot: "Café", units: 1, unitPrice: 1.4, discountPct: 0, taxRate: 10 },
      ],
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/admin/tickets/${t.id}/holded-payload-preview`,
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe("ticket");
    expect(body.payload.approveDoc).toBe(true);
    expect(body.payload.items).toHaveLength(1);
    expect(body.payload.items[0]).toMatchObject({
      name: "Café",
      sku: "CAFE-1",
      tax: 10,
      price: 1.4,
      units: 1,
    });
    // Notes contiene el TPV-uuid: <externalId> (signal de idempotencia).
    expect(body.payload.notes).toContain("TPV-uuid:");
    expect(body.payload.notes).toContain(t.externalId);
  });
});
