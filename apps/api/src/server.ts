import "dotenv/config";

import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";

import { registerManagerAuthorizationRoutes } from "./admin/manager-authorize.js";
import { registerAdminTagAliasesRoutes } from "./admin/tag-aliases.js";
import { registerAdminTagSectionsRoutes } from "./admin/tag-sections.js";
import { registerAdminTenantSettingsRoutes } from "./admin/tenant-settings.js";
import { registerAdminGiftReceiptRoutes } from "./admin/gift-receipts.js";
import { registerAdminModifierGroupRoutes } from "./admin/modifier-groups.js";
import { registerAdminPrinterConfigsRoutes } from "./admin/printer-configs.js";
import { registerAdminTicketDeliveryRoutes } from "./admin/ticket-delivery.js";
import { registerAdminTicketsErrorsRoutes } from "./admin/tickets-errors.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerPasswordResetRoutes } from "./auth/password-reset.js";
import { registerCashiersRoutes } from "./cashiers/routes.js";
import { registerCatalogRoutes } from "./catalog/routes.js";
import { registerContactsRoutes } from "./contacts/routes.js";
import { registerContactImportRoutes } from "./contacts/import.js";
import { getPrisma, getRedis, shutdown } from "./context.js";
import { registerDeviceRoutes } from "./devices/routes.js";
import { loadEnv } from "./env.js";
import { registerErrorHandler } from "./lib/error-handler.js";
import { registerLenientJsonParser } from "./lib/lenient-json.js";
import { initSentry } from "./lib/sentry.js";
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
import { registerSendToKitchenRoute } from "./tickets/send-to-kitchen.js";
import { registerSendToKitchenEscposRoute } from "./tickets/send-to-kitchen-escpos.js";
import { registerTicketPrintRoute } from "./tickets/print.js";
import { registerTpvPrinterInfoRoute } from "./tickets/printer-info.js";
import { registerPartialPaymentRoute } from "./tickets/partial-payment.js";
import { registerTpvCatalogRoutes } from "./tpv-catalog/routes.js";

async function main() {
  const env = loadEnv();
  // Sentry (v1.5-B Lote 2). No-op absoluto sin SENTRY_DSN. Antes de
  // crear el server para que las integraciones por defecto (uncaught
  // exception / unhandled rejection) cubran todo el ciclo de vida.
  const sentryOn = initSentry("api");
  const app = Fastify({
    // v1.5-D · Frente 3: detrás de Caddy (un único proxy de confianza).
    // Sin esto, `request.ip` sería la IP de Caddy y `X-Forwarded-For` lo
    // controla el cliente en su primer token — falsificable. Con
    // `trustProxy: 1`, Fastify toma el último salto del XFF (el que añade
    // Caddy = IP real del cliente) y descarta los tokens inyectados por el
    // atacante. Las claves de rate-limit por IP dependen de esto.
    trustProxy: 1,
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

  // Manejador global de errores (v1.5-consistencia-A §4.a): zod/ajv →
  // 400, holded-client → 502 con código propio, resto → 500 con
  // requestId y stack sólo en logs.
  registerErrorHandler(app);

  // v1.0-pilotos · Lote 2 (#9): el TPV manda `Content-Type:
  // application/json` también en POSTs sin body (reimprimir, comanda,
  // gift-receipt) y el parser por defecto de Fastify los rechazaba con
  // FST_ERR_CTP_EMPTY_JSON_BODY antes de llegar al handler. Tratamos
  // body vacío como `{}` — los endpoints con body required lo siguen
  // rechazando vía schema, ahora con un 400 explicable. Importante
  // hacerlo server-side porque las PWA cachean JS viejo semanas.
  registerLenientJsonParser(app);

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
  await registerContactImportRoutes(app);
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
  await registerSendToKitchenRoute(app);
  await registerSendToKitchenEscposRoute(app);
  await registerTicketPrintRoute(app);
  await registerTpvPrinterInfoRoute(app);
  await registerPartialPaymentRoute(app);
  await registerTicketDigitalRoute(app);
  await registerTpvCatalogRoutes(app);
  await registerAdminTicketsErrorsRoutes(app);
  await registerManagerAuthorizationRoutes(app);
  await registerAdminTenantSettingsRoutes(app);
  await registerAdminTagAliasesRoutes(app);
  await registerAdminTagSectionsRoutes(app);
  await registerAdminGiftReceiptRoutes(app);
  await registerAdminModifierGroupRoutes(app);
  await registerAdminPrinterConfigsRoutes(app);
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
  if (sentryOn) app.log.info("Sentry activo (api)");

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
