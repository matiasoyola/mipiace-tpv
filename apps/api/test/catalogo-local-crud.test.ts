// catalogo-local · el CRUD del catálogo propio y su puerta de alta.
//
// Tres cosas se prueban aquí, y las tres son criterios del bloque:
//
//   · **El SKU es imposible de saltarse** (criterio 5). Por esquema y por
//     handler, en el alta y en la edición.
//   · **La puerta del alta local** cierra con 403 cuando el tenant TIENE
//     Holded (addendum 1: probado contra un tenant con clave, no asumido
//     por el botón que no se pinta).
//   · **Un producto de Holded no se edita desde aquí**, porque el sync
//     incremental lo pisaría a los 15 minutos.
//
// Y el tipo de IVA del addendum 2: lista de cuatro + vía de escape
// validada, nunca un 500.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "00000000-0000-0000-0000-000000000001";
const OWNER = "00000000-0000-0000-0000-0000000000aa";

interface Row {
  id: string;
  tenantId: string;
  source: "HOLDED" | "LOCAL";
  holdedProductId: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  basePrice: number;
  taxRate: number;
  kind: "PRODUCT" | "SERVICE";
  active: boolean;
  tags: string[];
  sellableViaTpv: boolean;
  needsSkuReview: boolean;
  skuAutoAssignedAt: Date | null;
}

const store = new Map<string, Row>();
// catalogo-local (addendum 3) · las DOS señales del tenant, separadas.
// La puerta del alta mira `holdedEnabled`, no la clave: un tenant que
// usa Holded y todavía no lo ha conectado tampoco crea productos
// locales, porque está a mitad de su onboarding.
let tenantHoldedEnabled = false;
let tenantHasHoldedKey = false;
// Emula el índice único parcial `(tenant_id, sku) WHERE source='LOCAL'`.
let uniqueIndexOn = true;

class FakeP2002 extends Error {
  code = "P2002";
  meta = { target: ["products_tenant_id_sku_local_key"] };
  constructor() {
    super("Unique constraint failed");
  }
}

function matches(p: Row, where: any): boolean {
  if (where.tenantId && p.tenantId !== where.tenantId) return false;
  if (where.id && p.id !== where.id) return false;
  if (where.source && p.source !== where.source) return false;
  if (where.active !== undefined && p.active !== where.active) return false;
  if (where.sku !== undefined && p.sku !== where.sku) return false;
  if (where.OR) {
    const needle = (where.OR[0]?.name?.contains ?? "").toLowerCase();
    const hit = [p.name, p.sku ?? "", p.barcode ?? ""].some((v) =>
      v.toLowerCase().includes(needle),
    );
    if (!hit) return false;
  }
  return true;
}

function enforceUnique(tenantId: string, sku: string | null, ignoreId?: string): void {
  if (!uniqueIndexOn || sku == null) return;
  for (const p of store.values()) {
    if (p.id === ignoreId) continue;
    if (p.tenantId !== tenantId) continue;
    // PARCIAL: sólo entre los locales. Dos de Holded con el mismo SKU
    // conviven, que es lo que pasa de verdad cuando el cliente los
    // duplica en su ERP.
    if (p.source !== "LOCAL") continue;
    if (p.sku === sku) throw new FakeP2002();
  }
}

