// Worker BullMQ de la conciliación diaria (v1.5-consistencia-B Lote 4).
// Concurrency 1: una sola pasada a la vez (itera tenants internamente
// y ya throttlea los GETs a Holded).

import { Worker } from "bullmq";

import { getPrisma, getRedis } from "../context.js";
import { captureError } from "../lib/sentry.js";
import {
  RECONCILIATION_QUEUE_NAME,
  type ReconciliationJob,
} from "../queues/reconciliation.js";
import { runDailyReconciliation } from "../tickets/reconciliation.js";

export function startReconciliationWorker(): Worker<ReconciliationJob> {
  const worker = new Worker<ReconciliationJob>(
    RECONCILIATION_QUEUE_NAME,
    async (job) => {
      const prisma = getPrisma();
      const summary = await runDailyReconciliation({ prisma });
      return { source: job.data.source, ...summary };
    },
    { connection: getRedis(), concurrency: 1 },
  );
  worker.on("completed", (job) => {
    console.log(`[reconciliation] job ${job.id} ok`, job.returnvalue ?? "");
  });
  worker.on("failed", (job, err) => {
    console.error(`[reconciliation] job ${job?.id} falló: ${err.message}`);
    captureError(err, { extra: { queue: RECONCILIATION_QUEUE_NAME, jobId: job?.id } });
  });
  return worker;
}
