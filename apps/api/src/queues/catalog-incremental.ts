// Cola BullMQ del sync incremental de catálogo (B2 §2). Una sola cola,
// jobs por tenant. Dos modos de encolado:
//
//   1. `registerTenantRepeatable(tenantId)` — añade un job repeatable
//      con `every: 900_000` (15 min). jobId determinista
//      `incr-<tenantId>` para que BullMQ no duplique entre cron y
//      endpoint manual.
//   2. `enqueueManualSync(tenantId)` — añade un job one-shot con
//      prioridad alta (lo dispara `POST /catalog/sync-now`). Devuelve
//      el jobId para que el admin haga polling.
//
// El worker tiene `concurrency: 1`, así que si llegan dos jobs del
// mismo tenant uno detrás del otro se ejecutan secuencialmente. Los
// upserts son idempotentes, así que el segundo es no-op funcional.

import { Queue, type JobsOptions } from "bullmq";

import { getRedis } from "../context.js";

export const CATALOG_INCREMENTAL_QUEUE_NAME = "catalog-incremental";

export interface CatalogIncrementalJob {
  tenantId: string;
  // "cron": disparado por el repeatable cada 15 min.
  // "manual": disparado por POST /catalog/sync-now (prioridad alta).
  source: "cron" | "manual";
}

const REPEAT_EVERY_MS = 15 * 60 * 1000; // 900 000

let _queue: Queue<CatalogIncrementalJob> | null = null;
export function getCatalogIncrementalQueue(): Queue<CatalogIncrementalJob> {
  if (!_queue) {
    _queue = new Queue<CatalogIncrementalJob>(CATALOG_INCREMENTAL_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 1, // Idempotente vía upserts; si falla, el siguiente
        // tick lo recoge. Reintentar inmediato sólo añade ruido.
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return _queue;
}

// jobId determinista por tenant. Tanto repeatable como manual usan
// este prefijo para asegurar que sólo haya un job pendiente por tenant
// en cualquier momento (BullMQ deduplica por jobId si ya existe).
function repeatableJobId(tenantId: string): string {
  return `incr-${tenantId}`;
}

function manualJobId(tenantId: string): string {
  // Manual permite múltiples encolados (cada vez que pulses
  // "Sincronizar ahora"). Usamos timestamp para que sean distintos.
  return `incr-${tenantId}-manual-${Date.now()}`;
}

export async function registerTenantRepeatable(tenantId: string): Promise<void> {
  const queue = getCatalogIncrementalQueue();
  const opts: JobsOptions = {
    repeat: { every: REPEAT_EVERY_MS },
    jobId: repeatableJobId(tenantId),
  };
  await queue.add("catalog-incremental", { tenantId, source: "cron" }, opts);
}

export async function unregisterTenantRepeatable(tenantId: string): Promise<void> {
  const queue = getCatalogIncrementalQueue();
  // BullMQ requiere los mismos opts.repeat para identificar el job.
  await queue.removeRepeatable(
    "catalog-incremental",
    { every: REPEAT_EVERY_MS },
    repeatableJobId(tenantId),
  );
}

export interface EnqueueManualResult {
  jobId: string;
}

export async function enqueueManualSync(tenantId: string): Promise<EnqueueManualResult> {
  const jobId = manualJobId(tenantId);
  await getCatalogIncrementalQueue().add(
    "catalog-incremental",
    { tenantId, source: "manual" },
    {
      jobId,
      priority: 1, // Prioridad alta (1 = más alta en BullMQ).
    },
  );
  return { jobId };
}
