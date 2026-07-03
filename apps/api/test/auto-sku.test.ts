import { describe, expect, it, vi } from "vitest";

import { HoldedApiError, type HoldedClient } from "@mipiacetpv/holded-client";

import { buildAutoSku, runAutoSku } from "../src/onboarding/auto-sku.js";

// Minimal stub de Prisma. El script sólo usa
// `prisma.product.findMany(...)` y `prisma.product.update(...)`.
interface ProductRow {
  id: string;
  holdedProductId: string;
  name: string;
  kind: "PRODUCT" | "SERVICE";
  sku?: string | null;
  needsSkuReview?: boolean;
  sellableViaTpv?: boolean;
}

function makePrisma(initial: ProductRow[]) {
  const rows = new Map(initial.map((p) => [p.id, { ...p }]));
  return {
    rows,
    product: {
      findMany: vi.fn(async (args: {
        where: {
          tenantId: string;
          kind?: "PRODUCT" | "SERVICE";
          OR: Array<{ sku: null | "" }>;
          needsSkuReview: boolean;
        };
      }) => {
        return Array.from(rows.values())
          .filter((r) => (r.sku == null || r.sku === "") && !r.needsSkuReview)
          // runAutoSku filtra por kind desde v1.3-hotfix4 (PRODUCT y
          // SERVICE se procesan en pasadas separadas).
          .filter((r) => !args.where.kind || r.kind === args.where.kind)
          .map((r) => ({
            id: r.id,
            holdedProductId: r.holdedProductId,
            name: r.name,
            kind: r.kind,
          }));
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ProductRow> & { skuAutoAssignedAt?: Date } }) => {
        const r = rows.get(where.id);
        if (!r) throw new Error(`row ${where.id} no existe`);
        Object.assign(r, data);
        return r;
      }),
    },
  } as const;
}

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe("buildAutoSku", () => {
  it("toma los primeros 8 chars del holded_id sanitizado", () => {
    expect(buildAutoSku("68d50ecfd24138c0cf089d2b")).toBe("AUTO-68d50ecf");
  });
  it("ignora guiones u otros caracteres", () => {
    expect(buildAutoSku("ab-cd-1234-5678")).toBe("AUTO-abcd1234");
  });
});

