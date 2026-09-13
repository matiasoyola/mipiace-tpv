// catalogo-local · PUERTA 1 — el sync no toca lo local.
//
// Es la primera que el prompt del bloque manda probar con sabotaje, y la
// que más daño hace si se pierde: un producto local archivado por la
// conciliación desaparece del TPV sin que nadie haya hecho nada, y el
// propietario sólo se entera cuando va a cobrarlo.
//
// La conciliación archiva "lo activo que Holded ya no lista". Un producto
// local no está en esa lista porque NUNCA estuvo en Holded, así que sin
// la puerta caería en cada pasada, cada 15 minutos.
//
// El fake de Prisma de este fichero SÍ honra `where.source` —a diferencia
// del de `catalog-reconcile.test.ts`, que es anterior al bloque—. Eso es
// lo que hace que quitar el filtro del código ponga esto en rojo en vez
// de pasar de largo.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it, vi } from "vitest";

let holdedProducts: Array<{ id: string; name: string; forSale?: number }> = [];
let holdedServices: Array<{ id: string; name: string }> = [];

vi.mock("@mipiacetpv/holded-client", async () => {
  const actual = await vi.importActual<typeof import("@mipiacetpv/holded-client")>(
    "@mipiacetpv/holded-client",
  );
  return {
    ...actual,
    ApiKeyClient: vi.fn().mockImplementation(() => ({})) as any,
    iterateAllProducts: vi.fn(async function* () {
      yield { page: 1, products: holdedProducts };
    }),
    iterateAllServices: vi.fn(async function* () {
      yield { page: 1, services: holdedServices };
    }),
  };
});

interface Row {
  id: string;
  tenantId: string;
  holdedProductId: string | null;
  source: "HOLDED" | "LOCAL";
  name: string;
  active: boolean;
  sellableViaTpv: boolean;
  archivedFromHoldedAt: Date | null;
}

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const store = new Map<string, Row>();

// El corazón del fake. Reproduce las condiciones que el código escribe,
// incluida la semántica SQL de `notIn` frente a NULL: en Postgres,
// `NULL NOT IN (...)` evalúa a NULL y la fila NO entra. Se replica a
// propósito para que el test mida el comportamiento real y no una
// versión amable de él.
function matches(p: Row, where: any): boolean {
  if (p.tenantId !== where.tenantId) return false;
  if (where.active !== undefined && p.active !== where.active) return false;
  if (where.source !== undefined && p.source !== where.source) return false;
  if (where.holdedProductId?.notIn) {
    if (p.holdedProductId === null) return false;
    if (where.holdedProductId.notIn.includes(p.holdedProductId)) return false;
  }
  return true;
}

const fakePrisma = {
  tenant: {
    findUniqueOrThrow: vi.fn(async () => tenantRow),
  },
  product: {
    count: vi.fn(async ({ where }: any) =>
      [...store.values()].filter((p) => matches(p, where)).length,
    ),
    findMany: vi.fn(async ({ where }: any) =>
      [...store.values()].filter((p) => matches(p, where)),
    ),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const p of store.values()) {
        if (!matches(p, where)) continue;
        Object.assign(p, data);
        count += 1;
      }
      return { count };
    }),
  },
} as const;

let tenantRow: {
  id: string;
  holdedApiKeyCiphertext: string | null;
  initialSyncStatus: string;
};

const { encryptSecret } = await import("../src/crypto.js");
const CIPHER = encryptSecret("test-api-key", process.env.HOLDED_KEY_ENCRYPTION_SECRET!);

const { runCatalogReconcile } = await import("../src/catalog/reconcile.js");

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

function seedHolded(holdedId: string, name = `P-${holdedId}`): Row {
  const row: Row = {
    id: randomUUID(),
    tenantId: TENANT_ID,
    holdedProductId: holdedId,
    source: "HOLDED",
    name,
    active: true,
    sellableViaTpv: true,
    archivedFromHoldedAt: null,
  };
  store.set(row.id, row);
  return row;
}

function seedLocal(name: string): Row {
  const row: Row = {
    id: randomUUID(),
    tenantId: TENANT_ID,
    // Lo que define un producto local: sin enlace con Holded.
    holdedProductId: null,
    source: "LOCAL",
    name,
    active: true,
    sellableViaTpv: true,
    archivedFromHoldedAt: null,
  };
  store.set(row.id, row);
  return row;
}

function run() {
  return runCatalogReconcile({
    tenantId: TENANT_ID,
    prisma: fakePrisma as any,
    logger: silent,
  });
}

beforeEach(() => {
  store.clear();
  fakePrisma.product.count.mockClear();
  fakePrisma.product.findMany.mockClear();
  fakePrisma.product.updateMany.mockClear();
  holdedProducts = [];
  holdedServices = [];
  tenantRow = {
    id: TENANT_ID,
    holdedApiKeyCiphertext: CIPHER,
    initialSyncStatus: "DONE",
  };
});

