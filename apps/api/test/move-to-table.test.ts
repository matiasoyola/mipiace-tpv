// Tests del endpoint POST /tickets/:id/move-to-table
// (v1.4-Bar-Operativa-MVP Lote 3).

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
const STORE_A = "00000000-0000-0000-0000-000000000002";
const STORE_B = "00000000-0000-0000-0000-000000000099";
const REGISTER = "00000000-0000-0000-0000-000000000003";
const DEVICE = "00000000-0000-0000-0000-000000000004";
const CASHIER = "00000000-0000-0000-0000-000000000005";
const TICKET = "00000000-0000-0000-0000-000000000007";
const TABLE_FREE = "00000000-0000-0000-0000-00000000000a";
const TABLE_OCCUPIED = "00000000-0000-0000-0000-00000000000b";
const TABLE_OTHER_STORE = "00000000-0000-0000-0000-00000000000c";
const OCCUPANT_TICKET = "00000000-0000-0000-0000-00000000000d";
const SHIFT = "00000000-0000-0000-0000-00000000000e";

interface FakeTicket {
  id: string;
  tenantId: string;
  registerId: string;
  status: "DRAFT" | "PAID";
  tableId: string | null;
  register: { storeId: string };
  table: { name: string } | null;
}

interface FakeTable {
  id: string;
  name: string;
  storeId: string;
  deletedAt: Date | null;
}

const state = {
  tickets: new Map<string, FakeTicket>(),
  tables: new Map<string, FakeTable>(),
  shifts: [] as Array<{ id: string; registerId: string; closedAt: null }>,
};

const fakePrisma = {
  ticket: {
    findFirst: vi.fn(async ({ where, select: _select }: any) => {
      // Búsqueda por id+tenantId+status (handler principal) o por
      // tableId+status (check de mesa ocupada).
      if (where.id) {
        const t = state.tickets.get(where.id);
        if (!t) return null;
        if (where.tenantId && t.tenantId !== where.tenantId) return null;
        if (where.status && t.status !== where.status) return null;
        return t;
      }
      if (where.tableId) {
        for (const t of state.tickets.values()) {
          if (t.tableId === where.tableId && t.status === "DRAFT") return t;
        }
        return null;
      }
      return null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = state.tickets.get(where.id);
      if (!t) throw new Error("ticket not found");
      if (data.tableId !== undefined) t.tableId = data.tableId;
      return t;
    }),
  },
  table: {
    findFirst: vi.fn(async ({ where }: any) => {
      const t = state.tables.get(where.id);
      if (!t) return null;
      if (where.deletedAt === null && t.deletedAt !== null) return null;
      if (where.storeId && t.storeId !== where.storeId) return null;
      // Compat con grouping/operativa, que usa store: { tenantId }
      if (where.store?.tenantId) {
        if (t.storeId !== STORE_A && t.storeId !== STORE_B) return null;
      }
      return t;
    }),
  },
  user: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id !== CASHIER) return null;
      return { email: "camarero@bar.es" };
    }),
  },
  register: {
    findFirst: vi.fn(async () => ({ id: REGISTER })),
  },
  shift: {
    findFirst: vi.fn(async () => state.shifts[0] ?? null),
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}) as never,
  shutdown: async () => undefined,
}));

const { registerTableOperativaRoutes } = await import(
  "../src/tables/operativa.js"
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
  await registerTableOperativaRoutes(app);
  return app;
}

function seedDraft(overrides: Partial<FakeTicket> = {}): FakeTicket {
  const t: FakeTicket = {
    id: TICKET,
    tenantId: TENANT,
    registerId: REGISTER,
    status: "DRAFT",
    tableId: "00000000-0000-0000-0000-0000000000aa",
    register: { storeId: STORE_A },
    table: { name: "Mesa 4" },
    ...overrides,
  };
  state.tickets.set(t.id, t);
  return t;
}

beforeEach(() => {
  state.tickets.clear();
  state.tables.clear();
  state.shifts = [{ id: SHIFT, registerId: REGISTER, closedAt: null }];
  vi.clearAllMocks();

  state.tables.set(TABLE_FREE, {
    id: TABLE_FREE,
    name: "Mesa 7",
    storeId: STORE_A,
    deletedAt: null,
  });
  state.tables.set(TABLE_OCCUPIED, {
    id: TABLE_OCCUPIED,
    name: "Mesa 9",
    storeId: STORE_A,
    deletedAt: null,
  });
  state.tables.set(TABLE_OTHER_STORE, {
    id: TABLE_OTHER_STORE,
    name: "Mesa de otra tienda",
    storeId: STORE_B,
    deletedAt: null,
  });
  // Mesa ocupada por otro DRAFT.
  state.tickets.set(OCCUPANT_TICKET, {
    id: OCCUPANT_TICKET,
    tenantId: TENANT,
    registerId: REGISTER,
    status: "DRAFT",
    tableId: TABLE_OCCUPIED,
    register: { storeId: STORE_A },
    table: { name: "Mesa 9" },
  });
});

describe("POST /tickets/:id/move-to-table", () => {
  it("mover a mesa libre → 200 + tableId actualizado", async () => {
    seedDraft();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/move-to-table`,
      headers: { authorization: `Bearer ${signSession()}` },
      payload: { newTableId: TABLE_FREE },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().newTableId).toBe(TABLE_FREE);
    expect(res.json().newTableName).toBe("Mesa 7");
    expect(state.tickets.get(TICKET)!.tableId).toBe(TABLE_FREE);
  });

  it("mover a mesa ocupada → 409 con ticketId ocupante", async () => {
    seedDraft();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/move-to-table`,
      headers: { authorization: `Bearer ${signSession()}` },
      payload: { newTableId: TABLE_OCCUPIED },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("DESTINATION_OCCUPIED");
    expect(res.json().occupiedByTicketId).toBe(OCCUPANT_TICKET);
    // No cambia tableId.
    expect(state.tickets.get(TICKET)!.tableId).not.toBe(TABLE_OCCUPIED);
  });

  it("mover a mesa de otro store → 404 (la query filtra por storeId)", async () => {
    seedDraft();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/move-to-table`,
      headers: { authorization: `Bearer ${signSession()}` },
      payload: { newTableId: TABLE_OTHER_STORE },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("TABLE_NOT_FOUND");
  });

  it("ticket ya cobrado → 404 (sólo DRAFT)", async () => {
    seedDraft({ status: "PAID" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/move-to-table`,
      headers: { authorization: `Bearer ${signSession()}` },
      payload: { newTableId: TABLE_FREE },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("TICKET_NOT_FOUND_OR_NOT_DRAFT");
  });

  it("ticket de otra caja → 403 REGISTER_MISMATCH", async () => {
    seedDraft({ registerId: "ffffffff-ffff-ffff-ffff-ffffffffffff" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/move-to-table`,
      headers: { authorization: `Bearer ${signSession()}` },
      payload: { newTableId: TABLE_FREE },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("REGISTER_MISMATCH");
  });

  it("misma mesa → 400 SAME_TABLE (no-op explícito)", async () => {
    seedDraft({ tableId: TABLE_FREE });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${TICKET}/move-to-table`,
      headers: { authorization: `Bearer ${signSession()}` },
      payload: { newTableId: TABLE_FREE },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("SAME_TABLE");
  });
});
