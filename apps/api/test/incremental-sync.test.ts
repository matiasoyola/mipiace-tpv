// Tests del orquestador del sync incremental (B2 §2). Mockea
// @mipiacetpv/holded-client (catálogo de Holded) y Prisma en memoria,
// además del auto-sku y los comodines (verificados en sus propios
// tests). Cubre:
//
//   - Happy path: productos nuevos + modificados + huérfanos.
//   - Huérfano que vuelve → active=true otra vez.
//   - Tenant sin sync inicial completo → IncrementalSyncSkippedError.
//   - Stats persistidos en tenant.lastIncrementalSyncStats.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Estado mockeado de Holded ────────────────────────────────────────
let holdedProducts: Array<{ id: string; name: string; sku?: string; price?: number; barcode?: string; taxes?: string[]; forSale?: number }> = [];
let holdedServices: typeof holdedProducts = [];
// B7.5: el shape real de /invoicing/v1/taxes viene con `key` (slug
// estable que matchea Product.taxes[]) + `amount` string. `id` puede
// venir vacío para taxes del catálogo estándar. Los tests usan el
// shape real para que cubran el bug que B7.5 arregla.
let holdedTaxes: Array<{ id: string; key: string; name: string; amount?: string; rate?: number | null }> = [
  { id: "", key: "s_iva_21", name: "IVA 21%", amount: "21" },
];
let holdedWarehouses = [{ id: "wh-1", name: "Default", default: true }];

vi.mock("@mipiacetpv/holded-client", async () => {
  const actual = await vi.importActual<typeof import("@mipiacetpv/holded-client")>(
    "@mipiacetpv/holded-client",
  );
  return {
    ...actual,
    ApiKeyClient: vi.fn().mockImplementation(() => ({})) as any,
    // Simulamos el normalizado de listTaxes: si `rate` no está, lo
    // parseamos de `amount` igual que el código real.
    listTaxes: vi.fn(async () =>
      holdedTaxes.map((t) => ({
        ...t,
        rate:
          typeof t.rate === "number"
            ? t.rate
            : typeof t.amount === "string" && t.amount.length > 0
              ? Number(t.amount)
              : null,
      })),
    ),
    listWarehouses: vi.fn(async () => holdedWarehouses),
    iterateAllProducts: vi.fn(async function* () {
      yield { page: 1, products: holdedProducts };
    }),
    iterateAllServices: vi.fn(async function* () {
      yield { page: 1, services: holdedServices };
    }),
    // B7 §8: el incremental sync ahora itera contactos al final. Para
    // este test el catálogo de contactos está vacío.
    iterateAllContacts: vi.fn(async function* () {
      yield { page: 1, contacts: [] as unknown[] };
    }),
  };
});

vi.mock("../src/onboarding/auto-sku.js", () => ({
  runAutoSku: vi.fn(async () => ({
    candidatesScanned: 0,
    fixed: 0,
    needsReview: 0,
    errors: [],
  })),
}));

vi.mock("../src/onboarding/tpv-otros.js", () => ({
  createTpvOtrosWildcards: vi.fn(async () => ({
    created: 0,
    reused: 0,
    errors: [],
  })),
}));

// B-ProductImages: el sync incremental encola el cache worker para
// productos con URL de imagen nueva o cambiada. En este test no nos
// importa Redis; sólo verificamos que se llame por cada candidato.
const enqueueSpy = vi.fn(async (_productId: string) => undefined);
vi.mock("../src/queues/product-image-cache.js", () => ({
  enqueueProductImageCache: (id: string) => enqueueSpy(id),
}));

// v1.2-Lite-fix1 Bug-Imagenes-Holded: el sync incremental ahora pega al
// endpoint binario de imágenes. En tests aislamos la lógica de disco +
// red haciendo no-op del backfill — los tests específicos del backfill
// viven en `image-backfill.test.ts` y en `products.test.ts` (helpers).
vi.mock("../src/catalog/image-backfill.js", () => ({
  backfillImagesFromHolded: vi.fn(async () => ({
    fetched: 0,
    none: 0,
    failed: 0,
    pending: 0,
    mimeChanged: 0,
  })),
}));

