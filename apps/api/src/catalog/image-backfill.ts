// v1.2-Lite-fix1 Bug-Imagenes-Holded: backfill de imágenes vía endpoint
// binario `GET /invoicing/v1/products/{id}/image`.
//
// Spike 2026-05-22 confirmó que ese endpoint sí devuelve el binario real
// (JPEG/PNG/GIF/WEBP) aunque el `content-type` mienta. Las otras rutas
// candidatas (`/attachments`, `/files`, `/images`, `/mainimage`) sirven
// el HTML catch-all del frontend Next.js. Por eso la Opción A (rebuscar
// URL en el detalle JSON) quedó muerta: el listado tiene 26 campos y
// NINGUNO es de imagen.
//
// Flujo por producto:
//   1. SELECT productos `active = true AND kind = 'PRODUCT'` con
//      `imageCachedAt IS NULL` o `imageCachedAt < now() - 24h`.
//   2. Por cada uno: pegar al endpoint binario con concurrencia 5.
//   3. Magic bytes → 3 caminos:
//        - imagen reconocida: escribir a disco (tmp + fsync + rename),
//          UPDATE imageMime + imageCachedAt = now().
//        - HTML catch-all: producto sin foto en Holded → sentinel
//          UPDATE imageMime = NULL, imageCachedAt = now(). El próximo
//          sync NO lo vuelve a pinchar hasta cumplir las 24 h.
//        - throw (red, magic bytes raros): log warn, NO update —
//          imageCachedAt sigue NULL y reintentamos en el siguiente
//          sync.
//   4. Si la foto previa tenía MIME distinto al actual (mp; cambiaron
//      jpg → webp), borrar el archivo viejo de disco al renombrar el
//      nuevo. Si el producto pasa de "tenía foto" a "ya no", también
//      borramos el archivo viejo.
//
// Idempotente: una corrida sobre productos ya cacheados (porque su
// imageCachedAt < cutoff) reescribe el mismo archivo con los mismos
// bytes — el rename atómico lo deja consistente.

import { promises as fs } from "node:fs";
import { join } from "node:path";

import type { PrismaClient } from "@mipiacetpv/db";
import {
  extFromDetectedMime,
  fetchProductImagesBatch,
  type DetectedImageMime,
  type HoldedClient,
} from "@mipiacetpv/holded-client";

export interface ImageBackfillEnv {
  cacheDir: string;
  maxBytes: number;
}

export interface ImageBackfillLogger {
  info: (msg: string, extra?: unknown) => void;
  warn: (msg: string, extra?: unknown) => void;
  error: (msg: string, extra?: unknown) => void;
}

export interface ImageBackfillResult {
  // Productos cuya imagen se descargó y persistió OK en disco + BD.
  fetched: number;
  // Productos verificados sin foto en Holded (sentinel imageMime=NULL,
  // imageCachedAt=now). No vuelven a pincharse hasta 24h.
  none: number;
  // Productos con fallo de red, timeout, o magic bytes raros. NO se
  // actualizan en BD — su imageCachedAt sigue NULL y el siguiente sync
  // reintenta.
  failed: number;
  // Productos totales candidatos a backfill en esta corrida (= los que
  // entraron al batch). Útil para diagnóstico en logs.
  pending: number;
  // Productos cuyo MIME cambió respecto al cacheado previo (jpg → webp).
  // Se elimina el archivo viejo del disco; loggeable para entender por
  // qué cambia el "tamaño" del directorio de imágenes.
  mimeChanged: number;
}

