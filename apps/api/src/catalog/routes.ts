// Endpoints del catálogo (B2 §2.1).
//
//   POST /catalog/sync-now    — encola un sync incremental manual con
//                               prioridad alta. Devuelve 202 + jobId.
//   GET  /catalog/sync-status — estado del último sync incremental del
//                               tenant. El admin lo pollea para mostrar
//                               "última sincronización hace X min".
//
// El cron de 15 min (BullMQ repeatable) vive aparte y se registra
// automáticamente al completar el sync inicial. Estos endpoints sólo
// son la vía manual.

import type { FastifyInstance } from "fastify";

import {
  ApiKeyClient,
  HoldedApiError,
  HoldedInvalidResponseError,
  HoldedSilentRejectError,
  updateProductWithGetBack,
} from "@mipiacetpv/holded-client";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { throttle } from "../auth/rate-limit.js";
import { getPrisma } from "../context.js";
import { decryptSecret } from "../crypto.js";
import { loadEnv } from "../env.js";
import { buildAutoSku } from "../onboarding/auto-sku.js";
import { enqueueManualSync } from "../queues/catalog-incremental.js";
import { getTenantHealthStatus } from "../tickets/health.js";

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/catalog/sync-now",
    {
      preHandler: requireOwnerOrManager,
      schema: { body: { type: "object", additionalProperties: false, properties: {} } },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUnique({
        where: { id: auth.tenantId },
        select: { initialSyncStatus: true, holdedApiKeyCiphertext: true },
      });
      // Defensa: no permitir sync manual a tenants sin onboarding
      // completo. El worker también lo detecta, pero rebotar aquí da
      // mejor mensaje al admin.
      if (!tenant) {
        return reply.code(404).send({ error: "TENANT_NOT_FOUND", message: "Tenant no encontrado" });
      }
      if (!tenant.holdedApiKeyCiphertext) {
        return reply.code(409).send({
          error: "NO_HOLDED_KEY",
          message: "Conecta tu cuenta de Holded antes de sincronizar.",
        });
      }
      if (tenant.initialSyncStatus !== "DONE") {
        return reply.code(409).send({
          error: "INITIAL_SYNC_PENDING",
          message:
            "El sync inicial todavía no ha terminado. Espera a que complete para forzar uno nuevo.",
        });
      }

      // v1.3-Operativa-Extra · Lote 2: máximo 1 sync manual por minuto
      // por tenant. Evita que el OWNER pulse el botón en bucle (cada
      // sync arranca un job real contra Holded, que tarda segundos).
      // El cron de 15 min queda intacto — sólo limita lo que dispara
      // este endpoint.
      const limit = await throttle(`catalog-sync-now:${auth.tenantId}`, 1, 60);
      if (limit.exceeded) {
        return reply.code(429).send({
          error: "TOO_MANY_REQUESTS",
          message: `Ya hay un sync manual en curso. Vuelve a intentarlo en ${limit.retryAfterSeconds}s.`,
          retryAfterSeconds: limit.retryAfterSeconds,
        });
      }

      try {
        const { jobId } = await enqueueManualSync(auth.tenantId);
        return reply.code(202).send({ jobId, queuedAt: new Date().toISOString() });
      } catch (err) {
        request.log.error(
          { tenantId: auth.tenantId },
          `no se pudo encolar sync-now: ${err instanceof Error ? err.message : err}`,
        );
        return reply.code(503).send({
          error: "QUEUE_UNAVAILABLE",
          message: "El sistema de cola no está disponible. Reintenta en un momento.",
        });
      }
    },
  );

  // Bandeja de productos pendientes de SKU (B2 §4.4). Lista lo que
  // auto-sku no pudo resolver (Holded silenció el PUT, ADR-010).
  app.get(
    "/catalog/sku-review",
    { preHandler: requireOwnerOrManager },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const items = await prisma.product.findMany({
        where: { tenantId: auth.tenantId, needsSkuReview: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          holdedProductId: true,
          name: true,
          basePrice: true,
          taxRate: true,
          sku: true,
          sellableViaTpv: true,
          skuReviewAttempts: true,
        },
      });
      return {
        items: items.map((p) => ({
          id: p.id,
          holdedProductId: p.holdedProductId,
          name: p.name,
          basePrice: Number(p.basePrice),
          taxRate: Number(p.taxRate),
          currentSku: p.sku,
          // Sugerencia: misma fórmula que el script auto-SKU. El
          // propietario puede aceptarla o escribir uno propio.
          suggestedSku: buildAutoSku(p.holdedProductId),
          sellableViaTpv: p.sellableViaTpv,
          skuReviewAttempts: p.skuReviewAttempts,
        })),
      };
    },
  );

  // Asigna un SKU manual al producto (B2 §4.4). PUT a Holded con
  // GET-back. Si Holded vuelve a silenciar, devolvemos 502 y dejamos
  // needsSkuReview=true para que siga en la bandeja.
  app.post(
    "/catalog/sku-review/:productId/assign",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["sku"],
          additionalProperties: false,
          properties: {
            sku: { type: "string", minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { productId } = request.params as { productId: string };
      const { sku } = request.body as { sku: string };
      const prisma = getPrisma();
      const product = await prisma.product.findFirst({
        where: { id: productId, tenantId: auth.tenantId },
        select: { id: true, holdedProductId: true, needsSkuReview: true },
      });
      if (!product) {
        return reply.code(404).send({ error: "PRODUCT_NOT_FOUND", message: "Producto no encontrado." });
      }

      const env = loadEnv();
      const tenant = await prisma.tenant.findUnique({
        where: { id: auth.tenantId },
        select: { holdedApiKeyCiphertext: true },
      });
      if (!tenant?.holdedApiKeyCiphertext) {
        return reply.code(409).send({
          error: "NO_HOLDED_KEY",
          message: "Conecta tu cuenta de Holded antes de asignar SKUs.",
        });
      }
      const apiKey = decryptSecret(tenant.holdedApiKeyCiphertext, env.HOLDED_KEY_ENCRYPTION_SECRET);
      const client = new ApiKeyClient(apiKey, { baseUrl: env.HOLDED_BASE_URL });

      // Incrementamos `skuReviewAttempts` en cada intento (éxito o
      // silent reject) — el contador alimenta el badge ámbar de la
      // bandeja para que el propietario pueda escalar a soporte
      // cuando Holded persiste en silenciar.
      try {
        await updateProductWithGetBack(
          client,
          product.holdedProductId,
          { sku },
          { expect: { sku } },
        );
        await prisma.product.update({
          where: { id: product.id },
          data: {
            sku,
            needsSkuReview: false,
            sellableViaTpv: true,
            skuAutoAssignedAt: null,
            skuReviewAttempts: { increment: 1 },
          },
        });
        return reply.code(200).send({ ok: true, sku });
      } catch (err) {
        if (err instanceof HoldedSilentRejectError) {
          // Holded volvió a silenciar. Mantén needsSkuReview=true y
          // bumpa el contador.
          await prisma.product.update({
            where: { id: product.id },
            data: { skuReviewAttempts: { increment: 1 } },
          });
          request.log.warn(
            { tenantId: auth.tenantId, productId },
            "asignación manual de SKU silenciada por Holded",
          );
          return reply.code(502).send({
            error: "HOLDED_SILENT_REJECT",
            message:
              "Holded ha aceptado la petición pero no aplicó el SKU. Revisa el producto en Holded.",
            mismatches: err.mismatches,
          });
        }
        if (err instanceof HoldedApiError && err.status === 404) {
          // v1.9 Frente 2: la ficha ya no existe en Holded — soft-
          // archive inmediato y fuera de la bandeja. Si reaparece en
          // Holded, el sync la reactiva.
          await prisma.product.update({
            where: { id: product.id },
            data: {
              active: false,
              sellableViaTpv: false,
              needsSkuReview: false,
              archivedFromHoldedAt: new Date(),
            },
          });
          request.log.warn(
            { tenantId: auth.tenantId, productId },
            "assign-sku: producto borrado en Holded (404), archivado",
          );
          return reply.code(410).send({
            error: "HOLDED_PRODUCT_DELETED",
            message:
              "Este producto ya no existe en Holded. Lo hemos archivado y dejará de aparecer en el TPV.",
          });
        }
        if (err instanceof HoldedApiError) {
          return reply.code(502).send({
            error: "HOLDED_ERROR",
            message: `Holded rechazó la actualización: ${err.message}`,
          });
        }
        if (err instanceof HoldedInvalidResponseError) {
          return reply.code(502).send({
            error: "HOLDED_INVALID_RESPONSE",
            message: "Holded devolvió una respuesta que no es JSON.",
          });
        }
        request.log.error(
          { tenantId: auth.tenantId, productId },
          `assign-sku falló: ${err instanceof Error ? err.message : String(err)}`,
        );
        return reply.code(502).send({
          error: "HOLDED_UNREACHABLE",
          message: "No hemos podido contactar con Holded.",
        });
      }
    },
  );

  // Marca el producto como no-vendible vía TPV permanentemente. El
  // propietario lo usa cuando Holded persiste en silenciar el SKU
  // (skuReviewAttempts >= 3) y no quiere seguir intentándolo. El
  // producto sale de la bandeja (needsSkuReview = false) pero NO se
  // borra: queda como referencia histórica si Holded lo arregla más
  // tarde.
  app.post(
    "/catalog/sku-review/:productId/mark-unsellable",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", format: "uuid" } },
        },
        body: { type: "object", additionalProperties: false, properties: {} },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { productId } = request.params as { productId: string };
      const prisma = getPrisma();
      const product = await prisma.product.findFirst({
        where: { id: productId, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!product) {
        return reply
          .code(404)
          .send({ error: "PRODUCT_NOT_FOUND", message: "Producto no encontrado." });
      }
      await prisma.product.update({
        where: { id: product.id },
        data: { sellableViaTpv: false, needsSkuReview: false },
      });
      return reply.code(200).send({ ok: true });
    },
  );

  app.get(
    "/catalog/sync-status",
    { preHandler: requireOwnerOrManager },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: {
          lastIncrementalSyncAt: true,
          lastIncrementalSyncStats: true,
        },
      });
      const stats =
        tenant.lastIncrementalSyncStats && typeof tenant.lastIncrementalSyncStats === "object"
          ? (tenant.lastIncrementalSyncStats as Record<string, unknown>)
          : null;
      const errors =
        stats && Array.isArray(stats.errors) ? (stats.errors as unknown[]) : [];
      // v1.5-B §3.b: nivel de salud para el banner grande del admin
      // (sin API key / >48h sin sync). Mismo helper que el TPV.
      const health = await getTenantHealthStatus(prisma, auth.tenantId);
      return {
        lastIncrementalSyncAt: tenant.lastIncrementalSyncAt?.toISOString() ?? null,
        stats,
        errors,
        health: {
          level: health.level,
          reason: health.reason,
          lastSyncAgeMs: health.lastSyncAgeMs,
        },
      };
    },
  );
}
