import { describe, expect, it, vi } from "vitest";

import {
  HoldedSilentRejectError,
  iterateAllProducts,
  listProductsPage,
  updateProductWithGetBack,
  type HoldedClient,
  type HoldedProduct,
} from "../src/index.js";

function mockClient(handler: (path: string, init?: RequestInit) => unknown): HoldedClient {
  return {
    request: vi.fn(async (path: string, init?: RequestInit) => handler(path, init)) as HoldedClient["request"],
  };
}

describe("listProductsPage", () => {
  it("usa ?page=N", async () => {
    const client = mockClient((path) => {
      expect(path).toBe("/invoicing/v1/products?page=3");
      return [{ id: "x", name: "n" }];
    });
    const result = await listProductsPage(client, 3);
    expect(result).toHaveLength(1);
  });

  it("rechaza page < 1 antes de pegar a la red", async () => {
    const client = mockClient(() => {
      throw new Error("no debería pegarse");
    });
    await expect(listProductsPage(client, 0)).rejects.toBeInstanceOf(RangeError);
  });

  it("falla si la respuesta no es array", async () => {
    const client = mockClient(() => ({ products: [] }));
    await expect(listProductsPage(client, 1)).rejects.toBeInstanceOf(TypeError);
  });
});

describe("iterateAllProducts", () => {
  it("itera hasta encontrar array vacío", async () => {
    const pages: HoldedProduct[][] = [
      [{ id: "a", name: "A" }],
      [{ id: "b", name: "B" }, { id: "c", name: "C" }],
      [],
    ];
    const client = mockClient((path) => {
      const m = path.match(/page=(\d+)/);
      const n = m ? Number(m[1]) : 0;
      return pages[n - 1] ?? [];
    });
    const collected: string[] = [];
    for await (const { products } of iterateAllProducts(client)) {
      for (const p of products) collected.push(p.id);
    }
    expect(collected).toEqual(["a", "b", "c"]);
  });
});

describe("updateProductWithGetBack", () => {
  it("happy path: PUT + GET demuestran que sku se actualizó", async () => {
    let putted = false;
    const client = mockClient((path, init) => {
      if (init?.method === "PUT") {
        expect(path).toBe("/invoicing/v1/products/p-1");
        expect(JSON.parse(init.body as string)).toEqual({ sku: "AUTO-deadbeef" });
        putted = true;
        return { status: 1, info: "Updated" };
      }
      expect(putted).toBe(true);
      return { id: "p-1", name: "Producto", sku: "AUTO-deadbeef" };
    });
    const stored = await updateProductWithGetBack(
      client,
      "p-1",
      { sku: "AUTO-deadbeef" },
      { expect: { sku: "AUTO-deadbeef" } },
    );
    expect(stored.sku).toBe("AUTO-deadbeef");
  });

  it("lanza HoldedSilentRejectError si el GET-back muestra sku distinto (Holded descartó)", async () => {
    const client = mockClient((path, init) => {
      if (init?.method === "PUT") return { status: 1, info: "Updated" };
      return { id: "p-1", name: "Producto", sku: "" };
    });
    await expect(
      updateProductWithGetBack(
        client,
        "p-1",
        { sku: "AUTO-cafebabe" },
        { expect: { sku: "AUTO-cafebabe" } },
      ),
    ).rejects.toBeInstanceOf(HoldedSilentRejectError);
  });
});
