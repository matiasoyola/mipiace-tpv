// Bootstrap del proceso de workers — sin Fastify. Útil cuando en
// producción los workers corren en un contenedor distinto del API.
//
// En desarrollo, server.ts puede arrancar el worker en el mismo proceso
// con `startInitialSyncWorker()`.

import "dotenv/config";

import { loadEnv } from "../env.js";
import { startInitialSyncWorker } from "./initial-sync-worker.js";

async function main() {
  loadEnv();
  const worker = startInitialSyncWorker();
  console.log("[workers] initial-sync worker listo");
  process.on("SIGINT", async () => {
    console.log("[workers] SIGINT — cerrando…");
    await worker.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[workers] fatal", err);
  process.exit(1);
});
