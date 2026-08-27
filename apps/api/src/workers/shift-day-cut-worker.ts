// v1.11-cierre-de-dia · worker del corte de día. Concurrency 1: una sola
// pasada a la vez para no cerrar dos veces el mismo turno si el cron se
// solapa con un disparo manual.

import { Worker } from "bullmq";

import { getPrisma, getRedis } from "../context.js";
import { captureError } from "../lib/sentry.js";
import { runDayCutPass } from "../shift/day-cut-pass.js";
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
      // v1.13 · la pasada entera vive en `runDayCutPass`: cerrar los
      // turnos que cruzaron el corte y, detrás, soltar las mesas que se
      // quedaron ocupadas con un DRAFT vacío (v1.12-B). El worker ya no
      // compone nada — así el e2e puede ejecutar exactamente la misma
      // pasada sin levantar Redis, y desconectar el barrido pone la
      // suite roja en vez de pasar desapercibido durante semanas.
      const pass = await runDayCutPass({ prisma: getPrisma(), log });
      if (pass.tablesError) {
        const err = pass.tablesError;
        captureError(err instanceof Error ? err : new Error(String(err)), {
          extra: { queue: SHIFT_DAY_CUT_QUEUE_NAME, step: "abandoned-tables" },
        });
      }
      return {
        source: job.data.source,
        scanned: pass.shifts.scanned,
        closed: pass.shifts.closed.length,
        failed: pass.shifts.failed,
        tablesReleased: pass.tables?.released.length ?? 0,
        tablesKeptWithLines: pass.tables?.keptWithLines ?? 0,
        tablesFailed: pass.tables?.failed ?? 0,
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
