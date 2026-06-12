// Cola BullMQ de la conciliación diaria TPV ↔ Holded (v1.5-B Lote 4).
//
// Un único job repeatable GLOBAL (no por tenant): la pasada itera
// internamente los tenants con actividad reciente. Cron diario a la
// hora configurada por RECONCILIATION_HOUR (default 07:00) en
// Europe/Madrid. jobId determinista para que BullMQ deduplique entre
// reinicios del worker.

import { Queue } from "bullmq";

import { getRedis } from "../context.js";
import { loadEnv } from "../env.js";

export const RECONCILIATION_QUEUE_NAME = "reconciliation-daily";

export interface ReconciliationJob {
  source: "cron" | "manual";
}

const REPEATABLE_JOB_ID = "reconciliation-daily";

let _queue: Queue<ReconciliationJob> | null = null;
export function getReconciliationQueue(): Queue<ReconciliationJob> {
  if (!_queue) {
    _queue = new Queue<ReconciliationJob>(RECONCILIATION_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 1, // La ventana es de 48h: la pasada de mañana cubre
        // cualquier fallo de hoy. Reintentar sólo duplicaría GETs.
        removeOnComplete: 30,
        removeOnFail: 30,
      },
    });
  }
  return _queue;
}

export function reconciliationCronPattern(): string {
  const env = loadEnv();
  return `0 ${env.RECONCILIATION_HOUR} * * *`;
}

export async function registerReconciliationRepeatable(): Promise<void> {
  const queue = getReconciliationQueue();
  await queue.add(
    "reconciliation-daily",
    { source: "cron" },
    {
      repeat: { pattern: reconciliationCronPattern(), tz: "Europe/Madrid" },
      jobId: REPEATABLE_JOB_ID,
    },
  );
}
