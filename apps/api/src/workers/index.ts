// Bootstrap del proceso de workers — sin Fastify. Útil cuando en
// producción los workers corren en un contenedor distinto del API.
//
// En desarrollo, server.ts puede arrancar el worker en el mismo proceso
// con `startInitialSyncWorker()`.

import "dotenv/config";

import { loadEnv } from "../env.js";
import { startInitialSyncWorker } from "./initial-sync-worker.js";
import {
  registerAllExistingRepeatables,
  startCatalogIncrementalWorker,
} from "./catalog-incremental-worker.js";
import { startTicketUploadWorker } from "./ticket-upload-worker.js";
import { startRefundUploadWorker } from "./refund-upload-worker.js";
import { startTicketEmailWorker } from "./ticket-email-worker.js";
import { startImageCacheWorker } from "./image-cache-worker.js";

async function main() {
  loadEnv();
  const initialWorker = startInitialSyncWorker();
  const incrementalWorker = startCatalogIncrementalWorker();
  const ticketWorker = startTicketUploadWorker();
  const refundWorker = startRefundUploadWorker();
  const emailWorker = startTicketEmailWorker();
  const imageWorker = startImageCacheWorker();
  console.log("[workers] initial-sync worker listo");
  console.log("[workers] catalog-incremental worker listo");
  console.log("[workers] ticket-upload worker listo");
  console.log("[workers] refund-upload worker listo");
  console.log("[workers] ticket-email worker listo");
  console.log("[workers] image-cache worker listo");
  const count = await registerAllExistingRepeatables();
  console.log(`[workers] ${count} repeatable(s) registrados para tenants existentes`);
  process.on("SIGINT", async () => {
    console.log("[workers] SIGINT — cerrando…");
    await Promise.all([
      initialWorker.close(),
      incrementalWorker.close(),
      ticketWorker.close(),
      refundWorker.close(),
      emailWorker.close(),
      imageWorker.close(),
    ]);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[workers] fatal", err);
  process.exit(1);
});
