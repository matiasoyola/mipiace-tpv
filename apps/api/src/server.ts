import "dotenv/config";

import Fastify from "fastify";
import cors from "@fastify/cors";

import { registerAuthRoutes } from "./auth/routes.js";
import { registerCatalogRoutes } from "./catalog/routes.js";
import { registerContactsRoutes } from "./contacts/routes.js";
import { getPrisma, getRedis, shutdown } from "./context.js";
import { loadEnv } from "./env.js";
import { registerOnboardingRoutes } from "./onboarding/routes.js";
import { registerSpikeRoutes } from "./spike/routes.js";
import {
  registerAllExistingRepeatables,
  startCatalogIncrementalWorker,
} from "./workers/catalog-incremental-worker.js";
import { startInitialSyncWorker } from "./workers/initial-sync-worker.js";

async function main() {
  const env = loadEnv();
  const app = Fastify({
    logger: {
      transport:
        env.NODE_ENV === "production"
          ? undefined
          : { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } },
      // Capa final de defensa: nunca dejes que un secret aparezca en logs.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'req.body.apiKey',
          'req.body.password',
        ],
        censor: "<REDACTED>",
      },
    },
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (env.CORS_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS bloqueado: ${origin}`), false);
    },
    credentials: true,
  });

  // Health primero — útil para probes Hostinger.
  app.get("/health", async () => ({ ok: true }));

  await registerAuthRoutes(app);
  await registerOnboardingRoutes(app);
  await registerCatalogRoutes(app);
  await registerContactsRoutes(app);

  // Endpoints del super-mini-MVP (tpv-web-spike). Sólo se activan si la
  // env trae HOLDED_API_KEY single-tenant. En producción nadie configura
  // esa env — el TPV usa claves cifradas por tenant.
  if (env.HOLDED_API_KEY && env.HOLDED_API_KEY.length > 0) {
    await registerSpikeRoutes(app, env.HOLDED_API_KEY, env.HOLDED_BASE_URL);
    app.log.info("Spike routes habilitadas (/products, /tickets) — modo single-tenant");
  }

  // Conexión perezosa: forzamos un primer query para fallar pronto si la
  // BD no está accesible (mejor mensaje que esperar al primer login).
  await getPrisma().$queryRaw`SELECT 1`;
  // Ping redis para detectar problemas en arranque.
  await getRedis().ping();

  // En desarrollo arrancamos los workers en el mismo proceso. En
  // producción se separan con `pnpm worker:dev` (otro contenedor del compose).
  let initialWorker: ReturnType<typeof startInitialSyncWorker> | null = null;
  let incrementalWorker: ReturnType<typeof startCatalogIncrementalWorker> | null = null;
  if (env.NODE_ENV !== "production") {
    initialWorker = startInitialSyncWorker();
    incrementalWorker = startCatalogIncrementalWorker();
    const count = await registerAllExistingRepeatables();
    app.log.info(`workers arrancados embedded · ${count} repeatable(s) registrados`);
  }

  const close = async () => {
    app.log.info("Apagando…");
    await app.close();
    if (initialWorker) await initialWorker.close();
    if (incrementalWorker) await incrementalWorker.close();
    await shutdown();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  try {
    await app.listen({ port: env.PORT, host: "127.0.0.1" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
