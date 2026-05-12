// Integration test de /contacts/search y POST /contacts (B2 §3).
// Mockea el cliente Holded (búsqueda por teléfono + creación) y Prisma
// en memoria.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks del cliente Holded ─────────────────────────────────────────
let phoneSearchResult: any[] = [];
let createResult: any = null;
let createGetBackResult: any = null;
let throwOnCreate: Error | null = null;

vi.mock("@mipiacetpv/holded-client", async () => {
  const actual = await vi.importActual<typeof import("@mipiacetpv/holded-client")>(
    "@mipiacetpv/holded-client",
  );
  return {
    ...actual,
    ApiKeyClient: vi.fn().mockImplementation(() => ({})) as any,
    listContactsByPhone: vi.fn(async () => phoneSearchResult),
    createContactWithGetBack: vi.fn(async (_client: unknown, body: any, _opts: any) => {
      if (throwOnCreate) throw throwOnCreate;
      // Por defecto, devolvemos lo que pidieron + un id de Holded.
      return (
        createGetBackResult ?? {
          id: "holded-id-" + randomUUID().slice(0, 8),
          name: body.name,
          code: body.code,
          email: body.email,
          phone: body.phone,
          mobile: body.mobile,
          type: body.type,
        }
      );
    }),
  };
});

// ── Prisma en memoria ────────────────────────────────────────────────
interface FakeContactRow {
  id: string;
  tenantId: string;
  holdedContactId: string;
  name: string;
  nif: string | null;
  email: string | null;
  phone: string | null;
  raw?: object | null;
  lastSyncedAt?: Date;
}

const contactStore = new Map<string, FakeContactRow>();
const tenantStore = new Map<string, { id: string; holdedApiKeyCiphertext: string | null }>();