const fakePrisma = {
  tenant: {
    findUnique: vi.fn(async () => ({
      holdedEnabled: tenantHoldedEnabled,
      holdedApiKeyCiphertext: tenantHasHoldedKey ? "cipher" : null,
      cajaEnabled: true,
    })),
  },
  product: {
    findMany: vi.fn(async ({ where, skip = 0, take = 50 }: any) =>
      [...store.values()]
        .filter((p) => matches(p, where))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(skip, skip + take)
        .map((p) => ({ ...p, basePrice: p.basePrice, taxRate: p.taxRate })),
    ),
    count: vi.fn(async ({ where }: any) =>
      [...store.values()].filter((p) => matches(p, where)).length,
    ),
    findFirst: vi.fn(async ({ where }: any) =>
      [...store.values()].find((p) => matches(p, where)) ?? null,
    ),
    create: vi.fn(async ({ data }: any) => {
      enforceUnique(data.tenantId, data.sku);
      const row: Row = {
        id: randomUUID(),
        tenantId: data.tenantId,
        source: data.source,
        holdedProductId: data.holdedProductId ?? null,
        name: data.name,
        sku: data.sku,
        barcode: data.barcode ?? null,
        basePrice: Number(data.basePrice),
        taxRate: Number(data.taxRate),
        kind: data.kind,
        active: data.active,
        tags: data.tags ?? [],
        sellableViaTpv: data.sellableViaTpv,
        needsSkuReview: data.needsSkuReview,
        skuAutoAssignedAt: data.skuAutoAssignedAt ?? null,
      };
      store.set(row.id, row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = store.get(where.id);
      if (!row) throw new Error("not found");
      if (data.sku !== undefined) enforceUnique(row.tenantId, data.sku, row.id);
      for (const [k, v] of Object.entries(data)) {
        (row as any)[k] = typeof v === "object" && v !== null && "toString" in v ? Number(v) : v;
      }
      return row;
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

// El Prisma real trae la clase del error; el fake la sustituye por una
// que expone `code` y `meta` igual.
vi.mock("@mipiacetpv/db", async () => {
  const actual = await vi.importActual<typeof import("@mipiacetpv/db")>("@mipiacetpv/db");
  return {
    ...actual,
    Prisma: {
      ...actual.Prisma,
      Decimal: class {
        private v: number;
        constructor(v: number | string) {
          this.v = Number(v);
        }
        toString() {
          return String(this.v);
        }
        valueOf() {
          return this.v;
        }
      },
      PrismaClientKnownRequestError: FakeP2002,
    },
  };
});

const { registerLocalCatalogRoutes } = await import("../src/catalog/local-products.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const owner = () => `Bearer ${signAccessToken({ sub: OWNER, tid: TENANT, role: "OWNER" })}`;

async function buildApp() {
  const app = Fastify();
  await registerLocalCatalogRoutes(app);
  return app;
}

function seed(partial: Partial<Row> & { name: string; source: "HOLDED" | "LOCAL" }): Row {
  const row: Row = {
    id: randomUUID(),
    tenantId: TENANT,
    holdedProductId: partial.source === "HOLDED" ? randomUUID() : null,
    sku: partial.sku ?? `SKU-${Math.random().toString(36).slice(2, 8)}`,
    barcode: null,
    basePrice: 10,
    taxRate: 21,
    kind: "PRODUCT",
    active: true,
    tags: [],
    sellableViaTpv: true,
    needsSkuReview: false,
    skuAutoAssignedAt: null,
    ...partial,
  } as Row;
  store.set(row.id, row);
  return row;
}

const VALID = {
  name: "Corte de pelo",
  sku: "CORTE-1",
  basePrice: 18.5,
  taxRate: 21,
};

function post(app: any, body: unknown) {
  return app.inject({
    method: "POST",
    url: "/catalog/products",
    headers: { authorization: owner() },
    payload: body,
  });
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  // El tenant del banco por defecto es el del bloque: con caja, sin
  // Holded y con el alta local abierta.
  tenantHoldedEnabled = false;
  tenantHasHoldedKey = false;
  uniqueIndexOn = true;
});

// ── El SKU obligatorio (criterio 5 del bloque) ─────────────────────────

describe("catalogo-local · dar de alta sin SKU es imposible por la API", () => {
  it("sin el campo sku → 400, lo rechaza el esquema", async () => {
    const app = await buildApp();
    const res = await post(app, { name: "X", basePrice: 1, taxRate: 21 });
    expect(res.statusCode).toBe(400);
    expect(store.size).toBe(0);
  });

  it("sku vacío → 400", async () => {
    const app = await buildApp();
    const res = await post(app, { ...VALID, sku: "" });
    expect(res.statusCode).toBe(400);
    expect(store.size).toBe(0);
  });

  it("sku de sólo espacios → 400 con frase, no un producto con sku en blanco", async () => {
    const app = await buildApp();
    const res = await post(app, { ...VALID, sku: "   " });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_SKU");
    expect(res.json().message).toContain("obligatorio");
    expect(store.size).toBe(0);
  });

  it("sku null → 400: el esquema no admite el tipo", async () => {
    const app = await buildApp();
    const res = await post(app, { ...VALID, sku: null });
    expect(res.statusCode).toBe(400);
    expect(store.size).toBe(0);
  });

  it("los espacios de los extremos se recortan en silencio (pegar de un Excel)", async () => {
    const app = await buildApp();
    const res = await post(app, { ...VALID, sku: "  CORTE-1  " });
    expect(res.statusCode).toBe(201);
    expect(res.json().product.sku).toBe("CORTE-1");
  });

  it("un espacio DENTRO del sku se rechaza: partiría el campo en Holded y en la impresora", async () => {
    const app = await buildApp();
    const res = await post(app, { ...VALID, sku: "CORTE 1" });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("espacios");
  });

  it("el PATCH tampoco puede dejar un producto sin SKU", async () => {
    const app = await buildApp();
    const local = seed({ name: "Local", source: "LOCAL", sku: "L-1" });
    const res = await app.inject({
      method: "PATCH",
      url: `/catalog/products/${local.id}`,
      headers: { authorization: owner() },
      payload: { sku: "  " },
    });
    expect(res.statusCode).toBe(400);
    expect(store.get(local.id)!.sku).toBe("L-1");
  });
});

// ── La unicidad del SKU local ──────────────────────────────────────────

describe("catalogo-local · un SKU local no se repite dentro del tenant", () => {
  it("el segundo con el mismo SKU → 409 con frase, no un 500", async () => {
    const app = await buildApp();
    expect((await post(app, VALID)).statusCode).toBe(201);
    const dup = await post(app, { ...VALID, name: "Otro" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe("SKU_ALREADY_EXISTS");
    expect(dup.json().message).toContain("SKU");
  });

  it("un SKU que ya usa un producto DE HOLDED no bloquea el alta local", async () => {
    // El índice es parcial a propósito: los SKU de Holded llegan como
    // llegan y no los gobernamos.
    const app = await buildApp();
    seed({ name: "De Holded", source: "HOLDED", sku: "CORTE-1" });
    const res = await post(app, VALID);
    expect(res.statusCode).toBe(201);
  });

  it("el PATCH que choca también devuelve 409", async () => {
    const app = await buildApp();
    seed({ name: "Uno", source: "LOCAL", sku: "A-1" });
    const dos = seed({ name: "Dos", source: "LOCAL", sku: "B-1" });
    const res = await app.inject({
      method: "PATCH",
      url: `/catalog/products/${dos.id}`,
      headers: { authorization: owner() },
      payload: { sku: "A-1" },
    });
    expect(res.statusCode).toBe(409);
  });
});

// ── La puerta del alta local (addendum 1) ──────────────────────────────

describe("catalogo-local · la puerta del alta cuando el tenant USA Holded", () => {
  it("403 LOCAL_CATALOG_DISABLED, probado contra un tenant con clave", async () => {
    tenantHoldedEnabled = true;
    tenantHasHoldedKey = true;
    const app = await buildApp();
    const res = await post(app, VALID);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("LOCAL_CATALOG_DISABLED");
    expect(res.json().message).toContain("Holded");
    // Y no ha creado nada.
    expect(store.size).toBe(0);
  });

  it("el PATCH también está cerrado con Holded conectado", async () => {
    const local = seed({ name: "Local", source: "LOCAL", sku: "L-1" });
    tenantHoldedEnabled = true;
    tenantHasHoldedKey = true;
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/catalog/products/${local.id}`,
      headers: { authorization: owner() },
      payload: { name: "Cambiado" },
    });
    expect(res.statusCode).toBe(403);
    expect(store.get(local.id)!.name).toBe("Local");
  });

  // ── addendum 3 · el caso que el predicado viejo no veía ────────────
  it("403 TAMBIÉN si usa Holded y todavía NO lo ha conectado", async () => {
    // Éste es el tenant que el predicado anterior (`¿tiene clave?`)
    // dejaba pasar: sin clave, el alta se le abría. Está a mitad de su
    // onboarding, y dejarle crear productos locales le fabricaría el
    // catálogo mixto que este bloque existe para impedir, justo el día
    // antes de conectar su ERP.
    tenantHoldedEnabled = true;
    tenantHasHoldedKey = false;
    const app = await buildApp();
    const res = await post(app, VALID);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("LOCAL_CATALOG_DISABLED");
    expect(store.size).toBe(0);
  });

  it("el LISTADO sigue abierto con Holded: es la pantalla de diagnóstico", async () => {
    tenantHoldedEnabled = true;
    tenantHasHoldedKey = true;
    seed({ name: "De Holded", source: "HOLDED" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/catalog/products",
      headers: { authorization: owner() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
  });
});

// ── Sólo se edita lo local ─────────────────────────────────────────────

describe("catalogo-local · un producto de Holded no se edita desde aquí", () => {
  it("PATCH sobre source=HOLDED → 409 y el motivo explica el sync", async () => {
    const holded = seed({ name: "Champú", source: "HOLDED", sku: "H-1" });
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/catalog/products/${holded.id}`,
      headers: { authorization: owner() },
      payload: { name: "Champú editado" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("PRODUCT_NOT_EDITABLE");
    expect(res.json().message).toContain("Holded");
    expect(store.get(holded.id)!.name).toBe("Champú");
  });

  it("el listado marca cuál se puede editar y cuál no", async () => {
    seed({ name: "A Local", source: "LOCAL", sku: "L-1" });
    seed({ name: "B Holded", source: "HOLDED", sku: "H-1" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/catalog/products",
      headers: { authorization: owner() },
    });
    const items = res.json().items;
    expect(items.find((i: any) => i.source === "LOCAL").editable).toBe(true);
    expect(items.find((i: any) => i.source === "HOLDED").editable).toBe(false);
  });
});

// ── El alta, bien hecha ────────────────────────────────────────────────

describe("catalogo-local · el producto que nace", () => {
  it("nace LOCAL, sin enlace con Holded y vendible en el TPV", async () => {
    const app = await buildApp();
    const res = await post(app, VALID);
    expect(res.statusCode).toBe(201);
    const row = [...store.values()][0]!;
    expect(row.source).toBe("LOCAL");
    expect(row.holdedProductId).toBeNull();
    expect(row.sellableViaTpv).toBe(true);
    expect(row.active).toBe(true);
    // No pasa por el auto-SKU ni por la bandeja: su SKU lo puso una persona.
    expect(row.needsSkuReview).toBe(false);
    expect(row.skuAutoAssignedAt).toBeNull();
  });

  it("cumple los tres filtros del TPV nada más nacer", async () => {
    // `tpv-catalog/routes.ts:81-86`: active + sellableViaTpv + sku no nulo.
    const app = await buildApp();
    await post(app, VALID);
    const row = [...store.values()][0]!;
    expect(row.active).toBe(true);
    expect(row.sellableViaTpv).toBe(true);
    expect(row.sku).toBeTruthy();
  });

  it("los tags se normalizan igual que los del sync: minúsculas y sin repetir", async () => {
    // Misma normalización que `initial-sync.ts` e `incremental-sync.ts`,
    // para que los chips de categoría del TPV salgan iguales vengan de
    // donde vengan.
    const app = await buildApp();
    const res = await post(app, { ...VALID, tags: ["Bebidas", "bebidas", " FRÍO "] });
    expect(res.statusCode).toBe(201);
    expect([...store.values()][0]!.tags).toEqual(["bebidas", "frío"]);
  });

  it("un tag vacío lo rechaza el esquema: no se guarda un tag en blanco", async () => {
    // Frontera medida, no supuesta: el `minLength: 1` del esquema corta
    // antes que el normalizador del handler. La pantalla nunca manda uno
    // (filtra al partir por comas), así que este 400 sólo lo ve quien
    // llame a la API a mano — y es la respuesta correcta.
    const app = await buildApp();
    const res = await post(app, { ...VALID, tags: ["bebidas", ""] });
    expect(res.statusCode).toBe(400);
    expect(store.size).toBe(0);
  });

  it("un servicio local también se puede dar de alta", async () => {
    const app = await buildApp();
    const res = await post(app, { ...VALID, kind: "SERVICE" });
    expect(res.statusCode).toBe(201);
    expect([...store.values()][0]!.kind).toBe("SERVICE");
  });

  it("el código de barras vacío se guarda como null, no como cadena vacía", async () => {
    const app = await buildApp();
    await post(app, { ...VALID, barcode: "   " });
    expect([...store.values()][0]!.barcode).toBeNull();
  });

  it("la sugerencia de SKU lleva prefijo LOC-, no AUTO-", async () => {
    // AUTO-* significa "lo subió runAutoSku a Holded y allí es canónico".
    // Un producto local no ha estado nunca en Holded: ponerle ese prefijo
    // sería mentir justo en el campo que viaja como identificador.
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/catalog/products/sku-suggestion",
      headers: { authorization: owner() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sku).toMatch(/^LOC-[A-Z0-9]{8}$/);
    expect(res.json().sku).not.toMatch(/^AUTO-/);
  });
});

// ── El IVA (addendum 2) ────────────────────────────────────────────────

describe("catalogo-local · el tipo de IVA", () => {
  it.each([21, 10, 4, 0])("acepta el tramo peninsular %i %%", async (rate) => {
    const app = await buildApp();
    const res = await post(app, { ...VALID, sku: `S-${rate}`, taxRate: rate });
    expect(res.statusCode).toBe(201);
    expect(res.json().product.taxRate).toBe(rate);
  });

  it("acepta el IGIC canario, que no está en la lista", async () => {
    // La razón de ser de la vía de escape: sin ella, un comercio canario
    // se queda sin poder dar de alta su producto hasta que despleguemos.
    const app = await buildApp();
    const res = await post(app, { ...VALID, taxRate: 7 });
    expect(res.statusCode).toBe(201);
    expect(res.json().product.taxRate).toBe(7);
  });

  it("acepta dos decimales", async () => {
    const app = await buildApp();
    const res = await post(app, { ...VALID, taxRate: 7.5 });
    expect(res.statusCode).toBe(201);
  });

  it("más de dos decimales → 400 con frase, no un redondeo callado", async () => {
    // La columna es Decimal(5,2): la base redondearía en silencio y el
    // producto quedaría con un IVA distinto del que se tecleó.
    const app = await buildApp();
    const res = await post(app, { ...VALID, taxRate: 7.555 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_TAX_RATE");
    expect(res.json().message).toContain("decimales");
    expect(store.size).toBe(0);
  });

  it("fuera de 0–100 → 400, nunca un 500", async () => {
    const app = await buildApp();
    for (const bad of [-1, 101, 1000]) {
      const res = await post(app, { ...VALID, taxRate: bad });
      expect(res.statusCode).toBe(400);
    }
    expect(store.size).toBe(0);
  });

  it("el PATCH valida el IVA igual que el alta", async () => {
    const app = await buildApp();
    const local = seed({ name: "Local", source: "LOCAL", sku: "L-1", taxRate: 21 });
    const res = await app.inject({
      method: "PATCH",
      url: `/catalog/products/${local.id}`,
      headers: { authorization: owner() },
      payload: { taxRate: 200 },
    });
    expect(res.statusCode).toBe(400);
    expect(store.get(local.id)!.taxRate).toBe(21);
  });
});

// ── El listado ─────────────────────────────────────────────────────────

describe("catalogo-local · el listado", () => {
  it("trae locales y de Holded juntos, con el origen marcado", async () => {
    seed({ name: "A Local", source: "LOCAL", sku: "L-1" });
    seed({ name: "B Holded", source: "HOLDED", sku: "H-1" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/catalog/products",
      headers: { authorization: owner() },
    });
    const items = res.json().items;
    expect(items).toHaveLength(2);
    expect(items.map((i: any) => i.source).sort()).toEqual(["HOLDED", "LOCAL"]);
  });

  it("filtra por origen", async () => {
    seed({ name: "A Local", source: "LOCAL", sku: "L-1" });
    seed({ name: "B Holded", source: "HOLDED", sku: "H-1" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/catalog/products?source=LOCAL",
      headers: { authorization: owner() },
    });
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].source).toBe("LOCAL");
  });

  it("esconde los inactivos salvo que se pidan", async () => {
    seed({ name: "Vivo", source: "LOCAL", sku: "L-1" });
    seed({ name: "Muerto", source: "LOCAL", sku: "L-2", active: false });
    const app = await buildApp();
    const sin = await app.inject({
      method: "GET",
      url: "/catalog/products",
      headers: { authorization: owner() },
    });
    expect(sin.json().items).toHaveLength(1);
    const con = await app.inject({
      method: "GET",
      url: "/catalog/products?includeInactive=true",
      headers: { authorization: owner() },
    });
    expect(con.json().items).toHaveLength(2);
  });

  it("devuelve localCount para distinguir 'no tengo nada' de 'no encuentro nada'", async () => {
    seed({ name: "Uno", source: "LOCAL", sku: "L-1" });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/catalog/products?search=zzzz",
      headers: { authorization: owner() },
    });
    expect(res.json().items).toHaveLength(0);
    expect(res.json().localCount).toBe(1);
  });
});
