// Tests de la conciliación standalone de catálogo (v1.9-sync-borrados).
// Cubre la pasada que usa el one-shot post-deploy:
//
//   - Diff con set vivo: archiva lo que Holded ya no lista (productos
//     y servicios), respeta lo vivo.
//   - Protección anti-catástrofe: payload vacío o <50% NO archiva.
//   - --force salta la protección.
//   - forSale=0 no cuenta como vivo (mismo criterio que el sync).
//   - Tenant sin API key / sin sync inicial → CatalogReconcileSkippedError.
//   - Error de listado (página rota) aborta ANTES de archivar.

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
let productsListingFails = false;

vi.mock("@mipiacetpv/holded-client", async () => {
  const actual = await vi.importActual<typeof import("@mipiacetpv/holded-client")>(
    "@mipiacetpv/holded-client",
  );
  return {
    ...actual,
    ApiKeyClient: vi.fn().mockImplementation(() => ({})) as any,
    iterateAllProducts: vi.fn(async function* () {
      if (productsListingFails) {
        throw new actual.HoldedApiError(500, "/invoicing/v1/products?page=1", {});
      }
      yield { page: 1, products: holdedProducts };
    }),
    iterateAllServices: vi.fn(async function* () {
      yield { page: 1, services: holdedServices };
    }),
  };
});

interface FakeProductRow {
  id: string;
  tenantId: string;
  holdedProductId: string;
  name: string;
  active: boolean;
  sellableViaTpv: boolean;
  archivedFromHoldedAt: Date | null;
}

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const productStore = new Map<string, FakeProductRow>();

let tenantRow: {
  id: string;
  holdedApiKeyCiphertext: string | null;
  initialSyncStatus: string;
};

const fakePrisma = {
  tenant: {
    findUniqueOrThrow: vi.fn(async () => tenantRow),
  },
  product: {
    count: vi.fn(async ({ where }: any) =>
      [...productStore.values()].filter(
        (p) => p.tenantId === where.tenantId && p.active === where.active,
      ).length,
    ),
    findMany: vi.fn(async ({ where }: any) =>
      [...productStore.values()].filter((p) => {
        if (p.tenantId !== where.tenantId) return false;
        if (where.active !== undefined && p.active !== where.active) return false;
        if (where.holdedProductId?.notIn?.includes(p.holdedProductId)) return false;
        return true;
      }),
    ),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const p of productStore.values()) {
        if (p.tenantId !== where.tenantId) continue;
        if (where.active !== undefined && p.active !== where.active) continue;
        if (where.holdedProductId?.notIn?.includes(p.holdedProductId)) continue;
        Object.assign(p, data);
        count += 1;
      }
      return { count };
    }),
  },
} as const;

const { encryptSecret } = await import("../src/crypto.js");
const FAKE_CIPHERTEXT = encryptSecret(
  "test-api-key",
  process.env.HOLDED_KEY_ENCRYPTION_SECRET!,
);

const { runCatalogReconcile, CatalogReconcileSkippedError } = await import(
  "../src/catalog/reconcile.js"
);

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function seedProduct(holdedId: string, opts: Partial<FakeProductRow> = {}) {
  const row: FakeProductRow = {
    id: randomUUID(),
    tenantId: TENANT_ID,
    holdedProductId: holdedId,
    name: opts.name ?? `P-${holdedId}`,
    active: opts.active ?? true,
    sellableViaTpv: opts.sellableViaTpv ?? true,
    archivedFromHoldedAt: opts.archivedFromHoldedAt ?? null,
  };
  productStore.set(`${TENANT_ID}|${holdedId}`, row);
  return row;
}

function run(force = false) {
  return runCatalogReconcile({
    tenantId: TENANT_ID,
    prisma: fakePrisma as any,
    force,
    logger: silentLogger,
  });
}

beforeEach(() => {
  productStore.clear();
  fakePrisma.product.count.mockClear();
  fakePrisma.product.findMany.mockClear();
  fakePrisma.product.updateMany.mockClear();
  holdedProducts = [];
  holdedServices = [];
  productsListingFails = false;
  tenantRow = {
    id: TENANT_ID,
    holdedApiKeyCiphertext: FAKE_CIPHERTEXT,
    initialSyncStatus: "DONE",
  };
});

