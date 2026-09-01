// v1.14-la-comanda-se-ve §4 · GET /tpv/catalog/top-sellers.
//
// El estado vacío del ticket deja de ser una pantalla en blanco: una
// mesa recién abierta es el punto de mayor intención del turno, así que
// ahí van los cinco productos que más se están vendiendo.
//
// Lo que estos tests fijan, que es donde un ranking se estropea sin que
// nadie lo note:
//
//   - Sólo cuentan ventas de verdad: un DRAFT es una mesa abierta (no se
//     ha vendido nada), un VOIDED es una mesa vaciada y un TEST es el
//     cajero técnico del onboarding.
//   - El corte es por unidades, no por importe: lo que acelera la
//     comanda es lo que más veces se pulsa, no lo que más factura.
//   - El turno manda, pero un turno recién abierto con una venta no es
//     señal: por debajo de la mitad de los huecos se cae al último mes.
//   - Lo que ya no está en el catálogo no se ofrece.
//   - Aislamiento por tenant.

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
const REGISTER = "00000000-0000-0000-0000-000000000003";
const DEVICE = "00000000-0000-0000-0000-000000000004";
const CASHIER = "00000000-0000-0000-0000-000000000005";
const SHIFT = "00000000-0000-0000-0000-00000000000e";
const OTRO_SHIFT = "00000000-0000-0000-0000-00000000000f";

const CAFE = "00000000-0000-0000-0000-0000000000c1";
const CROISSANT = "00000000-0000-0000-0000-0000000000c2";
const VINO = "00000000-0000-0000-0000-0000000000c3";
const BORRADO = "00000000-0000-0000-0000-0000000000c9";

interface FakeLine {
  productId: string | null;
  units: number;
  ticket: {
    tenantId: string;
    status: string;
    shiftId: string;
    createdAt: Date;
  };
}

const state = {
  lines: [] as FakeLine[],
  productosVivos: new Set<string>(),
};

/** Réplica mínima de `prisma.ticketLine.groupBy` para lo que usa la ruta. */
const fakePrisma = {
  ticketLine: {
    groupBy: vi.fn(async ({ where, orderBy: _orderBy, take }: any) => {
      const statuses: string[] = where.ticket.status.in;
      const filtradas = state.lines.filter((l) => {
        if (l.productId == null) return false;
        const t = l.ticket;
        if (t.tenantId !== where.ticket.tenantId) return false;
        if (!statuses.includes(t.status)) return false;
        if (where.ticket.shiftId && t.shiftId !== where.ticket.shiftId) {
          return false;
        }
        if (where.ticket.createdAt?.gte && t.createdAt < where.ticket.createdAt.gte) {
          return false;
        }
        return true;
      });
      const sumas = new Map<string, number>();
      for (const l of filtradas) {
        sumas.set(l.productId!, (sumas.get(l.productId!) ?? 0) + l.units);
      }
      return Array.from(sumas.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, take)
        .map(([productId, units]) => ({ productId, _sum: { units } }));
    }),
  },
  product: {
    findMany: vi.fn(async ({ where }: any) => {
      const ids: string[] = where.id.in;
      return ids
        .filter((id) => state.productosVivos.has(id))
        .map((id) => ({ id }));
    }),
  },
};

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}) as never,
  shutdown: async () => undefined,
}));

const { registerTpvCatalogRoutes } = await import("../src/tpv-catalog/routes.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");

function signSession(tid = TENANT) {
  return signCashierSession(
    { sub: CASHIER, tid, did: DEVICE, rid: REGISTER, role: "CASHIER" },
    10,
  );
}

async function buildApp() {
  const app = Fastify();
  await registerTpvCatalogRoutes(app);
  return app;
}

function linea(
  productId: string,
  units: number,
  over: Partial<FakeLine["ticket"]> = {},
): FakeLine {
  return {
    productId,
    units,
    ticket: {
      tenantId: TENANT,
      status: "PAID",
      shiftId: SHIFT,
      createdAt: new Date(),
      ...over,
    },
  };
}

async function get(query: string, tid = TENANT) {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: `/tpv/catalog/top-sellers${query}`,
    headers: { authorization: `Bearer ${signSession(tid)}` },
  });
  return res;
}

beforeEach(() => {
  state.lines = [];
  state.productosVivos = new Set([CAFE, CROISSANT, VINO]);
  vi.clearAllMocks();
});

