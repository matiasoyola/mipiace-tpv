// Worker BullMQ del envío de tickets por email (B4 §4). Concurrency
// 2: descargas PDF de Holded + SMTP. Si el ticket no está SYNCED
// todavía, el worker devuelve `deferred` — no re-encolamos
// automáticamente; al pasar a SYNCED, el ticket-upload-worker dispara
// el email.

import { Worker } from "bullmq";

import { getPrisma, getRedis } from "../context.js";
import { TICKET_EMAIL_QUEUE_NAME, type TicketEmailJob } from "../queues/ticket-email.js";
import { sendTicketEmail } from "../tickets/send-ticket-email.js";

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
  worker.on("failed", (job, err) => {
    console.error(`[ticket-email] job ${job?.id} falló: ${err.message}`);
  });
  return worker;
}
