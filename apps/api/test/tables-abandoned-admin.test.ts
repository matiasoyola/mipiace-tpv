// v1.12-mesas-abandonadas · la lista del admin y el "Anular" con PIN.
//
// Lo que se prueba aquí es la frontera: una cuenta con 84,60 € dentro no
// se anula por tener JWT de encargado abierto en una pestaña. Hace falta
// teclear un PIN, y el que queda escrito en `voidedByUserId` es el dueño
// de ESE PIN, no el de la sesión.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = randomUUID();
const STORE = randomUUID();
const OWNER_ID = randomUUID();
const MANAGER_ID = randomUUID();
const TABLE_ID = randomUUID();
const TICKET_ID = randomUUID();
const MANAGER_PIN = "7788";

const HACE_43_DIAS = new Date(Date.now() - 43 * 24 * 60 * 60 * 1000);

interface FakeTicket {
  id: string;
  tenantId: string;
  tableId: string | null;
  tableName: string;
  storeId: string;
  status: string;
  lines: number;
  total: number;
  notes: string | null;
  createdAt: Date;
  voidReason?: string | null;
  voidedByUserId?: string | null;
  voidedAt?: Date | null;
}

let tickets: FakeTicket[] = [];
const users = new Map<
  string,
  { id: string; tenantId: string; email: string; alias: string | null; role: string; pinHash: string | null; deletedAt: Date | null }
>();

function project(t: FakeTicket) {
  return {
    id: t.id,
    tenantId: t.tenantId,
    tableId: t.tableId,
    notes: t.notes,
    createdAt: t.createdAt,
    total: { toString: () => t.total.toFixed(4) },
    register: { storeId: t.storeId },
    table: { name: t.tableName, storeId: t.storeId },
    user: { email: "gemmamgc72@sirope.example", alias: "Gemma" },
    _count: { lines: t.lines },
  };
}

const fakePrisma = {
  store: {
    findFirst: vi.fn(async ({ where }: any) =>
      where.id === STORE && where.tenantId === TENANT ? { id: STORE } : null,
    ),
  },
  ticket: {
    findMany: vi.fn(async ({ where }: any) =>
      tickets
        .filter((t) => {
          if (where.status && t.status !== where.status) return false;
          if (where.tenantId && t.tenantId !== where.tenantId) return false;
          if (where.createdAt?.lt && t.createdAt >= where.createdAt.lt) return false;
          if (where.table?.storeId && t.storeId !== where.table.storeId) return false;
          return true;
        })
        .map(project),
    ),
    findFirst: vi.fn(async ({ where }: any) => {
      const hit = tickets.find(
        (t) =>
          (!where.id || t.id === where.id) &&
          (!where.tenantId || t.tenantId === where.tenantId) &&
          (!where.status || t.status === where.status),
      );
      return hit ? project(hit) : null;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const hit = tickets.filter(
        (t) =>
          (!where.id || t.id === where.id) &&
          (!where.tenantId || t.tenantId === where.tenantId) &&
          (!where.status || t.status === where.status) &&
          (!where.lines || t.lines === 0),
      );
      for (const t of hit) Object.assign(t, data);
      return { count: hit.length };
    }),
  },
  user: {
    findMany: vi.fn(async ({ where }: any) =>
      [...users.values()].filter(
        (u) =>
          u.tenantId === where.tenantId &&
          where.role.in.includes(u.role) &&
          u.pinHash !== null &&
          u.deletedAt === null,
      ),
    ),
  },
};

const redisStore = new Map<string, { value: string; expiresAt: number }>();
const fakeRedis = {
  incr: vi.fn(async (key: string) => {
    const existing = redisStore.get(key);
    const fresh = !existing || existing.expiresAt <= Date.now();
    const value = fresh ? 1 : Number(existing!.value) + 1;
    redisStore.set(key, {
      value: String(value),
      expiresAt: existing?.expiresAt ?? Date.now() + 5 * 60 * 1000,
    });
    return value;
  }),
  expire: vi.fn(async () => 1),
  ttl: vi.fn(async (key: string) => {
    const e = redisStore.get(key);
    if (!e) return -2;
    const ms = e.expiresAt - Date.now();
    return ms <= 0 ? -2 : Math.ceil(ms / 1000);
  }),
  set: vi.fn(async (key: string, value: string, _ex: string, seconds: number) => {
    redisStore.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return "OK";
  }),
  get: vi.fn(async (key: string) => {
    const e = redisStore.get(key);
    if (!e || e.expiresAt <= Date.now()) return null;
    return e.value;
  }),
  del: vi.fn(async (...keys: string[]) => {
    let c = 0;
    for (const k of keys) if (redisStore.delete(k)) c++;
    return c;
  }),
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => fakeRedis,
  shutdown: async () => undefined,
}));

