// Bootstrap del proceso de workers — sin Fastify. Útil cuando en
// producción los workers corren en un contenedor distinto del API.
//
// En desarrollo, server.ts puede arrancar el worker en el mismo proceso
// con `startInitialSyncWorker()`.

import "dotenv/config";

import { loadEnv } from "../env.js";
import { initSentry } from "../lib/sentry.js";
import { startInitialSyncWorker } from "./initial-sync-worker.js";
import {
  registerAllExistingRepeatables,
  startCatalogIncrementalWorker,
} from "./catalog-incremental-worker.js";
import { startTicketUploadWorker } from "./ticket-upload-worker.js";
import { startRefundUploadWorker } from "./refund-upload-worker.js";
import { startTicketEmailWorker } from "./ticket-email-worker.js";
import { startImageCacheWorker } from "./image-cache-worker.js";
import { startContactImportWorker } from "./contact-import-worker.js";
import { startReconciliationWorker } from "./reconciliation-worker.js";
import { startUploadSweeper } from "./upload-sweeper.js";
import { startWorkerHeartbeat } from "./heartbeat.js";
import { registerReconciliationRepeatable } from "../queues/reconciliation.js";

async function main() {
  loadEnv();
  // Sentry (v1.5-B Lote 2). No-op absoluto sin SENTRY_DSN.
  if (initSentry("worker")) console.log("[workers] Sentry activo");
  const initialWorker = startInitialSyncWorker();
  const incrementalWorker = startCatalogIncrementalWorker();
  const ticketWorker = startTicketUploadWorker();
  const refundWorker = startRefundUploadWorker();
  const emailWorker = startTicketEmailWorker();
  const imageWorker = startImageCacheWorker();
  const contactImportWorker = startContactImportWorker();
  const reconciliationWorker = startReconciliationWorker();
  const uploadSweeper = startUploadSweeper();
  const heartbeat = startWorkerHeartbeat();
  console.log("[workers] initial-sync worker listo");
  console.log("[workers] catalog-incremental worker listo");
  console.log("[workers] ticket-upload worker listo");
  console.log("[workers] refund-upload worker listo");
  console.log("[workers] ticket-email worker listo");
  console.log("[workers] image-cache worker listo");
  console.log("[workers] contact-import worker listo");
  console.log("[workers] reconciliation worker listo");
  console.log("[workers] upload-sweeper listo (cada 5 min)");
  const count = await registerAllExistingRepeatables();
  console.log(`[workers] ${count} repeatable(s) registrados para tenants existentes`);
  // Conciliación diaria (v1.5-B Lote 4): repeatable global, cron a la
  // hora de RECONCILIATION_HOUR (Europe/Madrid).
  await registerReconciliationRepeatable();
  console.log("[workers] reconciliación diaria registrada");
  process.on("SIGINT", async () => {
    console.log("[workers] SIGINT — cerrando…");
    uploadSweeper.stop();
    heartbeat.stop();
    await Promise.all([
      initialWorker.close(),
      incrementalWorker.close(),
      ticketWorker.close(),
      refundWorker.close(),
      emailWorker.close(),
      imageWorker.close(),
      contactImportWorker.close(),
      reconciliationWorker.close(),
    ]);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[workers] fatal", err);
  process.exit(1);
});