describe("runCatalogReconcile", () => {
  it("archiva productos y servicios que Holded ya no lista, respeta los vivos", async () => {
    seedProduct("p-alive", { name: "Vivo" });
    seedProduct("p-dead", { name: "Borrado" });
    seedProduct("svc-dead", { name: "Encuadernacion" });
    holdedProducts = [
      { id: "p-alive", name: "Vivo", forSale: 1 },
      { id: "p-other", name: "Nuevo en Holded (aún sin sync)", forSale: 1 },
    ];
    holdedServices = [];

    const result = await run();

    expect(result.aborted).toBeNull();
    expect(result.archived).toBe(2);
    expect(result.localActiveBefore).toBe(3);
    expect(result.liveSeen).toBe(2);
    expect(result.archivedSample.map((s) => s.holdedProductId).sort()).toEqual([
      "p-dead",
      "svc-dead",
    ]);
    const dead = productStore.get(`${TENANT_ID}|p-dead`)!;
    expect(dead.active).toBe(false);
    expect(dead.sellableViaTpv).toBe(false);
    expect(dead.archivedFromHoldedAt).toBeInstanceOf(Date);
    expect(productStore.get(`${TENANT_ID}|p-alive`)!.active).toBe(true);
  });

  it("un servicio vivo en Holded cuenta en el set (no se archiva)", async () => {
    seedProduct("svc-alive", { name: "Fotocopia" });
    holdedServices = [{ id: "svc-alive", name: "Fotocopia" }];

    const result = await run();

    expect(result.archived).toBe(0);
    expect(productStore.get(`${TENANT_ID}|svc-alive`)!.active).toBe(true);
  });

  it("producto forSale=0 NO cuenta como vivo (mismo criterio que el sync)", async () => {
    seedProduct("p-hidden", { name: "No vendible" });
    seedProduct("p-normal", { name: "Normal" });
    holdedProducts = [
      { id: "p-hidden", name: "No vendible", forSale: 0 },
      { id: "p-normal", name: "Normal", forSale: 1 },
    ];

    const result = await run();

    expect(result.archived).toBe(1);
    expect(productStore.get(`${TENANT_ID}|p-hidden`)!.active).toBe(false);
  });

  it("anti-catástrofe: listado vacío con catálogo local vivo → aborta sin archivar", async () => {
    seedProduct("p-1");
    seedProduct("p-2");

    const result = await run();

    expect(result.aborted).toBe("empty-live-set");
    expect(result.archived).toBe(0);
    expect(productStore.get(`${TENANT_ID}|p-1`)!.active).toBe(true);
  });

  it("anti-catástrofe: <50% de los activos locales → aborta sin archivar", async () => {
    seedProduct("p-1");
    seedProduct("p-2");
    seedProduct("p-3");
    holdedProducts = [{ id: "p-1", name: "Uno", forSale: 1 }];

    const result = await run();

    expect(result.aborted).toBe("live-set-below-ratio");
    expect(result.archived).toBe(0);
    expect(productStore.get(`${TENANT_ID}|p-2`)!.active).toBe(true);
  });

  it("--force salta la protección y archiva (borrado masivo verificado a mano)", async () => {
    seedProduct("p-1");
    seedProduct("p-2");
    seedProduct("p-3");
    holdedProducts = [{ id: "p-1", name: "Uno", forSale: 1 }];

    const result = await run(true);

    expect(result.aborted).toBeNull();
    expect(result.archived).toBe(2);
    expect(productStore.get(`${TENANT_ID}|p-1`)!.active).toBe(true);
    expect(productStore.get(`${TENANT_ID}|p-2`)!.active).toBe(false);
    expect(productStore.get(`${TENANT_ID}|p-3`)!.active).toBe(false);
  });

  it("catálogo local sin activos → no-op sin abortar", async () => {
    seedProduct("p-old", { active: false });

    const result = await run();

    expect(result.aborted).toBeNull();
    expect(result.archived).toBe(0);
    expect(result.localActiveBefore).toBe(0);
  });

  it("error de listado (página rota) aborta ANTES de archivar", async () => {
    seedProduct("p-1");
    productsListingFails = true;

    await expect(run()).rejects.toThrow("Holded API 500");
    expect(productStore.get(`${TENANT_ID}|p-1`)!.active).toBe(true);
    expect(fakePrisma.product.updateMany).not.toHaveBeenCalled();
  });

  it("tenant sin API key → CatalogReconcileSkippedError", async () => {
    tenantRow.holdedApiKeyCiphertext = null;
    await expect(run()).rejects.toBeInstanceOf(CatalogReconcileSkippedError);
  });

  it("tenant sin sync inicial completo → CatalogReconcileSkippedError", async () => {
    tenantRow.initialSyncStatus = "PENDING";
    await expect(run()).rejects.toBeInstanceOf(CatalogReconcileSkippedError);
  });
});
