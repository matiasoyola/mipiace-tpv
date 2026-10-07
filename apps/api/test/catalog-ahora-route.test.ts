// v2-H1-venta-y-sala §3 · GET /tpv/catalog/now, la vista «Ahora».
//
// «Ahora» es la primera pestaña de la venta de hostelería y la que abre
// por defecto. Lo que estos tests fijan es justo donde una vista así se
// estropea sin que nadie lo note:
//
//   · **Un comercio sin ventas no ve una pantalla vacía.** Es el
//     sabotaje que el prompt pide por su nombre («"Ahora" sin ventas
//     devuelve vacío» → test de API: comercio sin tickets → 20
//     productos). Un bar que abre por primera vez toca «Ahora» antes que
//     nada, y una rejilla en blanco le dice que el TPV está roto.
//   · **El relleno reparte por turnos, no familia a familia.** Con 9
//     familias y 20 huecos, volcarlas en orden daría veinte productos de
//     las dos primeras familias alfabéticas: veinte cafés y ni una caña.
//   · **El relleno no duplica lo que ya está por ventas.**
//   · **Lo que ya no está en el catálogo no se ofrece**, con el mismo
//     criterio que `top-sellers`: un botón que añade un producto borrado
//     de Holded es una línea que el sync rechaza.
//   · **El orden del ranking es el que manda el SQL**, no uno que la
//     ruta reordene por su cuenta.
//   · **Aislamiento por tenant.**
//
// Lo que estos tests NO cubren, y hay que decirlo: **la franja horaria y
// la ventana de 28 días viven en el `$queryRaw`**, así que aquí se
// comprueba que la consulta las pide (la plantilla SQL lleva la zona, el
// `% 24` de la aritmética modular y el intervalo), no que Postgres las
// resuelva. El `% 24` está ahí para que la franja envuelva la medianoche
// —a las 00:30 la franja es 23:00–01:00 y un `BETWEEN` daría vacío—, y
// eso sólo se demuestra de verdad contra una base. Queda para el e2e; el
// bucle visual del bloque lo ve con datos reales de la cuenta de
// pruebas.

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
const OTRO_TENANT = "00000000-0000-0000-0000-0000000000a1";
const REGISTER = "00000000-0000-0000-0000-000000000003";
const DEVICE = "00000000-0000-0000-0000-000000000004";
const CASHIER = "00000000-0000-0000-0000-000000000005";

interface FakeProduct {
  id: string;
  name: string;
  tags: string[];
  tenantId: string;
  active: boolean;
  sellableViaTpv: boolean;
  sku: string | null;
}

const state = {
  /** Lo que devolvería el `$queryRaw` del ranking de la franja. */
  ranking: [] as Array<{ product_id: string; units: number }>,
  productos: [] as FakeProduct[],
  /** La última plantilla SQL que la ruta ejecutó, para poder mirarla. */
  lastSql: "" as string,
  lastSqlValues: [] as unknown[],
};

function producto(
  id: string,
  name: string,
  familia: string,
  over: Partial<FakeProduct> = {},
): FakeProduct {
  return {
    id,
    name,
    tags: [familia],
    tenantId: TENANT,
    active: true,
    sellableViaTpv: true,
    sku: `SKU-${id.slice(-4)}`,
    ...over,
  };
}

