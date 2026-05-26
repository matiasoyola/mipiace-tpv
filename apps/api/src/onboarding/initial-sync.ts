// Job de sync inicial post-onboarding. Lo ejecuta el worker BullMQ
// (`workers/initial-sync-worker.ts`). El admin pollea
// `GET /onboarding/sync-status` para ver el progreso.

import { PrismaClient } from "@mipiacetpv/db";
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
  type HoldedContact,
  type HoldedProduct,
  type HoldedService,
  type HoldedTax,
} from "@mipiacetpv/holded-client";

import { backfillImagesFromHolded } from "../catalog/image-backfill.js";
import { decryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";
import { enqueueProductImageCache } from "../queues/product-image-cache.js";
import { runAutoSku, type AutoSkuResult } from "./auto-sku.js";
import { createTpvOtrosWildcards, type WildcardResult } from "./tpv-otros.js";

export interface SyncStats {
  productsCount: number;
  servicesCount: number;
  warehousesCount: number;
  taxesCount: number;
  autoSkuFixed: number;
  autoSkuNeedsReview: number;
  wildcardsCreated: number;
  wildcardsReused: number;
  productPagesProcessed: number;
  servicePagesProcessed: number;
  contactsCount: number;
  contactPagesProcessed: number;
  // B-ProductImages: jobs encolados al cache worker tras el sync para
  // el flujo legacy URL → fetch → cache. En v1.2-Lite-fix1 el sync de
  // Holded ya no encola jobs (descarga binaria directa), pero el campo
  // se mantiene como fallback por si en futuro un tenant tiene URLs
  // externas (S3 firmadas, etc.).
  imageJobsEnqueued: number;
  // v1.2-Lite Bug-Imagenes-Holded (Opción A, abandonada): productos
  // cuyo imageUrl se intentó rescatar llamando a `/products/{id}`. En
  // v1.2-Lite-fix1 estos campos quedan en 0 — la nueva ruta es
  // binaria. Conservados para no romper la UI del admin que ya los
  // pintaba; eliminar en una limpieza posterior.
  productsImageBackfilled: number;
  productsImageBackfillFailed: number;
  // v1.2-Lite-fix1 Bug-Imagenes-Holded: descarga binaria directa desde
  // `/invoicing/v1/products/{id}/image`. Si `fetched > 0` el TPV ya
  // pinta tiles con foto sin esperar al image-cache-worker.
  productsImageHoldedFetched: number;
  // Productos verificados sin foto en Holded (sentinel: imageCachedAt
  // poblado, imageMime NULL). No vuelven a pincharse hasta 24 h.
  productsImageHoldedNone: number;
  // Errores transitorios (red, timeout, magic bytes raros). Quedan con
  // imageCachedAt NULL para que el siguiente sync los reintente.
  productsImageHoldedFailed: number;
  currentStep?: string;
  errors: Array<{ step: string; message: string }>;
}

function emptyStats(): SyncStats {
  return {
    productsCount: 0,
    servicesCount: 0,
    warehousesCount: 0,
    taxesCount: 0,
    autoSkuFixed: 0,
    autoSkuNeedsReview: 0,
    wildcardsCreated: 0,
    wildcardsReused: 0,
    productPagesProcessed: 0,
    servicePagesProcessed: 0,
    contactsCount: 0,
    contactPagesProcessed: 0,
    imageJobsEnqueued: 0,
    productsImageBackfilled: 0,
    productsImageBackfillFailed: 0,
    productsImageHoldedFetched: 0,
    productsImageHoldedNone: 0,
    productsImageHoldedFailed: 0,
    errors: [],
  };
}

export interface RunInitialSyncOptions {
  tenantId: string;
  prisma: PrismaClient;
  logger?: { info: (msg: string, extra?: unknown) => void; warn: (msg: string, extra?: unknown) => void; error: (msg: string, extra?: unknown) => void };
  // Inyectable para tests.
  buildClient?: (apiKey: string) => ApiKeyClient;
}

export async function runInitialSync(options: RunInitialSyncOptions): Promise<SyncStats> {
  const { tenantId, prisma } = options;
  const log = options.logger ?? consoleLogger();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (!tenant.holdedApiKeyCiphertext) {
    throw new Error(`Tenant ${tenantId}: no Holded API key persisted yet`);
  }
  const env = loadEnv();
  const apiKey = decryptSecret(tenant.holdedApiKeyCiphertext, env.HOLDED_KEY_ENCRYPTION_SECRET);
  const client = options.buildClient
    ? options.buildClient(apiKey)
    : new ApiKeyClient(apiKey, { baseUrl: env.HOLDED_BASE_URL });

  const stats = emptyStats();
  await markRunning(prisma, tenantId);
  // Resolver `taxId → rate` que se construye en el paso de "Tipos de IVA"
  // y se reutiliza para productos/servicios (§1.1 del prompt B5).
  let resolveTaxRate: (taxId: string | undefined) => number | null = () => null;

  try {
    await step(stats, "Tipos de IVA", async () => {
      const taxes = await listTaxes(client);
      stats.taxesCount = taxes.length;
      resolveTaxRate = buildTaxRateResolver(taxes);
      for (const t of taxes) {
        const key = pickHoldedTaxKey(t);
        if (!key) continue; // tax sin key estable: no persistible
        await prisma.tenantTax.upsert({
          where: {
            tenantId_holdedTaxId: { tenantId, holdedTaxId: key },
          },
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
    }, prisma, tenantId);

    let warehousesPayload: Awaited<ReturnType<typeof listWarehouses>> = [];
    await step(stats, "Almacenes", async () => {
      warehousesPayload = await listWarehouses(client);
      stats.warehousesCount = warehousesPayload.length;
      for (const w of warehousesPayload) {
        await prisma.warehouse.upsert({
          where: {
            tenantId_holdedWarehouseId: { tenantId, holdedWarehouseId: w.id },
          },
          create: { tenantId, holdedWarehouseId: w.id, name: w.name },
          update: { name: w.name },
        });
      }
      // Datos fiscales mínimos para el pie del ticket: del almacén default.
      // T-6 (v1.1 Thalia): el warehouse de Holded NO trae taxId/nif —
      // ese dato vive a nivel de cuenta y no lo expone /warehouses. Si
      // el super-admin lo metió al crear el DRAFT (fiscalProfile.taxId
      // + legalName), aquí preservamos esos campos. ANTES pisábamos el
      // fiscalProfile entero y Thalia perdía su NIF tras el primer
      // sync.
      const def = warehousesPayload.find((w) => w.default) ?? warehousesPayload[0];
      if (def) {
        const existing = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { fiscalProfile: true },
        });
        const prev = (existing?.fiscalProfile ?? {}) as Record<string, unknown>;
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            fiscalProfile: {
              ...prev,
              source: "warehouse_default",
              warehouseHoldedId: def.id,
              name: def.name,
              address: def.address ?? null,
              // legalName/taxId/nif/phone: se preservan vía spread `prev`.
              // Si el super-admin los puso al crear el tenant, siguen
              // ahí. Si nunca se pusieron, quedan undefined → build.ts
              // los tolera (Bug-05).
            } as object,
          },
        });
      }
    }, prisma, tenantId);

    await step(stats, "Productos", async () => {
      for await (const { page, products } of iterateAllProducts(client)) {
        stats.productPagesProcessed = page;
        for (const p of products) {
          if (p.forSale === 0) continue;
          await upsertCatalogEntry(prisma, tenantId, p, "PRODUCT", resolveTaxRate, log);
          stats.productsCount += 1;
        }
        await persistProgress(prisma, tenantId, stats);
      }
    }, prisma, tenantId);

    await step(stats, "Servicios", async () => {
      for await (const { page, services } of iterateAllServices(client)) {
        stats.servicePagesProcessed = page;
        for (const s of services) {
          // v1.3-hotfix3 · NO filtramos servicios por `forSale`. Ese flag
          // es el toggle "Para TPV" del TPV propio de Holded, que en
          // servicios Holded deja apagado por defecto porque su TPV no
          // los maneja bien. Mipiacetpv es independiente del TPV de
          // Holded — para nosotros TODO servicio es por definición
          // vendible. Mantenemos el filtro sólo para productos (donde
          // los clientes RETAIL sí usan forSale para excluir materia
          // prima / consumibles internos).
          await upsertCatalogEntry(prisma, tenantId, s, "SERVICE", resolveTaxRate, log);
          stats.servicesCount += 1;
        }
        await persistProgress(prisma, tenantId, stats);
      }
    }, prisma, tenantId);

    await step(stats, "Asignación automática de SKUs", async () => {
      const result = await runAutoSku({ tenantId, prisma, client, logger: log });
      mergeAutoSku(stats, result);
    }, prisma, tenantId);

    await step(stats, "Comodines de línea libre", async () => {
      const result = await createTpvOtrosWildcards({ tenantId, prisma, client, logger: log });
      mergeWildcards(stats, result);
    }, prisma, tenantId);

    await step(stats, "Imágenes de producto (binario Holded)", async () => {
      // v1.2-Lite-fix1 Bug-Imagenes-Holded: el listado de Holded no
      // devuelve campo de imagen y los endpoints `/attachments`,
      // `/files`, `/images`, `/mainimage` sirven HTML catch-all
      // (spike 2026-05-22). El binario real está en
      // `/products/{id}/image`. Descarga + escritura a disco + UPDATE
      // `imageMime + imageCachedAt`. Concurrencia 5 → ~40s para 1000
      // productos.
      const result = await backfillImagesFromHolded(
        prisma,
        tenantId,
        client,
        {
          cacheDir: env.PRODUCT_IMAGE_CACHE_DIR,
          maxBytes: env.PRODUCT_IMAGE_MAX_BYTES,
        },
        log,
      );
      stats.productsImageHoldedFetched = result.fetched;
      stats.productsImageHoldedNone = result.none;
      stats.productsImageHoldedFailed = result.failed;
      log.info("backfill imagenes binario terminó", {
        tenantId,
        ...result,
      });
    }, prisma, tenantId);

    await step(stats, "Imágenes de producto", async () => {
      stats.imageJobsEnqueued = await enqueueAllProductImages(prisma, tenantId, log);
    }, prisma, tenantId);

    await step(stats, "Contactos", async () => {
      const now = new Date();
      for await (const { page, contacts } of iterateAllContacts(client)) {
        stats.contactPagesProcessed = page;
        for (const c of contacts) {
          await upsertContact(prisma, tenantId, c, now);
          stats.contactsCount += 1;
        }
        await persistProgress(prisma, tenantId, stats);
      }
      // Marcamos huérfanos al final del sync inicial igual que en
      // productos: cualquier contacto que existía localmente y no se
      // ha refrescado en este sync pasa a active=false (no debería
      // ocurrir en un sync inicial sobre BD vacía, pero por defensa).
      await prisma.contact.updateMany({
        where: {
          tenantId,
          OR: [
            { lastSeenInSyncAt: null },
            { lastSeenInSyncAt: { lt: now } },
          ],
        },
        data: { active: false },
      });
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { lastContactsSyncAt: now },
      });
    }, prisma, tenantId);

    await markDone(prisma, tenantId, stats);
    return stats;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stats.errors.push({ step: stats.currentStep ?? "<unknown>", message });
    await markFailed(prisma, tenantId, stats);
    log.error("initial-sync falló", { tenantId, message });
    throw err;
  }
}

