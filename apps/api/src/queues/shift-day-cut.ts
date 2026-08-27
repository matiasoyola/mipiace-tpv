// v1.11-cierre-de-dia · cola BullMQ del corte de día.
//
// Un único job repeatable GLOBAL (no por tenant): la pasada itera los
// turnos abiertos y compara cada uno con la hora de corte de SU tenant
// (`Tenant.dayCutHour`). Mismo patrón que `reconciliation` y
// `agenda-hold-ttl` — ADR-005.
//
// Cron HORARIO en punto, con `tz: Europe/Madrid`: `dayCutHour` es una
// hora entera, así que una pasada por hora local basta para que todos
// los tenants tengan su corte servido con precisión de minutos. La `tz`
// del repeat es lo que hace que el corte siga siendo local en el cambio
// de hora (CET/CEST) sin que el job tenga que saber nada.
//
// `attempts: 1` — la pasada de la hora siguiente cubre cualquier fallo,
// y `runShiftDayCut` ya aísla el fallo de un turno de los demás.

import { Queue } from "bullmq";

import { getRedis } from "../context.js";

export const SHIFT_DAY_CUT_QUEUE_NAME = "shift-day-cut";

export interface ShiftDayCutJob {
  source: "cron" | "manual";
}

const REPEATABLE_JOB_ID = "shift-day-cut";

let _queue: Queue<ShiftDayCutJob> | null = null;
export function getShiftDayCutQueue(): Queue<ShiftDayCutJob> {
  if (!_queue) {
    _queue = new Queue<ShiftDayCutJob>(SHIFT_DAY_CUT_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 30,
        removeOnFail: 30,
      },
    });
  }
  return _queue;
}

export async function registerShiftDayCutRepeatable(): Promise<void> {
  const queue = getShiftDayCutQueue();
  await queue.add(
    "shift-day-cut",
    { source: "cron" },
    {
      repeat: { pattern: "0 * * * *", tz: "Europe/Madrid" },
      jobId: REPEATABLE_JOB_ID,
    },
  );
}
