// Integration test del CRM (B-koibox-1): /clients y sus sub-recursos.
// Prisma en memoria; valida búsqueda A–Z, alta idempotente, aislamiento
// por tenant, ficha completa, historial unificado y contratos estables.

import { randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Prisma en memoria ────────────────────────────────────────────────
interface FakeClientRow {
  id: string;
  tenantId: string;
  externalId: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  birthdate: Date | null;
  holdedContactId: string | null;
  marketingOptIn: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const clientStore = new Map<string, FakeClientRow>();
const consentStore: Array<{
  id: string;
  tenantId: string;
  clientId: string;
  kind: string;
  grantedAt: Date;
  docRef: string | null;
  createdAt: Date;
}> = [];
const noteStore: Array<{
  id: string;
  tenantId: string;
  clientId: string;
  serviceId: string | null;
  body: string;
  createdByUserId: string;
  createdAt: Date;
}> = [];
const ticketStore: Array<{
  id: string;
  tenantId: string;
  contactHoldedId: string | null;
  internalNumber: string;
  total: number;
  status: string;
  holdedDocNumber: string | null;
  createdAt: Date;
  paidAt: Date | null;
}> = [];

function matchContains(row: FakeClientRow, needle: string): boolean {
  const n = needle.toLowerCase();
  return (
    row.firstName.toLowerCase().includes(n) ||
    row.lastName.toLowerCase().includes(n) ||
    (row.phone ?? "").toLowerCase().includes(n) ||
    (row.email ?? "").toLowerCase().includes(n)
  );
}

const fakePrisma = {
  client: {
    findMany: vi.fn(async ({ where, take, cursor, skip }: any) => {
      let list = [...clientStore.values()].filter(
        (c) => c.tenantId === where.tenantId,
      );
      const needle = where.OR?.[0]?.firstName?.contains;
      if (typeof needle === "string" && needle.length > 0) {
        list = list.filter((c) => matchContains(c, needle));
      }
      if (where.phone !== undefined) {
        list = list.filter((c) => c.phone === where.phone);
      }
      list.sort(
        (a, b) =>
          a.lastName.localeCompare(b.lastName) ||
          a.firstName.localeCompare(b.firstName) ||
          a.id.localeCompare(b.id),
      );
      if (cursor?.id) {
        const idx = list.findIndex((c) => c.id === cursor.id);
        if (idx >= 0) list = list.slice(idx + (skip ?? 0));
      }
      return take ? list.slice(0, take) : list;
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const c of clientStore.values()) {
        if (c.tenantId !== where.tenantId) continue;
        if (where.id && c.id !== where.id) continue;
        if (where.externalId && c.externalId !== where.externalId) continue;
        return c;
      }
      return null;
    }),
    create: vi.fn(async ({ data }: any) => {
      const row: FakeClientRow = {
        id: randomUUID(),
        tenantId: data.tenantId,
        externalId: data.externalId ?? null,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone ?? null,
        email: data.email ?? null,
        birthdate: data.birthdate ?? null,
        holdedContactId: data.holdedContactId ?? null,
        marketingOptIn: data.marketingOptIn ?? false,
        notes: data.notes ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      clientStore.set(row.id, row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = clientStore.get(where.id)!;
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
  },
  clientConsent: {
    findMany: vi.fn(async ({ where }: any) =>
      consentStore.filter(
        (c) => c.clientId === where.clientId && c.tenantId === where.tenantId,
      ),
    ),
    create: vi.fn(async ({ data }: any) => {
      const row = {
        id: randomUUID(),
        tenantId: data.tenantId,
        clientId: data.clientId,
        kind: data.kind,
        grantedAt: data.grantedAt ?? new Date(),
        docRef: data.docRef ?? null,
        createdAt: new Date(),
      };
      consentStore.push(row);
      return row;
    }),
  },
  clientTechnicalNote: {
    findMany: vi.fn(async ({ where }: any) =>
      noteStore.filter(
        (n) => n.clientId === where.clientId && n.tenantId === where.tenantId,
      ),
    ),
    create: vi.fn(async ({ data }: any) => {
      const row = {
        id: randomUUID(),
        tenantId: data.tenantId,
        clientId: data.clientId,
        serviceId: data.serviceId ?? null,
        body: data.body,
        createdByUserId: data.createdByUserId,
        createdAt: new Date(),
      };
      noteStore.push(row);
      return row;
    }),
  },
  ticket: {
    findMany: vi.fn(async ({ where }: any) => {
      let list = ticketStore.filter(
        (t) =>
          t.tenantId === where.tenantId &&
          t.contactHoldedId === where.contactHoldedId,
      );
      if (where.status?.in) {
        list = list.filter((t) => where.status.in.includes(t.status));
      }
      list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return list;
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerCrmRoutes } = await import("../src/crm/routes.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-000000000002";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const TOKEN = signAccessToken({ sub: USER_ID, tid: TENANT_ID, role: "CASHIER" });

async function buildApp() {
  const app = Fastify();
  await registerCrmRoutes(app);
  return app;
}

function seedClient(opts: Partial<FakeClientRow>): FakeClientRow {
  const id = opts.id ?? randomUUID();
  const row: FakeClientRow = {
    id,
    tenantId: opts.tenantId ?? TENANT_ID,
    externalId: opts.externalId ?? null,
    firstName: opts.firstName ?? "Nombre",
    lastName: opts.lastName ?? "Apellido",
    phone: opts.phone ?? null,
    email: opts.email ?? null,
    birthdate: opts.birthdate ?? null,
    holdedContactId: opts.holdedContactId ?? null,
    marketingOptIn: opts.marketingOptIn ?? false,
    notes: opts.notes ?? null,
    createdAt: opts.createdAt ?? new Date(),
    updatedAt: opts.updatedAt ?? new Date(),
  };
  clientStore.set(id, row);
  return row;
}

beforeEach(() => {
  clientStore.clear();
  consentStore.length = 0;
  noteStore.length = 0;
  ticketStore.length = 0;
});

const auth = { authorization: `Bearer ${TOKEN}` };

describe("GET /clients", () => {
  it("busca por nombre/teléfono/email (insensible) y ordena A–Z", async () => {
    seedClient({ firstName: "Carla", lastName: "López", phone: "600111222" });
    seedClient({ firstName: "Ana", lastName: "Zabala", email: "ana@x.com" });
    seedClient({ firstName: "Otro", lastName: "Aaa" });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/clients?query=carla", headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].firstName).toBe("Carla");
    await app.close();
  });

  it("lista completa ordenada por apellido", async () => {
    seedClient({ firstName: "Ana", lastName: "Zabala" });
    seedClient({ firstName: "Otro", lastName: "Aaa" });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/clients", headers: auth });
    const body = res.json();
    expect(body.items.map((c: any) => c.lastName)).toEqual(["Aaa", "Zabala"]);
    await app.close();
  });

  it("no ve clientes de otro tenant (aislamiento por fila)", async () => {
    seedClient({ firstName: "Ajeno", lastName: "Otro", tenantId: OTHER_TENANT });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/clients", headers: auth });
    expect(res.json().items).toHaveLength(0);
    await app.close();
  });

  it("rechaza sin auth → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/clients" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /clients", () => {
  it("alta happy path → 201", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/clients",
      headers: auth,
      payload: { firstName: "Nuevo", lastName: "Cliente", phone: "600999888", birthdate: "1990-05-01" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.client.firstName).toBe("Nuevo");
    expect(body.client.birthdate).toBe("1990-05-01");
    expect(body.client.id).toBeTruthy();
    await app.close();
  });

  it("avisa de teléfono duplicado sin bloquear", async () => {
    seedClient({ firstName: "Ya", lastName: "Existe", phone: "600111222" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/clients",
      headers: auth,
      payload: { firstName: "Otro", lastName: "Igual", phone: "600111222" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().phoneWarning).toHaveLength(1);
    await app.close();
  });

  it("idempotente por externalId → 200 duplicate", async () => {
    const ext = randomUUID();
    seedClient({ firstName: "Off", lastName: "Line", externalId: ext });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/clients",
      headers: auth,
      payload: { externalId: ext, firstName: "Off", lastName: "Line" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().duplicate).toBe(true);
    expect(clientStore.size).toBe(1);
    await app.close();
  });

  it("rechaza sin firstName/lastName → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/clients",
      headers: auth,
      payload: { firstName: "Solo" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /clients/:id", () => {
  it("devuelve ficha con consents y ficha técnica", async () => {
    const c = seedClient({ firstName: "Con", lastName: "Ficha" });
    consentStore.push({ id: randomUUID(), tenantId: TENANT_ID, clientId: c.id, kind: "DATA", grantedAt: new Date(), docRef: null, createdAt: new Date() });
    noteStore.push({ id: randomUUID(), tenantId: TENANT_ID, clientId: c.id, serviceId: "svc-1", body: "Color 6.0", createdByUserId: USER_ID, createdAt: new Date() });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/clients/${c.id}`, headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.consents).toHaveLength(1);
    expect(body.technicalNotes[0].body).toBe("Color 6.0");
    await app.close();
  });

  it("404 para cliente de otro tenant", async () => {
    const c = seedClient({ tenantId: OTHER_TENANT });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/clients/${c.id}`, headers: auth });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("PATCH /clients/:id", () => {
  it("edita campos", async () => {
    const c = seedClient({ firstName: "Antes", lastName: "X" });
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/clients/${c.id}`,
      headers: auth,
      payload: { firstName: "Después", marketingOptIn: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().client.firstName).toBe("Después");
    expect(res.json().client.marketingOptIn).toBe(true);
    await app.close();
  });

  it("404 para otro tenant", async () => {
    const c = seedClient({ tenantId: OTHER_TENANT });
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/clients/${c.id}`, headers: auth, payload: { firstName: "Z" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("GET /clients/:id/history", () => {
  it("compras del contacto Holded + contratos vacíos estables", async () => {
    const c = seedClient({ firstName: "Comprador", lastName: "Fiel", holdedContactId: "hc-1" });
    ticketStore.push({ id: randomUUID(), tenantId: TENANT_ID, contactHoldedId: "hc-1", internalNumber: "000123", total: 47.8, status: "SYNCED", holdedDocNumber: "F-1", createdAt: new Date(), paidAt: new Date() });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/clients/${c.id}/history`, headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].kind).toBe("PURCHASE");
    expect(body.entries[0].ticketId).toBeTruthy();
    expect(body.appointments).toEqual([]);
    expect(body.voucherMovements).toEqual([]);
    await app.close();
  });

  it("cliente sin holdedContactId → historial vacío", async () => {
    const c = seedClient({ firstName: "Sin", lastName: "Contacto" });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/clients/${c.id}/history`, headers: auth });
    expect(res.json().entries).toEqual([]);
    await app.close();
  });
});

describe("GET /clients/:id/vouchers", () => {
  it("contrato estable vacío", async () => {
    const c = seedClient({});
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/clients/${c.id}/vouchers`, headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.balance.sessionsLeft).toBe(0);
    expect(body.vouchers).toEqual([]);
    await app.close();
  });
});

describe("sub-recursos: alta manual", () => {
  it("POST /consents crea consentimiento", async () => {
    const c = seedClient({});
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/clients/${c.id}/consents`, headers: auth, payload: { kind: "TREATMENT", docRef: "doc-1" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().consent.kind).toBe("TREATMENT");
    expect(consentStore).toHaveLength(1);
    await app.close();
  });

  it("POST /technical-notes crea nota", async () => {
    const c = seedClient({});
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/clients/${c.id}/technical-notes`, headers: auth, payload: { serviceId: "svc-9", body: "Parámetros láser 3J" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().technicalNote.createdByUserId).toBe(USER_ID);
    expect(noteStore).toHaveLength(1);
    await app.close();
  });

  it("no crea nota en cliente de otro tenant → 404", async () => {
    const c = seedClient({ tenantId: OTHER_TENANT });
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/clients/${c.id}/technical-notes`, headers: auth, payload: { body: "x" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