async function step(
  stats: SyncStats,
  name: string,
  fn: () => Promise<void>,
  prisma: PrismaClient,
  tenantId: string,
): Promise<void> {
  stats.currentStep = name;
  await persistProgress(prisma, tenantId, stats);
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stats.errors.push({ step: name, message });
    throw err;
  }
}

async function upsertCatalogEntry(
  prisma: PrismaClient,
  tenantId: string,
  raw: HoldedProduct | HoldedService,
  kind: "PRODUCT" | "SERVICE",
  resolveTaxRate: (taxId: string | undefined) => number | null,
  log: NonNullable<RunInitialSyncOptions["logger"]>,
): Promise<void> {
  const sku = typeof raw.sku === "string" && raw.sku.length > 0 ? raw.sku : null;
  const taxId = raw.taxes?.[0];
  const resolvedTaxRate = resolveTaxRate(taxId);
  const taxRate = resolvedTaxRate ?? 0;
  if (resolvedTaxRate === null) {
    // B5 §1.1: producto con tax sin resolver. Lo persistimos como NO
    // vendible vía TPV — si saliera el silent reject por mismatch de
    // total. El propietario tendrá que corregir el tipo de IVA en
    // Holded; el siguiente sync lo reactivará.
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
  // B-ProductImages: extrae la URL canónica de imagen. Si no hay,
  // imageUrl queda null y el TPV pintará placeholder. Servicios usan
  // el mismo helper (raw es HoldedProduct | HoldedService, ambos con
  // los campos de imagen como opcionales).
  const imageUrl = extractImageUrl(raw as HoldedProduct);
  // Inv-1 (v1.1 Thalia): si hay claves "image-like" no reconocidas,
  // emitir warning con la lista para que el siguiente sync nos diga
  // qué campo Holded usa en esa cuenta. Sin spam: sólo si imageUrl
  // quedó null.
  if (imageUrl === null) {
    const unknownKeys = listUnrecognizedImageKeys(raw as HoldedProduct);
    if (unknownKeys.length > 0) {
      log.warn("producto sin imagen reconocida pero raw tiene claves image-like", {
        holdedProductId: raw.id,
        name: raw.name,
        candidateKeys: unknownKeys,
      });
    }
  }
  // B-Categorias-via-Tags: normalizamos los tags de Holded. Llegan
  // como string[] pero defensivamente filtramos vacíos y duplicados
  // (un cliente paranoico podría taguear "Bebidas" dos veces). El
  // orden no importa porque el TPV los re-ordena alfabéticamente al
  // construir los chips.
  // v1.2-Lite Lote 3.A: normalizamos a lowercase tras detectar en
  // Thalia chips duplicados "Papelería" / "papeleria". El TPV
  // capitaliza al renderizar, así que el cliente sigue viendo el
  // chip bonito.
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

  // Sync inicial: BD vacía para este tenant, así que el upsert siempre
  // es create. No leemos previo para decidir invalidación del cache —
  // el worker descargará en cuanto vea imageUrl != null && cachedAt
  // null. (En incremental-sync sí comparamos URL previa.)
  await prisma.product.upsert({
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
      imageUrl,
      tags,
      // imageMime + imageCachedAt nacen NULL — el worker los rellena.
      raw: raw as unknown as object,
    },
    update: {
      name: raw.name,
      // No pisamos un sku que el script auto-SKU haya rellenado en local
      // pero Holded aún no haya devuelto (caso poco probable, pero por
      // si re-disparamos el sync).
      sku: sku ?? undefined,
      barcode,
      basePrice,
      taxRate,
      kind,
      active: true,
      // Si el tax está sin resolver, FORZAMOS sellableViaTpv=false aunque
      // el sku exista — vender con tax=0 cuando Holded espera 21 provoca
      // silent reject (§1.1). Si el sku falta pero el tax sí está, no
      // bajamos (auto-sku puede subirlo a true tras asignar SKU).
      sellableViaTpv:
        resolvedTaxRate === null ? false : sellable || undefined,
      imageUrl,
      tags,
      raw: raw as unknown as object,
      lastSyncedAt: new Date(),
    },
  });
}