const { registerTablesRoutes } = await import("../src/tables/routes.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { hashPassword } = await import("../src/auth/passwords.js");

function ownerToken() {
  return signAccessToken({ sub: OWNER_ID, tid: TENANT, role: "OWNER" });
}

async function buildApp() {
  const app = Fastify();
  await registerTablesRoutes(app);
  return app;
}

beforeEach(async () => {
  redisStore.clear();
  users.clear();
  users.set(MANAGER_ID, {
    id: MANAGER_ID,
    tenantId: TENANT,
    email: "encargado@sirope.example",
    alias: "Nuria",
    role: "MANAGER",
    pinHash: await hashPassword(MANAGER_PIN),
    deletedAt: null,
  });
  tickets = [
    {
      id: TICKET_ID,
      tenantId: TENANT,
      tableId: TABLE_ID,
      tableName: "M7",
      storeId: STORE,
      status: "DRAFT",
      lines: 3,
      total: 84.6,
      notes: null,
      createdAt: HACE_43_DIAS,
    },
    // Vacía y vieja: la suelta el barrido de madrugada, no molesta al
    // encargado con ella.
    {
      id: randomUUID(),
      tenantId: TENANT,
      tableId: randomUUID(),
      tableName: "M1",
      storeId: STORE,
      status: "DRAFT",
      lines: 0,
      total: 0,
      notes: null,
      createdAt: HACE_43_DIAS,
    },
  ];
});

describe("GET /admin/stores/:storeId/tables/abandoned", () => {
  it("lista sólo las cuentas con consumo, con importe y desde cuándo", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/admin/stores/${STORE}/tables/abandoned`,
      headers: { authorization: `Bearer ${ownerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.thresholdHours).toBe(24);
    expect(body.tickets).toHaveLength(1);
    expect(body.tickets[0]).toMatchObject({
      ticketId: TICKET_ID,
      tableName: "M7",
      lineCount: 3,
      openedByAlias: "Gemma",
    });
  });
});

describe("POST /admin/tables/abandoned/:ticketId/void", () => {
  it("sin PIN correcto no se anula nada", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/tables/abandoned/${TICKET_ID}/void`,
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { managerPin: "0000" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("INVALID_MANAGER_PIN");
    expect(tickets[0]!.status).toBe("DRAFT");
  });

  it("con PIN de encargado anula la cuenta y firma quién y por qué", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/tables/abandoned/${TICKET_ID}/void`,
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { managerPin: MANAGER_PIN, reason: "Mesa del 9 de julio" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().voidedByAlias).toBe("Nuria");
    const t = tickets[0]!;
    expect(t.status).toBe("VOIDED");
    expect(t.voidReason).toBe("MANAGER_VOID");
    // Quién: el dueño del PIN, no el de la sesión del navegador.
    expect(t.voidedByUserId).toBe(MANAGER_ID);
    expect(t.notes).toContain("Mesa del 9 de julio");
  });

  it("si la cobraron desde el TPV mientras tanto → 409, no la anula", async () => {
    tickets[0]!.status = "PAID";
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/tables/abandoned/${TICKET_ID}/void`,
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { managerPin: MANAGER_PIN },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("TICKET_NOT_DRAFT");
    expect(tickets[0]!.status).toBe("PAID");
  });

  it("un CASHIER no llega ni a la puerta", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/admin/tables/abandoned/${TICKET_ID}/void`,
      headers: {
        authorization: `Bearer ${signAccessToken({ sub: OWNER_ID, tid: TENANT, role: "CASHIER" })}`,
      },
      payload: { managerPin: MANAGER_PIN },
    });
    expect(res.statusCode).toBe(403);
    expect(tickets[0]!.status).toBe("DRAFT");
  });
});
