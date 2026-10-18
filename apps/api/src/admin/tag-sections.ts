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
//   GET    /admin/tag-sections/etiquetas → las etiquetas REALES del
//                                     catálogo, con su sección si la
//                                     tienen (auditoria-sirope #19).
//   POST   /admin/tag-sections       → upsert idempotente por slug.
//   DELETE /admin/tag-sections/:id   → quita el mapeo (la línea cae a SALON).

import type { FastifyInstance } from "fastify";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { ensureCajaEnabled } from "../lib/caja-gate.js";

const SECTIONS = ["BARRA", "COCINA", "SALON"] as const;

export async function registerAdminTagSectionsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/admin/tag-sections",
    { preHandler: [requireOwnerOrManager, ensureCajaEnabled] },
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

  // auditoria-sirope (#19) · LAS ETIQUETAS QUE EXISTEN DE VERDAD.
  //
  // «Comanderas» pedía teclear a mano «el slug de Holded». Dos problemas,
  // y el 18-10 se pagaron los dos: Sirope ya no usa Holded —así que el
  // rótulo manda a buscar algo que no existe— y una etiqueta mal tecleada
  // no da error: simplemente no mapea nada y sus platos caen a SALÓN sin
  // que nadie lo note. La primera comanda de la T6 se perdió así.
  //
  // Con esto la página puede listar las etiquetas del catálogo y poner un
  // selector al lado de cada una. Lo que no se puede teclear, no se puede
  // teclear mal.
  app.get(
    "/admin/tag-sections/etiquetas",
    { preHandler: [requireOwnerOrManager, ensureCajaEnabled] },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const [productos, mapeos] = await Promise.all([
        prisma.product.findMany({
          where: {
            tenantId: auth.tenantId,
            active: true,
            archivedFromHoldedAt: null,
          },
          select: { tags: true },
        }),
        prisma.tagSection.findMany({
          where: { tenantId: auth.tenantId },
          select: { id: true, slug: true, section: true },
        }),
      ]);
      const cuenta = new Map<string, number>();
      for (const p of productos) {
        for (const t of p.tags) {
          const slug = t.trim().toLowerCase();
          if (!slug) continue;
          cuenta.set(slug, (cuenta.get(slug) ?? 0) + 1);
        }
      }
      const porSlug = new Map(mapeos.map((m) => [m.slug, m] as const));
      // Las etiquetas del catálogo, y además las mapeadas que ya no
      // tienen productos: son las que sobran y el dueño tiene que poder
      // verlas para quitarlas.
      const slugs = new Set<string>([...cuenta.keys(), ...porSlug.keys()]);
      const etiquetas = [...slugs]
        .sort((a, b) => a.localeCompare(b, "es"))
        .map((slug) => ({
          slug,
          productCount: cuenta.get(slug) ?? 0,
          section: porSlug.get(slug)?.section ?? null,
          mapeoId: porSlug.get(slug)?.id ?? null,
        }));
      return {
        etiquetas,
        // Cuántas etiquetas con productos no tienen sección: es el aviso
        // que la página pinta arriba, y el mismo número que mira el panel.
        sinSeccion: etiquetas.filter(
          (e) => e.section == null && e.productCount > 0,
        ).length,
      };
    },
  );

  app.post(
    "/admin/tag-sections",
    {
      preHandler: [requireOwnerOrManager, ensureCajaEnabled],
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
      preHandler: [requireOwnerOrManager, ensureCajaEnabled],
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
