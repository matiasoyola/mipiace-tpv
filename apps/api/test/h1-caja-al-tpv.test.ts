// H1 · `cajaEnabled` viaja al TPV, y la puerta está dentro del handler.
//
// Lo que este banco fija:
//
//   1. `GET /tpv/catalog/products` devuelve `cajaEnabled` en la primera
//      página, junto a `crmEnabled` y `agendaEnabled`.
//   2. Con la caja apagada devuelve 403 CAJA_DISABLED con frase, en vez
//      de servir un catálogo que el TPV no puede usar.
//   3. La puerta vive DENTRO del handler y no en un `preHandler`, para
//      no añadir una consulta por cada cursor de paginación (ver la nota
//      del fichero de rutas y `tpv-catalog-business-type.test.ts`).
//
// Sabotaje que este fichero pone en rojo (§3 del done):
//   · que `cajaEnabled` no llegue al TPV (nº 5)

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
const REGISTER_ID = "00000000-0000-0000-0000-0000000000bb";
const DEVICE_ID = "00000000-0000-0000-0000-0000000000cc";
const CASHIER_ID = "00000000-0000-0000-0000-0000000000dd";

let row: Record<string, unknown> = {};

const fakePrisma = {
  tenant: {
    findUnique: vi.fn(async ({ where }: any) =>
      where.id === TENANT ? row : null,
    ),
  },
  product: { findMany: vi.fn(async () => []) },
  modifierGroup: { findMany: vi.fn(async () => []) },
  tagAlias: { findMany: vi.fn(async () => []) },
  ticket: { count: vi.fn(async () => 0) },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

vi.mock("../src/tickets/health.js", () => ({
  getTenantHealthStatus: vi.fn(async () => ({
    level: "ok",
    reason: "ok",
    hasHoldedKey: true,
    lastSuccessfulSyncAt: null,
    lastSyncAgeMs: null,
    blockedAt: null,
  })),
}));

const { registerTpvCatalogRoutes } = await import("../src/tpv-catalog/routes.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");

function signSession() {
  return signCashierSession(
    { sub: CASHIER_ID, tid: TENANT, did: DEVICE_ID, rid: REGISTER_ID, role: "CASHIER" },
    10,
  );
}

async function pull(cursor?: string) {
  const app = Fastify();
  await registerTpvCatalogRoutes(app);
  const res = await app.inject({
    method: "GET",
    url: `/tpv/catalog/products${cursor ? `?cursor=${cursor}` : ""}`,
    headers: { authorization: `Bearer ${signSession()}` },
  });
  await app.close();
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  row = {
    businessType: "SERVICES",
    tpvIconPreset: null,
    creditSalesEnabled: false,
    crmEnabled: true,
    agendaEnabled: true,
    cajaEnabled: true,
    // catalogo-local (addendum 3) · el interruptor de Holded viaja con
    // sus hermanos. Aquí NO gatea nada: el TPV lo usa para una frase.
    holdedEnabled: true,
  };
});

describe("H1 · GET /tpv/catalog/products con caja", () => {
  it("manda cajaEnabled junto a crmEnabled y agendaEnabled", async () => {
    const res = await pull();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cajaEnabled).toBe(true);
    expect(body.crmEnabled).toBe(true);
    expect(body.agendaEnabled).toBe(true);
  });
});

// ── catalogo-local · addendum 3 ───────────────────────────────────────
describe("catalogo-local · holdedEnabled viaja al TPV", () => {
  it("va en la primera página, junto a los otros flags", async () => {
    const body = (await pull()).json();
    expect(body.holdedEnabled).toBe(true);
  });

  it("el comercio de catálogo local lo recibe en false", async () => {
    // Es lo único que le permite al TPV acertar la frase del catálogo
    // vacío. Sin este dato le decía "Configúralos en Holded o
    // sincroniza", que es mandarlo a un ERP que no ha comprado.
    row.holdedEnabled = false;
    const body = (await pull()).json();
    expect(body.holdedEnabled).toBe(false);
    // Y NO cierra nada: sigue sirviendo su catálogo con normalidad.
    expect(body.items).toBeDefined();
  });

  it("no se confunde con la caja: son dos interruptores distintos", async () => {
    row.holdedEnabled = false;
    row.cajaEnabled = true;
    const body = (await pull()).json();
    expect(body.cajaEnabled).toBe(true);
    expect(body.holdedEnabled).toBe(false);
  });
});

describe("H1 · GET /tpv/catalog/products sin caja", () => {
  it("responde 403 CAJA_DISABLED con una frase, no un catálogo vacío", async () => {
    row.cajaEnabled = false;
    const res = await pull();
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe("CAJA_DISABLED");
    expect(body.message).toMatch(/caja/i);
    expect(body.message.length).toBeGreaterThan(20);
  });

  it("no sirve ni un producto", async () => {
    row.cajaEnabled = false;
    const res = await pull();
    expect(res.json().items).toBeUndefined();
  });
});

describe("H1 · la puerta no encarece la paginación", () => {
  it("la página 2 no vuelve a consultar el tenant", async () => {
    // Es la razón de que esta ruta lleve el gate dentro del handler y no
    // en un `preHandler`: un preHandler consultaría en CADA cursor.
    await pull("00000000-0000-0000-0000-0000000000ee");
    expect(fakePrisma.tenant.findUnique).not.toHaveBeenCalled();
  });
});
