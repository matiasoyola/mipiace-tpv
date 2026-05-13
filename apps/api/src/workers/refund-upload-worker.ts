// Worker BullMQ del upload de devoluciones (B4 §5.1). Concurrency 1
// para no enredarse con el ticket-upload-worker — los volúmenes son
// pequeños, no hace falta paralelismo.

import { Worker } from "bullmq";

import { getPrisma, getRedis } from "../context.js";
import { REFUND_UPLOAD_QUEUE_NAME, type RefundUploadJob } from "../queues/refund-upload.js";
import { uploadRefund } from "../tickets/upload-refund.js";

export function startRefundUploadWorker(): Worker<RefundUploadJob> {
  const worker = new Worker<RefundUploadJob>(
    REFUND_UPLOAD_QUEUE_NAME,
    async (job) => {
      const prisma = getPrisma();
      return await uploadRefund({ externalId: job.data.externalId, prisma });
    },
    { connection: getRedis(), concurrency: 1 },
  );
  worker.on("completed", (job) => {
    console.log(`[refund-upload] job ${job.id} ok`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[refund-upload] job ${job?.id} falló: ${err.message}`);
  });
  return worker;
}
