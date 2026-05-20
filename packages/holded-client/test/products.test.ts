import { describe, expect, it, vi } from "vitest";

import {
  extractImageUrl,
  HoldedSilentRejectError,
  iterateAllProducts,
  listProductsPage,
  listUnrecognizedImageKeys,
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

describe("extractImageUrl (B-ProductImages spike §13)", () => {
  function p(extra: Partial<HoldedProduct>): HoldedProduct {
    return { id: "x", name: "n", ...extra } as HoldedProduct;
  }

  it("mainImage string http(s) → la devuelve tal cual", () => {
    expect(
      extractImageUrl(p({ mainImage: "https://cdn.holded.com/foo.jpg" })),
    ).toBe("https://cdn.holded.com/foo.jpg");
  });

  it("mainImage como objeto { url } → extrae la URL anidada", () => {
    expect(
      extractImageUrl(p({ mainImage: { url: "https://x.example/a.png" } })),
    ).toBe("https://x.example/a.png");
  });

  it("pictures[] array de strings → primera entrada válida", () => {
    expect(
      extractImageUrl(
        p({ pictures: ["", "https://cdn.holded.com/p1.jpg", "https://x/p2"] }),
      ),
    ).toBe("https://cdn.holded.com/p1.jpg");
  });

  it("images[] array de objetos → URL anidada", () => {
    expect(
      extractImageUrl(
        p({ images: [{ url: "https://cdn.holded.com/p1.jpg" }] }),
      ),
    ).toBe("https://cdn.holded.com/p1.jpg");
  });

  it("ningún campo → null", () => {
    expect(extractImageUrl(p({}))).toBeNull();
  });

  it("campo vacío / array vacío → null", () => {
    expect(extractImageUrl(p({ mainImage: "" }))).toBeNull();
    expect(extractImageUrl(p({ images: [] }))).toBeNull();
    expect(extractImageUrl(p({ pictures: [""] }))).toBeNull();
  });

  it("string no http (path relativo) → null (defensivo)", () => {
    expect(extractImageUrl(p({ mainImage: "/uploads/foo.jpg" }))).toBeNull();
  });

  it("prioridad: mainImage gana sobre image/thumbnail/pictures", () => {
    expect(
      extractImageUrl(
        p({
          mainImage: "https://main.example/m.jpg",
          image: "https://other.example/i.jpg",
          thumbnail: "https://other.example/t.jpg",
          pictures: ["https://other.example/p.jpg"],
        }),
      ),
    ).toBe("https://main.example/m.jpg");
  });

  // Inv-1 (v1.1 Thalia): Holded sirve la foto subida desde móvil bajo
  // `attachment(s)` en algunas cuentas. Sin estos campos, la foto no
  // pasaba al TPV.
  it("attachment string http(s) → la devuelve", () => {
    expect(
      extractImageUrl(p({ attachment: "https://cdn.holded.com/a.jpg" })),
    ).toBe("https://cdn.holded.com/a.jpg");
  });

  it("attachments[] como objetos → URL anidada", () => {
    expect(
      extractImageUrl(
        p({ attachments: [{ url: "https://cdn.holded.com/a.png" }] }),
      ),
    ).toBe("https://cdn.holded.com/a.png");
  });
});

describe("listUnrecognizedImageKeys (Inv-1 v1.1 Thalia)", () => {
  function p(extra: Partial<HoldedProduct> & Record<string, unknown>): HoldedProduct {
    return { id: "x", name: "n", ...extra } as HoldedProduct;
  }

  it("ignora las claves conocidas y devuelve [] si no hay raras", () => {
    expect(
      listUnrecognizedImageKeys(
        p({ mainImage: "https://x", image: "https://y" }),
      ),
    ).toEqual([]);
  });

  it("detecta claves nuevas que contienen 'image', 'photo', 'attach', etc.", () => {
    const keys = listUnrecognizedImageKeys(
      p({
        imageMobile: "blah",
        photo_main: { url: "x" },
        attachUrl: "y",
        productMedia: [],
        fotoPrincipal: "z",
      }),
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        "imageMobile",
        "photo_main",
        "attachUrl",
        "productMedia",
        "fotoPrincipal",
      ]),
    );
  });

  it("no marca campos sin relación con imagen (ej. 'name', 'sku')", () => {
    expect(
      listUnrecognizedImageKeys(p({ sku: "S1", price: 10 })),
    ).toEqual([]);
  });
});
