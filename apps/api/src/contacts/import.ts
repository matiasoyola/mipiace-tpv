// v1.0-pilotos · Lote 6 (#22): importador de clientes desde Excel/CSV.
//
// El admin (OWNER-only) parsea el archivo en el navegador (exceljs/CSV)
// y manda las filas normalizadas como JSON — así no necesitamos plugin
// multipart en la API y el contrato queda agnóstico del formato. El
// proceso real corre en un worker BullMQ (un Excel de 1.000 clientes a
// ~5 req/s contra Holded son 3-4 min, imposible como request HTTP):
//
//   POST /admin/contacts/import           → valida + encola; devuelve jobId.
//   GET  /admin/contacts/import/:jobId    → estado + progreso + resultado.
//
// La validación fuerte por fila (NIF con util-validation, idempotencia
// por NIF/email, throttle, reintentos) vive en el worker
// (workers/contact-import-worker.ts) — una sola fuente de verdad.

import type { FastifyInstance } from "fastify";

import { requireOwner } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import {
  enqueueContactImport,
  getContactImportQueue,
  type ContactImportProgress,
  type ContactImportResult,
  type ContactImportRow,
} from "../queues/contact-import.js";

const MAX_ROWS = 2_000;

export async function registerContactImportRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/admin/contacts/import",
    {
      preHandler: requireOwner,
      schema: {
        body: {
          type: "object",
          required: ["rows"],
          additionalProperties: false,
          properties: {
            rows: {
              type: "array",
              minItems: 1,
              maxItems: MAX_ROWS,
              items: {
                type: "object",
                required: ["name"],
                additionalProperties: false,
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 200 },
                  nif: { type: ["string", "null"], maxLength: 20 },
                  email: { type: ["string", "null"], maxLength: 320 },
                  phone: { type: ["string", "null"], maxLength: 40 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { rows } = request.body as {
        rows: Array<{
          name: string;
          nif?: string | null;
          email?: string | null;
          phone?: string | null;
        }>;
      };
      const prisma = getPrisma();

      // Sin API key de Holded no hay importación posible — Holded es la
      // fuente de verdad y no creamos contactos "solo locales".
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: { holdedApiKeyCiphertext: true },
      });
      if (!tenant.holdedApiKeyCiphertext) {
        return reply.code(409).send({
          error: "NO_HOLDED_API_KEY",
          message:
            "Configura la API key de Holded antes de importar clientes.",
        });
      }

      const normalized: ContactImportRow[] = rows.map((r) => ({
        name: r.name.trim(),
        nif: r.nif?.trim() || null,
        email: r.email?.trim() || null,
        phone: r.phone?.trim() || null,
      }));

      const jobId = await enqueueContactImport({
        tenantId: auth.tenantId,
        requestedByUserId: auth.userId,
        rows: normalized,
      });

      request.log.info(
        {
          event: "contacts.import.enqueued",
          tenantId: auth.tenantId,
          userId: auth.userId,
          jobId,
          rowCount: normalized.length,
        },
        "Importación de clientes encolada",
      );

      return reply.code(202).send({ jobId, total: normalized.length });
    },
  );

  app.get(
    "/admin/contacts/import/:jobId",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["jobId"],
          properties: { jobId: { type: "string", minLength: 1, maxLength: 64 } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { jobId } = request.params as { jobId: string };
      const job = await getContactImportQueue().getJob(jobId);
      // El job pertenece a OTRO tenant → mismo 404 que si no existiera
      // (no filtramos existencia entre tenants).
      if (!job || job.data.tenantId !== auth.tenantId) {
        return reply.code(404).send({
          error: "IMPORT_JOB_NOT_FOUND",
          message: "Importación no encontrada (puede haber expirado).",
        });
      }
      const state = await job.getState();
      const progress = (job.progress ?? null) as ContactImportProgress | null;
      const result =
        state === "completed"
          ? ((job.returnvalue ?? null) as ContactImportResult | null)
          : null;
      return {
        jobId,
        state, // waiting | active | completed | failed | delayed
        total: job.data.rows.length,
        progress,
        result,
        failedReason: state === "failed" ? (job.failedReason ?? null) : null,
      };
    },
  );
}
