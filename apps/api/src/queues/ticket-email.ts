// Cola BullMQ del worker que reenvía el PDF de Holded por email
// (B4 §4). El job lleva sólo el id del TicketEmailJob — el worker
// recarga ticket y destinatario desde BD.

import { Queue } from "bullmq";

import { getRedis } from "../context.js";

export const TICKET_EMAIL_QUEUE_NAME = "ticket-email";

export interface TicketEmailJob {
  emailJobId: string;
}

let _queue: Queue<TicketEmailJob> | null = null;
export function getTicketEmailQueue(): Queue<TicketEmailJob> {
  if (!_queue) {
    _queue = new Queue<TicketEmailJob>(TICKET_EMAIL_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        // B-Print fase 1: 3 reintentos con backoff exponencial. Si tras
        // el 3º sigue rojo, el worker marca Ticket.emailFailedAt para
        // que admin lo vea en bandeja.
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }
  return _queue;
}

export async function enqueueTicketEmail(emailJobId: string): Promise<void> {
  await getTicketEmailQueue().add(
    "send-ticket-email",
    { emailJobId },
    { jobId: `email-${emailJobId}` },
  );
}
