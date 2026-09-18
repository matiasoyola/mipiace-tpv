// B-reservas-mostrador F6 · el contacto de Holded se hace cliente del CRM.
//
// Prisma en memoria, como el resto de los tests de ruta. Lo que se fija aquí
// es el CONTRATO del endpoint: qué crea, qué devuelve cuando ya existía, a
// quién se niega, y que el cerrojo se pide ANTES de leer. La carrera de
// verdad —dos altas simultáneas contra Postgres— es del e2e
// (`test-e2e/crm-contacto.e2e.ts`): un fake no puede demostrar un cerrojo.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeClient {
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

interface FakeContact {
  id: string;
  tenantId: string;
  holdedContactId: string;
  name: string;
  email: string | null;
  phone: string | null;
  type: string | null;
}

const clientStore = new Map<string, FakeClient>();
const contactStore = new Map<string, FakeContact>();
/** Todo el SQL crudo que ha pasado por aquí, en orden. El cerrojo tiene que
 *  ser lo PRIMERO de la transacción: si se lee antes de pedirlo, se lee sin
 *  protección y el cerrojo no sirve para nada. */
let sqlCrudo: Array<{ sql: string; args: unknown[] }> = [];
/** Marcas de orden dentro de la transacción, para poder afirmar el «antes». */
let orden: string[] = [];