describe("GET /tpv/catalog/top-sellers", () => {
  it("ordena por unidades vendidas del turno actual", async () => {
    state.lines = [
      linea(CAFE, 12),
      linea(CROISSANT, 30),
      linea(VINO, 3),
    ];

    const res = await get(`?shiftId=${SHIFT}&limit=5`);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe("shift");
    expect(body.items.map((i: { productId: string }) => i.productId)).toEqual([
      CROISSANT,
      CAFE,
      VINO,
    ]);
  });

  it("corta por unidades, no por importe (el vino caro no adelanta al café)", async () => {
    // Un vino de 18 € vendido dos veces factura más que 20 cafés de
    // 1,20 €, pero lo que acelera la comanda es lo que más se pulsa.
    state.lines = [linea(VINO, 2), linea(CAFE, 20)];

    const body = (await get(`?shiftId=${SHIFT}`)).json();

    expect(body.items[0].productId).toBe(CAFE);
  });

  it("ignora DRAFT, VOIDED y TEST", async () => {
    state.lines = [
      // Una mesa abierta con 50 cafés apuntados no ha vendido nada.
      linea(CAFE, 50, { status: "DRAFT" }),
      // Una mesa vaciada tampoco.
      linea(CAFE, 50, { status: "VOIDED" }),
      // Ni el cajero técnico del onboarding.
      linea(CAFE, 50, { status: "TEST" }),
      linea(CROISSANT, 1),
    ];

    const body = (await get(`?shiftId=${SHIFT}`)).json();

    expect(body.items).toHaveLength(1);
    expect(body.items[0].productId).toBe(CROISSANT);
  });

  it("cuenta los estados de venta que sí lo son (incluido el fiado)", async () => {
    state.lines = [
      linea(CAFE, 1, { status: "PENDING_SYNC" }),
      linea(CAFE, 1, { status: "SYNCED" }),
      linea(CAFE, 1, { status: "SYNC_FAILED" }),
      linea(CAFE, 1, { status: "ON_CREDIT" }),
    ];

    const body = (await get(`?shiftId=${SHIFT}`)).json();

    expect(body.items[0]).toEqual({ productId: CAFE, units: 4 });
  });

  it("turno recién abierto (poca señal) → cae al último mes", async () => {
    const haceDiezDias = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    state.lines = [
      // Una sola venta en este turno: no es un ranking, es ruido.
      linea(VINO, 1),
      // El mes sí tiene historia.
      linea(CAFE, 200, { shiftId: OTRO_SHIFT, createdAt: haceDiezDias }),
      linea(CROISSANT, 90, { shiftId: OTRO_SHIFT, createdAt: haceDiezDias }),
    ];

    const body = (await get(`?shiftId=${SHIFT}&limit=5`)).json();

    expect(body.source).toBe("month");
    expect(body.items[0].productId).toBe(CAFE);
  });

  it("lo de hace más de un mes no cuenta", async () => {
    const haceCuarentaDias = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    state.lines = [
      linea(CAFE, 500, {
        shiftId: OTRO_SHIFT,
        createdAt: haceCuarentaDias,
      }),
    ];

    const body = (await get(`?shiftId=${SHIFT}`)).json();

    expect(body.items).toEqual([]);
  });

  it("sin shiftId va directo al mes (venta rápida sin turno resuelto)", async () => {
    state.lines = [linea(CAFE, 5, { shiftId: OTRO_SHIFT })];

    const body = (await get("?limit=5")).json();

    expect(body.source).toBe("month");
    expect(body.items[0].productId).toBe(CAFE);
  });

  it("un producto ya borrado del catálogo no se ofrece", async () => {
    state.lines = [linea(BORRADO, 900), linea(CAFE, 3)];
    // BORRADO no está en `productosVivos`.

    const body = (await get(`?shiftId=${SHIFT}`)).json();

    expect(body.items.map((i: { productId: string }) => i.productId)).toEqual([
      CAFE,
    ]);
  });

  it("no se cruzan tenants", async () => {
    const OTRO_TENANT = "00000000-0000-0000-0000-0000000000ff";
    state.lines = [linea(CAFE, 99, { tenantId: OTRO_TENANT })];

    const body = (await get(`?shiftId=${SHIFT}`)).json();

    expect(body.items).toEqual([]);
  });

  it("sin sesión de cajero → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/tpv/catalog/top-sellers",
    });
    expect(res.statusCode).toBe(401);
  });

  it("el límite está acotado por schema (no se pide el catálogo entero)", async () => {
    const res = await get("?limit=500");
    expect(res.statusCode).toBe(400);
  });
});
