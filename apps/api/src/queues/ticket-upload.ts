// Cola BullMQ del worker que sube tickets a Holded (B4 §1.3). Una sola
// cola, jobs identificados por externalId. JobId determinista:
// `upload-ticket-<externalId>` evita encolar el mismo dos veces.
//
// Retries: el worker decide qué error es reintentable y propaga la
// excepción para que BullMQ encole el siguiente intento con backoff
// exponencial. attempts=5, delay base 30 s, exponencial.

import { Queue } from "bullmq";

import { getRedis } from "../context.js";

export const TICKET_UPLOAD_QUEUE_NAME = "ticket-upload";

export interface TicketUploadJob {
  externalId: string;
}

let _queue: Queue<TicketUploadJob> | null = null;
export function getTicketUploadQueue(): Queue<TicketUploadJob> {
  if (!_queue) {
    _queue = new Queue<TicketUploadJob>(TICKET_UPLOAD_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }
  return _queue;
}

export async function enqueueTicketUpload(externalId: string): Promise<void> {
  await getTicketUploadQueue().add(
    "upload-ticket",
    { externalId },
    { jobId: `upload-ticket-${externalId}` },
  );
}
