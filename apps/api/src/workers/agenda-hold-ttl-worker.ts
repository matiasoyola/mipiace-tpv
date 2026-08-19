// Worker BullMQ del TTL de holds de la agenda (B-reservas-4). Concurrency 1:
// una sola pasada a la vez (un UPDATE masivo por id).

import { Worker } from "bullmq";

import { getPrisma, getRedis } from "../context.js";
import { captureError } from "../lib/sentry.js";
import { createAgendaStore } from "../agenda/store.js";
import {
  AGENDA_HOLD_TTL_QUEUE_NAME,
  type AgendaHoldTtlJob,
} from "../queues/agenda-hold-ttl.js";

export function startAgendaHoldTtlWorker(): Worker<AgendaHoldTtlJob> {
  const worker = new Worker<AgendaHoldTtlJob>(
    AGENDA_HOLD_TTL_QUEUE_NAME,
    async (job) => {
      const store = createAgendaStore(getPrisma());
      const freed = await store.expireHolds(new Date());
      return { source: job.data.source, freed };
    },
    { connection: getRedis(), concurrency: 1 },
  );
  worker.on("completed", (job) => {
    const freed = (job.returnvalue as { freed?: number } | undefined)?.freed ?? 0;
    if (freed > 0) console.log(`[agenda-hold-ttl] liberados ${freed} holds`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[agenda-hold-ttl] job ${job?.id} falló: ${err.message}`);
    captureError(err, {
      extra: { queue: AGENDA_HOLD_TTL_QUEUE_NAME, jobId: job?.id },
    });
  });
  return worker;
}
