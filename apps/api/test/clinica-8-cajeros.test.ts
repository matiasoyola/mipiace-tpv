// clinica-8 · EN «CAJEROS» SÓLO SALE EL PERSONAL DEL COMERCIO.
//
// La auditoría del 18-10 abrió Cajeros de la clínica y encontró UN cajero:
// `mipiacetpv-test-7eb85ef5@internal.mipiacetpv.tech`, el cajero técnico de
// «Probar TPV», con sus botones de Editar, Cambiar PIN y Revocar. Le cambió
// el PIN desde el panel de la dueña. Después lo revocó, y pasó a salir como
// `revoked-1792…@revoked.local`, con los mismos tres botones.
//
// Las dos cosas son el mismo agujero: la lista no distinguía al personal
// del cliente de tres clases de usuario que no lo son. Y no es cosmética —
// la revocación deja `pin_hash = NULL`, así que el cajero no entra; pero
// «Cambiar PIN» le pone uno nuevo. O sea que desde esa pantalla se podía
// **resucitar a un cajero revocado y al cajero técnico de Mi Piace**.
//
// Por eso el filtro va en las CUATRO rutas y no sólo en la lista: esconder
// el botón no cierra la ruta.

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
  role: "OWNER" | "MANAGER" | "CASHIER" | "CLINICIAN";
  tokenVersion: number;
  lastLoginAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  isTestCashier: boolean;
}

const users = new Map<string, FakeUser>();

// El fake SÍ mira `deletedAt` y `isTestCashier`: es exactamente lo que
// este banco prueba, y un fake que los ignorara saldría verde con el
// filtro quitado.
function matchesWhere(u: FakeUser, where: any): boolean {
  if (!where) return true;
  if (where.id && u.id !== where.id) return false;
  if (where.tenantId && u.tenantId !== where.tenantId) return false;
  if (where.role?.in && !where.role.in.includes(u.role)) return false;
  if (where.deletedAt === null && u.deletedAt !== null) return false;
  if (where.isTestCashier === false && u.isTestCashier) return false;
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

function filter(where: any): FakeUser[] {
  return [...users.values()].filter((u) => matchesWhere(u, where));
}

const fakePrisma = {
  user: {
    findMany: vi.fn(async ({ where }: any) =>
      filter(where).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    ),
    findFirst: vi.fn(async ({ where }: any) => {
      const u = filter(where)[0];
      // El DELETE pide `_count` para contar lo que conserva (turnos y
      // tickets). Sin él, el handler revienta con un 500 y el test
      // saldría «rojo» por el fake y no por el código.
      return u ? { ...u, _count: { shifts: 0, tickets: 0 } } : null;
    }),
    findUnique: vi.fn(
      async ({ where }: any) =>
        [...users.values()].find(
          (u) => u.email === where.email || u.id === where.id,
        ) ?? null,
    ),
    update: vi.fn(async ({ where, data }: any) => {
      const u = users.get(where.id)!;
      if (data.email !== undefined) u.email = data.email;
      if (data.alias !== undefined) u.alias = data.alias;
      if (data.pinHash !== undefined) u.pinHash = data.pinHash;
      if (data.tokenVersion?.increment)
        u.tokenVersion += data.tokenVersion.increment;
      return u;
    }),
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
        deletedAt: null,
        isTestCashier: false,
      };
      users.set(u.id, u);
      return u;
    }),
    count: vi.fn(async () => 0),
  },
  tenant: {
    findUnique: vi.fn(async () => ({
      cajaEnabled: true,
      clinicalRecordsEnabled: true,
    })),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerCashiersRoutes } = await import("../src/cashiers/routes.js");

const TENANT = "00000000-0000-0000-0000-00000000000a";
const OWNER = "00000000-0000-0000-0000-0000000000a9";

function ownerToken() {
  return jwt.sign(
    { sub: OWNER, tid: TENANT, role: "OWNER", type: "access" },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: "15m" },
  );
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerCashiersRoutes(app);
  return app;
}

function seed(overrides: Partial<FakeUser> = {}): FakeUser {
  const u: FakeUser = {
    id: randomUUID(),
    tenantId: TENANT,
    email: `c-${randomUUID().slice(0, 8)}@clinica.es`,
    alias: "Marta",
    pinHash: "x",
    role: "CASHIER",
    tokenVersion: 0,
    lastLoginAt: null,
    createdAt: new Date(),
    deletedAt: null,
    isTestCashier: false,
    ...overrides,
  };
  users.set(u.id, u);
  return u;
}

