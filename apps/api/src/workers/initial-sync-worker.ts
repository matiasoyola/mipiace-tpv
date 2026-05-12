import { Worker } from "bullmq";

import { getPrisma, getRedis } from "../context.js";
import {
  INITIAL_SYNC_QUEUE_NAME,
  type InitialSyncJob,
} from "../queues/initial-sync.js";
import { runInitialSync } from "../onboarding/initial-sync.js";

export function startInitialSyncWorker(): Worker<InitialSyncJob> {
  const worker = new Worker<InitialSyncJob>(
    INITIAL_SYNC_QUEUE_NAME,
    async (job) => {
      const { tenantId } = job.data;
      const prisma = getPrisma();
      const stats = await runInitialSync({ tenantId, prisma });
      return stats;
    },
    {
      connection: getRedis(),
      // Un job pesado a la vez por proceso para no saturar a Holded.
      concurrency: 1,
    },
  );
  worker.on("failed", (job, err) => {
    console.error(`[initial-sync] job ${job?.id} falló: ${err.message}`);
  });
  worker.on("completed", (job) => {
    console.log(`[initial-sync] job ${job.id} ok`);
  });
  return worker;
}
