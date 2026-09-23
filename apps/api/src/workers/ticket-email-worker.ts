// Worker BullMQ del envío de tickets por email (B-Print fase 1).
//
// Concurrency 2: el PDF se genera local (fast) + SMTP I/O bound.
// Si tras 3 attempts el job sigue rojo, queda en estado TERMINAL: la
// fila pasa a FAILED con el motivo y el ticket queda marcado con
// `emailFailedAt`. Lo enseñan el histórico del TPV (que es donde trabaja
// la peluquería) y el resumen del panel.

import { Worker } from "bullmq";

import { getPrisma, getRedis } from "../context.js";
import { TICKET_EMAIL_QUEUE_NAME, type TicketEmailJob } from "../queues/ticket-email.js";
import { markFailed, sendTicketEmail } from "../tickets/send-ticket-email.js";

const MAX_ATTEMPTS = 3;

export function startTicketEmailWorker(): Worker<TicketEmailJob> {
  const worker = new Worker<TicketEmailJob>(
    TICKET_EMAIL_QUEUE_NAME,
    async (job) => {
      const prisma = getPrisma();
      return await sendTicketEmail({ emailJobId: job.data.emailJobId, prisma });
    },
    { connection: getRedis(), concurrency: 2 },
  );
  worker.on("completed", (job) => {
    console.log(`[ticket-email] job ${job.id} ok`);
  });
  worker.on("failed", async (job, err) => {
    console.error(`[ticket-email] job ${job?.id} falló: ${err.message}`);
    // Sole (23-09-2026) · un job que agota sus intentos queda en estado
    // TERMINAL, no en PENDING.
    //
    // Antes de este bloque aquí sólo se escribía `Ticket.email_failed_at`
    // y la fila de `ticket_email_jobs` se quedaba en PENDING para
    // siempre: el envío del 000257 llevaba seis días diciendo
    // "pendiente" sobre algo que había fallado tres veces la primera
    // tarde. Y la única huella del fallo era la marca del ticket, que
    // no la enseñaba ninguna pantalla que viera nadie de la peluquería.
    //
    // Ahora se escriben las dos cosas, y el motivo va con ellas para que
    // el histórico del TPV pueda decir POR QUÉ en lenguaje de persona
    // (`email-status.ts` lo traduce).
    if (job && job.attemptsMade >= MAX_ATTEMPTS) {
      try {
        const prisma = getPrisma();
        await markFailed(prisma, job.data.emailJobId, "send_failed", {
          message: err.message,
          attempts: job.attemptsMade,
        });
      } catch (markErr) {
        console.error(
          `[ticket-email] no pude marcar el fallo del envío: ${
            markErr instanceof Error ? markErr.message : String(markErr)
          }`,
        );
      }
    }
  });
  return worker;
}