/** El cajero técnico de «Probar TPV», tal cual lo crea el super-admin. */
function cajeroTecnico(deleted = false): FakeUser {
  return seed({
    email: "mipiacetpv-test-7eb85ef5@internal.mipiacetpv.tech",
    alias: null,
    role: "MANAGER",
    isTestCashier: true,
    deletedAt: deleted ? new Date() : null,
  });
}

/** Uno revocado: la revocación es un soft-delete con email centinela. */
function revocado(): FakeUser {
  return seed({
    email: `revoked-${Date.now()}-${randomUUID()}@revoked.local`,
    pinHash: null,
  });
}

async function listar() {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/cashiers",
    headers: { authorization: `Bearer ${ownerToken()}` },
  });
  return res.json().cashiers as Array<{ id: string; email: string }>;
}

beforeEach(() => {
  users.clear();
  vi.clearAllMocks();
});

describe("clinica-8 · la lista de Cajeros", () => {
  it("enseña al personal del comercio", async () => {
    const marta = seed({ alias: "Marta" });
    expect((await listar()).map((c) => c.id)).toEqual([marta.id]);
  });

  it("NO enseña al cajero técnico de «Probar TPV»", async () => {
    const marta = seed();
    cajeroTecnico();
    const lista = await listar();
    expect(lista.map((c) => c.id)).toEqual([marta.id]);
    expect(JSON.stringify(lista)).not.toContain("internal.mipiacetpv.tech");
  });

  it("NO enseña al que ya está borrado (lo que hace la activación)", async () => {
    const marta = seed();
    cajeroTecnico(true);
    expect((await listar()).map((c) => c.id)).toEqual([marta.id]);
  });

  it("NO enseña a los revocados como «revoked-17…»", async () => {
    const marta = seed();
    revocado();
    const lista = await listar();
    expect(lista.map((c) => c.id)).toEqual([marta.id]);
    expect(JSON.stringify(lista)).not.toContain("@revoked.local");
  });
});

describe("clinica-8 · y las rutas que ESCRIBEN tampoco los alcanzan", () => {
  it("no se le puede poner un PIN al cajero técnico", async () => {
    // Es lo que la auditoría hizo sin querer: «PIN actualizado» sobre un
    // usuario interno de Mi Piace con acceso a la caja del cliente.
    const tecnico = cajeroTecnico();
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/cashiers/${tecnico.id}/pin`,
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { pin: "4321" },
    });
    expect(res.statusCode).toBe(404);
    expect(users.get(tecnico.id)!.pinHash).toBe("x");
  });

  it("ni resucitar a un revocado poniéndole un PIN nuevo", async () => {
    const fuera = revocado();
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/cashiers/${fuera.id}/pin`,
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { pin: "4321" },
    });
    expect(res.statusCode).toBe(404);
    // Sigue sin PIN: sigue sin poder entrar.
    expect(users.get(fuera.id)!.pinHash).toBeNull();
  });

  it("ni renombrarlo, ni volver a revocarlo", async () => {
    const fuera = revocado();
    const app = await buildApp();
    const patch = await app.inject({
      method: "PATCH",
      url: `/cashiers/${fuera.id}`,
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { alias: "Fantasma" },
    });
    expect(patch.statusCode).toBe(404);
    const del = await app.inject({
      method: "DELETE",
      url: `/cashiers/${fuera.id}`,
      headers: { authorization: `Bearer ${ownerToken()}` },
    });
    expect(del.statusCode).toBe(404);
  });

  it("y al personal de verdad se le sigue pudiendo todo", async () => {
    // La otra mitad: el filtro no puede dejar fuera a quien sí es
    // personal del comercio.
    const marta = seed({ alias: "Marta" });
    const app = await buildApp();
    const patch = await app.inject({
      method: "PATCH",
      url: `/cashiers/${marta.id}`,
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { alias: "Marta R." },
    });
    expect(patch.statusCode).toBe(200);
    const pin = await app.inject({
      method: "PATCH",
      url: `/cashiers/${marta.id}/pin`,
      headers: { authorization: `Bearer ${ownerToken()}` },
      payload: { pin: "9876" },
    });
    expect(pin.statusCode).toBe(200);
    const del = await app.inject({
      method: "DELETE",
      url: `/cashiers/${marta.id}`,
      headers: { authorization: `Bearer ${ownerToken()}` },
    });
    expect(del.statusCode).toBe(200);
    // Y tras revocarlo, desaparece de la lista con su centinela.
    expect(await listar()).toEqual([]);
  });
});
