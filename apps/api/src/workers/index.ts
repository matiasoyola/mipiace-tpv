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

async function main() {
  loadEnv();
  const initialWorker = startInitialSyncWorker();
  const incrementalWorker = startCatalogIncrementalWorker();
  console.log("[workers] initial-sync worker listo");
  console.log("[workers] catalog-incremental worker listo");
  const count = await registerAllExistingRepeatables();
  console.log(`[workers] ${count} repeatable(s) registrados para tenants existentes`);
  process.on("SIGINT", async () => {
    console.log("[workers] SIGINT — cerrando…");
    await Promise.all([initialWorker.close(), incrementalWorker.close()]);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[workers] fatal", err);
  process.exit(1);
});
