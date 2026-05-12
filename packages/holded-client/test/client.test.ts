import { describe, expect, it, vi } from "vitest";

import {
  ApiKeyClient,
  HoldedApiError,
  HoldedInvalidResponseError,
  HoldedSubscriptionSuspendedError,
} from "../src/index.js";

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  }) as unknown as typeof fetch;
}

describe("ApiKeyClient", () => {
  it("envía header `key` literal (no Bearer) y Accept JSON", async () => {
    const fetchImpl = mockFetch((_url, init) => {
      const headers = init.headers as Headers;
      expect(headers.get("key")).toBe("secret-key");
      expect(headers.get("Accept")).toBe("application/json");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const client = new ApiKeyClient("secret-key", { fetchImpl });
    const result = await client.request<{ ok: boolean }>("/invoicing/v1/taxes");
    expect(result).toEqual({ ok: true });
  });

  it("HTTP 402 lanza HoldedSubscriptionSuspendedError", async () => {
    const fetchImpl = mockFetch(() =>
      new Response(JSON.stringify({ status: 0, info: "Account has been blocked. Reason: Unpaid" }), {
        status: 402,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiKeyClient("k", { fetchImpl });
    await expect(client.request("/invoicing/v1/products")).rejects.toBeInstanceOf(
      HoldedSubscriptionSuspendedError,
    );
  });

  it("HTTP 4xx genérico lanza HoldedApiError con body parseado", async () => {
    const fetchImpl = mockFetch(() =>
      new Response(JSON.stringify({ status: 0, info: "Wrong date" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new ApiKeyClient("k", { fetchImpl });
    try {
      await client.request("/invoicing/v1/documents/salesreceipt/X/pay");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(HoldedApiError);
      const e = err as HoldedApiError;
      expect(e.status).toBe(400);
      expect(e.body).toEqual({ status: 0, info: "Wrong date" });
    }
  });

  it("200 + HTML lanza HoldedInvalidResponseError (endpoint inexistente)", async () => {
    const fetchImpl = mockFetch(() =>
      new Response("<!DOCTYPE html><title>404 · Holded</title>", {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" },
      }),
    );
    const client = new ApiKeyClient("k", { fetchImpl });
    await expect(client.request("/invoicing/v1/warehouse")).rejects.toBeInstanceOf(
      HoldedInvalidResponseError,
    );
  });

  it("añade Content-Type application/json al enviar body", async () => {
    const fetchImpl = mockFetch((_url, init) => {
      const headers = init.headers as Headers;
      expect(headers.get("Content-Type")).toBe("application/json");
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const client = new ApiKeyClient("k", { fetchImpl });
    await client.request("/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
  });
});
