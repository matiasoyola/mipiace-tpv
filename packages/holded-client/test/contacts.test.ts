// Tests del cliente de contactos (B7 §8). Mirror del test de
// products: paginación, iterador, validación.

import { describe, expect, it, vi } from "vitest";

import {
  iterateAllContacts,
  listContactsPage,
  type HoldedClient,
  type HoldedContact,
} from "../src/index.js";

function mockClient(
  handler: (path: string, init?: RequestInit) => unknown,
): HoldedClient {
  return {
    request: vi.fn(async (path: string, init?: RequestInit) =>
      handler(path, init),
    ) as HoldedClient["request"],
  };
}

describe("listContactsPage", () => {
  it("usa ?page=N", async () => {
    const client = mockClient((path) => {
      expect(path).toBe("/invoicing/v1/contacts?page=2");
      return [{ id: "c1", name: "Cliente uno" }];
    });
    const result = await listContactsPage(client, 2);
    expect(result).toHaveLength(1);
  });

  it("rechaza page < 1 antes de pegar a la red", async () => {
    const client = mockClient(() => {
      throw new Error("no debería pegarse");
    });
    await expect(listContactsPage(client, 0)).rejects.toBeInstanceOf(
      RangeError,
    );
  });

  it("falla si la respuesta no es array", async () => {
    const client = mockClient(() => ({ contacts: [] }));
    await expect(listContactsPage(client, 1)).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});

describe("iterateAllContacts", () => {
  it("itera hasta encontrar array vacío", async () => {
    const pages: HoldedContact[][] = [
      [{ id: "a", name: "A" }],
      [
        { id: "b", name: "B" },
        { id: "c", name: "C" },
      ],
      [],
    ];
    const client = mockClient((path) => {
      const m = path.match(/page=(\d+)/);
      const n = m ? Number(m[1]) : 0;
      return pages[n - 1] ?? [];
    });
    const collected: HoldedContact[] = [];
    for await (const { contacts } of iterateAllContacts(client)) {
      collected.push(...contacts);
    }
    expect(collected.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("no llama una página más allá del array vacío", async () => {
    const seen: number[] = [];
    const client = mockClient((path) => {
      const m = path.match(/page=(\d+)/);
      const n = m ? Number(m[1]) : 0;
      seen.push(n);
      return n === 1 ? [{ id: "x" }] : [];
    });
    for await (const _ of iterateAllContacts(client)) {
      /* drain */
    }
    expect(seen).toEqual([1, 2]);
  });
});
