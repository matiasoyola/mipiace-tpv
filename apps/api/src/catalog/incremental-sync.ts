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
  buildTaxRateResolver,
  iterateAllContacts,
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
import { upsertContact } from "../onboarding/initial-sync.js";
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
  contactsSeen: number;
  contactsOrphansMarked: number;
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
    contactsSeen: 0,
    contactsOrphansMarked: 0,
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
    // Resolver `taxId → rate` para el resto del sync (§1.1).
    const resolveTaxRate = buildTaxRateResolver(taxes);
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
        await upsertCatalogEntry(prisma, tenantId, p, "PRODUCT", resolveTaxRate, log);
        stats.productsSeen += 1;
      }
    }

    // ── Servicios ────────────────────────────────────────────────────
    for await (const { services } of iterateAllServices(client)) {
      for (const s of services) {
        if (s.forSale === 0) continue;
        await upsertCatalogEntry(prisma, tenantId, s, "SERVICE", resolveTaxRate, log);
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

// Misma lógica de upsert que el sync inicial. Se duplica
// intencionalmente: extraerla a un helper compartido es trivial
// pero hoy la diferencia entre inicial/incremental es nula. Si
// divergen, refactorizamos.
async function upsertCatalogEntry(
  prisma: PrismaClient,
  tenantId: string,
  raw: HoldedProduct | HoldedService,
  kind: "PRODUCT" | "SERVICE",
  resolveTaxRate: (taxId: string | undefined) => number | null,
  log: NonNullable<RunIncrementalSyncOptions["logger"]>,
): Promise<void> {
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
      // Tax sin resolver → FORZAMOS false (vender con tax=0 cuando
      // Holded tiene otro IVA en el SKU provoca silent reject). Si el
      // tax sí está pero falta el sku, no degradamos (auto-sku lo
      // re-activará tras asignar SKU).
      sellableViaTpv:
        resolvedTaxRate === null ? false : sellable || undefined,
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
