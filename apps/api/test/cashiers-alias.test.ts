// v1.7-alias-cajeros. Alias obligatorio en el alta de cajeros, editable
// vía PATCH, y unicidad case-insensitive POR TENANT entre cajeros
// activos (los revocados con email sentinel @revoked.local no bloquean).
// Mocks Prisma en memoria, mismo harness que stores-route.test.ts.

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

interface FakeUser {
  id: string;
  tenantId: string;
  email: string;
  alias: string | null;
  pinHash: string | null;
  role: "OWNER" | "MANAGER" | "CASHIER";
  tokenVersion: number;
  lastLoginAt: Date | null;
  createdAt: Date;
}

const users = new Map<string, FakeUser>();

function filter(pred: (u: FakeUser) => boolean): FakeUser[] {
  return Array.from(users.values()).filter(pred);
}

function matchesWhere(u: FakeUser, where: any): boolean {
  if (where.id && u.id !== where.id) return false;
  if (where.tenantId && u.tenantId !== where.tenantId) return false;
  if (where.role?.in && !where.role.in.includes(u.role)) return false;
  if (where.email && typeof where.email === "string" && u.email !== where.email)
    return false;
  if (where.alias?.equals !== undefined) {
    if (u.alias == null) return false;
    const insensitive = where.alias.mode === "insensitive";
    const a = insensitive ? u.alias.toLowerCase() : u.alias;
    const b = insensitive
      ? String(where.alias.equals).toLowerCase()
      : String(where.alias.equals);
    if (a !== b) return false;
  }
  if (where.NOT) {
    const nots = Array.isArray(where.NOT) ? where.NOT : [where.NOT];
    for (const n of nots) {
      if (n.email?.endsWith && u.email.endsWith(n.email.endsWith)) return false;
      if (n.id && u.id === n.id) return false;
    }
  }
  return true;
}

const fakePrisma = {
  user: {
    findMany: vi.fn(async ({ where }: any) =>
      filter((u) => matchesWhere(u, where)).sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      ),
    ),
    findFirst: vi.fn(
      async ({ where }: any) => filter((u) => matchesWhere(u, where))[0] ?? null,
    ),
    findUnique: vi.fn(
      async ({ where }: any) =>
        filter((u) => u.email === where.email || u.id === where.id)[0] ?? null,
    ),
    create: vi.fn(async ({ data }: any) => {
      const u: FakeUser = {
        id: randomUUID(),
        tenantId: data.tenantId,
        email: data.email,
        alias: data.alias ?? null,
        pinHash: data.pinHash ?? null,
        role: data.role,
        tokenVersion: 0,
        lastLoginAt: null,
        createdAt: new Date(),
      };
      users.set(u.id, u);
      return u;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const u = users.get(where.id)!;
      if (data.alias !== undefined) u.alias = data.alias;
      if (data.email !== undefined) u.email = data.email;
      if (data.pinHash !== undefined) u.pinHash = data.pinHash;
      if (data.tokenVersion?.increment) u.tokenVersion += data.tokenVersion.increment;
      return u;
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerCashiersRoutes } = await import("../src/cashiers/routes.js");

const TENANT_A = "00000000-0000-0000-0000-00000000000a";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";
const OWNER_A = "00000000-0000-0000-0000-0000000000a9";

function ownerToken(tenantId = TENANT_A) {
  return jwt.sign(
    { sub: OWNER_A, tid: tenantId, role: "OWNER", type: "access" },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: "15m" },
  );
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerCashiersRoutes(app);
  return app;
}

function seedCashier(overrides: Partial<FakeUser> = {}): FakeUser {
  const u: FakeUser = {
    id: randomUUID(),
    tenantId: TENANT_A,
    email: `c-${randomUUID().slice(0, 8)}@bar.es`,
    alias: null,
    pinHash: "x",
    role: "CASHIER",
    tokenVersion: 0,
    lastLoginAt: null,
    createdAt: new Date(),
    ...overrides,
  };
  users.set(u.id, u);
  return u;
}

async function createCashier(
  app: Awaited<ReturnType<typeof buildApp>>,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: "/cashiers",
    headers: { authorization: `Bearer ${ownerToken()}` },
    payload: {
      email: `nuevo-${randomUUID().slice(0, 8)}@bar.es`,
      alias: "María",
      role: "CASHIER",
      pin: "1234",
      ...payload,
    },
  });
}

beforeEach(() => {
  users.clear();
  vi.clearAllMocks();
});

describe("POST /cashiers · alias obligatorio", () => {
  it("sin alias → 400 (schema)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/cashiers",
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { email: "a@bar.es", role: "CASHIER", pin: "1234" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("alias sólo-espacios → 400 INVALID_ALIAS", async () => {
    const app = await buildApp();
    const res = await createCashier(app, { alias: "   " });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_ALIAS");
  });

  it("alias válido → 201, se guarda con trim y vuelve en el listado", async () => {
    const app = await buildApp();
    const res = await createCashier(app, { alias: "  María  " });
    expect(res.statusCode).toBe(201);
    expect(res.json().cashier.alias).toBe("María");

    const list = await app.inject({
      method: "GET",
      url: "/cashiers",
      headers: { authorization: `Bearer ${ownerToken()}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().cashiers[0].alias).toBe("María");
  });
});

describe("POST /cashiers · unicidad por tenant", () => {
  it("duplicado case-insensitive en el mismo tenant → 409 con mensaje humano", async () => {
    seedCashier({ alias: "María" });
    const app = await buildApp();
    const res = await createCashier(app, { alias: "maría" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("ALIAS_TAKEN");
    expect(res.json().message).toBe("Ya hay un cajero llamado maría");
  });

  it("mismo alias en OTRO tenant → 201 (unicidad es por tenant)", async () => {
    seedCashier({ alias: "María", tenantId: TENANT_B });
    const app = await buildApp();
    const res = await createCashier(app, { alias: "María" });
    expect(res.statusCode).toBe(201);
  });

  it("alias de un cajero revocado no bloquea el alta", async () => {
    seedCashier({
      alias: "María",
      email: "revoked-123-abc@revoked.local",
      pinHash: null,
    });
    const app = await buildApp();
    const res = await createCashier(app, { alias: "María" });
    expect(res.statusCode).toBe(201);
  });
});

describe("PATCH /cashiers/:id · alias editable", () => {
  it("edita el alias con trim", async () => {
    const c = seedCashier({ alias: "María" });
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/cashiers/${c.id}`,
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { alias: "  Mari  " },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().cashier.alias).toBe("Mari");
    expect(users.get(c.id)!.alias).toBe("Mari");
  });

  it("editar hacia un alias ya usado en el tenant → 409", async () => {
    seedCashier({ alias: "Pedro" });
    const c = seedCashier({ alias: "María" });
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/cashiers/${c.id}`,
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { alias: "pedro" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("ALIAS_TAKEN");
  });

  it("re-guardar su propio alias no colisiona consigo mismo", async () => {
    const c = seedCashier({ alias: "María" });
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/cashiers/${c.id}`,
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { alias: "maría" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("cajero de otro tenant → 404", async () => {
    const c = seedCashier({ alias: "María", tenantId: TENANT_B });
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/cashiers/${c.id}`,
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { alias: "Otra" },
    });
    expect(res.statusCode).toBe(404);
  });
});
