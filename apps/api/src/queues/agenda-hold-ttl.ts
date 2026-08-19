// Cola BullMQ del TTL de holds de la agenda (B-reservas-4, ADR-R8 §4).
//
// Un único job repeatable GLOBAL (no por tenant): la pasada libera todos los
// holds PENDING vencidos (pending_until < now) marcándolos CANCELLED e
// inactivando sus assignments → el hueco vuelve a estar libre. La carrera de
// reserva la resuelve el GiST en el INSERT; este job sólo hace la limpieza
// diferida de los holds que nunca se confirmaron. Cron cada minuto.

import { Queue } from "bullmq";

import { getRedis } from "../context.js";

export const AGENDA_HOLD_TTL_QUEUE_NAME = "agenda-hold-ttl";

export interface AgendaHoldTtlJob {
  source: "cron" | "manual";
}

const REPEATABLE_JOB_ID = "agenda-hold-ttl";

let _queue: Queue<AgendaHoldTtlJob> | null = null;
export function getAgendaHoldTtlQueue(): Queue<AgendaHoldTtlJob> {
  if (!_queue) {
    _queue = new Queue<AgendaHoldTtlJob>(AGENDA_HOLD_TTL_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 1, // la pasada del minuto siguiente cubre cualquier fallo.
        removeOnComplete: 30,
        removeOnFail: 30,
      },
    });
  }
  return _queue;
}

export async function registerAgendaHoldTtlRepeatable(): Promise<void> {
  const queue = getAgendaHoldTtlQueue();
  await queue.add(
    "agenda-hold-ttl",
    { source: "cron" },
    {
      // Cada minuto: los holds tienen TTL de ~10 min, granularidad de sobra.
      repeat: { pattern: "* * * * *", tz: "Europe/Madrid" },
      jobId: REPEATABLE_JOB_ID,
    },
  );
}
