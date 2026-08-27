// v1.11-cierre-de-dia · worker del corte de día. Concurrency 1: una sola
// pasada a la vez para no cerrar dos veces el mismo turno si el cron se
// solapa con un disparo manual.

import { Worker } from "bullmq";

import { getPrisma, getRedis } from "../context.js";
import { captureError } from "../lib/sentry.js";
import { runShiftDayCut } from "../shift/day-cut-run.js";
import {
  SHIFT_DAY_CUT_QUEUE_NAME,
  type ShiftDayCutJob,
} from "../queues/shift-day-cut.js";

export function startShiftDayCutWorker(): Worker<ShiftDayCutJob> {
  const worker = new Worker<ShiftDayCutJob>(
    SHIFT_DAY_CUT_QUEUE_NAME,
    async (job) => {
      const result = await runShiftDayCut({
        prisma: getPrisma(),
        log: {
          info: (obj, msg) => console.log(`[shift-day-cut] ${msg}`, obj),
          error: (obj, msg) => console.error(`[shift-day-cut] ${msg ?? ""}`, obj),
        },
      });
      return {
        source: job.data.source,
        scanned: result.scanned,
        closed: result.closed.length,
        failed: result.failed,
      };
    },
    { connection: getRedis(), concurrency: 1 },
  );
  worker.on("completed", (job) => {
    const r = job.returnvalue as { closed?: number; failed?: number } | undefined;
    if ((r?.closed ?? 0) > 0 || (r?.failed ?? 0) > 0) {
      console.log(
        `[shift-day-cut] ${r?.closed ?? 0} turno(s) cerrados por corte de día, ${r?.failed ?? 0} fallidos`,
      );
    }
  });
  worker.on("failed", (job, err) => {
    console.error(`[shift-day-cut] job ${job?.id} falló: ${err.message}`);
    captureError(err, {
      extra: { queue: SHIFT_DAY_CUT_QUEUE_NAME, jobId: job?.id },
    });
  });
  return worker;
}
