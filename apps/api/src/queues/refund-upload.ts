// Cola BullMQ del worker que sube devoluciones a Holded (B4 §5.1).
// Mismo modelo que ticket-upload pero con externalId del Refund.

import { Queue } from "bullmq";

import { getRedis } from "../context.js";

export const REFUND_UPLOAD_QUEUE_NAME = "refund-upload";

export interface RefundUploadJob {
  externalId: string;
}

let _queue: Queue<RefundUploadJob> | null = null;
export function getRefundUploadQueue(): Queue<RefundUploadJob> {
  if (!_queue) {
    _queue = new Queue<RefundUploadJob>(REFUND_UPLOAD_QUEUE_NAME, {
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

export async function enqueueRefundUpload(externalId: string): Promise<void> {
  await getRefundUploadQueue().add(
    "upload-refund",
    { externalId },
    { jobId: `upload-refund-${externalId}` },
  );
}
