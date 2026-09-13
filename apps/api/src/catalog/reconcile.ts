// Conciliación de catálogo Holded → TPV (v1.9-sync-borrados).
//
// Propaga BORRADOS: todo producto local activo cuyo holded_product_id
// no aparezca en el listado vivo de Holded se soft-archiva
// (active=false, sellableViaTpv=false, archivedFromHoldedAt=now).
// NUNCA se borran filas — el histórico de tickets las referencia.
//
// Dos vías de entrada:
//   1. `archiveMissingProducts()` — la llama el sync incremental con el
//      set de ids que acaba de upsertear (reutiliza el listado que el
//      sync ya recorre cada 15 min; coste API extra: cero). Sustituye
//      al antiguo UPDATE por lastSyncedAt < syncStartedAt, que hacía lo
//      mismo pero sin protección anti-catástrofe.
//   2. `runCatalogReconcile()` — pasada standalone que recorre el
//      listado completo (productos + servicios) sin upsertear nada.
//      La usa el one-shot post-deploy (`scripts/reconcile-catalog.ts`).
//
// Protección anti-catástrofe: si el set vivo es sospechosamente pequeño
// (0 items con catálogo local vivo, o < MIN_LIVE_RATIO del total local
// activo), NO se archiva nada y se reporta a Sentry — una respuesta
// coja de la API de Holded no puede archivar un catálogo entero. El
// flag `force` (one-shot manual) salta la protección cuando un humano
// ya verificó que el borrado masivo es legítimo.
//
// Reactivación: no vive aquí. Si un id reaparece en Holded, el upsert
// del sync (incremental o inicial) pone active=true y limpia
// archivedFromHoldedAt.

import type { PrismaClient } from "@mipiacetpv/db";
import {
  ApiKeyClient,
  iterateAllProducts,
  iterateAllServices,
} from "@mipiacetpv/holded-client";

import { decryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";
import { captureAlert } from "../lib/sentry.js";

// Si Holded devuelve menos del 50% de los productos locales vivos,
// asumimos respuesta coja y abortamos sin archivar.
export const MIN_LIVE_RATIO = 0.5;

// Cuántos nombres de archivados guardamos en stats para diagnóstico
// (el resto sólo cuenta). Evita inflar lastIncrementalSyncStats.
const ARCHIVED_SAMPLE_MAX = 20;

export interface ReconcileLogger {
  info: (msg: string, extra?: unknown) => void;
  warn: (msg: string, extra?: unknown) => void;
  error: (msg: string, extra?: unknown) => void;
}

export type ReconcileAbortReason =
  | "empty-live-set"
  | "live-set-below-ratio";

export interface ArchiveMissingResult {
  localActiveBefore: number;
  liveSeen: number;
  archived: number;
  // Muestra de archivados (hasta ARCHIVED_SAMPLE_MAX) para diagnóstico.
  archivedSample: Array<{ holdedProductId: string; name: string }>;
  // null = archivado aplicado. Si no, motivo del aborto defensivo.
  aborted: ReconcileAbortReason | null;
}

export interface ArchiveMissingOptions {
  // Salta la protección anti-catástrofe. SOLO para el one-shot manual
  // cuando un humano ya verificó que el borrado masivo es legítimo.
  force?: boolean;
  logger?: ReconcileLogger;
}

// Archiva todo producto local activo cuyo holdedProductId no esté en
// `liveIds`. `liveIds` debe ser el resultado de recorrer el listado
// COMPLETO de Holded (productos con forSale≠0 + servicios) — un set
// parcial archivaría catálogo vivo, de ahí la protección.
export async function archiveMissingProducts(
  prisma: PrismaClient,
  tenantId: string,
  liveIds: Set<string>,
  options: ArchiveMissingOptions = {},
): Promise<ArchiveMissingResult> {
  const log = options.logger ?? consoleLogger();
  // catalogo-local · este contador alimenta la protección anti-catástrofe
  // de abajo (`liveIds.size < localActiveBefore * MIN_LIVE_RATIO`), que
  // compara el listado VIVO de Holded contra nuestra cache DE HOLDED. Un
  // producto local no está en ninguno de los dos lados de esa
  // comparación: contarlo infla el denominador y aborta conciliaciones
  // legítimas. Un tenant con 50 fichas de Holded y 200 locales abortaría
  // siempre, y dejaría de archivar lo que Holded sí borró.
  //
  // Aviso de vocabulario: "local" en el nombre de esta variable y en los
  // comentarios de este fichero significa "en nuestra base", que es como
  // se escribió en v1.9, y NO `source = LOCAL`. Aquí chocan los dos
  // sentidos por primera vez.
  const localActiveBefore = await prisma.product.count({
    where: { tenantId, active: true, source: "HOLDED" },
  });

  const result: ArchiveMissingResult = {
    localActiveBefore,
    liveSeen: liveIds.size,
    archived: 0,
    archivedSample: [],
    aborted: null,
  };

  // Nada local vivo → nada que archivar (tenant recién creado o ya
  // conciliado a cero). No es condición de error.
  if (localActiveBefore === 0) return result;

  if (!options.force) {
    if (liveIds.size === 0) {
      result.aborted = "empty-live-set";
    } else if (liveIds.size < localActiveBefore * MIN_LIVE_RATIO) {
      result.aborted = "live-set-below-ratio";
    }
    if (result.aborted) {
      const msg =
        "conciliación de catálogo abortada: listado de Holded sospechosamente pequeño, no se archiva nada";
      log.error(msg, {
        tenantId,
        reason: result.aborted,
        liveSeen: liveIds.size,
        localActiveBefore,
      });
      captureAlert(`catalog-reconcile abortado (${result.aborted})`, {
        tenantId,
        extra: { liveSeen: liveIds.size, localActiveBefore },
      });
      return result;
    }
  }

  // Candidatos a archivar: activos que Holded ya no lista. Los leemos
  // antes del UPDATE para poder loguear una muestra con nombre.
  //
  // catalogo-local · `source: "HOLDED"` es LA PUERTA de la conciliación.
  // Un producto local no puede ser archivado por "no estar en Holded":
  // es que nunca estuvo, y archivarlo dejaría de venderlo en el TPV sin
  // que nadie hubiera hecho nada.
  //
  // El filtro es explícito y no se apoya en el `notIn`. En SQL, un
  // `holded_product_id NULL NOT IN (...)` evalúa a NULL y la fila no
  // entra — así que los locales ya quedarían fuera por accidente. Pero
  // por accidente no vale: si algún día alguien cambia ese `notIn` por
  // otra cosa, la protección desaparecería en silencio. La condición
  // dice lo que quiere decir.
  const missing = await prisma.product.findMany({
    where: {
      tenantId,
      active: true,
      source: "HOLDED",
      holdedProductId: { notIn: [...liveIds] },
    },
    select: { holdedProductId: true, name: true },
  });

  if (missing.length === 0) return result;

  const archivedAt = new Date();
  const updated = await prisma.product.updateMany({
    where: {
      tenantId,
      active: true,
      // catalogo-local · la misma puerta que en el SELECT de arriba. Van
      // las dos porque son dos consultas distintas: la de la muestra y
      // la que escribe. La que hace daño es ésta.
      source: "HOLDED",
      holdedProductId: { notIn: [...liveIds] },
    },
    data: {
      active: false,
      sellableViaTpv: false,
      archivedFromHoldedAt: archivedAt,
    },
  });
  result.archived = updated.count;
  result.archivedSample = missing
    .slice(0, ARCHIVED_SAMPLE_MAX)
    // Un HOLDED sin enlace no existe, pero el tipo lo admite desde que
    // la columna es nullable. `?? ""` mantiene la forma del log sin
    // inventar un id.
    .map((p) => ({ holdedProductId: p.holdedProductId ?? "", name: p.name }));

  log.info("conciliación: productos borrados en Holded archivados", {
    tenantId,
    archived: result.archived,
    liveSeen: liveIds.size,
    localActiveBefore,
    sample: result.archivedSample,
  });
  return result;
}

export interface RunCatalogReconcileOptions {
  tenantId: string;
  prisma: PrismaClient;
  force?: boolean;
  logger?: ReconcileLogger;
  // Inyectable para tests.
  buildClient?: (apiKey: string) => ApiKeyClient;
}

export class CatalogReconcileSkippedError extends Error {
  constructor(public reason: "no-api-key" | "initial-sync-not-done") {
    super(`catalog-reconcile skipped: ${reason}`);
    this.name = "CatalogReconcileSkippedError";
  }
}

// Pasada standalone: recorre TODO el listado de Holded para construir
// el set vivo y archiva lo que falte. No upsertea nada — para eso está
// el sync incremental. Cualquier error de listado (página rota, non-
// array, 5xx) aborta ANTES de archivar: la excepción se propaga.
export async function runCatalogReconcile(
  options: RunCatalogReconcileOptions,
): Promise<ArchiveMissingResult> {
  const { tenantId, prisma } = options;
  const log = options.logger ?? consoleLogger();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  if (!tenant.holdedApiKeyCiphertext) {
    throw new CatalogReconcileSkippedError("no-api-key");
  }
  if (tenant.initialSyncStatus !== "DONE") {
    throw new CatalogReconcileSkippedError("initial-sync-not-done");
  }

  const env = loadEnv();
  const apiKey = decryptSecret(tenant.holdedApiKeyCiphertext, env.HOLDED_KEY_ENCRYPTION_SECRET);
  const client = options.buildClient
    ? options.buildClient(apiKey)
    : new ApiKeyClient(apiKey, { baseUrl: env.HOLDED_BASE_URL });

  const liveIds = new Set<string>();
  for await (const { products } of iterateAllProducts(client)) {
    for (const p of products) {
      // Mismo criterio que el sync incremental: forSale=0 no se
      // sincroniza → tampoco cuenta como vivo para el TPV.
      if (p.forSale === 0) continue;
      liveIds.add(p.id);
    }
  }
  for await (const { services } of iterateAllServices(client)) {
    for (const s of services) liveIds.add(s.id);
  }

  return archiveMissingProducts(prisma, tenantId, liveIds, {
    force: options.force,
    logger: log,
  });
}

function consoleLogger(): ReconcileLogger {
  return {
    info: (m, e) => console.log(`[catalog-reconcile] ${m}`, e ?? ""),
    warn: (m, e) => console.warn(`[catalog-reconcile] ${m}`, e ?? ""),
    error: (m, e) => console.error(`[catalog-reconcile] ${m}`, e ?? ""),
  };
}