const fakePrisma = {
  tenant: {
    findUnique: vi.fn(async ({ where }: any) => tenantStore.get(where.id) ?? null),
  },
  contact: {
    findMany: vi.fn(async ({ where, take }: any) => {
      const q: string =
        where.OR?.[0]?.name?.contains ??
        where.OR?.[0]?.email?.contains ??
        "";
      const ql = q.toLowerCase();
      const list = [...contactStore.values()].filter(
        (c) =>
          c.tenantId === where.tenantId &&
          (c.name.toLowerCase().includes(ql) ||
            (c.email ?? "").toLowerCase().includes(ql) ||
            (c.nif ?? "").toLowerCase().includes(ql) ||
            (c.phone ?? "").toLowerCase().includes(ql)),
      );
      return list.slice(0, take ?? 25).map((c) => ({
        id: c.id,
        holdedContactId: c.holdedContactId,
        name: c.name,
        nif: c.nif,
        email: c.email,
        phone: c.phone,
      }));
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const key = `${where.tenantId_holdedContactId.tenantId}|${where.tenantId_holdedContactId.holdedContactId}`;
      const existing = contactStore.get(key);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row: FakeContactRow = {
        id: randomUUID(),
        tenantId: create.tenantId,
        holdedContactId: create.holdedContactId,
        name: create.name,
        nif: create.nif ?? null,
        email: create.email ?? null,
        phone: create.phone ?? null,
        raw: create.raw ?? null,
        lastSyncedAt: new Date(),
      };
      contactStore.set(key, row);
      return {
        id: row.id,
        tenantId: row.tenantId,
        holdedContactId: row.holdedContactId,
        name: row.name,
        nif: row.nif,
        email: row.email,
        phone: row.phone,
      };
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { encryptSecret } = await import("../src/crypto.js");
const FAKE_CIPHERTEXT = encryptSecret(
  "test-api-key",
  process.env.HOLDED_KEY_ENCRYPTION_SECRET!,
);

const { registerContactsRoutes } = await import("../src/contacts/routes.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { HoldedSilentRejectError } = await import("@mipiacetpv/holded-client");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const ACCESS_TOKEN = signAccessToken({ sub: USER_ID, tid: TENANT_ID, role: "OWNER" });

async function buildApp() {
  const app = Fastify();
  await registerContactsRoutes(app);
  return app;
}

function seedContact(opts: Partial<FakeContactRow>) {
  const id = randomUUID();
  const row: FakeContactRow = {
    id,
    tenantId: TENANT_ID,
    holdedContactId: opts.holdedContactId ?? "h-" + id.slice(0, 8),
    name: opts.name ?? "Anon",
    nif: opts.nif ?? null,
    email: opts.email ?? null,
    phone: opts.phone ?? null,
  };
  contactStore.set(`${row.tenantId}|${row.holdedContactId}`, row);
  return row;
}

beforeEach(() => {
  contactStore.clear();
  tenantStore.clear();
  tenantStore.set(TENANT_ID, { id: TENANT_ID, holdedApiKeyCiphertext: FAKE_CIPHERTEXT });
  phoneSearchResult = [];
  createResult = null;
  createGetBackResult = null;
  throwOnCreate = null;
});

describe("GET /contacts/search", () => {
  it("encuentra en BD local por nombre (LIKE case-insensitive)", async () => {
    seedContact({ name: "Carla López", email: "carla@test.com" });
    seedContact({ name: "Otro contacto" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/contacts/search?q=carla",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe("local");
    expect(body.results).toHaveLength(1);
    expect(body.results[0].name).toBe("Carla López");
    await app.close();
  });

  it("local vacío + query no-teléfono → holdedFallback name_search_not_supported", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/contacts/search?q=fulanito",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toEqual([]);
    expect(body.source).toBe("local");
    expect(body.holdedFallback).toBe("name_search_not_supported");
    await app.close();
  });

  it("local vacío + query teléfono → consulta Holded, upserta, devuelve source=holded", async () => {
    phoneSearchResult = [
      {
        id: "h-from-holded-1",
        name: "Marisa González",
        code: "12345678A",
        email: "marisa@test.com",
        phone: "+34 600 111 222",
      },
    ];
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/contacts/search?q=" + encodeURIComponent("+34 600 111 222"),
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe("holded");
    expect(body.results).toHaveLength(1);
    expect(body.results[0].name).toBe("Marisa González");
    // Y se upserteó en local.
    expect(contactStore.has(`${TENANT_ID}|h-from-holded-1`)).toBe(true);
    await app.close();
  });

  it("sin Holded conectado + query teléfono → holdedFallback no_holded_key", async () => {
    tenantStore.get(TENANT_ID)!.holdedApiKeyCiphertext = null;
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/contacts/search?q=600111222",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().holdedFallback).toBe("no_holded_key");
    await app.close();
  });

  it("rechaza sin q → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/contacts/search",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("rechaza sin auth → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/contacts/search?q=x",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /contacts", () => {
  it("happy path: crea en Holded con GET-back y upserta local", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/contacts",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: {
        name: "Nuevo cliente",
        nif: "11111111A",
        email: "nuevo@test.com",
        phone: "600999999",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.contact.name).toBe("Nuevo cliente");
    expect(body.contact.nif).toBe("11111111A");
    // Tiene id local distinto al de Holded.
    expect(body.contact.id).toBeTruthy();
    expect(body.contact.holdedContactId).toBeTruthy();
    await app.close();
  });

  it("HoldedSilentRejectError → 502 con mismatches", async () => {
    throwOnCreate = new HoldedSilentRejectError(
      "POST contact",
      "/invoicing/v1/contacts/h-id",
      [{ field: "code", expected: "11111111A", actual: null }],
      { id: "h-id" },
    );
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/contacts",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { name: "Test", nif: "11111111A" },
    });
    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.error).toBe("HOLDED_SILENT_REJECT");
    expect(body.mismatches).toHaveLength(1);
    expect(body.mismatches[0].field).toBe("code");
    await app.close();
  });

  it("rechaza si tenant no tiene API Key (409 NO_HOLDED_KEY)", async () => {
    tenantStore.get(TENANT_ID)!.holdedApiKeyCiphertext = null;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/contacts",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { name: "Test" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("NO_HOLDED_KEY");
    await app.close();
  });

  it("rechaza body sin name → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/contacts",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { nif: "12345678A" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
