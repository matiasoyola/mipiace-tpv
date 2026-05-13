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
let holdedTaxes = [{ id: "s_iva_21", name: "IVA 21%", rate: 21 }];
let holdedWarehouses = [{ id: "wh-1", name: "Default", default: true }];

vi.mock("@mipiacetpv/holded-client", async () => {
  const actual = await vi.importActual<typeof import("@mipiacetpv/holded-client")>(
    "@mipiacetpv/holded-client",
  );
  return {
    ...actual,
    ApiKeyClient: vi.fn().mockImplementation(() => ({})) as any,
    listTaxes: vi.fn(async () => holdedTaxes),
    listWarehouses: vi.fn(async () => holdedWarehouses),
    iterateAllProducts: vi.fn(async function* () {
      yield { page: 1, products: holdedProducts };
    }),
    iterateAllServices: vi.fn(async function* () {
      yield { page: 1, services: holdedServices };
    }),
    parseTaxRateFromId: (id: string) =>
      id?.startsWith("s_iva_") ? Number(id.slice(6)) : null,
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
  holdedTaxes = [{ id: "s_iva_21", name: "IVA 21%", rate: 21 }];
  holdedWarehouses = [{ id: "wh-1", name: "Default", default: true }];
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
      { id: "s_iva_21", name: "IVA 21%", rate: 21 },
      { id: "s_iva_10", name: "IVA 10%", rate: 10 },
      { id: "s_iva_4", name: "IVA 4%", rate: 4 },
      { id: "s_iva_0", name: "Sin IVA", rate: 0 },
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

  it("tax id desconocido → sellableViaTpv=false + warning estructurado", async () => {
    const warnings: Array<{ msg: string; extra?: unknown }> = [];
    const logger = {
      info: () => undefined,
      warn: (msg: string, extra?: unknown) => warnings.push({ msg, extra }),
      error: () => undefined,
    };
    holdedTaxes = [{ id: "s_iva_21", name: "IVA 21%", rate: 21 }];
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
    holdedTaxes = [{ id: "s_iva_21", name: "IVA 21%", rate: 21 }];
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
