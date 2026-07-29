import { describe, expect, it, vi } from "vitest";

import {
  ApiKeyClient,
  HoldedApiError,
  HoldedSubscriptionSuspendedError,
} from "../src/index.js";
import {
  computeBackoffMs,
  parseRetryAfterMs,
  resolveRetryOptions,
} from "../src/retry.js";

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });

const ok = () => json({ ok: true }, 200);
const err500 = () => json({ status: 0, info: "boom" }, 500);
const err400 = () => json({ status: 0, info: "bad" }, 400);
const err402 = () => json({ status: 0, info: "unpaid" }, 402);
const err429 = (retryAfter?: number) =>
  json({}, 429, retryAfter != null ? { "retry-after": String(retryAfter) } : {});

// fetch simulado por secuencia de thunks; el último se repite si se piden
// más llamadas (útil para agotar reintentos). Un thunk puede lanzar para
// simular un error de red.
function makeFetch(thunks: Array<() => Response>) {
  let i = 0;
  const fn = vi.fn(async () => {
    const t = thunks[Math.min(i, thunks.length - 1)];
    i += 1;
    if (!t) throw new Error("makeFetch: sin thunk disponible");
    return t();
  });
  return fn as unknown as typeof fetch;
}

// Cliente con esperas registradas (sin dormir de verdad) y jitter a 0.
function makeClient(
  fetchImpl: typeof fetch,
  overrides: Record<string, unknown> = {},
) {
  const sleeps: number[] = [];
  const client = new ApiKeyClient("k", {
    fetchImpl,
    retry: {
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      random: () => 0,
      ...overrides,
    },
  });
  return { client, sleeps };
}

describe("ApiKeyClient · reintentos (v1.9.9)", () => {
  it("429 con Retry-After: espera esos segundos y reintenta el GET", async () => {
    const fetchImpl = makeFetch([() => err429(2), ok]);
    const { client, sleeps } = makeClient(fetchImpl);
    const res = await client.request<{ ok: boolean }>("/invoicing/v1/products");
    expect(res).toEqual({ ok: true });
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
    expect(sleeps).toEqual([2000]);
  });

  it("5xx: backoff exponencial (1s, 2s) y éxito al tercer intento", async () => {
    const fetchImpl = makeFetch([err500, err500, ok]);
    const { client, sleeps } = makeClient(fetchImpl);
    const res = await client.request("/invoicing/v1/products");
    expect(res).toEqual({ ok: true });
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("error de red: reintenta y acaba bien", async () => {
    const boom = () => {
      throw new Error("ECONNRESET");
    };
    const fetchImpl = makeFetch([boom as unknown as () => Response, ok]);
    const { client, sleeps } = makeClient(fetchImpl);
    const res = await client.request("/invoicing/v1/products");
    expect(res).toEqual({ ok: true });
    expect(sleeps).toEqual([1000]);
  });

  it("NO reintenta un POST aunque sea 5xx (no doblar creación)", async () => {
    const fetchImpl = makeFetch([err500]);
    const { client, sleeps } = makeClient(fetchImpl);
    await expect(
      client.request("/invoicing/v1/documents/salesreceipt", {
        method: "POST",
        body: JSON.stringify({ a: 1 }),
      }),
    ).rejects.toBeInstanceOf(HoldedApiError);
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("402 (suspensión) NO se reintenta", async () => {
    const fetchImpl = makeFetch([err402]);
    const { client, sleeps } = makeClient(fetchImpl);
    await expect(client.request("/invoicing/v1/products")).rejects.toBeInstanceOf(
      HoldedSubscriptionSuspendedError,
    );
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("400 (validación) NO se reintenta", async () => {
    const fetchImpl = makeFetch([err400]);
    const { client, sleeps } = makeClient(fetchImpl);
    await expect(client.request("/invoicing/v1/products")).rejects.toBeInstanceOf(
      HoldedApiError,
    );
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("agota maxRetries y lanza el error final", async () => {
    const fetchImpl = makeFetch([err500]);
    const { client, sleeps } = makeClient(fetchImpl, { maxRetries: 2 });
    await expect(client.request("/invoicing/v1/products")).rejects.toBeInstanceOf(
      HoldedApiError,
    );
    // 1 intento inicial + 2 reintentos = 3 llamadas.
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("Retry-After por encima del tope: no duerme, deja subir el 429", async () => {
    const fetchImpl = makeFetch([() => err429(30)]);
    const { client, sleeps } = makeClient(fetchImpl, { maxRetryAfterMs: 5000 });
    await expect(client.request("/invoicing/v1/products")).rejects.toBeInstanceOf(
      HoldedApiError,
    );
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
    expect(sleeps).toEqual([]);
  });
});

describe("retry helpers", () => {
  it("parseRetryAfterMs lee segundos → ms; null si falta o inválido", () => {
    expect(parseRetryAfterMs(new Headers({ "retry-after": "3" }))).toBe(3000);
    expect(parseRetryAfterMs(new Headers())).toBeNull();
    expect(parseRetryAfterMs(new Headers({ "retry-after": "-1" }))).toBeNull();
    expect(parseRetryAfterMs(new Headers({ "retry-after": "x" }))).toBeNull();
  });

  it("computeBackoffMs es exponencial con jitter acotado", () => {
    const opts = resolveRetryOptions({ random: () => 0 });
    expect(computeBackoffMs(0, opts)).toBe(1000);
    expect(computeBackoffMs(1, opts)).toBe(2000);
    expect(computeBackoffMs(3, opts)).toBe(8000);
    const jittered = resolveRetryOptions({ random: () => 0.999 });
    expect(computeBackoffMs(0, jittered)).toBe(1000 + 249);
  });
});
