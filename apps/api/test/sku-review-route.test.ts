// Tests de GET /catalog/sku-review y POST /catalog/sku-review/:id/assign
// (B2 §4.4). Mockea el cliente Holded (updateProductWithGetBack) y
// Prisma en memoria.

import { randomBytes, randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock cliente Holded ─────────────────────────────────────────────
let updateBehavior: "ok" | "silent-reject" | "http-error" = "ok";
vi.mock("@mipiacetpv/holded-client", async () => {
  const actual = await vi.importActual<typeof import("@mipiacetpv/holded-client")>(
    "@mipiacetpv/holded-client",
  );
  return {
    ...actual,
    ApiKeyClient: vi.fn().mockImplementation(() => ({})) as any,
    updateProductWithGetBack: vi.fn(async (_client: unknown, holdedId: string, body: any) => {
      if (updateBehavior === "silent-reject") {
        throw new actual.HoldedSilentRejectError(
          `PUT product ${holdedId}`,
          `/invoicing/v1/products/${holdedId}`,
          [{ field: "sku", expected: body.sku, actual: null }],
          { id: holdedId },
        );
      }
      if (updateBehavior === "http-error") {
        throw new actual.HoldedApiError(500, `/invoicing/v1/products/${holdedId}`, "boom");
      }
      return { id: holdedId, sku: body.sku } as any;
    }),
  };
});

// ── Prisma fake ─────────────────────────────────────────────────────
interface FakeProductRow {
  id: string;
  tenantId: string;
  holdedProductId: string;
  name: string;
  basePrice: number;
  taxRate: number;
  sku: string | null;
  needsSkuReview: boolean;
  sellableViaTpv: boolean;
  skuAutoAssignedAt: Date | null;
}

const productStore = new Map<string, FakeProductRow>();
const tenantStore = new Map<string, { id: string; holdedApiKeyCiphertext: string | null }>();

const fakePrisma = {
  tenant: {
    findUnique: vi.fn(async ({ where }: any) => tenantStore.get(where.id) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const t = tenantStore.get(where.id);
      if (!t) throw new Error("not found");
      return t;
    }),
  },
  product: {
    findMany: vi.fn(async ({ where, orderBy: _o, select: _s }: any) => {
      const list = [...productStore.values()].filter(
        (p) =>
          p.tenantId === where.tenantId && p.needsSkuReview === where.needsSkuReview,
      );
      list.sort((a, b) => a.name.localeCompare(b.name));
      return list.map((p) => ({
        id: p.id,
        holdedProductId: p.holdedProductId,
        name: p.name,
        basePrice: p.basePrice,
        taxRate: p.taxRate,
        sku: p.sku,
        sellableViaTpv: p.sellableViaTpv,
      }));
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      for (const p of productStore.values()) {
        if (p.id === where.id && p.tenantId === where.tenantId) {
          return {
            id: p.id,
            holdedProductId: p.holdedProductId,
            needsSkuReview: p.needsSkuReview,
          };
        }
      }
      return null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const p = [...productStore.values()].find((x) => x.id === where.id);
      if (!p) throw new Error("not found");
      Object.assign(p, data);
      return p;
    }),
  },
} as const;

vi.mock("../src/context.js", () => ({
  getPrisma: () => fakePrisma,
  getRedis: () => ({ ping: async () => "PONG" }),
  shutdown: async () => undefined,
}));

const { encryptSecret } = await import("../src/crypto.js");
const FAKE_CIPHERTEXT = encryptSecret("test-key", process.env.HOLDED_KEY_ENCRYPTION_SECRET!);

const { registerCatalogRoutes } = await import("../src/catalog/routes.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const ACCESS_TOKEN = signAccessToken({ sub: USER_ID, tid: TENANT_ID, role: "OWNER" });

async function buildApp() {
  const app = Fastify();
  await registerCatalogRoutes(app);
  return app;
}

function seedProduct(opts: Partial<FakeProductRow> = {}) {
  const id = opts.id ?? randomUUID();
  const row: FakeProductRow = {
    id,
    tenantId: TENANT_ID,
    holdedProductId: opts.holdedProductId ?? "holded-" + id.slice(0, 8),
    name: opts.name ?? "Producto X",
    basePrice: opts.basePrice ?? 1.5,
    taxRate: opts.taxRate ?? 21,
    sku: opts.sku ?? null,
    needsSkuReview: opts.needsSkuReview ?? true,
    sellableViaTpv: opts.sellableViaTpv ?? false,
    skuAutoAssignedAt: null,
  };
  productStore.set(id, row);
  return row;
}

beforeEach(() => {
  productStore.clear();
  tenantStore.clear();
  updateBehavior = "ok";
  tenantStore.set(TENANT_ID, { id: TENANT_ID, holdedApiKeyCiphertext: FAKE_CIPHERTEXT });
});

describe("GET /catalog/sku-review", () => {
  it("lista sólo productos con needsSkuReview=true, ordenados por nombre", async () => {
    seedProduct({ name: "Zeta", needsSkuReview: true });
    seedProduct({ name: "Alfa", needsSkuReview: true });
    seedProduct({ name: "Beta", needsSkuReview: false }); // excluido
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/catalog/sku-review",
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.map((i: any) => i.name)).toEqual(["Alfa", "Zeta"]);
    expect(items[0].suggestedSku).toMatch(/^AUTO-/);
    await app.close();
  });

  it("rechaza sin auth → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/catalog/sku-review" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /catalog/sku-review/:productId/assign", () => {
  it("happy path: PUT a Holded OK → marca needsSkuReview=false, sellable=true", async () => {
    const p = seedProduct({ name: "Necesita sku" });
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/catalog/sku-review/${p.id}/assign`,
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { sku: "MANUAL-001" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sku).toBe("MANUAL-001");
    const after = productStore.get(p.id)!;
    expect(after.sku).toBe("MANUAL-001");
    expect(after.needsSkuReview).toBe(false);
    expect(after.sellableViaTpv).toBe(true);
    await app.close();
  });

  it("Holded silencia → 502 con mismatches, needsSkuReview se mantiene", async () => {
    updateBehavior = "silent-reject";
    const p = seedProduct();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/catalog/sku-review/${p.id}/assign`,
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { sku: "ZZZ" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("HOLDED_SILENT_REJECT");
    expect(res.json().mismatches).toHaveLength(1);
    const after = productStore.get(p.id)!;
    expect(after.needsSkuReview).toBe(true); // sigue en bandeja
    expect(after.sku).toBeNull(); // no se persistió
    await app.close();
  });

  it("sin API Key → 409 NO_HOLDED_KEY", async () => {
    tenantStore.get(TENANT_ID)!.holdedApiKeyCiphertext = null;
    const p = seedProduct();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/catalog/sku-review/${p.id}/assign`,
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { sku: "X" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("NO_HOLDED_KEY");
    await app.close();
  });

  it("producto inexistente → 404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/catalog/sku-review/${randomUUID()}/assign`,
      headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
      payload: { sku: "X" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