// ── Prisma en memoria ────────────────────────────────────────────────
interface FakeTenantRow {
  id: string;
  holdedApiKeyCiphertext: string | null;
  initialSyncStatus: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  lastIncrementalSyncAt: Date | null;
  lastIncrementalSyncStats: object | null;
}

interface FakeProductRow {
  id: string;
  tenantId: string;
  holdedProductId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  basePrice: number;
  taxRate: number;
  kind: "PRODUCT" | "SERVICE";
  active: boolean;
  sellableViaTpv: boolean;
  imageUrl: string | null;
  imageMime: string | null;
  imageCachedAt: Date | null;
  lastSyncedAt: Date;
  needsSkuReview: boolean;
}

const tenantStore = new Map<string, FakeTenantRow>();
const productStore = new Map<string, FakeProductRow>();

const fakePrisma = {
  tenant: {
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const t = tenantStore.get(where.id);
      if (!t) throw new Error("tenant not found");
      return t;
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      tenantStore.get(where.id) ?? null,
    ),
    update: vi.fn(async ({ where, data }: any) => {
      const t = tenantStore.get(where.id);
      if (!t) throw new Error("tenant not found");
      Object.assign(t, data);
      return t;
    }),
  },
  tenantTax: {
    upsert: vi.fn(async () => ({})),
  },
  warehouse: {
    upsert: vi.fn(async () => ({})),
  },
  product: {
    findUnique: vi.fn(async ({ where }: any) => {
      const tenantId = where.tenantId_holdedProductId?.tenantId;
      const holdedProductId = where.tenantId_holdedProductId?.holdedProductId;
      if (!tenantId || !holdedProductId) return null;
      const row = [...productStore.values()].find(
        (p) => p.tenantId === tenantId && p.holdedProductId === holdedProductId,
      );
      return row ?? null;
    }),
    findMany: vi.fn(async ({ where }: any) => {
      // Usado por initial-sync.enqueueAllProductImages.
      return [...productStore.values()].filter((p) => {
        if (where.tenantId && p.tenantId !== where.tenantId) return false;
        if (where.imageUrl?.not === null && p.imageUrl === null) return false;
        if (
          Object.prototype.hasOwnProperty.call(where, "imageCachedAt") &&
          where.imageCachedAt === null &&
          p.imageCachedAt !== null
        ) {
          return false;
        }
        return true;
      });
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const key = `${where.tenantId_holdedProductId.tenantId}|${where.tenantId_holdedProductId.holdedProductId}`;
      const existing = [...productStore.values()].find(
        (p) =>
          p.tenantId === where.tenantId_holdedProductId.tenantId &&
          p.holdedProductId === where.tenantId_holdedProductId.holdedProductId,
      );
      if (existing) {
        Object.assign(existing, update, { lastSyncedAt: new Date() });
        return existing;
      }
      const row: FakeProductRow = {
        id: randomUUID(),
        tenantId: create.tenantId,
        holdedProductId: create.holdedProductId,
        name: create.name,
        sku: create.sku ?? null,
        barcode: create.barcode ?? null,
        basePrice: create.basePrice,
        taxRate: create.taxRate,
        kind: create.kind,
        active: create.active ?? true,
        sellableViaTpv: create.sellableViaTpv ?? true,
        imageUrl: create.imageUrl ?? null,
        imageMime: create.imageMime ?? null,
        imageCachedAt: create.imageCachedAt ?? null,
        lastSyncedAt: new Date(),
        needsSkuReview: false,
      };
      productStore.set(key, row);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const p of productStore.values()) {
        if (p.tenantId !== where.tenantId) continue;
        if (where.active !== undefined && p.active !== where.active) continue;
        if (where.lastSyncedAt?.lt && p.lastSyncedAt >= where.lastSyncedAt.lt) continue;
        Object.assign(p, data);
        count += 1;
      }
      return { count };
    }),
  },
  // B7 §8: el incremental sync ahora upserta contactos al final. En
  // este test el iterador yield-ea vacío, así que sólo se llama a
  // updateMany para huérfanos.
  contact: {
    upsert: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

// ── Encrypt fake apiKey con la clave de test ────────────────────────
const { encryptSecret } = await import("../src/crypto.js");
const FAKE_CIPHERTEXT = encryptSecret(
  "test-api-key",
  process.env.HOLDED_KEY_ENCRYPTION_SECRET!,
);

const { runIncrementalSync, IncrementalSyncSkippedError } = await import(
  "../src/catalog/incremental-sync.js"
);

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

function resetTenant(status: FakeTenantRow["initialSyncStatus"] = "DONE") {
  tenantStore.clear();
  productStore.clear();
  tenantStore.set(TENANT_ID, {
    id: TENANT_ID,
    holdedApiKeyCiphertext: FAKE_CIPHERTEXT,
    initialSyncStatus: status,
    lastIncrementalSyncAt: null,
    lastIncrementalSyncStats: null,
  });
}

function seedProduct(holdedId: string, opts: Partial<FakeProductRow> = {}) {
  const row: FakeProductRow = {
    id: randomUUID(),
    tenantId: TENANT_ID,
    holdedProductId: holdedId,
    name: opts.name ?? `P-${holdedId}`,
    sku: opts.sku ?? `SKU-${holdedId}`,
    barcode: opts.barcode ?? null,
    basePrice: opts.basePrice ?? 1,
    taxRate: opts.taxRate ?? 21,
    kind: opts.kind ?? "PRODUCT",
    active: opts.active ?? true,
    sellableViaTpv: opts.sellableViaTpv ?? true,
    imageUrl: opts.imageUrl ?? null,
    imageMime: opts.imageMime ?? null,
    imageCachedAt: opts.imageCachedAt ?? null,
    lastSyncedAt: opts.lastSyncedAt ?? new Date(Date.now() - 60_000),
    needsSkuReview: false,
  };
  productStore.set(`${TENANT_ID}|${holdedId}`, row);
  return row;
}

beforeEach(() => {
  resetTenant("DONE");
  holdedProducts = [];
  holdedServices = [];
  holdedTaxes = [{ id: "", key: "s_iva_21", name: "IVA 21%", amount: "21" }];
  holdedWarehouses = [{ id: "wh-1", name: "Default", default: true }];
  enqueueSpy.mockClear();
});

describe("runIncrementalSync", () => {
  it("happy path: upsertea nuevos + modificados, marca huérfanos como inactive", async () => {
    seedProduct("p-orphan", { name: "Será huérfano" });
    seedProduct("p-existing", { name: "Existente original" });

    holdedProducts = [
      {
        id: "p-existing",
        name: "Existente RENOMBRADO",
        sku: "SKU-existing",
        price: 5,
        taxes: ["s_iva_21"],
        forSale: 1,
      },
      {
        id: "p-new",
        name: "Nuevo",
        sku: "SKU-new",
        price: 3,
        taxes: ["s_iva_21"],
        forSale: 1,
      },
    ];

    const stats = await runIncrementalSync({ tenantId: TENANT_ID, prisma: fakePrisma as any });

    expect(stats.productsSeen).toBe(2);
    expect(stats.orphansMarked).toBe(1);
    expect(stats.errors).toHaveLength(0);

    const orphan = productStore.get(`${TENANT_ID}|p-orphan`)!;
    expect(orphan.active).toBe(false);
    expect(orphan.sellableViaTpv).toBe(false);

    const existing = productStore.get(`${TENANT_ID}|p-existing`)!;
    expect(existing.active).toBe(true);
    expect(existing.name).toBe("Existente RENOMBRADO");

    const created = productStore.get(`${TENANT_ID}|p-new`)!;
    expect(created.name).toBe("Nuevo");
    expect(created.active).toBe(true);

    const tenant = tenantStore.get(TENANT_ID)!;
    expect(tenant.lastIncrementalSyncAt).toBeInstanceOf(Date);
    expect(tenant.lastIncrementalSyncStats).not.toBeNull();
  });

  it("huérfano que vuelve a aparecer en Holded → active=true otra vez", async () => {
    seedProduct("p-returning", {
      name: "Volvió",
      active: false,
      sellableViaTpv: false,
      // Simulamos que lleva tiempo sin verse.
      lastSyncedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    holdedProducts = [
      {
        id: "p-returning",
        name: "Volvió",
        sku: "SKU-returning",
        price: 2,
        taxes: ["s_iva_21"],
        forSale: 1,
      },
    ];

    const stats = await runIncrementalSync({ tenantId: TENANT_ID, prisma: fakePrisma as any });

    expect(stats.productsSeen).toBe(1);
    expect(stats.orphansMarked).toBe(0);

    const returning = productStore.get(`${TENANT_ID}|p-returning`)!;
    expect(returning.active).toBe(true);
    expect(returning.sellableViaTpv).toBe(true);
  });

  it("rechaza tenant sin sync inicial completo (IncrementalSyncSkippedError)", async () => {
    resetTenant("PENDING");
    await expect(
      runIncrementalSync({ tenantId: TENANT_ID, prisma: fakePrisma as any }),
    ).rejects.toBeInstanceOf(IncrementalSyncSkippedError);
  });

  it("rechaza tenant sin API Key (IncrementalSyncSkippedError)", async () => {
    resetTenant("DONE");
    tenantStore.get(TENANT_ID)!.holdedApiKeyCiphertext = null;
    await expect(
      runIncrementalSync({ tenantId: TENANT_ID, prisma: fakePrisma as any }),
    ).rejects.toBeInstanceOf(IncrementalSyncSkippedError);
  });

  it("resuelve taxRate vía /invoicing/v1/taxes (s_iva_21 → 21, s_iva_10 → 10)", async () => {
    holdedTaxes = [
      { id: "", key: "s_iva_21", name: "IVA 21%", amount: "21" },
      { id: "", key: "s_iva_10", name: "IVA 10%", amount: "10" },
      { id: "", key: "s_iva_4", name: "IVA 4%", amount: "4" },
      { id: "", key: "s_iva_0", name: "Sin IVA", amount: "0" },
    ];
    holdedProducts = [
      { id: "p-21", name: "21%", sku: "S21", price: 1, taxes: ["s_iva_21"], forSale: 1 },
      { id: "p-10", name: "10%", sku: "S10", price: 1, taxes: ["s_iva_10"], forSale: 1 },
      { id: "p-4", name: "4%", sku: "S04", price: 1, taxes: ["s_iva_4"], forSale: 1 },
      { id: "p-0", name: "0%", sku: "S00", price: 1, taxes: ["s_iva_0"], forSale: 1 },
    ];

    await runIncrementalSync({ tenantId: TENANT_ID, prisma: fakePrisma as any });

    expect(productStore.get(`${TENANT_ID}|p-21`)!.taxRate).toBe(21);
    expect(productStore.get(`${TENANT_ID}|p-10`)!.taxRate).toBe(10);
    expect(productStore.get(`${TENANT_ID}|p-4`)!.taxRate).toBe(4);
    expect(productStore.get(`${TENANT_ID}|p-0`)!.taxRate).toBe(0);
    for (const sku of ["p-21", "p-10", "p-4", "p-0"]) {
      expect(productStore.get(`${TENANT_ID}|${sku}`)!.sellableViaTpv).toBe(true);
    }
  });

  it("B7.5: resuelve productos que referencian tax `key` (caso shape real Holded)", async () => {
    // Shape exacto de /invoicing/v1/taxes confirmado por spike §11:
    // id puede venir vacío; key matchea Product.taxes[]; amount es
    // string. Productos del piloto referencian "tax_49_sales" (custom)
    // y "s_iva_21" (estándar). Ambos deben resolverse.
    holdedTaxes = [
      { id: "", key: "s_iva_21", name: "IVA 21%", amount: "21" },
      {
        id: "69b7f6b4170c9d1c8c042921",
        key: "tax_49_sales",
        name: "Impuesto 49",
        amount: "49",
      },
    ];
    holdedProducts = [
      { id: "p-std", name: "Estándar", sku: "S21", price: 1, taxes: ["s_iva_21"], forSale: 1 },
      { id: "p-cst", name: "Custom", sku: "S49", price: 1, taxes: ["tax_49_sales"], forSale: 1 },
    ];

    await runIncrementalSync({ tenantId: TENANT_ID, prisma: fakePrisma as any });

    expect(productStore.get(`${TENANT_ID}|p-std`)!.taxRate).toBe(21);
    expect(productStore.get(`${TENANT_ID}|p-std`)!.sellableViaTpv).toBe(true);
    expect(productStore.get(`${TENANT_ID}|p-cst`)!.taxRate).toBe(49);
    expect(productStore.get(`${TENANT_ID}|p-cst`)!.sellableViaTpv).toBe(true);
  });

  it("tax id desconocido → sellableViaTpv=false + warning estructurado", async () => {
    const warnings: Array<{ msg: string; extra?: unknown }> = [];
    const logger = {
      info: () => undefined,
      warn: (msg: string, extra?: unknown) => warnings.push({ msg, extra }),
      error: () => undefined,
    };
    holdedTaxes = [{ id: "", key: "s_iva_21", name: "IVA 21%", amount: "21" }];
    holdedProducts = [
      // taxId que no está en /invoicing/v1/taxes y tampoco encaja con el regex.
      { id: "p-mystery", name: "Tax desconocido", sku: "M01", price: 1, taxes: ["foo_bar_99"], forSale: 1 },
    ];

    await runIncrementalSync({
      tenantId: TENANT_ID,
      prisma: fakePrisma as any,
      logger,
    });

    const stored = productStore.get(`${TENANT_ID}|p-mystery`)!;
    expect(stored.sellableViaTpv).toBe(false);
    // taxRate cae a 0 como valor por defecto pero NO se vende porque el flag
    // sellableViaTpv lo bloquea — el upload-ticket no construirá payload.
    expect(stored.taxRate).toBe(0);
    expect(warnings.some((w) => w.msg.includes("tax sin resolver"))).toBe(true);
  });

  it("producto existente que pierde tax válido → sellableViaTpv pasa a false", async () => {
    seedProduct("p-loses-tax", { sku: "OK", sellableViaTpv: true, taxRate: 21 });
    holdedTaxes = [{ id: "", key: "s_iva_21", name: "IVA 21%", amount: "21" }];
    holdedProducts = [
      { id: "p-loses-tax", name: "loses tax", sku: "OK", price: 1, taxes: ["zz_unknown"], forSale: 1 },
    ];

    await runIncrementalSync({ tenantId: TENANT_ID, prisma: fakePrisma as any });

    const stored = productStore.get(`${TENANT_ID}|p-loses-tax`)!;
    expect(stored.sellableViaTpv).toBe(false);
  });

  it("ignora productos con forSale=0", async () => {
    holdedProducts = [
      {
        id: "p-yes",
        name: "Vendible",
        sku: "x",
        price: 1,
        taxes: ["s_iva_21"],
        forSale: 1,
      },
      {
        id: "p-no",
        name: "No vendible",
        sku: "y",
        price: 1,
        taxes: ["s_iva_21"],
        forSale: 0,
      },
    ];
    const stats = await runIncrementalSync({ tenantId: TENANT_ID, prisma: fakePrisma as any });
    expect(stats.productsSeen).toBe(1);
    expect(productStore.has(`${TENANT_ID}|p-yes`)).toBe(true);
    expect(productStore.has(`${TENANT_ID}|p-no`)).toBe(false);
  });
});

// ── B-ProductImages: persistencia de imageUrl + encolado del worker ──
//
// Confirma que el sync incremental:
//   - extrae `mainImage` del payload Holded y lo persiste en imageUrl.
//   - sin imagen en payload → imageUrl null + no encola.
//   - URL nueva o cambiada → encola job de cache + invalida cachedAt.
//   - URL igual y imageCachedAt poblado → no encola (no-op).
describe("runIncrementalSync · B-ProductImages", () => {
  it("producto con mainImage → persiste imageUrl y encola cache job", async () => {
    holdedProducts = [
      {
        id: "p-img",
        name: "Camiseta",
        sku: "SKU-1",
        price: 10,
        taxes: ["s_iva_21"],
        forSale: 1,
        // mainImage en payload del listado.
        mainImage: "https://cdn.holded.com/p-img.jpg",
      } as any,
    ];

    await runIncrementalSync({ tenantId: TENANT_ID, prisma: fakePrisma as any });

    const row = productStore.get(`${TENANT_ID}|p-img`)!;
    expect(row.imageUrl).toBe("https://cdn.holded.com/p-img.jpg");
    expect(enqueueSpy).toHaveBeenCalledWith(row.id);
  });

  it("producto sin imagen en payload → imageUrl null, no encola", async () => {
    holdedProducts = [
      {
        id: "p-no-img",
        name: "Sin foto",
        sku: "SKU-2",
        price: 5,
        taxes: ["s_iva_21"],
        forSale: 1,
      },
    ];

    await runIncrementalSync({ tenantId: TENANT_ID, prisma: fakePrisma as any });

    const row = productStore.get(`${TENANT_ID}|p-no-img`)!;
    expect(row.imageUrl).toBeNull();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it("URL cambiada → invalida imageCachedAt y encola re-descarga", async () => {
    seedProduct("p-rotated", {
      sku: "SKU-3",
      imageUrl: "https://cdn.holded.com/old.jpg",
      imageMime: "image/jpeg",
      imageCachedAt: new Date(Date.now() - 3_600_000),
    });
    holdedProducts = [
      {
        id: "p-rotated",
        name: "Misma foto cambiada",
        sku: "SKU-3",
        price: 10,
        taxes: ["s_iva_21"],
        forSale: 1,
        mainImage: "https://cdn.holded.com/new.jpg",
      } as any,
    ];

    await runIncrementalSync({ tenantId: TENANT_ID, prisma: fakePrisma as any });

    const row = productStore.get(`${TENANT_ID}|p-rotated`)!;
    expect(row.imageUrl).toBe("https://cdn.holded.com/new.jpg");
    expect(row.imageCachedAt).toBeNull();
    expect(row.imageMime).toBeNull();
    expect(enqueueSpy).toHaveBeenCalledWith(row.id);
  });

  it("URL igual y cacheado → NO encola (idempotente)", async () => {
    seedProduct("p-cached", {
      sku: "SKU-4",
      imageUrl: "https://cdn.holded.com/same.jpg",
      imageMime: "image/jpeg",
      imageCachedAt: new Date(Date.now() - 3_600_000),
    });
    holdedProducts = [
      {
        id: "p-cached",
        name: "Cacheado y sin cambios",
        sku: "SKU-4",
        price: 10,
        taxes: ["s_iva_21"],
        forSale: 1,
        mainImage: "https://cdn.holded.com/same.jpg",
      } as any,
    ];

    await runIncrementalSync({ tenantId: TENANT_ID, prisma: fakePrisma as any });

    const row = productStore.get(`${TENANT_ID}|p-cached`)!;
    expect(row.imageUrl).toBe("https://cdn.holded.com/same.jpg");
    expect(row.imageMime).toBe("image/jpeg");
    expect(row.imageCachedAt).toBeInstanceOf(Date);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it("URL igual pero imageCachedAt null (descarga previa falló) → reintenta", async () => {
    seedProduct("p-retry", {
      sku: "SKU-5",
      imageUrl: "https://cdn.holded.com/x.jpg",
      imageMime: null,
      imageCachedAt: null,
    });
    holdedProducts = [
      {
        id: "p-retry",
        name: "Pendiente",
        sku: "SKU-5",
        price: 10,
        taxes: ["s_iva_21"],
        forSale: 1,
        mainImage: "https://cdn.holded.com/x.jpg",
      } as any,
    ];

    await runIncrementalSync({ tenantId: TENANT_ID, prisma: fakePrisma as any });

    const row = productStore.get(`${TENANT_ID}|p-retry`)!;
    expect(enqueueSpy).toHaveBeenCalledWith(row.id);
  });
});
