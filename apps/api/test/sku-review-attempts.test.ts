// B3 mini-fix §4.4. El contador `skuReviewAttempts` se incrementa en
// cada intento de assign (éxito o silent reject). El endpoint
// `mark-unsellable` saca el producto de la bandeja.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeProduct {
  id: string;
  tenantId: string;
  holdedProductId: string;
  name: string;
  basePrice: number;
  taxRate: number;
  sku: string | null;
  needsSkuReview: boolean;
  sellableViaTpv: boolean;
  skuReviewAttempts: number;
}

interface FakeTenant {
  id: string;
  holdedApiKeyCiphertext: string;
}

const products = new Map<string, FakeProduct>();
const tenants = new Map<string, FakeTenant>();

const fakePrisma = {
  product: {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const p of products.values()) {
        if (where.id && p.id !== where.id) continue;
        if (where.tenantId && p.tenantId !== where.tenantId) continue;
        return p;
      }
      return null;
    }),
    findMany: vi.fn(async ({ where }: any) => {
      const out: FakeProduct[] = [];
      for (const p of products.values()) {
        if (where.tenantId && p.tenantId !== where.tenantId) continue;
        if (where.needsSkuReview != null && p.needsSkuReview !== where.needsSkuReview) continue;
        out.push(p);
      }
      return out;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const p = products.get(where.id);
      if (!p) throw new Error("not found");
      if (data.skuReviewAttempts?.increment != null) {
        p.skuReviewAttempts += data.skuReviewAttempts.increment;
      }
      if (data.needsSkuReview !== undefined) p.needsSkuReview = data.needsSkuReview;
      if (data.sellableViaTpv !== undefined) p.sellableViaTpv = data.sellableViaTpv;
      if (data.sku !== undefined) p.sku = data.sku;
      return p;
    }),
  },
  tenant: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      return tenants.get(where.id) ?? null;
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({}),
  shutdown: async () => undefined,
}));

// Mock del cliente Holded para forzar success o silent reject.
let mockHoldedBehaviour: "ok" | "silent" = "ok";
vi.mock("@mipiacetpv/holded-client", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    updateProductWithGetBack: async () => {
      if (mockHoldedBehaviour === "ok") return;
      // Firma: (operation, url, mismatches[], storedSnapshot?)
      throw new (real.HoldedSilentRejectError as new (
        operation: string,
        url: string,
        mismatches: unknown[],
        storedSnapshot?: unknown,
      ) => Error)("PUT", "/products/abc123", [], {});
    },
    ApiKeyClient: function () {
      return {};
    },
  };
});

// Mock del crypto para que no necesitemos descifrar.
vi.mock("../src/crypto.js", () => ({
  decryptSecret: () => "FAKE_API_KEY",
  encryptSecret: (v: string) => v,
}));

const { registerCatalogRoutes } = await import("../src/catalog/routes.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const PRODUCT_ID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  products.clear();
  tenants.clear();
  vi.clearAllMocks();
  mockHoldedBehaviour = "ok";
  tenants.set(TENANT_ID, {
    id: TENANT_ID,
    holdedApiKeyCiphertext: "v1:dummy",
  });
  products.set(PRODUCT_ID, {
    id: PRODUCT_ID,
    tenantId: TENANT_ID,
    holdedProductId: "abc123",
    name: "Producto sin SKU",
    basePrice: 9.9,
    taxRate: 21,
    sku: null,
    needsSkuReview: true,
    sellableViaTpv: false,
    skuReviewAttempts: 0,
  });
});

function ownerBearer() {
  return `Bearer ${signAccessToken({ sub: OWNER_ID, tid: TENANT_ID, role: "OWNER" })}`;
}

async function buildApp() {
  const app = Fastify();
  await registerCatalogRoutes(app);
  return app;
}

describe("sku-review attempts counter", () => {
  it("incrementa skuReviewAttempts en éxito", async () => {
    const app = await buildApp();
    mockHoldedBehaviour = "ok";
    const res = await app.inject({
      method: "POST",
      url: `/catalog/sku-review/${PRODUCT_ID}/assign`,
      headers: { authorization: ownerBearer() },
      payload: { sku: "MANUAL-001" },
    });
    expect(res.statusCode).toBe(200);
    expect(products.get(PRODUCT_ID)!.skuReviewAttempts).toBe(1);
    expect(products.get(PRODUCT_ID)!.needsSkuReview).toBe(false);
  });

  it("incrementa skuReviewAttempts en silent reject y mantiene needsSkuReview", async () => {
    const app = await buildApp();
    mockHoldedBehaviour = "silent";
    const res = await app.inject({
      method: "POST",
      url: `/catalog/sku-review/${PRODUCT_ID}/assign`,
      headers: { authorization: ownerBearer() },
      payload: { sku: "MANUAL-002" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("HOLDED_SILENT_REJECT");
    expect(products.get(PRODUCT_ID)!.skuReviewAttempts).toBe(1);
    expect(products.get(PRODUCT_ID)!.needsSkuReview).toBe(true);
  });

  it("GET /catalog/sku-review expone skuReviewAttempts", async () => {
    products.get(PRODUCT_ID)!.skuReviewAttempts = 4;
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/catalog/sku-review",
      headers: { authorization: ownerBearer() },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ skuReviewAttempts: number }>;
    expect(items[0]!.skuReviewAttempts).toBe(4);
  });
});

describe("mark-unsellable", () => {
  it("setea sellableViaTpv=false + needsSkuReview=false", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/catalog/sku-review/${PRODUCT_ID}/mark-unsellable`,
      headers: { authorization: ownerBearer() },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const p = products.get(PRODUCT_ID)!;
    expect(p.sellableViaTpv).toBe(false);
    expect(p.needsSkuReview).toBe(false);
  });

  it("404 si el producto no pertenece al tenant", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/catalog/sku-review/${"99999999-9999-9999-9999-999999999999"}/mark-unsellable`,
      headers: { authorization: ownerBearer() },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
