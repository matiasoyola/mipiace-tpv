// Tests del processor `processImageCacheJob` (B-ProductImages F3).
//
// Cubrimos:
//   - happy path: descarga image/jpeg, escribe atomicamente, actualiza
//     Product.imageMime + imageCachedAt.
//   - Content-Type rechazado (text/html disfrazado de 200, §01.B):
//     no escribe, no actualiza, retorna `skipped`.
//   - Tamaño > maxBytes: no escribe, retorna `skipped`.
//   - HTTP 404: skip (no merece reintento).
//   - Producto sin imageUrl: skip rápido.
//   - Idempotencia: imageCachedAt ya poblado → no-op.
//   - URL Holded (.holded.com) → envía header `key:`. URL externa → no.

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it, vi } from "vitest";

import { processImageCacheJob } from "../src/workers/image-cache-worker.js";

interface FakeProduct {
  id: string;
  tenantId: string;
  imageUrl: string | null;
  imageMime: string | null;
  imageCachedAt: Date | null;
  tenant: { holdedApiKeyCiphertext: string | null };
}

const products = new Map<string, FakeProduct>();
let cacheDir: string;
let logger: { info: any; warn: any; error: any };

const fakePrisma = {
  product: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      return products.get(where.id) ?? null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const p = products.get(where.id);
      if (!p) throw new Error("not found");
      if (data.imageMime !== undefined) p.imageMime = data.imageMime;
      if (data.imageCachedAt !== undefined) p.imageCachedAt = data.imageCachedAt;
      return p;
    }),
  },
} as any;

function seedProduct(opts: Partial<FakeProduct> = {}): FakeProduct {
  const p: FakeProduct = {
    id: opts.id ?? randomUUID(),
    tenantId: opts.tenantId ?? randomUUID(),
    imageUrl: opts.imageUrl ?? "https://cdn.holded.com/products/foo.jpg",
    imageMime: opts.imageMime ?? null,
    imageCachedAt: opts.imageCachedAt ?? null,
    tenant: opts.tenant ?? { holdedApiKeyCiphertext: "cipher-X" },
  };
  products.set(p.id, p);
  return p;
}

function makeFetch(opts: {
  body: Buffer | Uint8Array | string;
  status?: number;
  contentType?: string | null;
  onRequest?: (url: string, init?: RequestInit) => void;
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    opts.onRequest?.(url, init);
    const buf =
      typeof opts.body === "string"
        ? Buffer.from(opts.body)
        : Buffer.from(opts.body);
    const headers = new Map<string, string>();
    if (opts.contentType) headers.set("content-type", opts.contentType);
    return {
      ok: (opts.status ?? 200) >= 200 && (opts.status ?? 200) < 300,
      status: opts.status ?? 200,
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: async () => {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: new Uint8Array(buf) };
            },
            cancel: async () => undefined,
          };
        },
      },
    } as unknown as Response;
  });
}

beforeEach(() => {
  products.clear();
  cacheDir = mkdtempSync(join(tmpdir(), "img-cache-test-"));
  logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
});

