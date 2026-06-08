// v1.4-Buscador-Contactos · tests del filtro por `type` en
// `GET /contacts/search`. Mockea Prisma en memoria y verifica:
//   - SUPPLIER/LEAD/DEBTOR/CREDITOR no aparecen en el default.
//   - CLIENT y UNKNOWN sí aparecen.
//   - `?includeAll=1` con OWNER devuelve todos.
//   - `?includeAll=1` con CASHIER devuelve 403.
//   - El fallback Holded descarta contactos remotos no-cliente.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

type ContactType =
  | "CLIENT"
  | "SUPPLIER"
  | "LEAD"
  | "DEBTOR"
  | "CREDITOR"
  | "UNKNOWN";

let phoneSearchResult: any[] = [];

vi.mock("@mipiacetpv/holded-client", async () => {
  const actual = await vi.importActual<typeof import("@mipiacetpv/holded-client")>(
    "@mipiacetpv/holded-client",
  );
  return {
    ...actual,
    ApiKeyClient: vi.fn().mockImplementation(() => ({})) as any,
    listContactsByPhone: vi.fn(async () => phoneSearchResult),
    createContactWithGetBack: vi.fn(),
  };
});

interface FakeContactRow {
  id: string;
  tenantId: string;
  holdedContactId: string;
  name: string;
  nif: string | null;
  email: string | null;
  phone: string | null;
  type: ContactType | null;
  active: boolean;
  raw?: object | null;
}

const contactStore = new Map<string, FakeContactRow>();
const tenantStore = new Map<
  string,
  { id: string; holdedApiKeyCiphertext: string | null }
>();

function matchesType(
  row: FakeContactRow,
  filter:
    | { in: readonly ContactType[] }
    | undefined,
): boolean {
  if (!filter) return true;
  return row.type !== null && filter.in.includes(row.type);
}

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
      const typeFilter = where.type as
        | { in: readonly ContactType[] }
        | undefined;
      const list = [...contactStore.values()].filter(
        (c) =>
          c.tenantId === where.tenantId &&
          c.active &&
          matchesType(c, typeFilter) &&
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
        type: c.type,
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
        type: create.type ?? null,
        active: true,
      };
      contactStore.set(key, row);
      return { ...row };
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

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const CASHIER_ID = "22222222-2222-2222-2222-222222222222";

const OWNER_TOKEN = signAccessToken({ sub: OWNER_ID, tid: TENANT_ID, role: "OWNER" });
const CASHIER_TOKEN = signAccessToken({
  sub: CASHIER_ID,
  tid: TENANT_ID,
  role: "CASHIER",
});

async function buildApp() {
  const app = Fastify();
  await registerContactsRoutes(app);
  return app;
}

function seed(opts: Partial<FakeContactRow> & { name: string }) {
  const id = randomUUID();
  const row: FakeContactRow = {
    id,
    tenantId: TENANT_ID,
    holdedContactId: opts.holdedContactId ?? "h-" + id.slice(0, 8),
    name: opts.name,
    nif: opts.nif ?? null,
    email: opts.email ?? null,
    phone: opts.phone ?? null,
    type: opts.type ?? null,
    active: opts.active ?? true,
  };
  contactStore.set(`${row.tenantId}|${row.holdedContactId}`, row);
  return row;
}

beforeEach(() => {
  contactStore.clear();
  tenantStore.clear();
  tenantStore.set(TENANT_ID, {
    id: TENANT_ID,
    holdedApiKeyCiphertext: FAKE_CIPHERTEXT,
  });
  phoneSearchResult = [];
});

describe("GET /contacts/search · filtro por tipo (v1.4)", () => {
  it("default oculta SUPPLIER pero deja pasar CLIENT", async () => {
    seed({ name: "Cliente Marta", type: "CLIENT" });
    seed({ name: "Marta Distribuidora SL", type: "SUPPLIER" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/contacts/search?q=marta",
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results.map((r: any) => r.name)).toEqual(["Cliente Marta"]);
    expect(body.results[0].type).toBe("CLIENT");
  });

  it("default deja pasar UNKNOWN (contactos pre-backfill)", async () => {
    seed({ name: "Carlos Pre-Backfill", type: "UNKNOWN" });
    seed({ name: "Carlos Proveedor", type: "SUPPLIER" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/contacts/search?q=carlos",
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const names = res.json().results.map((r: any) => r.name);
    expect(names).toContain("Carlos Pre-Backfill");
    expect(names).not.toContain("Carlos Proveedor");
  });

  it("default oculta LEAD, DEBTOR y CREDITOR", async () => {
    seed({ name: "Lead Lola", type: "LEAD" });
    seed({ name: "Deudor Daniel", type: "DEBTOR" });
    seed({ name: "Acreedor Andrés", type: "CREDITOR" });
    seed({ name: "Cliente Clara", type: "CLIENT" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/contacts/search?q=" + encodeURIComponent("a"),
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    const names = res.json().results.map((r: any) => r.name);
    expect(names).toEqual(["Cliente Clara"]);
  });

  it("?includeAll=1 con OWNER devuelve TODOS los tipos", async () => {
    seed({ name: "Cliente Carla", type: "CLIENT" });
    seed({ name: "Carla Proveedora", type: "SUPPLIER" });
    seed({ name: "Carla Lead", type: "LEAD" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/contacts/search?q=carla&includeAll=1",
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const names = res.json().results.map((r: any) => r.name).sort();
    expect(names).toEqual(["Carla Lead", "Carla Proveedora", "Cliente Carla"]);
  });

  it("?includeAll=1 con CASHIER devuelve 403", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/contacts/search?q=x&includeAll=1",
      headers: { authorization: `Bearer ${CASHIER_TOKEN}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
  });

  it("fallback Holded descarta contacto remoto SUPPLIER", async () => {
    phoneSearchResult = [
      {
        id: "h-supplier-1",
        name: "Distribuidor S.L.",
        phone: "+34 600 111 222",
        type: "supplier",
      },
    ];
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/contacts/search?q=" + encodeURIComponent("+34 600 111 222"),
      headers: { authorization: `Bearer ${CASHIER_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toEqual([]);
    // Y no se upsertó tampoco — no queremos "ensuciar" la BD local
    // con proveedores recuperados desde el TPV.
    expect(contactStore.has(`${TENANT_ID}|h-supplier-1`)).toBe(false);
  });

  it("fallback Holded upserta y devuelve contacto remoto CLIENT", async () => {
    phoneSearchResult = [
      {
        id: "h-client-1",
        name: "Marisa González",
        code: "12345678A",
        phone: "+34 600 999 888",
        type: "client",
      },
    ];
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/contacts/search?q=" + encodeURIComponent("+34 600 999 888"),
      headers: { authorization: `Bearer ${CASHIER_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe("holded");
    expect(body.results).toHaveLength(1);
    expect(body.results[0].type).toBe("CLIENT");
    expect(contactStore.has(`${TENANT_ID}|h-client-1`)).toBe(true);
  });
});
