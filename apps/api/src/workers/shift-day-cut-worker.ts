// v1.11-cierre-de-dia · worker del corte de día. Concurrency 1: una sola
// pasada a la vez para no cerrar dos veces el mismo turno si el cron se
// solapa con un disparo manual.

import { Worker } from "bullmq";

import { getPrisma, getRedis } from "../context.js";
import { captureError } from "../lib/sentry.js";
import { runShiftDayCut } from "../shift/day-cut-run.js";
import { runAbandonedTableSweep } from "../tables/abandoned.js";
import {
  SHIFT_DAY_CUT_QUEUE_NAME,
  type ShiftDayCutJob,
} from "../queues/shift-day-cut.js";

export function startShiftDayCutWorker(): Worker<ShiftDayCutJob> {
  const worker = new Worker<ShiftDayCutJob>(
    SHIFT_DAY_CUT_QUEUE_NAME,
    async (job) => {
      const log = {
        info: (obj: object, msg: string) =>
          console.log(`[shift-day-cut] ${msg}`, obj),
        error: (obj: unknown, msg?: string) =>
          console.error(`[shift-day-cut] ${msg ?? ""}`, obj),
      };
      const result = await runShiftDayCut({ prisma: getPrisma(), log });
      // v1.12-mesas-abandonadas · el mismo job, una capa más abajo: tras
      // cerrar los turnos que cruzaron el corte, soltamos las mesas que
      // se quedaron ocupadas con un DRAFT vacío. Va DESPUÉS a propósito
      // —la caja primero— y aislado: si el barrido peta, los turnos ya
      // están cerrados.
      let sweep = { released: 0, keptWithLines: 0, failed: 0 };
      try {
        const swept = await runAbandonedTableSweep({ prisma: getPrisma(), log });
        sweep = {
          released: swept.released.length,
          keptWithLines: swept.keptWithLines,
          failed: swept.failed,
        };
      } catch (err) {
        console.error("[shift-day-cut] barrido de mesas abandonadas falló", err);
        captureError(err instanceof Error ? err : new Error(String(err)), {
          extra: { queue: SHIFT_DAY_CUT_QUEUE_NAME, step: "abandoned-tables" },
        });
      }
      return {
        source: job.data.source,
        scanned: result.scanned,
        closed: result.closed.length,
        failed: result.failed,
        tablesReleased: sweep.released,
        tablesKeptWithLines: sweep.keptWithLines,
        tablesFailed: sweep.failed,
      };
    },
    { connection: getRedis(), concurrency: 1 },
  );
  worker.on("completed", (job) => {
    const r = job.returnvalue as
      | { closed?: number; failed?: number; tablesReleased?: number }
      | undefined;
    if ((r?.closed ?? 0) > 0 || (r?.failed ?? 0) > 0) {
      console.log(
        `[shift-day-cut] ${r?.closed ?? 0} turno(s) cerrados por corte de día, ${r?.failed ?? 0} fallidos`,
      );
    }
    if ((r?.tablesReleased ?? 0) > 0) {
      console.log(
        `[shift-day-cut] ${r?.tablesReleased} mesa(s) liberadas (draft vacío de antes del corte)`,
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
