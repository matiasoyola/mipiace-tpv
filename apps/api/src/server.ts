import "dotenv/config";

import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";

import { registerManagerAuthorizationRoutes } from "./admin/manager-authorize.js";
import { registerAdminTenantSettingsRoutes } from "./admin/tenant-settings.js";
import { registerAdminGiftReceiptRoutes } from "./admin/gift-receipts.js";
import { registerAdminModifierGroupRoutes } from "./admin/modifier-groups.js";
import { registerAdminTicketDeliveryRoutes } from "./admin/ticket-delivery.js";
import { registerAdminTicketsErrorsRoutes } from "./admin/tickets-errors.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerPasswordResetRoutes } from "./auth/password-reset.js";
import { registerCashiersRoutes } from "./cashiers/routes.js";
import { registerCatalogRoutes } from "./catalog/routes.js";
import { registerContactsRoutes } from "./contacts/routes.js";
import { getPrisma, getRedis, shutdown } from "./context.js";
import { registerDeviceRoutes } from "./devices/routes.js";
import { loadEnv } from "./env.js";
import { registerOnboardingRoutes } from "./onboarding/routes.js";
import { registerCashierAuthRoutes } from "./shift/cashier-auth.js";
import { registerShiftRoutes } from "./shift/routes.js";
import { registerStoresRoutes } from "./stores/routes.js";
import { registerStoreWebSocketRoute } from "./realtime/ws-route.js";
import {
  registerSuperAdminRoutes,
  registerTenantBlockGuard,
} from "./superadmin/routes.js";
import { registerTableGroupingRoutes } from "./tables/grouping.js";
import { registerTableOperativaRoutes } from "./tables/operativa.js";
import { registerTablesRoutes } from "./tables/routes.js";
import {
  registerAllExistingRepeatables,
  startCatalogIncrementalWorker,
} from "./workers/catalog-incremental-worker.js";
import { startInitialSyncWorker } from "./workers/initial-sync-worker.js";
import { startTicketUploadWorker } from "./workers/ticket-upload-worker.js";
import { startRefundUploadWorker } from "./workers/refund-upload-worker.js";
import { startTicketEmailWorker } from "./workers/ticket-email-worker.js";
import { registerTicketRoutes } from "./tickets/routes.js";
import { registerTicketDigitalRoute } from "./tickets/digital-route.js";
import { registerPublicTicketPdfRoute } from "./tickets/public-pdf-route.js";
import { registerTpvCatalogRoutes } from "./tpv-catalog/routes.js";

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

  // WebSocket plugin para el bus multi-terminal del vertical bar (B7
  // §6). Registramos antes de las rutas para que el `websocket: true`
  // en la route opt sea reconocido.
  await app.register(websocket);

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

  if (
    env.NODE_ENV === "production" &&
    env.SUPER_ADMIN_JWT_SECRET.startsWith("dev-only-super-admin-secret")
  ) {
    throw new Error(
      "SUPER_ADMIN_JWT_SECRET no está configurado en producción. " +
        "Setéalo con `openssl rand -base64 48` antes de arrancar.",
    );
  }

  // B-SuperAdmin: guard global de tenants bloqueados. Se registra ANTES
  // de cualquier ruta per-tenant. Las rutas exentas (/super-admin/*,
  // /auth/login, /auth/password-reset/*, /health) pasan de largo; el
  // resto, si lleva Bearer de un tenant con blocked_at != null, recibe
  // 423 Locked. Cubre CASHIER tanto como OWNER/MANAGER.
  registerTenantBlockGuard(app);

  await registerSuperAdminRoutes(app);
  await registerAuthRoutes(app);
  await registerPasswordResetRoutes(app);
  await registerOnboardingRoutes(app);
  await registerCatalogRoutes(app);
  await registerContactsRoutes(app);
  await registerDeviceRoutes(app);
  await registerCashiersRoutes(app);
  await registerCashierAuthRoutes(app);
  await registerShiftRoutes(app);
  await registerStoresRoutes(app);
  await registerTablesRoutes(app);
  await registerTableOperativaRoutes(app);
  await registerTableGroupingRoutes(app);
  await registerStoreWebSocketRoute(app);
  await registerPublicTicketPdfRoute(app);
  await registerTicketRoutes(app);
  await registerTicketDigitalRoute(app);
  await registerTpvCatalogRoutes(app);
  await registerAdminTicketsErrorsRoutes(app);
  await registerManagerAuthorizationRoutes(app);
  await registerAdminTenantSettingsRoutes(app);
  await registerAdminGiftReceiptRoutes(app);
  await registerAdminModifierGroupRoutes(app);
  await registerAdminTicketDeliveryRoutes(app);

  // Conexión perezosa: forzamos un primer query para fallar pronto si la
  // BD no está accesible (mejor mensaje que esperar al primer login).
  await getPrisma().$queryRaw`SELECT 1`;
  // Ping redis para detectar problemas en arranque.
  await getRedis().ping();

  // En desarrollo arrancamos los workers en el mismo proceso. En
  // producción se separan con `pnpm worker:dev` (otro contenedor del compose).
  let initialWorker: ReturnType<typeof startInitialSyncWorker> | null = null;
  let incrementalWorker: ReturnType<typeof startCatalogIncrementalWorker> | null = null;
  let ticketWorker: ReturnType<typeof startTicketUploadWorker> | null = null;
  let refundWorker: ReturnType<typeof startRefundUploadWorker> | null = null;
  let emailWorker: ReturnType<typeof startTicketEmailWorker> | null = null;
  if (env.NODE_ENV !== "production") {
    initialWorker = startInitialSyncWorker();
    incrementalWorker = startCatalogIncrementalWorker();
    ticketWorker = startTicketUploadWorker();
    refundWorker = startRefundUploadWorker();
    emailWorker = startTicketEmailWorker();
    const count = await registerAllExistingRepeatables();
    app.log.info(`workers arrancados embedded · ${count} repeatable(s) registrados`);
  }

  const close = async () => {
    app.log.info("Apagando…");
    await app.close();
    if (initialWorker) await initialWorker.close();
    if (incrementalWorker) await incrementalWorker.close();
    if (ticketWorker) await ticketWorker.close();
    if (refundWorker) await refundWorker.close();
    if (emailWorker) await emailWorker.close();
    await shutdown();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
