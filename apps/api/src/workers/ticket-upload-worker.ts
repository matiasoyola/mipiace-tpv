// Worker BullMQ del upload de tickets a Holded (B4 §1.3). Concurrency
// 2 por proceso para no comernos rate limits de Holded en piloto. Si
// hace falta más, se sube vía env TICKET_UPLOAD_CONCURRENCY.

import { Worker } from "bullmq";

import { getPrisma, getRedis } from "../context.js";
import { captureError } from "../lib/sentry.js";
import { TICKET_UPLOAD_QUEUE_NAME, type TicketUploadJob } from "../queues/ticket-upload.js";
import { uploadTicket } from "../tickets/upload-ticket.js";

const DEFAULT_CONCURRENCY = 2;

export function startTicketUploadWorker(): Worker<TicketUploadJob> {
  const concurrency = Number(process.env.TICKET_UPLOAD_CONCURRENCY ?? DEFAULT_CONCURRENCY);
  const worker = new Worker<TicketUploadJob>(
    TICKET_UPLOAD_QUEUE_NAME,
    async (job) => {
      const prisma = getPrisma();
      const result = await uploadTicket({ externalId: job.data.externalId, prisma });
      return result;
    },
    {
      connection: getRedis(),
      concurrency: Math.max(1, Math.min(8, concurrency)),
    },
  );
  worker.on("completed", (job) => {
    console.log(`[ticket-upload] job ${job.id} ok`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[ticket-upload] job ${job?.id} falló: ${err.message}`);
    // Sentry (v1.5-B Lote 2): un upload que agota reintentos es dinero
    // sin contabilizar — alertable. No-op sin SENTRY_DSN.
    captureError(err, {
      extra: { queue: "ticket-upload", jobId: job?.id, externalId: job?.data.externalId },
    });
  });
  return worker;
}
