// Cola BullMQ para el job de sync inicial. Una sola cola, jobs por
// tenant. El worker (apps/api/src/workers/initial-sync-worker.ts) la
// consume — puede correr en el mismo proceso del API o en un proceso
// dedicado vía `pnpm --filter @mipiacetpv/api worker:dev`.

import { Queue } from "bullmq";

import { getRedis } from "../context.js";

export const INITIAL_SYNC_QUEUE_NAME = "initial-sync";

export interface InitialSyncJob {
  tenantId: string;
}

let _queue: Queue<InitialSyncJob> | null = null;
export function getInitialSyncQueue(): Queue<InitialSyncJob> {
  if (!_queue) {
    _queue = new Queue<InitialSyncJob>(INITIAL_SYNC_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 1, // El job ya es idempotente (upserts). Si falla, el
        // propietario lo redispara desde el admin (botón en B2).
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    });
  }
  return _queue;
}

export async function enqueueInitialSync(tenantId: string): Promise<void> {
  await getInitialSyncQueue().add(
    "initial-sync",
    { tenantId },
    { jobId: `tenant-${tenantId}` }, // jobId único por tenant => evita doble cola.
  );
}
