// Sweeper de HoldedUpload huérfanos (v1.5-consistencia-A §3.b).
//
// `enqueueTicketUpload`/`enqueueRefundUpload` se llaman FUERA de la
// transacción que crea el ticket/refund (diseño correcto: no queremos
// abortar la venta si Redis está caído). El coste es que si Redis falla
// justo en ese instante, la fila HoldedUpload queda PENDING para
// siempre — el error sólo se loguea. Este sweeper es la red de
// seguridad: cada 5 min busca uploads PENDING con más de 10 min de
// antigüedad cuyo job ya no exista en la cola y los re-encola.
//
// Idempotencia: usa el MISMO jobId determinista que el encolado normal
// (`upload-ticket-<externalId>` / `upload-refund-<externalId>`), así
// BullMQ deduplica si el job sigue vivo. Si el job existe pero está en
// estado terminal (completed/failed) y la fila sigue PENDING, se
// elimina el job zombi y se re-encola — sin eso, `add` con el mismo
// jobId sería un no-op silencioso.

import { getPrisma } from "../context.js";
import { getTicketUploadQueue } from "../queues/ticket-upload.js";
import { getRefundUploadQueue } from "../queues/refund-upload.js";

const STALE_AFTER_MS = 10 * 60 * 1000;
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// Subconjunto de la API de BullMQ Queue/Job que usa el sweeper —
// permite inyectar fakes en tests sin Redis.
export interface SweeperJob {
  getState(): Promise<string>;
  remove(): Promise<void>;
}
export interface SweeperQueue {
  getJob(jobId: string): Promise<SweeperJob | null | undefined>;
  add(
    name: string,
    data: { externalId: string },
    opts: { jobId: string },
  ): Promise<unknown>;
}

interface PendingUploadRow {
  externalId: string;
  kind: "TICKET" | "REFUND";
}

export interface SweeperDeps {
  prisma?: {
    holdedUpload: {
      findMany(args: unknown): Promise<PendingUploadRow[]>;
    };
  };
  ticketQueue?: SweeperQueue;
  refundQueue?: SweeperQueue;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  now?: Date;
}

export interface SweepResult {
  scanned: number;
  rescued: number;
  errors: number;
}

const TERMINAL_JOB_STATES = new Set(["completed", "failed"]);

export async function sweepOrphanUploads(deps: SweeperDeps = {}): Promise<SweepResult> {
  const prisma = deps.prisma ?? (getPrisma() as unknown as NonNullable<SweeperDeps["prisma"]>);
  const ticketQueue = deps.ticketQueue ?? (getTicketUploadQueue() as unknown as SweeperQueue);
  const refundQueue = deps.refundQueue ?? (getRefundUploadQueue() as unknown as SweeperQueue);
  const log = deps.log ?? ((msg, extra) => console.log(`[upload-sweeper] ${msg}`, extra ?? ""));
  const now = deps.now ?? new Date();

  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  const pending = await prisma.holdedUpload.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    select: { externalId: true, kind: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  const result: SweepResult = { scanned: pending.length, rescued: 0, errors: 0 };
  for (const row of pending) {
    const isTicket = row.kind === "TICKET";
    const queue = isTicket ? ticketQueue : refundQueue;
    const jobName = isTicket ? "upload-ticket" : "upload-refund";
    const jobId = `${jobName}-${row.externalId}`;
    try {
      const job = await queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (!TERMINAL_JOB_STATES.has(state)) {
          // Job vivo (waiting/active/delayed) — BullMQ se encarga.
          continue;
        }
        // Job terminal pero la fila sigue PENDING → job zombi. Hay que
        // borrarlo para que el `add` con el mismo jobId no sea no-op.
        await job.remove();
      }
      await queue.add(jobName, { externalId: row.externalId }, { jobId });
      result.rescued += 1;
    } catch (err) {
      result.errors += 1;
      log("error rescatando upload", {
        externalId: row.externalId,
        kind: row.kind,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.rescued > 0 || result.errors > 0) {
    // rescued > 0 es señal de que el encolado inline falló en algún
    // momento (Redis caído al cobrar) — alertable en v1.5-B.
    log("pasada completada", result as unknown as Record<string, unknown>);
  }
  return result;
}

export function startUploadSweeper(): { stop(): void } {
  const timer = setInterval(() => {
    void sweepOrphanUploads().catch((err) => {
      console.error("[upload-sweeper] pasada falló", err);
    });
  }, SWEEP_INTERVAL_MS);
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
