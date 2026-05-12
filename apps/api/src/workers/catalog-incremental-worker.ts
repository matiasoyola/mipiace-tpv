// Worker BullMQ del sync incremental de catálogo (B2 §2). Concurrency 1:
// un sync por proceso a la vez para no saturar la API de Holded. Si
// llegan dos jobs del mismo tenant a la vez (cron + manual), BullMQ los
// secuencia y la idempotencia del runner garantiza no-op en la segunda
// pasada.
//
// Al arrancar, si el worker corre embedded en `apps/api`, escaneamos
// tenants con `initialSyncStatus = DONE` y registramos sus repeatables.
// Eso garantiza que tras un restart del proceso siguen disparándose los
// crons sin esperar al siguiente onboarding.

import { Worker } from "bullmq";

import { getPrisma, getRedis } from "../context.js";
import {
  CATALOG_INCREMENTAL_QUEUE_NAME,
  registerTenantRepeatable,
  type CatalogIncrementalJob,
} from "../queues/catalog-incremental.js";
import {
  IncrementalSyncSkippedError,
  runIncrementalSync,
} from "../catalog/incremental-sync.js";

export function startCatalogIncrementalWorker(): Worker<CatalogIncrementalJob> {
  const worker = new Worker<CatalogIncrementalJob>(
    CATALOG_INCREMENTAL_QUEUE_NAME,
    async (job) => {
      const { tenantId, source } = job.data;
      const prisma = getPrisma();
      try {
        const stats = await runIncrementalSync({ tenantId, prisma });
        return { source, ...stats };
      } catch (err) {
        if (err instanceof IncrementalSyncSkippedError) {
          // Skip silencioso (tenant sin onboarding completo). No
          // queremos espamar el log de errores con esto.
          console.log(`[catalog-incremental] skip ${tenantId} (${err.reason})`);
          return { source, skipped: err.reason };
        }
        throw err;
      }
    },
    {
      connection: getRedis(),
      concurrency: 1,
    },
  );
  worker.on("failed", (job, err) => {
    console.error(`[catalog-incremental] job ${job?.id} falló: ${err.message}`);
  });
  worker.on("completed", (job) => {
    const tag = job.data.source === "manual" ? "manual" : "cron";
    console.log(`[catalog-incremental] job ${job.id} (${tag}) ok`);
  });
  return worker;
}

// Re-registra los repeatables de tenants ya onboardeados. Idempotente:
// BullMQ usa el jobId determinista para deduplicar (ver queues/catalog-incremental.ts).
export async function registerAllExistingRepeatables(): Promise<number> {
  const prisma = getPrisma();
  const tenants = await prisma.tenant.findMany({
    where: { initialSyncStatus: "DONE", holdedApiKeyCiphertext: { not: null } },
    select: { id: true },
  });
  for (const t of tenants) {
    await registerTenantRepeatable(t.id);
  }
  return tenants.length;
}
