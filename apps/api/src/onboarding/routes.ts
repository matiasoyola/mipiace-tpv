// Endpoints del onboarding del propietario.
//
//   POST /onboarding/connect-holded   — recibe API Key, valida, cifra,
//                                       persiste y dispara el sync.
//   GET  /onboarding/sync-status      — estado para el polling del admin.
//
// Reglas duras de B1:
//   - NUNCA loguear la API Key, ni el primer carácter, ni siquiera la
//     longitud (la longitud filtra hash typos). Reemplazar en logs por "<REDACTED>".
//   - El error 402 de Holded mapea a HoldedSubscriptionSuspendedError y
//     se traduce a un error de UI específico (no genérico).

import type { FastifyInstance } from "fastify";

import {
  ApiKeyClient,
  HoldedApiError,
  HoldedInvalidResponseError,
  HoldedSubscriptionSuspendedError,
  listProductsPage,
} from "@mipiacetpv/holded-client";

import { requireOwner } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { encryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";
import { enqueueInitialSync } from "../queues/initial-sync.js";

export async function registerOnboardingRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/onboarding/connect-holded",
    {
      preHandler: requireOwner,
      schema: {
        body: {
          type: "object",
          required: ["apiKey"],
          additionalProperties: false,
          properties: {
            apiKey: { type: "string", minLength: 10, maxLength: 512 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { apiKey } = request.body as { apiKey: string };
      const env = loadEnv();

      // 1. Validar contra Holded.
      const probeClient = new ApiKeyClient(apiKey, { baseUrl: env.HOLDED_BASE_URL });
      try {
        await listProductsPage(probeClient, 1);
      } catch (err) {
        if (err instanceof HoldedSubscriptionSuspendedError) {
          return reply.code(402).send({
            error: "HOLDED_SUSPENDED",
            message:
              "Tu cuenta de Holded está suspendida por impago. Regulariza el pago en Holded y vuelve a intentarlo.",
          });
        }
        if (err instanceof HoldedApiError && (err.status === 401 || err.status === 403)) {
          return reply.code(401).send({
            error: "INVALID_HOLDED_KEY",
            message: "Holded rechaza la API Key. Genera una nueva desde tu admin y reintenta.",
          });
        }
        if (err instanceof HoldedInvalidResponseError) {
          return reply.code(502).send({
            error: "HOLDED_INVALID_RESPONSE",
            message:
              "Holded ha devuelto una respuesta que no es JSON. Es posible que estén con incidencia.",
          });
        }
        // Cualquier otro fallo: 502.
        request.log.error(
          { tenantId: auth.tenantId, apiKey: "<REDACTED>" },
          `connect-holded falló: ${err instanceof Error ? err.message : String(err)}`,
        );
        return reply.code(502).send({
          error: "HOLDED_UNREACHABLE",
          message: "No hemos podido contactar con Holded. Reintenta en unos minutos.",
        });
      }

      // 2. Cifrar + persistir.
      const ciphertext = encryptSecret(apiKey, env.HOLDED_KEY_ENCRYPTION_SECRET);
      const prisma = getPrisma();
      await prisma.tenant.update({
        where: { id: auth.tenantId },
        data: {
          holdedApiKeyCiphertext: ciphertext,
          holdedAuthMode: "API_KEY",
          initialSyncStatus: "PENDING",
          initialSyncStats: null,
        },
      });

      // 3. Encolar sync inicial. Si Redis está caído devolvemos 503 para
      //    que el propietario reintente; la key queda persistida.
      try {
        await enqueueInitialSync(auth.tenantId);
      } catch (err) {
        request.log.error(
          { tenantId: auth.tenantId },
          `no se pudo encolar initial-sync: ${err instanceof Error ? err.message : err}`,
        );
        return reply.code(503).send({
          error: "QUEUE_UNAVAILABLE",
          message: "Hemos guardado tu API Key pero el sync no se pudo programar. Reintenta.",
        });
      }
      return { ok: true, initialSyncStatus: "PENDING" };
    },
  );

  app.get(
    "/onboarding/sync-status",
    { preHandler: requireOwner },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: {
          initialSyncStatus: true,
          initialSyncStartedAt: true,
          initialSyncCompletedAt: true,
          initialSyncStats: true,
        },
      });
      const statsObject =
        tenant.initialSyncStats && typeof tenant.initialSyncStats === "object"
          ? (tenant.initialSyncStats as Record<string, unknown>)
          : null;
      const errors =
        statsObject && Array.isArray(statsObject.errors)
          ? (statsObject.errors as unknown[])
          : [];
      return {
        status: tenant.initialSyncStatus,
        startedAt: tenant.initialSyncStartedAt?.toISOString() ?? null,
        completedAt: tenant.initialSyncCompletedAt?.toISOString() ?? null,
        stats: statsObject,
        errors,
      };
    },
  );
}
