// Cola BullMQ del cache de imágenes de producto (B-ProductImages).
// Una sola cola, un job por productId. El worker
// (apps/api/src/workers/image-cache-worker.ts) descarga la imagen desde
// Holded, valida tamaño + Content-Type, escribe el binario a disco
// (volumen compartido con Caddy) y actualiza Product.imageMime +
// imageCachedAt.
//
// jobId determinista `imgcache-<productId>`: si llegan dos jobs para
// el mismo producto (sync incremental + sync manual coincidiendo),
// BullMQ deduplica al segundo. El worker mismo es idempotente:
// imageCachedAt poblado y URL inalterada → no re-descarga.

import { Queue } from "bullmq";

import { getRedis } from "../context.js";

export const PRODUCT_IMAGE_CACHE_QUEUE_NAME = "product-image-cache";

export interface ProductImageCacheJob {
  productId: string;
}

let _queue: Queue<ProductImageCacheJob> | null = null;
export function getProductImageCacheQueue(): Queue<ProductImageCacheJob> {
  if (!_queue) {
    _queue = new Queue<ProductImageCacheJob>(PRODUCT_IMAGE_CACHE_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        // 3 intentos con backoff exponencial — Holded a veces devuelve
        // 502/504 transitorios bajo carga; reintentar tras 30s y 2min
        // suele resolver. Tras el tercer fallo, log y skip hasta el
        // próximo sync (que re-encola si imageCachedAt sigue null).
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }
  return _queue;
}

export async function enqueueProductImageCache(productId: string): Promise<void> {
  await getProductImageCacheQueue().add(
    "cache-image",
    { productId },
    { jobId: `imgcache-${productId}` },
  );
}