describe("catalogo-local · la conciliación no archiva productos locales", () => {
  it("un producto local sobrevive a una conciliación que archiva de Holded", async () => {
    // Catálogo mixto: cuatro de Holded (tres siguen vivos allí, uno se
    // borró) y dos locales.
    const vivo1 = seedHolded("h1");
    const vivo2 = seedHolded("h2");
    const vivo3 = seedHolded("h3");
    const borrado = seedHolded("h4", "Borrado en Holded");
    const local1 = seedLocal("Corte de pelo");
    const local2 = seedLocal("Botella de agua");
    holdedProducts = [
      { id: "h1", name: "P1" },
      { id: "h2", name: "P2" },
      { id: "h3", name: "P3" },
    ];

    const res = await run();

    expect(res.aborted).toBeNull();
    // Se archiva EXACTAMENTE el que Holded borró.
    expect(res.archived).toBe(1);
    expect(borrado.active).toBe(false);
    expect(borrado.archivedFromHoldedAt).not.toBeNull();
    // Y los vivos de Holded siguen vivos.
    expect(vivo1.active).toBe(true);
    expect(vivo2.active).toBe(true);
    expect(vivo3.active).toBe(true);
    // LO QUE IMPORTA: los locales, intactos. Ni archivados ni tocados.
    expect(local1.active).toBe(true);
    expect(local1.sellableViaTpv).toBe(true);
    expect(local1.archivedFromHoldedAt).toBeNull();
    expect(local2.active).toBe(true);
    expect(local2.sellableViaTpv).toBe(true);
    expect(local2.archivedFromHoldedAt).toBeNull();
  });

  it("un catálogo SÓLO local no se archiva aunque Holded no liste nada suyo", async () => {
    // El comercio del bloque: cinco productos locales y ni uno de
    // Holded. Sin la puerta, la conciliación los vería todos como
    // "activos que Holded ya no lista" y los archivaría de golpe.
    const locales = [
      seedLocal("Uno"),
      seedLocal("Dos"),
      seedLocal("Tres"),
      seedLocal("Cuatro"),
      seedLocal("Cinco"),
    ];
    holdedProducts = [];

    const res = await run();

    expect(res.archived).toBe(0);
    for (const p of locales) {
      expect(p.active).toBe(true);
      expect(p.archivedFromHoldedAt).toBeNull();
    }
  });

  it("los locales NO cuentan en la protección anti-catástrofe", async () => {
    // La protección aborta si el listado vivo de Holded es sospechosa-
    // mente pequeño frente a lo que tenemos activo. Si los locales
    // contaran en el denominador, un comercio mixto abortaría siempre y
    // dejaría de archivar lo que Holded SÍ borró — un fallo silencioso
    // en la dirección contraria.
    //
    // 4 de Holded (3 vivos) + 40 locales. Con los locales dentro, el
    // ratio sería 3/44 y abortaría. Sin ellos, 3/4 y archiva.
    seedHolded("h1");
    seedHolded("h2");
    seedHolded("h3");
    const borrado = seedHolded("h4");
    for (let i = 0; i < 40; i += 1) seedLocal(`Local ${i}`);
    holdedProducts = [
      { id: "h1", name: "P1" },
      { id: "h2", name: "P2" },
      { id: "h3", name: "P3" },
    ];

    const res = await run();

    expect(res.aborted).toBeNull();
    expect(res.localActiveBefore).toBe(4);
    expect(res.archived).toBe(1);
    expect(borrado.active).toBe(false);
  });

  // ── La guarda que el comportamiento no puede probar ────────────────
  //
  // Este test mira la FORMA de la consulta, no su resultado, y es la
  // excepción en este fichero. La razón está medida: al sabotear el
  // `source: "HOLDED"` del `updateMany` (S1 de la tabla del done), NADA
  // se pone rojo. No porque la puerta sobre, sino porque su efecto está
  // ENMASCARADO por el `notIn`: en SQL —y en el fake de arriba, que lo
  // replica— `NULL NOT IN (...)` evalúa a NULL y la fila no entra, así
  // que los locales quedarían fuera igualmente.
  //
  // O sea: hoy la protección es doble y sobrevive a perder una mitad. Lo
  // que este test guarda es que no se pierdan LAS DOS. El día que
  // alguien cambie ese `notIn` por otra cosa —un `in` invertido, un
  // rango de fechas, lo que sea—, el `source` pasa de redundante a
  // único, y para entonces ya tiene que estar puesto.
  it("el UPDATE que archiva lleva el filtro de source escrito, no implícito", async () => {
    seedHolded("h1");
    seedHolded("h2");
    seedHolded("h3");
    seedHolded("h4");
    seedLocal("Local");
    holdedProducts = [
      { id: "h1", name: "P1" },
      { id: "h2", name: "P2" },
      { id: "h3", name: "P3" },
    ];

    await run();

    const updateCall = fakePrisma.product.updateMany.mock.calls.at(-1)?.[0] as any;
    expect(updateCall.where.source).toBe("HOLDED");
    // Y el SELECT de la muestra, también.
    const findCall = fakePrisma.product.findMany.mock.calls.at(-1)?.[0] as any;
    expect(findCall.where.source).toBe("HOLDED");
  });

  it("la muestra del log no inventa ids: sólo trae los de Holded", async () => {
    seedHolded("h1");
    const borrado = seedHolded("h9", "Se fue de Holded");
    seedLocal("Local que se queda");
    holdedProducts = [{ id: "h1", name: "P1" }];

    const res = await run();

    expect(res.archivedSample).toEqual([
      { holdedProductId: "h9", name: "Se fue de Holded" },
    ]);
    expect(borrado.active).toBe(false);
  });
});