const fakePrisma = {
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    orden.push("tx:abre");
    const r = await fn(fakePrisma);
    orden.push("tx:cierra");
    return r;
  }),
  $executeRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
    sqlCrudo.push({ sql, args });
    orden.push("cerrojo");
    return 1;
  }),
  // El historial de la ficha usa SQL crudo por su lado; no es de este test.
  $queryRawUnsafe: vi.fn(async () => []),
  contact: {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const c of contactStore.values()) {
        if (c.tenantId !== where.tenantId) continue;
        if (where.id && c.id !== where.id) continue;
        return c;
      }
      return null;
    }),
  },
  client: {
    findFirst: vi.fn(async ({ where }: any) => {
      orden.push("busca-cliente");
      for (const c of clientStore.values()) {
        if (c.tenantId !== where.tenantId) continue;
        if (
          where.holdedContactId !== undefined &&
          c.holdedContactId !== where.holdedContactId
        ) {
          continue;
        }
        if (where.id && c.id !== where.id) continue;
        if (where.externalId && c.externalId !== where.externalId) continue;
        return c;
      }
      return null;
    }),
    create: vi.fn(async ({ data }: any) => {
      orden.push("crea-cliente");
      const row: FakeClient = {
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
    findMany: vi.fn(async () => []),
    update: vi.fn(async () => null),
  },
  clientConsent: { findMany: vi.fn(async () => []), create: vi.fn() },
  clientTechnicalNote: { findMany: vi.fn(async () => []), create: vi.fn() },
  ticket: { findMany: vi.fn(async () => []) },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { registerCrmRoutes } = await import("../src/crm/routes.js");
const { partirNombre, esContactoDeCliente } = await import(
  "../src/crm/from-contact.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-000000000002";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const cabecera = (role: "CASHIER" | "OWNER" = "CASHIER") => ({
  authorization: `Bearer ${signAccessToken({ sub: USER_ID, tid: TENANT_ID, role })}`,
});

async function buildApp() {
  const app = Fastify();
  await registerCrmRoutes(app);
  return app;
}

function seedContacto(opts: Partial<FakeContact> = {}): FakeContact {
  const row: FakeContact = {
    id: opts.id ?? randomUUID(),
    tenantId: opts.tenantId ?? TENANT_ID,
    holdedContactId: opts.holdedContactId ?? `h-${randomUUID().slice(0, 8)}`,
    name: opts.name ?? "Carmen Ruiz Delgado",
    email: opts.email ?? null,
    phone: opts.phone ?? null,
    type: opts.type === undefined ? "CLIENT" : opts.type,
  };
  contactStore.set(row.id, row);
  return row;
}

function seedCliente(opts: Partial<FakeClient> = {}): FakeClient {
  const row: FakeClient = {
    id: opts.id ?? randomUUID(),
    tenantId: opts.tenantId ?? TENANT_ID,
    externalId: opts.externalId ?? null,
    firstName: opts.firstName ?? "Nombre",
    lastName: opts.lastName ?? "Apellido",
    phone: opts.phone ?? null,
    email: opts.email ?? null,
    birthdate: null,
    holdedContactId: opts.holdedContactId ?? null,
    marketingOptIn: false,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  clientStore.set(row.id, row);
  return row;
}

beforeEach(() => {
  clientStore.clear();
  contactStore.clear();
  sqlCrudo = [];
  orden = [];
});

// ── Partir el nombre ──────────────────────────────────────────────────

describe("partirNombre · la primera palabra es el nombre, el resto apellidos", () => {
  it("dos palabras", () => {
    expect(partirNombre("Carmen Ruiz")).toEqual({
      firstName: "Carmen",
      lastName: "Ruiz",
    });
  });

  it("cuatro palabras: todo lo que no es la primera son apellidos", () => {
    expect(partirNombre("Ana Belén Soto Gil")).toEqual({
      firstName: "Ana",
      lastName: "Belén Soto Gil",
    });
  });

  it("UNA palabra deja los apellidos vacíos, que ahora se puede", () => {
    expect(partirNombre("Sole")).toEqual({ firstName: "Sole", lastName: "" });
  });

  it("espacios de sobra no crean apellidos de aire", () => {
    expect(partirNombre("  Carmen   Ruiz  ")).toEqual({
      firstName: "Carmen",
      lastName: "Ruiz",
    });
    expect(partirNombre("  Sole  ")).toEqual({ firstName: "Sole", lastName: "" });
  });

  it("un nombre que son SÓLO espacios no inventa nada", () => {
    expect(partirNombre("   ")).toEqual({
      firstName: "(sin nombre)",
      lastName: "",
    });
  });

  it("no desborda el largo de la columna", () => {
    const largo = partirNombre(`${"A".repeat(300)} ${"B".repeat(300)}`);
    expect(largo.firstName).toHaveLength(120);
    expect(largo.lastName).toHaveLength(120);
  });
});

describe("esContactoDeCliente · el mismo criterio que el buscador del cajero", () => {
  it("CLIENT y UNKNOWN sí; null también (anterior al backfill b29)", () => {
    expect(esContactoDeCliente("CLIENT" as never)).toBe(true);
    expect(esContactoDeCliente("UNKNOWN" as never)).toBe(true);
    expect(esContactoDeCliente(null)).toBe(true);
  });

  it("proveedor, lead, deudor y acreedor NO", () => {
    for (const t of ["SUPPLIER", "LEAD", "DEBTOR", "CREDITOR"]) {
      expect(esContactoDeCliente(t as never)).toBe(false);
    }
  });
});

// ── El endpoint ───────────────────────────────────────────────────────

describe("POST /clients/from-contact/:contactId", () => {
  it("crea el cliente enlazado, partiendo el nombre y copiando los datos", async () => {
    const c = seedContacto({
      name: "Carmen Ruiz Delgado",
      phone: "600111222",
      email: "carmen@x.com",
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clients/from-contact/${c.id}`,
      headers: cabecera(),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.created).toBe(true);
    expect(body.client).toMatchObject({
      firstName: "Carmen",
      lastName: "Ruiz Delgado",
      phone: "600111222",
      email: "carmen@x.com",
      holdedContactId: c.holdedContactId,
    });
    expect(clientStore.size).toBe(1);
    await app.close();
  });

  it("un contacto de una sola palabra entra sin apellidos", async () => {
    const c = seedContacto({ name: "Sole" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clients/from-contact/${c.id}`,
      headers: cabecera(),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().client.lastName).toBe("");
    await app.close();
  });

  it("LLAMARLO DOS VECES deja UN cliente, y devuelve el mismo", async () => {
    const c = seedContacto();
    const app = await buildApp();
    const primera = await app.inject({
      method: "POST",
      url: `/clients/from-contact/${c.id}`,
      headers: cabecera(),
    });
    const segunda = await app.inject({
      method: "POST",
      url: `/clients/from-contact/${c.id}`,
      headers: cabecera(),
    });
    expect(primera.statusCode).toBe(201);
    expect(primera.json().created).toBe(true);
    expect(segunda.statusCode).toBe(200);
    expect(segunda.json().created).toBe(false);
    expect(segunda.json().client.id).toBe(primera.json().client.id);
    expect(clientStore.size).toBe(1);
    await app.close();
  });

  it("un contacto YA enlazado por el camino de cobro devuelve ESE cliente", async () => {
    // ADR-010: el cobro rellena `holdedContactId` cuando hace falta factura.
    // Ese cliente ya existe y tiene historial; no se puede duplicar.
    const c = seedContacto({ name: "Carmen Ruiz" });
    const ya = seedCliente({
      firstName: "Carmencita",
      lastName: "Ruiz",
      holdedContactId: c.holdedContactId,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clients/from-contact/${c.id}`,
      headers: cabecera(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(false);
    expect(res.json().client.id).toBe(ya.id);
    // Y NO se pisa el nombre que el centro le puso.
    expect(res.json().client.firstName).toBe("Carmencita");
    expect(clientStore.size).toBe(1);
    await app.close();
  });

  it("EL CERROJO se pide ANTES de leer, y con el tenant y el contacto", async () => {
    const c = seedContacto();
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/clients/from-contact/${c.id}`,
      headers: cabecera(),
    });
    expect(sqlCrudo).toHaveLength(1);
    expect(sqlCrudo[0]!.sql).toContain("pg_advisory_xact_lock");
    expect(sqlCrudo[0]!.args).toEqual([TENANT_ID, c.holdedContactId]);
    // El orden es lo que hace que el cerrojo sirva: abrir, cerrar el paso,
    // mirar, crear. Leer antes de pedirlo sería leer sin protección.
    expect(orden).toEqual([
      "tx:abre",
      "cerrojo",
      "busca-cliente",
      "crea-cliente",
      "tx:cierra",
    ]);
    await app.close();
  });

  it("UN PROVEEDOR se rechaza con 409 y no crea nada", async () => {
    const c = seedContacto({ name: "Distribuciones Pérez", type: "SUPPLIER" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clients/from-contact/${c.id}`,
      headers: cabecera(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("CONTACT_NOT_CLIENT");
    expect(res.json().message).toContain("Distribuciones Pérez");
    expect(clientStore.size).toBe(0);
    await app.close();
  });

  it("tampoco al PROPIETARIO: el filtro no depende del rol", async () => {
    const c = seedContacto({ type: "SUPPLIER" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clients/from-contact/${c.id}`,
      headers: cabecera("OWNER"),
    });
    expect(res.statusCode).toBe(409);
    expect(clientStore.size).toBe(0);
    await app.close();
  });

  it("un lead, un deudor y un acreedor tampoco entran", async () => {
    const app = await buildApp();
    for (const type of ["LEAD", "DEBTOR", "CREDITOR"]) {
      const c = seedContacto({ type });
      const res = await app.inject({
        method: "POST",
        url: `/clients/from-contact/${c.id}`,
        headers: cabecera(),
      });
      expect(res.statusCode).toBe(409);
    }
    expect(clientStore.size).toBe(0);
    await app.close();
  });

  it("un contacto sin clasificar (null, previo al backfill b29) SÍ entra", async () => {
    const c = seedContacto({ type: null, name: "Lucía Prieto" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clients/from-contact/${c.id}`,
      headers: cabecera(),
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it("un contacto de OTRO tenant no existe: 404, y ni se mira el cerrojo", async () => {
    const c = seedContacto({ tenantId: OTHER_TENANT });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clients/from-contact/${c.id}`,
      headers: cabecera(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("CONTACT_NOT_FOUND");
    expect(sqlCrudo).toHaveLength(0);
    expect(clientStore.size).toBe(0);
    await app.close();
  });

  it("un id que no es uuid se rechaza en el esquema", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/clients/from-contact/no-soy-un-uuid",
      headers: cabecera(),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("sin cabecera de auth, 401", async () => {
    const c = seedContacto();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/clients/from-contact/${c.id}`,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("el enlace NO escribe en Holded: el módulo ni siquiera lo importa", async () => {
    // ADR-R2. Es un test de código a propósito: la garantía de «no escribe en
    // Holded» sólo vale si no puede hacerlo, no si hoy no lo hace.
    const { readFileSync } = await import("node:fs");
    const fuente = readFileSync(
      new URL("../src/crm/from-contact.ts", import.meta.url),
      "utf8",
    );
    // Se miran los IMPORT, no cualquier aparición de la cadena: el propio
    // comentario del módulo nombra a `holded-client` para decir que no lo usa.
    const imports = fuente
      .split("\n")
      .filter((l) => /^\s*(import|const .*=\s*(await\s*)?(import|require))\b/.test(l));
    expect(imports.join("\n")).not.toContain("holded-client");
    expect(fuente).not.toContain("createContactWithGetBack(");
  });
});