// Tras el sync inicial, encola un job por cada producto que tenga
// imageUrl asignada pero no descarga válida. Concurrencia 4 en el
// worker → 500 productos se descargan en background sin saturar.
// Idempotente: el job mismo es no-op si imageCachedAt llegó a no-null
// entre el enqueue y la ejecución (carrera improbable pero defensiva).
async function enqueueAllProductImages(
  prisma: PrismaClient,
  tenantId: string,
  log: NonNullable<RunInitialSyncOptions["logger"]>,
): Promise<number> {
  const pending = await prisma.product.findMany({
    where: { tenantId, imageUrl: { not: null }, imageCachedAt: null },
    select: { id: true },
  });
  for (const p of pending) {
    try {
      await enqueueProductImageCache(p.id);
    } catch (err) {
      // No bloqueamos el sync por fallos del cache de imagen — son
      // cosméticos. Si Redis está caído, el siguiente incremental los
      // reintenta.
      log.warn("no pude encolar image-cache job", {
        productId: p.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return pending.length;
}

function mergeAutoSku(stats: SyncStats, result: AutoSkuResult): void {
  stats.autoSkuFixed = result.fixed;
  stats.autoSkuNeedsReview = result.needsReview;
  for (const e of result.errors) stats.errors.push({ step: "auto-sku", message: e });
}

function mergeWildcards(stats: SyncStats, result: WildcardResult): void {
  stats.wildcardsCreated = result.created;
  stats.wildcardsReused = result.reused;
  for (const e of result.errors) stats.errors.push({ step: "wildcards", message: e });
}

async function persistProgress(prisma: PrismaClient, tenantId: string, stats: SyncStats): Promise<void> {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { initialSyncStats: serializeStats(stats) },
  });
}

async function markRunning(prisma: PrismaClient, tenantId: string): Promise<void> {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      initialSyncStatus: "RUNNING",
      initialSyncStartedAt: new Date(),
      initialSyncCompletedAt: null,
      initialSyncStats: serializeStats(emptyStats()),
    },
  });
}

