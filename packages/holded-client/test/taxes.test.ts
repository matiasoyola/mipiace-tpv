// Tests de packages/holded-client/src/taxes.ts (B7.5).
//
// Cubre el shape REAL del endpoint /invoicing/v1/taxes confirmado por
// el spike §11:
//   - `id` puede venir vacío (taxes estándar Holded) → no usable como
//     clave.
//   - `key` es el slug estable que matchea Product.taxes[].
//   - `amount` es un STRING numérico ("21", "5.2", "0"), no number.
//   - `rate` (campo derivado) lo expone listTaxes parseado.
//
// El resolver indexa por `key` Y por `id` (cuando id != "") para
// tolerar tanto productos modernos (referencia por key) como cuentas
// hipotéticas que referencien por id.

import { describe, expect, it, vi } from "vitest";

import {
  buildTaxRateResolver,
  listTaxes,
  parseTaxRateFromId,
  type HoldedClient,
  type HoldedTax,
} from "../src/index.js";

function mockClient(handler: (path: string) => unknown): HoldedClient {
  return {
    request: vi.fn(async (path: string) => handler(path)) as HoldedClient["request"],
  };
}

describe("listTaxes", () => {
  it("parsea `amount` (string) → `rate` (number)", async () => {
    const client = mockClient(() => [
      { id: "", key: "s_iva_21", name: "IVA 21%", amount: "21" },
      { id: "", key: "s_iva_4", name: "IVA 4%", amount: "4" },
      { id: "", key: "s_rec5", name: "REC 5,2%", amount: "5.2" },
    ]);
    const taxes = await listTaxes(client);
    expect(taxes).toHaveLength(3);
    expect(taxes[0]).toMatchObject({ key: "s_iva_21", rate: 21 });
    expect(taxes[1]).toMatchObject({ key: "s_iva_4", rate: 4 });
    expect(taxes[2]).toMatchObject({ key: "s_rec5", rate: 5.2 });
  });

  it("respeta `rate` numérico si ya viene parseado (tests legacy)", async () => {
    const client = mockClient(() => [
      { id: "s_iva_21", key: "s_iva_21", name: "IVA 21%", rate: 21 },
    ]);
    const taxes = await listTaxes(client);
    expect(taxes[0]?.rate).toBe(21);
  });

  it("rate=null si `amount` no es numérico", async () => {
    const client = mockClient(() => [
      { id: "", key: "weird", name: "Weird", amount: "" },
      { id: "", key: "junk", name: "Junk", amount: "abc" },
    ]);
    const taxes = await listTaxes(client);
    expect(taxes[0]?.rate).toBeNull();
    expect(taxes[1]?.rate).toBeNull();
  });

  it("lanza TypeError si la respuesta no es array", async () => {
    const client = mockClient(() => ({ taxes: [] }));
    await expect(listTaxes(client)).rejects.toBeInstanceOf(TypeError);
  });
});

describe("buildTaxRateResolver", () => {
  it("resuelve por `key` (caso productos modernos)", () => {
    const taxes: HoldedTax[] = [
      { id: "", key: "s_iva_21", name: "IVA 21%", rate: 21 },
      { id: "", key: "s_iva_10", name: "IVA 10%", rate: 10 },
    ];
    const resolve = buildTaxRateResolver(taxes);
    expect(resolve("s_iva_21")).toBe(21);
    expect(resolve("s_iva_10")).toBe(10);
  });

  it("resuelve por `id` (custom taxes con UUID)", () => {
    const taxes: HoldedTax[] = [
      {
        id: "69b7f6b4170c9d1c8c042921",
        key: "tax_49_sales",
        name: "Impuesto 49",
        rate: 49,
      },
    ];
    const resolve = buildTaxRateResolver(taxes);
    // Producto que referencia por key (caso real spike §11).
    expect(resolve("tax_49_sales")).toBe(49);
    // Producto hipotético que referencia por id.
    expect(resolve("69b7f6b4170c9d1c8c042921")).toBe(49);
  });

  it("ignora taxes con id vacío y key vacía", () => {
    const taxes: HoldedTax[] = [
      { id: "", key: "", name: "Roto", rate: 21 } as HoldedTax,
      { id: "", key: "s_iva_21", name: "IVA 21%", rate: 21 },
    ];
    const resolve = buildTaxRateResolver(taxes);
    expect(resolve("")).toBeNull();
    expect(resolve("s_iva_21")).toBe(21);
  });

  it("parsea `amount` si `rate` no estaba precalculado", () => {
    const taxes: HoldedTax[] = [
      { id: "", key: "s_iva_21", name: "IVA 21%", amount: "21" },
    ];
    const resolve = buildTaxRateResolver(taxes);
    expect(resolve("s_iva_21")).toBe(21);
  });

  it("fallback a regex parseTaxRateFromId si el id no está en el listado", () => {
    const resolve = buildTaxRateResolver([]);
    // s_iva_21 no está en el array → cae al regex → 21.
    expect(resolve("s_iva_21")).toBe(21);
    // tax_49_sales no encaja con el regex → null.
    expect(resolve("tax_49_sales")).toBeNull();
    expect(resolve("foo_bar")).toBeNull();
  });

  it("devuelve null cuando taxId es undefined", () => {
    const resolve = buildTaxRateResolver([]);
    expect(resolve(undefined)).toBeNull();
  });
});

describe("parseTaxRateFromId", () => {
  it("matchea s_iva_<rate>", () => {
    expect(parseTaxRateFromId("s_iva_21")).toBe(21);
    expect(parseTaxRateFromId("s_iva_0")).toBe(0);
  });
  it("ignora prefijos custom (`tax_NN_sales`)", () => {
    expect(parseTaxRateFromId("tax_49_sales")).toBeNull();
    expect(parseTaxRateFromId("s_rec5")).toBeNull();
  });
  it("null para undefined/empty", () => {
    expect(parseTaxRateFromId(undefined)).toBeNull();
    expect(parseTaxRateFromId("")).toBeNull();
  });
});
