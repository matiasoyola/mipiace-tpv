// Worker BullMQ que cachea localmente las imágenes de producto que
// Holded expone vía URL (B-ProductImages, spike §13).
//
// Flujo del job:
//   1. Cargar producto + tenant (para la API key Holded si la URL la
//      exige — el spike §13 lo confirma por cuenta).
//   2. Si `imageCachedAt` ya está poblado Y la URL no cambió → no-op
//      (idempotencia ante re-encolados).
//   3. `fetch(imageUrl)`, validar Content-Type (image/jpeg|png|webp) y
//      tamaño (≤ PRODUCT_IMAGE_MAX_BYTES).
//   4. Escritura atómica: tmp file en mismo directorio, fsync, rename.
//      Si algo falla a media descarga, no dejamos el destino corrupto.
//   5. UPDATE products SET image_mime, image_cached_at = now().
//
// El archivo final vive en
// `<PRODUCT_IMAGE_CACHE_DIR>/<tenantId>/<productId>.<ext>`. Caddy lo
// sirve en `/product-images/<tenantId>/<productId>.<ext>` con cache
// HTTP largo (30d, ver Caddyfile). Sin auth: el path lleva UUID v4 ≈
// 122 bits de entropía — adivinar otro tenantId+productId es
// computacionalmente inviable. El tenantId como primer segmento añade
// segundo nivel de aislamiento por curiosidad.

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { Worker } from "bullmq";

import { getPrisma, getRedis } from "../context.js";
import { decryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";
import {
  PRODUCT_IMAGE_CACHE_QUEUE_NAME,
  type ProductImageCacheJob,
} from "../queues/product-image-cache.js";

// MIMEs aceptados. El resto se descarta — defensivo: una página HTML
// disfrazada de 200 (caso §01.B) llegaría con `text/html` y la
// rechazamos sin tocar disco.
export const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function extFromMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "bin";
}

export interface ImageCacheDeps {
  prisma: ReturnType<typeof getPrisma>;
  cacheDir: string;
  maxBytes: number;
  // Inyectable para tests: fetch real en prod, mock en test.
  fetchImpl?: typeof fetch;
  // Inyectable también para tests: si el spike §13 confirma que la
  // URL exige auth, el sync pasa la API key cifrada del tenant y este
  // helper la descifra al vuelo. La key se descifra UNA vez por job.
  decryptKey?: (ciphertext: string) => string;
  logger?: {
    info: (msg: string, extra?: unknown) => void;
    warn: (msg: string, extra?: unknown) => void;
    error: (msg: string, extra?: unknown) => void;
  };
}

export interface ImageCacheResult {
  status: "ok" | "skipped" | "no-image" | "no-product";
  reason?: string;
  filePath?: string;
  mime?: string;
  bytes?: number;
}