async function markDone(prisma: PrismaClient, tenantId: string, stats: SyncStats): Promise<void> {
  stats.currentStep = "Listo";
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      initialSyncStatus: "DONE",
      initialSyncCompletedAt: new Date(),
      initialSyncStats: serializeStats(stats),
    },
  });
}

async function markFailed(prisma: PrismaClient, tenantId: string, stats: SyncStats): Promise<void> {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      initialSyncStatus: "FAILED",
      initialSyncCompletedAt: new Date(),
      initialSyncStats: serializeStats(stats),
    },
  });
}

function serializeStats(stats: SyncStats): object {
  return { ...stats };
}

// Upsert de un contacto Holded a la tabla local (B7 §8). El sync
// completo lo llama desde initial-sync y desde incremental-sync —
// misma semántica: si existe (tenantId, holdedContactId) lo
// actualizamos; si no, lo creamos. Marca `lastSeenInSyncAt = now`.
export async function upsertContact(
  prisma: PrismaClient,
  tenantId: string,
  raw: HoldedContact,
  now: Date,
): Promise<void> {
  const name = raw.name?.trim() ?? "";
  if (!name || !raw.id) return; // contacto sin nombre/id → no almacenable
  const nif = raw.code ? raw.code.trim() : null;
  const email = raw.email ? raw.email.trim().toLowerCase() : null;
  const phone = raw.phone ? raw.phone.trim() : raw.mobile ? raw.mobile.trim() : null;
  await prisma.contact.upsert({
    where: {
      tenantId_holdedContactId: {
        tenantId,
        holdedContactId: raw.id,
      },
    },
    create: {
      tenantId,
      holdedContactId: raw.id,
      name,
      nif,
      email,
      phone,
      raw: raw as unknown as object,
      active: true,
      lastSeenInSyncAt: now,
    },
    update: {
      name,
      nif,
      email,
      phone,
      raw: raw as unknown as object,
      active: true,
      lastSeenInSyncAt: now,
      lastSyncedAt: now,
    },
  });
}

function consoleLogger(): NonNullable<RunInitialSyncOptions["logger"]> {
  return {
    info: (m, e) => console.log(`[initial-sync] ${m}`, e ?? ""),
    warn: (m, e) => console.warn(`[initial-sync] ${m}`, e ?? ""),
    error: (m, e) => console.error(`[initial-sync] ${m}`, e ?? ""),
  };
}

// B7.5: el campo estable que `Product.taxes[]` referencia es `key`. Para
// taxes del catálogo estándar de Holded (`s_iva_*`, `s_rec_*`) el `id`
// viene vacío; sólo los custom del dueño llevan `id` UUID. Persistimos
// el `key` en `holdedTaxId` y caemos al `id` sólo si por alguna razón
// `key` viniera vacío (defensivo).
export function pickHoldedTaxKey(t: HoldedTax): string | null {
  if (typeof t.key === "string" && t.key.length > 0) return t.key;
  if (typeof t.id === "string" && t.id.length > 0) return t.id;
  return null;
}
