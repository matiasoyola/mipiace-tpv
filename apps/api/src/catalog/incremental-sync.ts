// Job de sync incremental del catálogo (B2 §2). Lo dispara el worker
// BullMQ (`workers/catalog-incremental-worker.ts`) por dos vías:
//
//   1. Repeatable cada 15 min, registrado tras completar el sync inicial
//      del tenant (jobId determinista `incr-<tenantId>` para evitar
//      doble encolado entre cron y endpoint manual).
//   2. Encolado a demanda desde `POST /catalog/sync-now` (B2 §2.1).
//
// Algoritmo:
//   - syncStartedAt = now() (ancla para detectar huérfanos).
//   - Refrescar taxes y warehouses (los del catálogo del tenant pueden
//     cambiar).
//   - Iterar productos + servicios desde Holded, upsert con
//     lastSyncedAt = now(), acumulando el set de ids vivos.
//   - Borrados (v1.9): archiveMissingProducts() archiva todo producto
//     activo cuyo holded_product_id no esté en el set vivo (no borrar
//     — los tickets históricos referencian). Sustituye al antiguo
//     UPDATE por lastSyncedAt < syncStartedAt: mismo efecto, pero con
//     protección anti-catástrofe (listado coja → no archiva nada +
//     alerta Sentry) y muestra de archivados en stats.
//   - Re-ejecutar auto-SKU sobre productos sin SKU (lógica de B1
//     reutilizada; ya filtra por sku=null OR "" Y needsSkuReview=false).
//   - Refrescar comodines TPV-OTROS (idempotente; crea sólo los IVAs
//     nuevos que no tenía el tenant).
//   - Persistir tenant.lastIncrementalSyncAt + lastIncrementalSyncStats.
//
// NOTA: el sync incremental NO toca `tenant.fiscalProfile`. Si el spike
// §08 hubiera dado endpoint, lo refrescaríamos aquí; al ser negativo
// (B2 §1), el fiscalProfile se mantiene tal como lo dejó el sync
// inicial o el propietario desde "Mi cuenta".

import type { PrismaClient } from "@mipiacetpv/db";
import {
  ApiKeyClient,
  buildTaxRateResolver,
  extractImageUrl,
  iterateAllContacts,
  iterateAllProducts,
  iterateAllServices,
  listTaxes,
  listUnrecognizedImageKeys,
  listWarehouses,
  type HoldedProduct,
  type HoldedService,
} from "@mipiacetpv/holded-client";

import { decryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";
import { runAutoSku, type AutoSkuResult } from "../onboarding/auto-sku.js";
import {
  pickHoldedTaxKey,
  upsertContact,
} from "../onboarding/initial-sync.js";
import { createTpvOtrosWildcards, type WildcardResult } from "../onboarding/tpv-otros.js";
import { enqueueProductImageCache } from "../queues/product-image-cache.js";
import { backfillImagesFromHolded } from "./image-backfill.js";
import {
  archiveMissingProducts,
  type ArchiveMissingResult,
} from "./reconcile.js";

export interface IncrementalSyncStats {
  productsSeen: number;
  servicesSeen: number;
  taxesSeen: number;
  warehousesSeen: number;
  orphansMarked: number;
  // v1.9-sync-borrados: null = archivado aplicado; si no, motivo del
  // aborto defensivo ("empty-live-set" | "live-set-below-ratio").
  reconcileAborted: string | null;
  // Muestra (≤20) de los archivados en este tick, para diagnóstico
  // desde /catalog/sync-status sin entrar a la BD.
  reconcileArchivedSample: Array<{ holdedProductId: string; name: string }>;
  autoSkuFixed: number;
  autoSkuNeedsReview: number;
  wildcardsCreated: number;
  wildcardsReused: number;
  contactsSeen: number;
  contactsOrphansMarked: number;
  // B-ProductImages: jobs encolados al cache worker tras el sync para
  // el flujo legacy URL → fetch → cache. En v1.2-Lite-fix1 ya no se
  // encolan vía Holded — la descarga es binaria directa.
  imageJobsEnqueued: number;
  // v1.2-Lite Bug-Imagenes-Holded (Opción A, abandonada): mantenidos en
  // 0 para no romper la UI del admin que ya los pintaba.
  productsImageBackfilled: number;
  productsImageBackfillFailed: number;
  // v1.2-Lite-fix1 Bug-Imagenes-Holded: descarga binaria directa desde
  // `/invoicing/v1/products/{id}/image`. Por tick incremental sólo se
  // procesan los que tienen imageCachedAt NULL o más antiguo que 24h
  // (revalidación barata cuando el dueño sube foto en Holded).
  productsImageHoldedFetched: number;
  productsImageHoldedNone: number;
  productsImageHoldedFailed: number;
  durationMs: number;
  errors: Array<{ step: string; message: string }>;
}

function emptyStats(): IncrementalSyncStats {
  return {
    productsSeen: 0,
    servicesSeen: 0,
    taxesSeen: 0,
    warehousesSeen: 0,
    orphansMarked: 0,
    reconcileAborted: null,
    reconcileArchivedSample: [],
    autoSkuFixed: 0,
    autoSkuNeedsReview: 0,
    wildcardsCreated: 0,
    wildcardsReused: 0,
    contactsSeen: 0,
    contactsOrphansMarked: 0,
    imageJobsEnqueued: 0,
    productsImageBackfilled: 0,
    productsImageBackfillFailed: 0,
    productsImageHoldedFetched: 0,
    productsImageHoldedNone: 0,
    productsImageHoldedFailed: 0,
    durationMs: 0,
    errors: [],
  };
}

export interface RunIncrementalSyncOptions {
  tenantId: string;
  prisma: PrismaClient;
  logger?: {
    info: (msg: string, extra?: unknown) => void;
    warn: (msg: string, extra?: unknown) => void;
    error: (msg: string, extra?: unknown) => void;
  };
  // Inyectable para tests.
  buildClient?: (apiKey: string) => ApiKeyClient;
}

export class IncrementalSyncSkippedError extends Error {
  constructor(public reason: "no-api-key" | "initial-sync-not-done") {
    super(`incremental-sync skipped: ${reason}`);
    this.name = "IncrementalSyncSkippedError";
  }
}

export async function runIncrementalSync(
  options: RunIncrementalSyncOptions,
): Promise<IncrementalSyncStats> {
  const { tenantId, prisma } = options;
  const log = options.logger ?? consoleLogger();
  const start = Date.now();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  // Defensa: no correr sobre tenants sin onboarding completo. El cron
  // sólo registra repeatables para tenants con DONE, pero la cola
  // manual podría llegar antes.
  if (!tenant.holdedApiKeyCiphertext) {
    throw new IncrementalSyncSkippedError("no-api-key");
  }
  if (tenant.initialSyncStatus !== "DONE") {
    throw new IncrementalSyncSkippedError("initial-sync-not-done");
  }

  const env = loadEnv();
  const apiKey = decryptSecret(tenant.holdedApiKeyCiphertext, env.HOLDED_KEY_ENCRYPTION_SECRET);
  const client = options.buildClient
    ? options.buildClient(apiKey)
    : new ApiKeyClient(apiKey, { baseUrl: env.HOLDED_BASE_URL });

  const stats = emptyStats();
  // Ancla para detectar contactos huérfanos (los productos usan el set
  // vivo de ids desde v1.9, no el timestamp).
  const syncStartedAt = new Date();

  try {
    // ── Taxes ────────────────────────────────────────────────────────
    const taxes = await listTaxes(client);
    stats.taxesSeen = taxes.length;
    // Resolver `taxId → rate` para el resto del sync (§1.1 + B7.5).
    const resolveTaxRate = buildTaxRateResolver(taxes);
    for (const t of taxes) {
      const key = pickHoldedTaxKey(t);
      if (!key) continue;
      await prisma.tenantTax.upsert({
        where: { tenantId_holdedTaxId: { tenantId, holdedTaxId: key } },
        create: {
          tenantId,
          holdedTaxId: key,
          rate: t.rate ?? null,
          name: t.name ?? null,
          raw: t as unknown as object,
        },
        update: {
          rate: t.rate ?? null,
          name: t.name ?? null,
          raw: t as unknown as object,
          syncedAt: new Date(),
        },
      });
    }

    // ── Warehouses ───────────────────────────────────────────────────
    const warehouses = await listWarehouses(client);
    stats.warehousesSeen = warehouses.length;
    for (const w of warehouses) {
      await prisma.warehouse.upsert({
        where: { tenantId_holdedWarehouseId: { tenantId, holdedWarehouseId: w.id } },
        create: { tenantId, holdedWarehouseId: w.id, name: w.name },
        update: { name: w.name },
      });
    }

    // ── Productos ────────────────────────────────────────────────────
    // Acumulamos ids cuyo cache de imagen hay que (re)disparar. El
    // enqueue real se hace en bloque al final, para que Redis caído
    // no aborte el sync.
    const imageCacheTargets: string[] = [];
    // v1.9: set de holdedProductId vivos según el listado de este tick.
    // Alimenta archiveMissingProducts() — los forSale=0 se excluyen a
    // propósito: no se sincronizan, así que tampoco cuentan como vivos
    // para el TPV (mismo comportamiento que el huérfano-por-timestamp
    // anterior).
    const liveIds = new Set<string>();
    for await (const { products } of iterateAllProducts(client)) {
      for (const p of products) {
        if (p.forSale === 0) continue;
        liveIds.add(p.id);
        const r = await upsertCatalogEntry(
          prisma,
          tenantId,
          p,
          "PRODUCT",
          resolveTaxRate,
          log,
        );
        if (r.needsImageCache) imageCacheTargets.push(r.id);
        stats.productsSeen += 1;
      }
    }

    // ── Servicios ────────────────────────────────────────────────────
    // v1.3-hotfix3 · sin filtro `forSale` para servicios (es el toggle
    // "Para TPV" del TPV de Holded, irrelevante para mipiacetpv).
    // Igual que en initial-sync.ts.
    for await (const { services } of iterateAllServices(client)) {
      for (const s of services) {
        liveIds.add(s.id);
        const r = await upsertCatalogEntry(
          prisma,
          tenantId,
          s,
          "SERVICE",
          resolveTaxRate,
          log,
        );
        if (r.needsImageCache) imageCacheTargets.push(r.id);
        stats.servicesSeen += 1;
      }
    }

    // ── Borrados en Holded (v1.9-sync-borrados) ─────────────────────
    // Todo producto activo que no esté en el set vivo de este tick se
    // soft-archiva. La reactivación es el upsert de arriba: si el id
    // reaparece en Holded pone active=true y limpia
    // archivedFromHoldedAt. Con listado coja la función aborta sin
    // archivar y alerta a Sentry (protección anti-catástrofe).
    const reconcile: ArchiveMissingResult = await archiveMissingProducts(
      prisma,
      tenantId,
      liveIds,
      { logger: log },
    );
    stats.orphansMarked = reconcile.archived;
    stats.reconcileAborted = reconcile.aborted;
    stats.reconcileArchivedSample = reconcile.archivedSample;
    if (reconcile.aborted) {
      stats.errors.push({
        step: "reconcile",
        message: `conciliación abortada (${reconcile.aborted}): vivos=${reconcile.liveSeen}, locales activos=${reconcile.localActiveBefore}`,
      });
    }

    // ── Auto-SKU para los nuevos productos sin SKU ──────────────────
    // runAutoSku filtra por sku=null/"" AND needsSkuReview=false, así
    // que sólo procesa novedades. Idempotente.
    const autoSku = await runAutoSku({ tenantId, prisma, client, logger: log });
    mergeAutoSku(stats, autoSku);

    // ── Comodines TPV-OTROS (idempotente) ───────────────────────────
    const wildcards = await createTpvOtrosWildcards({ tenantId, prisma, client, logger: log });
    mergeWildcards(stats, wildcards);

    // ── Backfill de imágenes vía endpoint binario (v1.2-Lite-fix1) ──
    // Holded no expone campo de imagen en el listado de productos en
    // algunas cuentas (Thalia: 0/966 backfilled con Opción A). El
    // spike empírico 2026-05-22 demostró que `/products/{id}/image`
    // sí devuelve el binario real. Descarga + escritura a disco +
    // UPDATE imageMime + imageCachedAt en un solo paso (sin Redis,
    // sin worker intermedio). Sólo procesa productos con
    // imageCachedAt NULL o más antiguo que 24h.
    try {
      const backfill = await backfillImagesFromHolded(
        prisma,
        tenantId,
        client,
        {
          cacheDir: env.PRODUCT_IMAGE_CACHE_DIR,
          maxBytes: env.PRODUCT_IMAGE_MAX_BYTES,
        },
        log,
      );
      stats.productsImageHoldedFetched = backfill.fetched;
      stats.productsImageHoldedNone = backfill.none;
      stats.productsImageHoldedFailed = backfill.failed;
      log.info("backfill imagenes binario terminó", {
        tenantId,
        ...backfill,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stats.errors.push({ step: "image-backfill", message });
      log.warn("backfill imágenes incremental falló", { tenantId, message });
    }

    // ── Imágenes de producto (cache asíncrono, B-ProductImages) ─────
    // Encolamos a Redis los productos con imagen nueva o URL cambiada.
    // El upsert de arriba ya invalidó `imageCachedAt = null` para los
    // que cambiaron, así que el worker los detecta como pendientes.
    // No bloqueamos el sync por fallos de Redis aquí — el siguiente
    // incremental reintentará.
    for (const productId of imageCacheTargets) {
      try {
        await enqueueProductImageCache(productId);
        stats.imageJobsEnqueued += 1;
      } catch (err) {
        log.warn("no pude encolar image-cache job", {
          productId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Contactos completos (B7 §8) ─────────────────────────────────
    // Holded no expone `updatedSince` para contactos (spike §10).
    // Refrescamos el catálogo entero cada cron: 1000-5000 contactos
    // tardan ~3-5s, asumible. Si en algún piloto el volumen pasa de
    // 20.000, B7.5 introducirá un schedule horario en lugar de cada
    // 15 min.
    try {
      for await (const { contacts } of iterateAllContacts(client)) {
        for (const c of contacts) {
          await upsertContact(prisma, tenantId, c, syncStartedAt);
          stats.contactsSeen += 1;
        }
      }
      // Huérfanos: misma mecánica que productos.
      const orphans = await prisma.contact.updateMany({
        where: {
          tenantId,
          active: true,
          OR: [
            { lastSeenInSyncAt: null },
            { lastSeenInSyncAt: { lt: syncStartedAt } },
          ],
        },
        data: { active: false },
      });
      stats.contactsOrphansMarked = orphans.count;
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { lastContactsSyncAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stats.errors.push({ step: "contacts", message });
      log.warn("incremental-sync contactos falló", { tenantId, message });
    }

    stats.durationMs = Date.now() - start;
    await persistDone(prisma, tenantId, stats);
    log.info("incremental-sync ok", { tenantId, stats });
    return stats;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stats.errors.push({ step: "<top>", message });
    stats.durationMs = Date.now() - start;
    await persistDone(prisma, tenantId, stats);
    log.error("incremental-sync falló", { tenantId, message });
    throw err;
  }
}

// Misma lógica de upsert que el sync inicial pero con detección de
// cambio de URL de imagen: si la URL nueva difiere de la previa,
// invalidamos `imageCachedAt = null` para que el worker re-descargue
// y devolvemos `needsImageCache=true` para que el caller lo encole.
async function upsertCatalogEntry(
  prisma: PrismaClient,
  tenantId: string,
  raw: HoldedProduct | HoldedService,
  kind: "PRODUCT" | "SERVICE",
  resolveTaxRate: (taxId: string | undefined) => number | null,
  log: NonNullable<RunIncrementalSyncOptions["logger"]>,
): Promise<{ id: string; needsImageCache: boolean }> {
  const sku = typeof raw.sku === "string" && raw.sku.length > 0 ? raw.sku : null;
  const taxId = raw.taxes?.[0];
  const resolvedTaxRate = resolveTaxRate(taxId);
  const taxRate = resolvedTaxRate ?? 0;
  if (resolvedTaxRate === null) {
    // B5 §1.1: el tax del producto no se pudo resolver (ni vía
    // /invoicing/v1/taxes ni vía regex). Si lo enviáramos a Holded con
    // taxRate=0, Holded aplica su propio IVA → silent reject por
    // mismatch de total. Por eso forzamos sellableViaTpv=false aquí.
    log.warn("producto con tax sin resolver, marcado como no vendible", {
      holdedProductId: raw.id,
      taxId,
      name: raw.name,
    });
  }
  const basePrice = typeof raw.price === "number" ? raw.price : 0;
  const barcodeRaw = (raw as { barcode?: unknown }).barcode;
  const barcode =
    typeof barcodeRaw === "string" && barcodeRaw.length > 0 ? barcodeRaw : null;
  const sellable = sku !== null && resolvedTaxRate !== null;
  const newImageUrl = extractImageUrl(raw as HoldedProduct);
  // Inv-1 (v1.1 Thalia): si hay imageUrl null pero el raw tiene claves
  // que parecen imagen (image_xxx, attachmentUrl, etc.) loguear para
  // detectar campos nuevos sin tener que pedir un dump por slack.
  if (newImageUrl === null) {
    const unknownKeys = listUnrecognizedImageKeys(raw as HoldedProduct);
    if (unknownKeys.length > 0) {
      log.warn("producto sin imagen reconocida pero raw tiene claves image-like", {
        holdedProductId: raw.id,
        name: raw.name,
        candidateKeys: unknownKeys,
      });
    }
  }
  // B-Categorias-via-Tags: normalizamos los tags Holded igual que en
  // initial-sync. Filtra vacíos y duplicados defensivamente. Si el
  // propietario quita tags en Holded, el array queda vacío y el chip
  // desaparece del filtro del TPV en el siguiente render.
  // v1.2-Lite Lote 3.A: lowercase para evitar chips duplicados con
  // casing distinto (auditoría Thalia). Capitalización al renderizar
  // queda en el TPV.
  const tagsRaw = (raw as { tags?: unknown }).tags;
  const tags = Array.isArray(tagsRaw)
    ? Array.from(
        new Set(
          tagsRaw
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim().toLowerCase())
            .filter((t) => t.length > 0),
        ),
      )
    : [];

  // Leemos el estado previo para decidir si invalidamos el cache. Una
  // query extra por producto es asumible (1ms en el bench piloto: 500
  // productos × 1ms ≈ 0.5s sobre un sync que de por sí tarda 30s+).
  const existing = await prisma.product.findUnique({
    where: { tenantId_holdedProductId: { tenantId, holdedProductId: raw.id } },
    select: { id: true, imageUrl: true, imageCachedAt: true },
  });

  // ¿Hay que volver a descargar la imagen?
  //   - producto nuevo con imagen: sí.
  //   - URL cambió respecto a la previa: sí (e invalidamos imageCachedAt).
  //   - URL igual pero `imageCachedAt` sigue null (intento previo
  //     falló): sí — el worker reintenta hasta que cuelgue válido.
  //   - URL sigue igual y `imageCachedAt` ya está poblado: no.
  const urlChanged = existing != null && existing.imageUrl !== newImageUrl;
  const needsImageCache =
    newImageUrl !== null &&
    (existing == null ||
      urlChanged ||
      existing.imageCachedAt === null);

  const row = await prisma.product.upsert({
    where: {
      tenantId_holdedProductId: { tenantId, holdedProductId: raw.id },
    },
    create: {
      tenantId,
      holdedProductId: raw.id,
      name: raw.name,
      sku,
      barcode,
      basePrice,
      taxRate,
      kind,
      active: true,
      sellableViaTpv: sellable,
      imageUrl: newImageUrl,
      tags,
      raw: raw as unknown as object,
    },
    update: {
      name: raw.name,
      // No pisamos un sku que el script auto-SKU haya rellenado en
      // local pero Holded aún no haya devuelto (caso poco probable).
      sku: sku ?? undefined,
      barcode,
      basePrice,
      taxRate,
      kind,
      // El upsert siempre reactiva: si el producto vuelve después de
      // haber sido archivado (active=false), lo recuperamos y
      // limpiamos la marca de borrado en Holded (v1.9).
      active: true,
      archivedFromHoldedAt: null,
      // Tax sin resolver → FORZAMOS false (vender con tax=0 cuando
      // Holded tiene otro IVA en el SKU provoca silent reject). Si el
      // tax sí está pero falta el sku, no degradamos (auto-sku lo
      // re-activará tras asignar SKU).
      sellableViaTpv:
        resolvedTaxRate === null ? false : sellable || undefined,
      imageUrl: newImageUrl,
      // B-Categorias-via-Tags: sustitución completa del array. Si el
      // propietario edita tags en Holded, el siguiente sync los
      // refleja tal cual (no merge — la verdad es Holded).
      tags,
      // Si la URL cambió, también invalidamos mime + cachedAt para que
      // el TPV deje de pintar el archivo antiguo en cuanto el worker
      // confirme la nueva descarga. Si la URL es igual, no tocamos
      // estos campos (mantenemos el cache válido).
      ...(urlChanged
        ? { imageMime: null, imageCachedAt: null }
        : {}),
      raw: raw as unknown as object,
      lastSyncedAt: new Date(),
    },
    select: { id: true },
  });

  return { id: row.id, needsImageCache };
}

function mergeAutoSku(stats: IncrementalSyncStats, result: AutoSkuResult): void {
  stats.autoSkuFixed = result.fixed;
  stats.autoSkuNeedsReview = result.needsReview;
  for (const e of result.errors) stats.errors.push({ step: "auto-sku", message: e });
}

function mergeWildcards(stats: IncrementalSyncStats, result: WildcardResult): void {
  stats.wildcardsCreated = result.created;
  stats.wildcardsReused = result.reused;
  for (const e of result.errors) stats.errors.push({ step: "wildcards", message: e });
}

async function persistDone(
  prisma: PrismaClient,
  tenantId: string,
  stats: IncrementalSyncStats,
): Promise<void> {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      lastIncrementalSyncAt: new Date(),
      lastIncrementalSyncStats: { ...stats } as object,
    },
  });
}

function consoleLogger(): NonNullable<RunIncrementalSyncOptions["logger"]> {
  return {
    info: (m, e) => console.log(`[incremental-sync] ${m}`, e ?? ""),
    warn: (m, e) => console.warn(`[incremental-sync] ${m}`, e ?? ""),
    error: (m, e) => console.error(`[incremental-sync] ${m}`, e ?? ""),
  };
}
