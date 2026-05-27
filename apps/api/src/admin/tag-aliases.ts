// v1.3-Operativa-Extra · Lote 1: CRUD del alias editable de tags.
//
// El OWNER/MANAGER mapea slugs Holded ("01cortesypeinados") a un label
// legible que el TPV pinta en los chips de categoría ("Cortes y
// peinados"). El TPV cachea el map al refrescar catálogo y aplica un
// fallback a la lógica de capitalizeTag del hotfix5 cuando no hay
// entrada.
//
//   GET    /admin/tag-aliases       → lista los aliases del tenant.
//   POST   /admin/tag-aliases       → upsert idempotente por slug.
//   DELETE /admin/tag-aliases/:id   → quita un alias.

import type { FastifyInstance } from "fastify";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";

export async function registerAdminTagAliasesRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/admin/tag-aliases",
    { preHandler: requireOwnerOrManager },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const items = await prisma.tagAlias.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: { slug: "asc" },
        select: { id: true, slug: true, label: true },
      });
      return { items };
    },
  );

  app.post(
    "/admin/tag-aliases",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        body: {
          type: "object",
          required: ["slug", "label"],
          additionalProperties: false,
          properties: {
            slug: { type: "string", minLength: 1, maxLength: 60 },
            label: { type: "string", minLength: 1, maxLength: 80 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const body = request.body as { slug: string; label: string };
      // Normalizamos a la misma forma con la que Holded entrega los tags
      // (lowercase + trim) para que el upsert sea idempotente desde la UI.
      const slug = body.slug.trim().toLowerCase();
      const label = body.label.trim();
      if (slug.length === 0 || label.length === 0) {
        return reply
          .code(400)
          .send({ error: "INVALID_BODY", message: "slug y label son obligatorios." });
      }
      const prisma = getPrisma();
      const row = await prisma.tagAlias.upsert({
        where: { tenantId_slug: { tenantId: auth.tenantId, slug } },
        create: { tenantId: auth.tenantId, slug, label },
        update: { label },
        select: { id: true, slug: true, label: true },
      });
      return reply.code(200).send({ alias: row });
    },
  );

  app.delete(
    "/admin/tag-aliases/:id",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const r = await prisma.tagAlias.deleteMany({
        where: { id, tenantId: auth.tenantId },
      });
      if (r.count === 0) {
        return reply
          .code(404)
          .send({ error: "TAG_ALIAS_NOT_FOUND", message: "Alias no encontrado." });
      }
      return reply.code(200).send({ ok: true });
    },
  );
}