describe("runAutoSku", () => {
  function makeClient(handler: (path: string, init?: RequestInit) => unknown): HoldedClient {
    return {
      request: vi.fn(async (path: string, init?: RequestInit) => handler(path, init)) as HoldedClient["request"],
    };
  }

  it("happy path: producto sin sku → PUT + GET-back → sku asignado en local", async () => {
    const prisma = makePrisma([
      {
        id: "local-1",
        holdedProductId: "abcd1234ef567890",
        name: "Producto sin SKU",
        kind: "PRODUCT",
        sku: "",
        needsSkuReview: false,
      },
    ]);
    const client = makeClient((path, init) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string) as { sku: string };
        expect(path).toBe("/invoicing/v1/products/abcd1234ef567890");
        expect(body.sku).toBe("AUTO-abcd1234");
        return { status: 1, info: "Updated" };
      }
      return { id: "abcd1234ef567890", sku: "AUTO-abcd1234", name: "Producto sin SKU" };
    });
    const result = await runAutoSku({
      tenantId: "t1",
      prisma: prisma as unknown as Parameters<typeof runAutoSku>[0]["prisma"],
      client,
      logger: silentLogger,
      throttleMs: 0,
      sleep: () => Promise.resolve(),
    });
    expect(result.fixed).toBe(1);
    expect(result.needsReview).toBe(0);
    expect(result.errors).toEqual([]);
    const row = prisma.rows.get("local-1");
    expect(row?.sku).toBe("AUTO-abcd1234");
    expect(row?.sellableViaTpv).toBe(true);
    expect(row?.needsSkuReview).toBe(false);
  });

  it("Holded silencia el cambio (GET-back demuestra sku vacío) → needs_review", async () => {
    const prisma = makePrisma([
      {
        id: "local-2",
        holdedProductId: "deadbeef0000",
        name: "Holded chunga",
        kind: "PRODUCT",
        sku: null,
        needsSkuReview: false,
      },
    ]);
    const client = makeClient((path, init) => {
      if (init?.method === "PUT") return { status: 1, info: "Updated" };
      return { id: "deadbeef0000", sku: "", name: "Holded chunga" };
    });
    const result = await runAutoSku({
      tenantId: "t1",
      prisma: prisma as unknown as Parameters<typeof runAutoSku>[0]["prisma"],
      client,
      logger: silentLogger,
      throttleMs: 0,
      sleep: () => Promise.resolve(),
    });
    expect(result.fixed).toBe(0);
    expect(result.needsReview).toBe(1);
    const row = prisma.rows.get("local-2");
    expect(row?.needsSkuReview).toBe(true);
    expect(row?.sellableViaTpv).toBe(false);
    expect(row?.sku).toBeFalsy();
  });

  it("Holded 404 → producto marcado inactivo + sellableViaTpv=false (B5 §1.2)", async () => {
    const prisma = makePrisma([
      {
        id: "local-orphan",
        holdedProductId: "69b7f8be522458c48a0ef621",
        name: "Borrado en Holded",
        kind: "PRODUCT",
        sku: null,
        needsSkuReview: false,
        sellableViaTpv: true,
      },
    ]);
    const client = {
      request: vi.fn(async () => {
        throw new HoldedApiError(
          404,
          "/invoicing/v1/products/69b7f8be522458c48a0ef621",
          { status: 0, info: "Not found" },
        );
      }),
    };
    const result = await runAutoSku({
      tenantId: "t1",
      prisma: prisma as unknown as Parameters<typeof runAutoSku>[0]["prisma"],
      client,
      logger: silentLogger,
      throttleMs: 0,
      sleep: () => Promise.resolve(),
    });
    expect(result.fixed).toBe(0);
    expect(result.needsReview).toBe(0);
    // El 404 NO contamina `errors` porque ya está gestionado: el siguiente
    // sync no lo procesará y dejaremos de generar ruido cada 15 min.
    expect(result.errors).toEqual([]);
    const row = prisma.rows.get("local-orphan") as ProductRow & {
      active?: boolean;
      archivedFromHoldedAt?: Date;
    };
    expect(row?.active).toBe(false);
    expect(row?.sellableViaTpv).toBe(false);
    // v1.9 Frente 2: el 404 deja timestamp de archivado.
    expect(row?.archivedFromHoldedAt).toBeInstanceOf(Date);
  });

  it("v1.9: 400 persistente (TALONARIO CAJA) → bandeja de revisión, sin reintento infinito", async () => {
    const prisma = makePrisma([
      {
        id: "local-talonario",
        holdedProductId: "68d66b3386a8efc7260acf3a",
        name: "TALONARIO CAJA",
        kind: "PRODUCT",
        sku: null,
        needsSkuReview: false,
        sellableViaTpv: true,
      },
    ]);
    const client = {
      request: vi.fn(async () => {
        throw new HoldedApiError(
          400,
          "/invoicing/v1/products/68d66b3386a8efc7260acf3a",
          { status: 0, info: "Bad request" },
        );
      }),
    };
    const result = await runAutoSku({
      tenantId: "t1",
      prisma: prisma as unknown as Parameters<typeof runAutoSku>[0]["prisma"],
      client,
      logger: silentLogger,
      throttleMs: 0,
      sleep: () => Promise.resolve(),
    });
    expect(result.fixed).toBe(0);
    expect(result.needsReview).toBe(1);
    // Gestionado (bandeja), no contamina errors.
    expect(result.errors).toEqual([]);
    const row = prisma.rows.get("local-talonario");
    // needsSkuReview=true lo saca de los candidatos → el siguiente sync
    // ya no lo reintenta.
    expect(row?.needsSkuReview).toBe(true);
    expect(row?.sellableViaTpv).toBe(false);
  });

  it("HoldedApiError 429 NO marca needs_review (transitorio, reintenta el próximo sync)", async () => {
    const prisma = makePrisma([
      {
        id: "local-3",
        holdedProductId: "rate-limited",
        name: "Rate limited",
        kind: "PRODUCT",
        sku: null,
        needsSkuReview: false,
      },
    ]);
    const client = {
      request: vi.fn(async () => {
        throw new HoldedApiError(429, "/x", { status: 0, info: "rate" });
      }),
    };
    const result = await runAutoSku({
      tenantId: "t1",
      prisma: prisma as unknown as Parameters<typeof runAutoSku>[0]["prisma"],
      client,
      logger: silentLogger,
      throttleMs: 0,
      sleep: () => Promise.resolve(),
    });
    expect(result.fixed).toBe(0);
    expect(result.needsReview).toBe(0);
    expect(result.errors).toHaveLength(1);
    const row = prisma.rows.get("local-3");
    expect(row?.needsSkuReview).toBe(false);
  });

  it("idempotencia: re-ejecutar tras éxito no toca el producto", async () => {
    const prisma = makePrisma([
      {
        id: "local-4",
        holdedProductId: "abc1234567",
        name: "Ya con SKU",
        kind: "PRODUCT",
        sku: "AUTO-abc12345",
        needsSkuReview: false,
      },
    ]);
    const client = {
      request: vi.fn(async () => {
        throw new Error("no debería llamarse");
      }),
    };
    const result = await runAutoSku({
      tenantId: "t1",
      prisma: prisma as unknown as Parameters<typeof runAutoSku>[0]["prisma"],
      client,
      logger: silentLogger,
      throttleMs: 0,
      sleep: () => Promise.resolve(),
    });
    expect(result.candidatesScanned).toBe(0);
    expect(result.fixed).toBe(0);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("aplica throttle entre llamadas (sleep mockeado)", async () => {
    const prisma = makePrisma([
      { id: "p1", holdedProductId: "id1aaaaa", name: "P1", kind: "PRODUCT", sku: null, needsSkuReview: false },
      { id: "p2", holdedProductId: "id2bbbbb", name: "P2", kind: "PRODUCT", sku: null, needsSkuReview: false },
    ]);
    const sleeps: number[] = [];
    const client = {
      request: vi.fn(async (_path: string, init?: RequestInit) => {
        if (init?.method === "PUT") return { status: 1, info: "Updated" };
        const body = JSON.parse(init?.body as string ?? "{}");
        return { id: "x", sku: body.sku, name: "x" };
      }),
    };
    // El segundo PUT lleva sku coherente; el "stored" del GET-back debe
    // devolver el mismo sku para satisfacer la invariante. Reescribimos
    // el client para que el GET-back devuelva el sku del último PUT
    // visto.
    let lastSku = "";
    client.request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        lastSku = (JSON.parse(init.body as string) as { sku: string }).sku;
        return { status: 1, info: "Updated" };
      }
      return { id: "x", sku: lastSku, name: "x" };
    });
    const result = await runAutoSku({
      tenantId: "t",
      prisma: prisma as unknown as Parameters<typeof runAutoSku>[0]["prisma"],
      client: client as unknown as HoldedClient,
      logger: silentLogger,
      throttleMs: 200,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result.fixed).toBe(2);
    expect(sleeps).toEqual([200, 200]);
  });
});

