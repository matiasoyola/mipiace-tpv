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
//     lastSyncedAt = now().
//   - Huérfanos: UPDATE products SET active=false WHERE
//     lastSyncedAt < syncStartedAt AND active=true (no borrar — los
//     tickets históricos referencian).
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
  iterateAllProducts,
  iterateAllServices,
  listTaxes,
  listWarehouses,
  parseTaxRateFromId,
  type HoldedProduct,
  type HoldedService,
} from "@mipiacetpv/holded-client";

import { decryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";
import { runAutoSku, type AutoSkuResult } from "../onboarding/auto-sku.js";
import { createTpvOtrosWildcards, type WildcardResult } from "../onboarding/tpv-otros.js";

export interface IncrementalSyncStats {
  productsSeen: number;
  servicesSeen: number;
  taxesSeen: number;
  warehousesSeen: number;
  orphansMarked: number;
  autoSkuFixed: number;
  autoSkuNeedsReview: number;
  wildcardsCreated: number;
  wildcardsReused: number;
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
    autoSkuFixed: 0,
    autoSkuNeedsReview: 0,
    wildcardsCreated: 0,
    wildcardsReused: 0,
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
  // Ancla para detectar huérfanos: cualquier producto con
  // lastSyncedAt < syncStartedAt al terminar el sync es huérfano.
  const syncStartedAt = new Date();

  try {
    // ── Taxes ────────────────────────────────────────────────────────
    const taxes = await listTaxes(client);
    stats.taxesSeen = taxes.length;
    for (const t of taxes) {
      const rate = typeof t.rate === "number" ? t.rate : parseTaxRateFromId(t.id);
      await prisma.tenantTax.upsert({
        where: { tenantId_holdedTaxId: { tenantId, holdedTaxId: t.id } },
        create: {
          tenantId,
          holdedTaxId: t.id,
          rate: rate ?? null,
          name: t.name ?? null,
          raw: t as unknown as object,
        },
        update: {
          rate: rate ?? null,
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
    for await (const { products } of iterateAllProducts(client)) {
      for (const p of products) {
        if (p.forSale === 0) continue;
        await upsertCatalogEntry(prisma, tenantId, p, "PRODUCT");
        stats.productsSeen += 1;
      }
    }

    // ── Servicios ────────────────────────────────────────────────────
    for await (const { services } of iterateAllServices(client)) {
      for (const s of services) {
        if (s.forSale === 0) continue;
        await upsertCatalogEntry(prisma, tenantId, s, "SERVICE");
        stats.servicesSeen += 1;
      }
    }

    // ── Huérfanos ────────────────────────────────────────────────────
    // Reactivar productos que vuelven (puede pasar si Holded los
    // archiva temporalmente y luego los reactiva). El upsert anterior
    // ya marca active=true; los que NO se tocaron en este sync siguen
    // con su valor previo. El UPDATE de abajo sólo afecta a los que
    // estaban active=true y ya no aparecen.
    const orphans = await prisma.product.updateMany({
      where: {
        tenantId,
        active: true,
        lastSyncedAt: { lt: syncStartedAt },
      },
      data: { active: false, sellableViaTpv: false },
    });
    stats.orphansMarked = orphans.count;

    // ── Auto-SKU para los nuevos productos sin SKU ──────────────────
    // runAutoSku filtra por sku=null/"" AND needsSkuReview=false, así
    // que sólo procesa novedades. Idempotente.
    const autoSku = await runAutoSku({ tenantId, prisma, client, logger: log });
    mergeAutoSku(stats, autoSku);

    // ── Comodines TPV-OTROS (idempotente) ───────────────────────────
    const wildcards = await createTpvOtrosWildcards({ tenantId, prisma, client, logger: log });
    mergeWildcards(stats, wildcards);

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

// Misma lógica de upsert que el sync inicial. Se duplica
// intencionalmente: extraerla a un helper compartido es trivial
// pero hoy la diferencia entre inicial/incremental es nula. Si
// divergen, refactorizamos.
async function upsertCatalogEntry(
  prisma: PrismaClient,
  tenantId: string,
  raw: HoldedProduct | HoldedService,
  kind: "PRODUCT" | "SERVICE",
): Promise<void> {
  const sku = typeof raw.sku === "string" && raw.sku.length > 0 ? raw.sku : null;
  const taxId = raw.taxes?.[0];
  const taxRate = parseTaxRateFromId(taxId) ?? 0;
  const basePrice = typeof raw.price === "number" ? raw.price : 0;
  const barcodeRaw = (raw as { barcode?: unknown }).barcode;
  const barcode =
    typeof barcodeRaw === "string" && barcodeRaw.length > 0 ? barcodeRaw : null;
  const sellable = sku !== null;

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
      // haber sido marcado huérfano (active=false), lo recuperamos.
      active: true,
      // sellableViaTpv: sólo lo subimos si la condición se cumple; si
      // sigue sin sku no lo bajamos a false desde aquí (auto-sku
      // puede ponerlo a true después de asignar el SKU).
      sellableViaTpv: sellable || undefined,
      raw: raw as unknown as object,
      lastSyncedAt: new Date(),
    },
  });
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
