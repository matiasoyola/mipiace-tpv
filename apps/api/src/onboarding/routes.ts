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

import { Prisma } from "@mipiacetpv/db";

import { requireOwner } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { encryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";
import { probeFailureToHttpStatus, probeHoldedKey } from "../holded/probe.js";
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
      const probe = await probeHoldedKey(apiKey);
      if (!probe.ok) {
        if (probe.code === "HOLDED_UNREACHABLE") {
          request.log.error(
            { tenantId: auth.tenantId, apiKey: "<REDACTED>" },
            `connect-holded falló: ${probe.code}`,
          );
        }
        return reply
          .code(probeFailureToHttpStatus(probe.code))
          .send({ error: probe.code, message: probe.message });
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
          initialSyncStats: Prisma.JsonNull,
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
