// v1.4-Bar-Operativa-MVP Lote 2 · CRUD del mapa `tag → KitchenSection`.
//
// El OWNER/MANAGER asigna cada tag de su catálogo (los mismos slugs
// que vienen de Holded — "cafes", "tapas", "vinos") a una sección
// (BARRA / COCINA / SALON). El endpoint de comanderas usa este mapa
// para agrupar las líneas del ticket al enviar.
//
// Tags no mapeados caen a SALON en el endpoint de envío — es el
// default razonable: la línea acaba en el papel del camarero, que es
// quien la lleva en mano. Por eso el admin sólo añade entradas para
// BARRA y COCINA en la práctica; el resto se queda en SALON sin
// configurar nada.
//
//   GET    /admin/tag-sections       → lista las entradas del tenant.
//   POST   /admin/tag-sections       → upsert idempotente por slug.
//   DELETE /admin/tag-sections/:id   → quita el mapeo (la línea cae a SALON).

import type { FastifyInstance } from "fastify";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";

const SECTIONS = ["BARRA", "COCINA", "SALON"] as const;

export async function registerAdminTagSectionsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/admin/tag-sections",
    { preHandler: requireOwnerOrManager },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const items = await prisma.tagSection.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: [{ section: "asc" }, { slug: "asc" }],
        select: { id: true, slug: true, section: true },
      });
      return { items };
    },
  );

  app.post(
    "/admin/tag-sections",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        body: {
          type: "object",
          required: ["slug", "section"],
          additionalProperties: false,
          properties: {
            slug: { type: "string", minLength: 1, maxLength: 60 },
            section: { type: "string", enum: SECTIONS as unknown as string[] },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const body = request.body as {
        slug: string;
        section: (typeof SECTIONS)[number];
      };
      const slug = body.slug.trim().toLowerCase();
      if (slug.length === 0) {
        return reply
          .code(400)
          .send({ error: "INVALID_BODY", message: "slug obligatorio." });
      }
      const prisma = getPrisma();
      const row = await prisma.tagSection.upsert({
        where: { tenantId_slug: { tenantId: auth.tenantId, slug } },
        create: { tenantId: auth.tenantId, slug, section: body.section },
        update: { section: body.section },
        select: { id: true, slug: true, section: true },
      });
      return reply.code(200).send({ tagSection: row });
    },
  );

  app.delete(
    "/admin/tag-sections/:id",
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
      const r = await prisma.tagSection.deleteMany({
        where: { id, tenantId: auth.tenantId },
      });
      if (r.count === 0) {
        return reply
          .code(404)
          .send({ error: "TAG_SECTION_NOT_FOUND", message: "Mapeo no encontrado." });
      }
      return reply.code(200).send({ ok: true });
    },
  );
}
