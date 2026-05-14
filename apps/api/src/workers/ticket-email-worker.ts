// Worker BullMQ del envío de tickets por email (B-Print fase 1).
//
// Concurrency 2: el PDF se genera local (fast) + SMTP I/O bound.
// Si tras 3 attempts el job sigue rojo, marcamos `Ticket.emailFailedAt`
// para que la bandeja admin lo muestre como "email no entregado".

import { Worker } from "bullmq";

import { getPrisma, getRedis } from "../context.js";
import { TICKET_EMAIL_QUEUE_NAME, type TicketEmailJob } from "../queues/ticket-email.js";
import { sendTicketEmail } from "../tickets/send-ticket-email.js";

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
    // Tras agotar reintentos, marcamos el ticket para que admin lo vea.
    if (job && job.attemptsMade >= MAX_ATTEMPTS) {
      try {
        const prisma = getPrisma();
        const emailJob = await prisma.ticketEmailJob.findUnique({
          where: { id: job.data.emailJobId },
          select: { ticketId: true },
        });
        if (emailJob) {
          await prisma.ticket.update({
            where: { id: emailJob.ticketId },
            data: { emailFailedAt: new Date() },
          });
        }
      } catch (markErr) {
        console.error(
          `[ticket-email] no pude marcar emailFailedAt: ${
            markErr instanceof Error ? markErr.message : String(markErr)
          }`,
        );
      }
    }
  });
  return worker;
}