// Productos cuyo `imageCachedAt` es más antiguo que este umbral se
// revalidan en el siguiente sync. Sin etag de Holded, es el compromiso
// "cliente subió foto y queremos pillarlo en < 24h sin gastar sync time
// en re-descargar todo el catálogo cada 15 min".
const REVALIDATE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function backfillImagesFromHolded(
  prisma: PrismaClient,
  tenantId: string,
  client: HoldedClient,
  env: ImageBackfillEnv,
  log: ImageBackfillLogger,
): Promise<ImageBackfillResult> {
  const cutoff = new Date(Date.now() - REVALIDATE_AFTER_MS);
  const pending = await prisma.product.findMany({
    where: {
      tenantId,
      active: true,
      kind: "PRODUCT",
      OR: [
        { imageCachedAt: null },
        { imageCachedAt: { lt: cutoff } },
      ],
    },
    select: {
      id: true,
      holdedProductId: true,
      imageMime: true,
    },
  });
  if (pending.length === 0) {
    return { fetched: 0, none: 0, failed: 0, pending: 0, mimeChanged: 0 };
  }
  log.info("backfill imagenes desde Holded (binario)", {
    tenantId,
    pendingCount: pending.length,
  });

  const byHoldedId = new Map<
    string,
    { localId: string; previousMime: string | null }
  >();
  const holdedIds: string[] = [];
  for (const p of pending) {
    byHoldedId.set(p.holdedProductId, {
      localId: p.id,
      previousMime: p.imageMime,
    });
    holdedIds.push(p.holdedProductId);
  }

  const batch = await fetchProductImagesBatch(client, holdedIds, {
    concurrency: 5,
    maxBytes: env.maxBytes,
    timeoutMs: 15000,
    onWarn: (m, e) => log.warn(m, e),
  });

  const result: ImageBackfillResult = {
    fetched: 0,
    none: 0,
    failed: batch.failed.length,
    pending: pending.length,
    mimeChanged: 0,
  };
  const now = new Date();
  const destDir = join(env.cacheDir, tenantId);
  // Crear el directorio una sola vez al inicio: si no hay productos
  // con foto el mkdir es un no-op extra, pero es un syscall barato.
  await fs.mkdir(destDir, { recursive: true });

  for (const [holdedId, payload] of batch.resolved.entries()) {
    const target = byHoldedId.get(holdedId);
    if (!target) continue;
    const mime = payload.mime as Exclude<DetectedImageMime, "text/html" | "unknown">;
    const ext = extFromDetectedMime(mime);
    const destPath = join(destDir, `${target.localId}.${ext}`);
    try {
      await writeFileAtomic(destPath, payload.bytes);
      // Si el MIME previo era distinto, hay que borrar la versión vieja
      // del disco (cambia la extensión). El archivo nuevo ya está en
      // su sitio, así que el front sigue sirviendo algo válido.
      if (target.previousMime && target.previousMime !== mime) {
        result.mimeChanged += 1;
        const oldExt = extFromMimeLoose(target.previousMime);
        if (oldExt && oldExt !== ext) {
          const oldPath = join(destDir, `${target.localId}.${oldExt}`);
          try {
            await fs.unlink(oldPath);
          } catch {
            /* archivo viejo ya no existía */
          }
        }
      }
      await prisma.product.update({
        where: { id: target.localId },
        data: {
          imageMime: mime,
          imageCachedAt: now,
        },
      });
      result.fetched += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.warn("write imagen producto a disco falló", {
        holdedProductId: holdedId,
        productId: target.localId,
        error: reason,
      });
      result.failed += 1;
    }
  }

  // Sentinel "Holded verificó sin foto": imageCachedAt poblado pero
  // imageMime NULL. Productos que antes tenían foto y ahora no:
  // borramos el archivo viejo del disco para no servir uno obsoleto.
  for (const holdedId of batch.none) {
    const target = byHoldedId.get(holdedId);
    if (!target) continue;
    if (target.previousMime) {
      const oldExt = extFromMimeLoose(target.previousMime);
      if (oldExt) {
        const oldPath = join(destDir, `${target.localId}.${oldExt}`);
        try {
          await fs.unlink(oldPath);
        } catch {
          /* ya no existía */
        }
      }
    }
    await prisma.product.update({
      where: { id: target.localId },
      data: {
        imageMime: null,
        imageCachedAt: now,
      },
    });
    result.none += 1;
  }

  return result;
}

// Escritura atómica idéntica a la del image-cache-worker: tmp →
// writeFile → fsync → rename. POSIX garantiza que el rename dentro del
// mismo filesystem es atómico, así que Caddy no servirá un archivo
// medio escrito si pasa al directorio mientras escribimos.
async function writeFileAtomic(destPath: string, buf: Buffer): Promise<void> {
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
    try {
      await fs.unlink(tmpPath);
    } catch {
      /* tmp ya no existe */
    }
    throw err;
  }
}

// Mapea cualquier MIME conocido a su extensión. Caso defensivo:
// productos con MIME "raro" (algún día Holded podría servir webp) o
// con MIME que no entra en `DetectedImageMime` ya cacheados antes del
// fix.
function extFromMimeLoose(mime: string): string | null {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}