// Núcleo del job, sin BullMQ. Exportado para tests.
export async function processImageCacheJob(
  productId: string,
  deps: ImageCacheDeps,
): Promise<ImageCacheResult> {
  const { prisma, cacheDir, maxBytes } = deps;
  const log = deps.logger ?? consoleLogger();
  const fetchImpl = deps.fetchImpl ?? fetch;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      tenantId: true,
      imageUrl: true,
      imageMime: true,
      imageCachedAt: true,
      tenant: { select: { holdedApiKeyCiphertext: true } },
    },
  });
  if (!product) {
    log.warn("image-cache: producto no existe", { productId });
    return { status: "no-product", reason: "product-not-found" };
  }
  if (!product.imageUrl) {
    return { status: "no-image", reason: "image-url-null" };
  }
  if (product.imageCachedAt && product.imageMime) {
    // Idempotencia: ya cacheado. El sync invalida `imageCachedAt`
    // cuando la URL cambia, así que un cachedAt no-null garantiza que
    // el archivo actual sigue siendo válido.
    return { status: "skipped", reason: "already-cached" };
  }

  // Cabeceras de descarga. La key Holded sólo se envía si el spike §13
  // determinó que la URL la exige (host bajo *.holded.com) — para CDNs
  // externos (ej. AWS S3 firmado), enviar la key es ruido.
  const headers: Record<string, string> = { Accept: "image/*" };
  if (
    product.tenant.holdedApiKeyCiphertext &&
    isHoldedHostedUrl(product.imageUrl)
  ) {
    const decrypt = deps.decryptKey ?? defaultDecrypt;
    try {
      headers.key = decrypt(product.tenant.holdedApiKeyCiphertext);
    } catch (err) {
      log.warn("image-cache: no pude descifrar API key", {
        productId,
        tenantId: product.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { status: "skipped", reason: "decrypt-failed" };
    }
  }

  let res: Response;
  try {
    res = await fetchImpl(product.imageUrl, { headers });
  } catch (err) {
    // Fallo de red — rethrow para que BullMQ reintente con backoff.
    log.warn("image-cache: fetch falló", {
      productId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
  if (!res.ok) {
    log.warn("image-cache: HTTP no OK", {
      productId,
      status: res.status,
      url: product.imageUrl,
    });
    // 404/410 → la imagen desapareció en Holded; no merece retry.
    if (res.status === 404 || res.status === 410) {
      return { status: "skipped", reason: `http-${res.status}` };
    }
    throw new Error(`image-cache: HTTP ${res.status}`);
  }

  const ct = (res.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (!ct || !ALLOWED_IMAGE_MIME.has(ct)) {
    // 200+HTML (§01.B) o cualquier Content-Type no soportado. NO
    // guardamos, NO retry (la URL no nos servirá hasta que el sync
    // detecte un cambio).
    log.warn("image-cache: Content-Type no aceptado", {
      productId,
      contentType: ct,
      url: product.imageUrl,
    });
    return { status: "skipped", reason: `bad-content-type:${ct ?? "missing"}` };
  }

  // Lectura limitada por tamaño. `response.arrayBuffer()` no aplica
  // límite; con un stream y conteo manual cortamos en cuanto pasamos
  // del umbral, sin gastar 5 MB+ en heap por error.
  const buf = await readBoundedBytes(res, maxBytes);
  if (buf === null) {
    log.warn("image-cache: tamaño excede límite", {
      productId,
      maxBytes,
      url: product.imageUrl,
    });
    return { status: "skipped", reason: "too-large" };
  }
  if (buf.length === 0) {
    log.warn("image-cache: archivo vacío", { productId, url: product.imageUrl });
    return { status: "skipped", reason: "empty-body" };
  }

  // Escritura atómica: tmp → fsync → rename. Caddy podría estar
  // sirviendo el archivo viejo justo ahora; el rename POSIX es atómico
  // dentro del mismo filesystem, así que ningún cliente verá un
  // archivo a medio escribir.
  const ext = extFromMime(ct);
  const destDir = join(cacheDir, product.tenantId);
  const destPath = join(destDir, `${product.id}.${ext}`);
  await fs.mkdir(destDir, { recursive: true });
  const tmpPath = `${destPath}.tmp.${process.pid}.${Date.now()}`;
  try {
    const handle = await fs.open(tmpPath, "w");
    try {
      await handle.writeFile(buf);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmpPath, destPath);
  } catch (err) {
    // Asegurar que no queda basura en disco si rename falla.
    try {
      await fs.unlink(tmpPath);
    } catch {
      /* tmp ya no existe */
    }
    throw err;
  }

  // Si el MIME anterior era distinto, borramos el archivo antiguo
  // (la extensión cambia de .jpg a .png). El nuevo ya está en su sitio.
  if (product.imageMime && product.imageMime !== ct) {
    const oldExt = extFromMime(product.imageMime);
    if (oldExt !== ext) {
      const oldPath = join(destDir, `${product.id}.${oldExt}`);
      try {
        await fs.unlink(oldPath);
      } catch {
        /* tampoco pasa nada si no existe */
      }
    }
  }

  await prisma.product.update({
    where: { id: product.id },
    data: { imageMime: ct, imageCachedAt: new Date() },
  });

  log.info("image-cache: ok", {
    productId: product.id,
    tenantId: product.tenantId,
    bytes: buf.length,
    mime: ct,
  });
  return { status: "ok", filePath: destPath, mime: ct, bytes: buf.length };
}

// Stream del body con corte temprano si el contenido excede `max`.
// Devuelve null si se pasó del límite, el buffer concatenado si OK.
async function readBoundedBytes(res: Response, max: number): Promise<Buffer | null> {
  const reader = res.body?.getReader();
  if (!reader) {
    // Fallback: el runtime no soporta streams Web; cargamos completo
    // y validamos longitud a posteriori. Riesgo de OOM bajo control si
    // Holded respeta Content-Length, pero por seguridad chequeamos.
    const ab = await res.arrayBuffer();
    if (ab.byteLength > max) return null;
    return Buffer.from(ab);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      // Cancelar para liberar el socket sin descargar el resto.
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function isHoldedHostedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.endsWith("holded.com") || u.hostname.endsWith("holded.es");
  } catch {
    return false;
  }
}

function defaultDecrypt(ciphertext: string): string {
  const env = loadEnv();
  return decryptSecret(ciphertext, env.HOLDED_KEY_ENCRYPTION_SECRET);
}

function consoleLogger(): NonNullable<ImageCacheDeps["logger"]> {
  return {
    info: (m, e) => console.log(`[image-cache] ${m}`, e ?? ""),
    warn: (m, e) => console.warn(`[image-cache] ${m}`, e ?? ""),
    error: (m, e) => console.error(`[image-cache] ${m}`, e ?? ""),
  };
}

export function startImageCacheWorker(): Worker<ProductImageCacheJob> {
  const env = loadEnv();
  const worker = new Worker<ProductImageCacheJob>(
    PRODUCT_IMAGE_CACHE_QUEUE_NAME,
    async (job) => {
      const prisma = getPrisma();
      return await processImageCacheJob(job.data.productId, {
        prisma,
        cacheDir: env.PRODUCT_IMAGE_CACHE_DIR,
        maxBytes: env.PRODUCT_IMAGE_MAX_BYTES,
      });
    },
    {
      connection: getRedis(),
      // 4: paralelizamos pero sin saturar a Holded ni IO del VPS.
      // Cada job es ~100-500 KB de descarga + 1 escritura a disco.
      concurrency: 4,
    },
  );
  worker.on("completed", (job, result) => {
    const status = (result as ImageCacheResult | undefined)?.status ?? "?";
    console.log(`[image-cache] job ${job.id} ${status}`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[image-cache] job ${job?.id} falló: ${err.message}`);
  });
  return worker;
}

