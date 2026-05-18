import { Worker } from "bullmq";

import { getPrisma, getRedis } from "../context.js";
import {
  INITIAL_SYNC_QUEUE_NAME,
  type InitialSyncJob,
} from "../queues/initial-sync.js";
import { registerTenantRepeatable } from "../queues/catalog-incremental.js";
import { runInitialSync } from "../onboarding/initial-sync.js";
import { provisionTestCashier } from "../superadmin/test-cashier.js";

export function startInitialSyncWorker(): Worker<InitialSyncJob> {
  const worker = new Worker<InitialSyncJob>(
    INITIAL_SYNC_QUEUE_NAME,
    async (job) => {
      const { tenantId } = job.data;
      const prisma = getPrisma();
      const stats = await runInitialSync({ tenantId, prisma });
      // Sync inicial OK → arrancar el cron de 15 min para este tenant
      // (B2 §2.1). El jobId determinista evita duplicación si por
      // alguna razón este worker corre dos veces.
      await registerTenantRepeatable(tenantId);

      // B-OnboardingV2: si el tenant está en DRAFT, auto-provisionar
      // el cajero técnico para que el equipo mipiacetpv pueda probar
      // el TPV. Idempotente — re-provision sobre el mismo tenant es
      // seguro. Lo aislamos del flujo legacy (ACTIVE) para no tocar
      // tenants productivos.
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { onboardingState: true },
      });
      if (tenant?.onboardingState === "DRAFT") {
        try {
          await provisionTestCashier(prisma, tenantId);
        } catch (err) {
          // Que falle la provisión del cashier técnico no debe romper
          // el sync. Lo log oramos y dejamos al super-admin
          // reaprovisionar manualmente (re-sync).
          console.error(
            `[initial-sync] provisión cashier técnico falló para tenant ${tenantId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      return stats;
    },
    {
      connection: getRedis(),
      // Un job pesado a la vez por proceso para no saturar a Holded.
      concurrency: 1,
    },
  );
  worker.on("failed", (job, err) => {
    console.error(`[initial-sync] job ${job?.id} falló: ${err.message}`);
  });
  worker.on("completed", (job) => {
    console.log(`[initial-sync] job ${job.id} ok`);
  });
  return worker;
}