const fakePrisma = {
  $queryRaw: vi.fn(async (q: { sql?: string; strings?: string[]; values?: unknown[] }) => {
    // `Prisma.sql` produce un objeto con `strings`/`values`; guardamos la
    // plantilla entera para poder afirmar que la franja viaja en ella.
    state.lastSql = Array.isArray(q.strings) ? q.strings.join("?") : (q.sql ?? "");
    state.lastSqlValues = q.values ?? [];
    return state.ranking;
  }),
  product: {
    findMany: vi.fn(async ({ where, orderBy, select }: any) => {
      let list = state.productos.filter((p) => {
        if (p.tenantId !== where.tenantId) return false;
        if (where.active === true && !p.active) return false;
        if (where.sellableViaTpv === true && !p.sellableViaTpv) return false;
        if (where.sku?.not === null && p.sku == null) return false;
        if (where.id?.in && !where.id.in.includes(p.id)) return false;
        return true;
      });
      if (orderBy?.name === "asc") {
        list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
      }
      // La ruta pide `{ id: true }` en un sitio y `{ id, tags }` en otro.
      return list.map((p) =>
        select?.tags ? { id: p.id, tags: p.tags } : { id: p.id },
      );
    }),
  },
  tenant: {
    findUnique: vi.fn(async () => ({ cajaEnabled: true })),
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

async function get(query = "", tid = TENANT) {
  const app = Fastify();
  await registerTpvCatalogRoutes(app);
  return app.inject({
    method: "GET",
    url: `/tpv/catalog/now${query}`,
    headers: { authorization: `Bearer ${signSession(tid)}` },
  });
}

/** Nueve familias como la carta de La Maestranza, cuatro productos cada una. */
function cartaDeBar(): FakeProduct[] {
  const familias = [
    "bocadillos",
    "cafes",
    "cervezas",
    "desayunos",
    "licores",
    "platos",
    "raciones",
    "refrescos",
    "vinos",
  ];
  const out: FakeProduct[] = [];
  familias.forEach((familia, fi) => {
    for (let i = 0; i < 4; i += 1) {
      out.push(
        producto(
          `00000000-0000-0000-0000-0000000${String(fi)}${String(i)}001`,
          `${familia}-${i}`,
          familia,
        ),
      );
    }
  });
  return out;
}

beforeEach(() => {
  state.ranking = [];
  state.productos = cartaDeBar();
  state.lastSql = "";
  state.lastSqlValues = [];
  vi.clearAllMocks();
});

describe("GET /tpv/catalog/now · «Ahora»", () => {
  it("un comercio SIN ventas ve 20 productos, no una pantalla vacía", async () => {
    // El sabotaje que pide el prompt por su nombre. Un bar que abre por
    // primera vez toca «Ahora» antes que nada; una rejilla en blanco le
    // dice que el TPV está roto.
    state.ranking = [];

    const res = await get();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(20);
    expect(body.source).toBe("families");
    // Ninguno viene de ventas: el `units: 0` lo dice en vez de mentir.
    expect(body.items.every((i: { units: number }) => i.units === 0)).toBe(true);
  });

  it("el relleno reparte POR TURNOS: no son veinte cafés", async () => {
    // Volcar familia a familia daría los veinte productos de las dos
    // primeras familias alfabéticas. Con nueve familias y veinte huecos,
    // el reparto por turnos tiene que tocar las nueve.
    const body = (await get()).json();

    const familiaDe = new Map(state.productos.map((p) => [p.id, p.tags[0]!]));
    const familias = new Set(
      body.items.map((i: { productId: string }) => familiaDe.get(i.productId)),
    );
    expect(familias.size).toBe(9);
    // Dos vueltas completas (18) más dos de la tercera.
    expect(body.items).toHaveLength(20);
  });

  it("las ventas van primero y el relleno completa hasta 20", async () => {
    const cana = state.productos.find((p) => p.name === "cervezas-0")!;
    const cafe = state.productos.find((p) => p.name === "cafes-0")!;
    state.ranking = [
      { product_id: cana.id, units: 42 },
      { product_id: cafe.id, units: 30 },
    ];

    const body = (await get()).json();

    expect(body.source).toBe("mixed");
    expect(body.items).toHaveLength(20);
    // El orden del ranking se respeta tal cual llega del SQL.
    expect(body.items[0]).toEqual({ productId: cana.id, units: 42 });
    expect(body.items[1]).toEqual({ productId: cafe.id, units: 30 });
  });

  it("el relleno NO duplica lo que ya entró por ventas", async () => {
    const cana = state.productos.find((p) => p.name === "cervezas-0")!;
    state.ranking = [{ product_id: cana.id, units: 42 }];

    const body = (await get()).json();

    const ids = body.items.map((i: { productId: string }) => i.productId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id: string) => id === cana.id)).toHaveLength(1);
  });

  it("con 20 productos vendidos no hay relleno y la fuente es «sales»", async () => {
    state.ranking = state.productos
      .slice(0, 20)
      .map((p, i) => ({ product_id: p.id, units: 100 - i }));

    const body = (await get()).json();

    expect(body.source).toBe("sales");
    expect(body.items).toHaveLength(20);
    expect(body.items[0].units).toBe(100);
  });

  it("no ofrece un producto que ya no está en el catálogo", async () => {
    const borrado = "00000000-0000-0000-0000-0000000000c9";
    const cana = state.productos.find((p) => p.name === "cervezas-0")!;
    state.ranking = [
      { product_id: borrado, units: 99 },
      { product_id: cana.id, units: 1 },
    ];

    const body = (await get()).json();

    const ids = body.items.map((i: { productId: string }) => i.productId);
    expect(ids).not.toContain(borrado);
    expect(ids[0]).toBe(cana.id);
  });

  it("tampoco ofrece un producto marcado como no vendible por TPV", async () => {
    const oculto = state.productos.find((p) => p.name === "vinos-0")!;
    oculto.sellableViaTpv = false;
    state.ranking = [{ product_id: oculto.id, units: 99 }];

    const body = (await get()).json();

    const ids = body.items.map((i: { productId: string }) => i.productId);
    expect(ids).not.toContain(oculto.id);
  });

  it("respeta el límite pedido", async () => {
    const body = (await get("?limit=8")).json();

    expect(body.items).toHaveLength(8);
  });

  it("aislamiento por tenant: otro tenant no ve este catálogo", async () => {
    const body = (await get("", OTRO_TENANT)).json();

    // `cartaDeBar()` es todo de TENANT, así que el relleno sale vacío.
    expect(body.items).toHaveLength(0);
  });

  it("la consulta pide la franja, la ventana y la zona del local", async () => {
    // La franja y la ventana viven en el SQL, así que lo que se puede
    // afirmar aquí es que la plantilla las lleva. El `% 24` es lo que
    // hace que la franja envuelva la medianoche (a las 00:30 la franja es
    // 23:00–01:00) y es exactamente lo que un refactor descuidado
    // convertiría en un `BETWEEN`, dejando «Ahora» en blanco a la hora
    // punta de un bar de copas.
    await get();

    expect(fakePrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(state.lastSql).toContain("AT TIME ZONE");
    expect(state.lastSql).toContain("% 24");
    expect(state.lastSql).toContain("ticket_lines");
    // Sólo ventas de verdad: ni DRAFT, ni VOIDED, ni TEST.
    expect(state.lastSql).toContain("'PAID'");
    expect(state.lastSql).not.toContain("'DRAFT'");
    expect(state.lastSql).not.toContain("'VOIDED'");
    expect(state.lastSql).not.toContain("'TEST'");
    // Los parámetros: tenant, ventana de 28 días, zona y ±1 h.
    expect(state.lastSqlValues).toContain(TENANT);
    expect(state.lastSqlValues).toContain("28 days");
    expect(state.lastSqlValues).toContain("Europe/Madrid");
    expect(state.lastSqlValues).toContain(1);
  });

  it("la respuesta declara la franja y la ventana que ha usado", async () => {
    // Sin esto no hay forma de distinguir «este bar pide cañas a esta
    // hora» de «este bar es nuevo» al depurar una implantación.
    const body = (await get()).json();

    expect(body.bandHours).toBe(1);
    expect(body.windowDays).toBe(28);
  });
});