describe("processImageCacheJob", () => {
  it("happy path: descarga, escribe atómicamente, actualiza Product", async () => {
    const p = seedProduct();
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const fetchImpl = makeFetch({ body: fakeJpeg, contentType: "image/jpeg" });

    const result = await processImageCacheJob(p.id, {
      prisma: fakePrisma,
      cacheDir,
      maxBytes: 1024 * 1024,
      fetchImpl: fetchImpl as any,
      decryptKey: () => "fake-api-key",
      logger,
    });

    expect(result.status).toBe("ok");
    expect(result.mime).toBe("image/jpeg");
    expect(result.bytes).toBe(fakeJpeg.length);

    const expectedPath = join(cacheDir, p.tenantId, `${p.id}.jpg`);
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath)).toEqual(fakeJpeg);

    expect(p.imageMime).toBe("image/jpeg");
    expect(p.imageCachedAt).toBeInstanceOf(Date);
  });

  it("Content-Type inválido (text/html) → no guarda + log warn", async () => {
    const p = seedProduct();
    const fetchImpl = makeFetch({
      body: "<!DOCTYPE html><html>...",
      contentType: "text/html; charset=utf-8",
    });

    const result = await processImageCacheJob(p.id, {
      prisma: fakePrisma,
      cacheDir,
      maxBytes: 1024 * 1024,
      fetchImpl: fetchImpl as any,
      decryptKey: () => "fake-api-key",
      logger,
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/bad-content-type/);
    expect(p.imageMime).toBeNull();
    expect(p.imageCachedAt).toBeNull();
    expect(existsSync(join(cacheDir, p.tenantId, `${p.id}.jpg`))).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("Tamaño > maxBytes → no guarda", async () => {
    const p = seedProduct();
    const bigBuf = Buffer.alloc(6 * 1024 * 1024, 0xaa);
    const fetchImpl = makeFetch({ body: bigBuf, contentType: "image/png" });

    const result = await processImageCacheJob(p.id, {
      prisma: fakePrisma,
      cacheDir,
      maxBytes: 5 * 1024 * 1024,
      fetchImpl: fetchImpl as any,
      decryptKey: () => "fake-api-key",
      logger,
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("too-large");
    expect(p.imageCachedAt).toBeNull();
    expect(existsSync(join(cacheDir, p.tenantId, `${p.id}.png`))).toBe(false);
  });

  it("HTTP 404 → skip sin reintento", async () => {
    const p = seedProduct();
    const fetchImpl = makeFetch({
      body: "Not found",
      status: 404,
      contentType: "text/plain",
    });

    const result = await processImageCacheJob(p.id, {
      prisma: fakePrisma,
      cacheDir,
      maxBytes: 1024 * 1024,
      fetchImpl: fetchImpl as any,
      decryptKey: () => "fake-api-key",
      logger,
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("http-404");
  });

  it("HTTP 500 → throw (BullMQ reintenta)", async () => {
    const p = seedProduct();
    const fetchImpl = makeFetch({
      body: "boom",
      status: 500,
      contentType: "text/plain",
    });

    await expect(
      processImageCacheJob(p.id, {
        prisma: fakePrisma,
        cacheDir,
        maxBytes: 1024 * 1024,
        fetchImpl: fetchImpl as any,
        decryptKey: () => "fake-api-key",
        logger,
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("producto sin imageUrl → no-image rápido", async () => {
    const p = seedProduct({ imageUrl: null });
    const fetchImpl = vi.fn();

    const result = await processImageCacheJob(p.id, {
      prisma: fakePrisma,
      cacheDir,
      maxBytes: 1024 * 1024,
      fetchImpl: fetchImpl as any,
      decryptKey: () => "fake-api-key",
      logger,
    });

    expect(result.status).toBe("no-image");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("idempotencia: ya cacheado → skip", async () => {
    const p = seedProduct({
      imageMime: "image/jpeg",
      imageCachedAt: new Date(),
    });
    const fetchImpl = vi.fn();

    const result = await processImageCacheJob(p.id, {
      prisma: fakePrisma,
      cacheDir,
      maxBytes: 1024 * 1024,
      fetchImpl: fetchImpl as any,
      decryptKey: () => "fake-api-key",
      logger,
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("already-cached");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("URL holded.com → envía header `key`", async () => {
    const p = seedProduct({ imageUrl: "https://app.holded.com/img/foo.jpg" });
    let captured: { url?: string; init?: RequestInit } = {};
    const fetchImpl = makeFetch({
      body: Buffer.from([0xff, 0xd8]),
      contentType: "image/jpeg",
      onRequest: (url, init) => {
        captured = { url, init };
      },
    });

    await processImageCacheJob(p.id, {
      prisma: fakePrisma,
      cacheDir,
      maxBytes: 1024 * 1024,
      fetchImpl: fetchImpl as any,
      decryptKey: () => "fake-api-key",
      logger,
    });

    const headers = captured.init?.headers as Record<string, string> | undefined;
    expect(headers?.key).toBe("fake-api-key");
  });

  it("URL externa (S3) → NO envía la API key", async () => {
    const p = seedProduct({
      imageUrl: "https://s3.amazonaws.com/holded-cdn/img.jpg",
    });
    let captured: { url?: string; init?: RequestInit } = {};
    const fetchImpl = makeFetch({
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      contentType: "image/png",
      onRequest: (url, init) => {
        captured = { url, init };
      },
    });

    await processImageCacheJob(p.id, {
      prisma: fakePrisma,
      cacheDir,
      maxBytes: 1024 * 1024,
      fetchImpl: fetchImpl as any,
      decryptKey: () => {
        throw new Error("no debería llamarse para URLs externas");
      },
      logger,
    });

    const headers = captured.init?.headers as Record<string, string> | undefined;
    expect(headers?.key).toBeUndefined();
  });
});
