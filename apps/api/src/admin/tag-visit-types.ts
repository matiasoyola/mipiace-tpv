// clinica-5 · CRUD del mapa `categoría → tipo de visita`.
//
// La dueña asigna cada etiqueta de su catálogo (los slugs que vienen de
// Holded o del catálogo local — «podologia», «cirugia») a uno de los cinco
// tipos de visita. De ahí sale qué tarjeta abre la sesión y de qué tipo se
// cobra cada línea, y los servicios lo heredan sin tocarlos uno a uno
// (S5).
//
//   GET    /admin/tag-visit-types       → lista las entradas del tenant.
//   POST   /admin/tag-visit-types       → upsert idempotente por slug.
//   DELETE /admin/tag-visit-types/:id   → quita el mapeo.
//
// Mismo contrato, mismas tres rutas y mismos verbos que
// `/admin/tag-sections` (v1.4-Bar-Operativa). No es pereza: es que el
// panel reutiliza la forma y la dueña reconoce la pantalla.
//
// ── La puerta: `ensureClinicaEnabled`, no `ensureCajaEnabled` ────────
//
// Las hermanas (`tag-aliases`, `tag-sections`) van tras la capability de
// caja. Ésta va tras la de la HISTORIA CLÍNICA, y con ella la 404 que se
// hace pasar por ruta inexistente (clinica-1 §1): un tipo de visita sólo
// significa algo donde hay historia, y una ruta que contestara 403 le
// diría a un bar que en este sistema existe un módulo de datos de salud.
//
// ── Y lo que esta ruta NO hace: comprobar los servicios ──────────────
//
// Quitarle el tipo a una categoría puede dejar un servicio de sesión sin
// tipo, y eso es justo lo que el guardado de un servicio rechaza
// (`tipoDelServicio`, motivo `SESION_SIN_TIPO`). Aquí no se comprueba, a
// propósito: la regla se aplica cuando se guarda un servicio, que es
// cuando alguien está mirando ese servicio y puede arreglarlo. Bloquear el
// borrado de un mapeo habría obligado a la dueña a desmarcar seis
// servicios antes de poder corregir una categoría mal puesta, sin decirle
// cuáles.
//
// Lo que sí pasa mientras tanto: el servicio sin tipo no sale en ninguna
// tarjeta de la sesión. No se cobra de más ni se cobra mal — deja de
// ofrecerse, que es el fallo seguro.

import type { FastifyInstance } from "fastify";
import {
  TIPOS_DE_VISITA,
  normalizarSlug,
} from "@mipiacetpv/clinica-sesion";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { getPrisma } from "../context.js";

const guard = { preHandler: [requireOwnerOrManager, ensureClinicaEnabled] };

export async function registerAdminTagVisitTypesRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/admin/tag-visit-types", guard, async (request) => {
    const auth = request.auth!;
    const items = await getPrisma().tagVisitType.findMany({
      where: { tenantId: auth.tenantId },
      orderBy: [{ visitType: "asc" }, { slug: "asc" }],
      select: { id: true, slug: true, visitType: true },
    });
    return { items };
  });

  app.post(
    "/admin/tag-visit-types",
    {
      ...guard,
      schema: {
        body: {
          type: "object",
          required: ["slug", "visitType"],
          additionalProperties: false,
          properties: {
            slug: { type: "string", minLength: 1, maxLength: 60 },
            // La lista cerrada del paquete, no una copia escrita a mano:
            // un tipo nuevo se añade allí y esta ruta lo admite sola.
            visitType: { type: "string", enum: [...TIPOS_DE_VISITA] },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const body = request.body as {
        slug: string;
        visitType: (typeof TIPOS_DE_VISITA)[number];
      };
      // La MISMA normalización con la que la sesión lee (`normalizarSlug`,
      // del paquete): minúsculas y sin espacios al borde, que es la forma
      // en la que Holded entrega los tags. Si el guardado normalizara de
      // otra manera que la lectura, «Podologia» se guardaría y nunca
      // casaría con el tag del producto.
      const slug = normalizarSlug(body.slug);
      if (slug.length === 0) {
        return reply
          .code(400)
          .send({ error: "INVALID_BODY", message: "La categoría es obligatoria." });
      }
      const row = await getPrisma().tagVisitType.upsert({
        where: { tenantId_slug: { tenantId: auth.tenantId, slug } },
        create: { tenantId: auth.tenantId, slug, visitType: body.visitType },
        update: { visitType: body.visitType },
        select: { id: true, slug: true, visitType: true },
      });
      return reply.code(200).send({ tagVisitType: row });
    },
  );

  app.delete(
    "/admin/tag-visit-types/:id",
    {
      ...guard,
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
      // `deleteMany` con el tenant en el `where` y no `delete` por id: el
      // aislamiento por fila va en la consulta, no en una comprobación
      // previa. Misma forma que `/admin/tag-sections`.
      const r = await getPrisma().tagVisitType.deleteMany({
        where: { id, tenantId: auth.tenantId },
      });
      if (r.count === 0) {
        return reply.code(404).send({
          error: "TAG_VISIT_TYPE_NOT_FOUND",
          message: "Mapeo no encontrado.",
        });
      }
      return reply.code(200).send({ ok: true });
    },
  );
}
