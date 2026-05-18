// Backend del Frente 2 de B-Bar-Modifiers — CRUD admin de grupos de
// modificadores (caso B confirmado en spike §14).
//
// Holded no expone modificadores nativamente, así que el catálogo
// vive entero en mipiacetpv per-tenant. OWNER y MANAGER pueden ambos
// gestionar el menú (es operativa diaria de barra, no infraestructura).
//
//   GET    /admin/modifier-groups                          → listar
//   POST   /admin/modifier-groups                          → crear grupo
//   PATCH  /admin/modifier-groups/:groupId                 → editar grupo
//   DELETE /admin/modifier-groups/:groupId                 → soft-delete
//
//   POST   /admin/modifier-groups/:groupId/modifiers       → añadir item
//   PATCH  /admin/modifier-groups/:groupId/modifiers/:id   → editar item
//   DELETE /admin/modifier-groups/:groupId/modifiers/:id   → soft-delete
//
//   POST   /admin/products/:productId/modifier-groups/:groupId  → asociar
//   DELETE /admin/products/:productId/modifier-groups/:groupId  → desasociar
//
// El soft-delete preserva el snapshot inmutable de TicketLine.modifiers
// — si un MANAGER quita "Tipo de leche" del menú, los tickets históricos
// siguen mostrando el desglose con el groupName/label congelado.

import type { FastifyInstance } from "fastify";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";

interface ModifierGroupView {
  id: string;
  name: string;
  exclusive: boolean;
  required: boolean;
  sortOrder: number;
  createdAt: string;
  modifiers: ModifierView[];
  productIds: string[];
}

interface ModifierView {
  id: string;
  label: string;
  priceDeltaCents: number;
  sortOrder: number;
  isDefault: boolean;
}

function viewGroup(
  group: {
    id: string;
    name: string;
    exclusive: boolean;
    required: boolean;
    sortOrder: number;
    createdAt: Date;
    modifiers: {
      id: string;
      label: string;
      priceDeltaCents: number;
      sortOrder: number;
      isDefault: boolean;
    }[];
    products: { productId: string }[];
  },
): ModifierGroupView {
  return {
    id: group.id,
    name: group.name,
    exclusive: group.exclusive,
    required: group.required,
    sortOrder: group.sortOrder,
    createdAt: group.createdAt.toISOString(),
    modifiers: group.modifiers.map((m) => ({
      id: m.id,
      label: m.label,
      priceDeltaCents: m.priceDeltaCents,
      sortOrder: m.sortOrder,
      isDefault: m.isDefault,
    })),
    productIds: group.products.map((p) => p.productId),
  };
}

export async function registerAdminModifierGroupRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── LIST ─────────────────────────────────────────────────────────
  app.get(
    "/admin/modifier-groups",
    { preHandler: requireOwnerOrManager },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const groups = await prisma.modifierGroup.findMany({
        where: { tenantId: auth.tenantId, deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          modifiers: {
            where: { deletedAt: null },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          products: { select: { productId: true } },
        },
      });
      return { groups: groups.map(viewGroup) };
    },
  );

  // ── CREATE GROUP ─────────────────────────────────────────────────
  app.post(
    "/admin/modifier-groups",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            exclusive: { type: "boolean" },
            required: { type: "boolean" },
            sortOrder: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const body = request.body as {
        name: string;
        exclusive?: boolean;
        required?: boolean;
        sortOrder?: number;
      };
      const prisma = getPrisma();
      const group = await prisma.modifierGroup.create({
        data: {
          tenantId: auth.tenantId,
          name: body.name.trim(),
          exclusive: body.exclusive ?? true,
          required: body.required ?? false,
          sortOrder: body.sortOrder ?? 0,
        },
        include: {
          modifiers: { where: { deletedAt: null } },
          products: { select: { productId: true } },
        },
      });
      return reply.code(201).send({ group: viewGroup(group) });
    },
  );

  // ── PATCH GROUP ──────────────────────────────────────────────────
  app.patch(
    "/admin/modifier-groups/:groupId",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["groupId"],
          properties: { groupId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            exclusive: { type: "boolean" },
            required: { type: "boolean" },
            sortOrder: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { groupId } = request.params as { groupId: string };
      const body = request.body as {
        name?: string;
        exclusive?: boolean;
        required?: boolean;
        sortOrder?: number;
      };
      const prisma = getPrisma();
      const existing = await prisma.modifierGroup.findFirst({
        where: { id: groupId, tenantId: auth.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) {
        return reply
          .code(404)
          .send({ error: "MODIFIER_GROUP_NOT_FOUND", message: "Grupo no encontrado" });
      }
      const group = await prisma.modifierGroup.update({
        where: { id: groupId },
        data: {
          name: body.name?.trim(),
          exclusive: body.exclusive,
          required: body.required,
          sortOrder: body.sortOrder,
        },
        include: {
          modifiers: {
            where: { deletedAt: null },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          products: { select: { productId: true } },
        },
      });
      return reply.code(200).send({ group: viewGroup(group) });
    },
  );

  // ── DELETE GROUP (soft) ──────────────────────────────────────────
  app.delete(
    "/admin/modifier-groups/:groupId",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["groupId"],
          properties: { groupId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { groupId } = request.params as { groupId: string };
      const prisma = getPrisma();
      const result = await prisma.modifierGroup.updateMany({
        where: { id: groupId, tenantId: auth.tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) {
        return reply
          .code(404)
          .send({ error: "MODIFIER_GROUP_NOT_FOUND", message: "Grupo no encontrado" });
      }
      return reply.code(204).send();
    },
  );

  // ── ADD MODIFIER ─────────────────────────────────────────────────
  app.post(
    "/admin/modifier-groups/:groupId/modifiers",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["groupId"],
          properties: { groupId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["label"],
          additionalProperties: false,
          properties: {
            label: { type: "string", minLength: 1, maxLength: 100 },
            priceDeltaCents: { type: "integer" },
            sortOrder: { type: "integer", minimum: 0 },
            isDefault: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { groupId } = request.params as { groupId: string };
      const body = request.body as {
        label: string;
        priceDeltaCents?: number;
        sortOrder?: number;
        isDefault?: boolean;
      };
      const prisma = getPrisma();
      const group = await prisma.modifierGroup.findFirst({
        where: { id: groupId, tenantId: auth.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!group) {
        return reply
          .code(404)
          .send({ error: "MODIFIER_GROUP_NOT_FOUND", message: "Grupo no encontrado" });
      }
      const modifier = await prisma.modifier.create({
        data: {
          modifierGroupId: groupId,
          label: body.label.trim(),
          priceDeltaCents: body.priceDeltaCents ?? 0,
          sortOrder: body.sortOrder ?? 0,
          isDefault: body.isDefault ?? false,
        },
      });
      return reply.code(201).send({
        modifier: {
          id: modifier.id,
          label: modifier.label,
          priceDeltaCents: modifier.priceDeltaCents,
          sortOrder: modifier.sortOrder,
          isDefault: modifier.isDefault,
        },
      });
    },
  );

  // ── PATCH MODIFIER ───────────────────────────────────────────────
  app.patch(
    "/admin/modifier-groups/:groupId/modifiers/:modifierId",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["groupId", "modifierId"],
          properties: {
            groupId: { type: "string", format: "uuid" },
            modifierId: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string", minLength: 1, maxLength: 100 },
            priceDeltaCents: { type: "integer" },
            sortOrder: { type: "integer", minimum: 0 },
            isDefault: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { groupId, modifierId } = request.params as {
        groupId: string;
        modifierId: string;
      };
      const body = request.body as {
        label?: string;
        priceDeltaCents?: number;
        sortOrder?: number;
        isDefault?: boolean;
      };
      const prisma = getPrisma();
      // Cross-tenant fence: subir desde el modifier al grupo y verificar
      // tenant del grupo. Una sola query.
      const modifier = await prisma.modifier.findFirst({
        where: {
          id: modifierId,
          modifierGroupId: groupId,
          deletedAt: null,
          modifierGroup: { tenantId: auth.tenantId, deletedAt: null },
        },
        select: { id: true },
      });
      if (!modifier) {
        return reply
          .code(404)
          .send({ error: "MODIFIER_NOT_FOUND", message: "Modifier no encontrado" });
      }
      const updated = await prisma.modifier.update({
        where: { id: modifierId },
        data: {
          label: body.label?.trim(),
          priceDeltaCents: body.priceDeltaCents,
          sortOrder: body.sortOrder,
          isDefault: body.isDefault,
        },
      });
      return reply.code(200).send({
        modifier: {
          id: updated.id,
          label: updated.label,
          priceDeltaCents: updated.priceDeltaCents,
          sortOrder: updated.sortOrder,
          isDefault: updated.isDefault,
        },
      });
    },
  );

  // ── DELETE MODIFIER (soft) ───────────────────────────────────────
  app.delete(
    "/admin/modifier-groups/:groupId/modifiers/:modifierId",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["groupId", "modifierId"],
          properties: {
            groupId: { type: "string", format: "uuid" },
            modifierId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { groupId, modifierId } = request.params as {
        groupId: string;
        modifierId: string;
      };
      const prisma = getPrisma();
      const result = await prisma.modifier.updateMany({
        where: {
          id: modifierId,
          modifierGroupId: groupId,
          deletedAt: null,
          modifierGroup: { tenantId: auth.tenantId, deletedAt: null },
        },
        data: { deletedAt: new Date() },
      });
      if (result.count === 0) {
        return reply
          .code(404)
          .send({ error: "MODIFIER_NOT_FOUND", message: "Modifier no encontrado" });
      }
      return reply.code(204).send();
    },
  );

  // ── ASSOCIATE PRODUCT ⇄ GROUP ────────────────────────────────────
  app.post(
    "/admin/products/:productId/modifier-groups/:groupId",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["productId", "groupId"],
          properties: {
            productId: { type: "string", format: "uuid" },
            groupId: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            sortOrder: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { productId, groupId } = request.params as {
        productId: string;
        groupId: string;
      };
      const body = (request.body ?? {}) as { sortOrder?: number };
      const prisma = getPrisma();

      // Ambos lados deben pertenecer al tenant. Una transacción ligera
      // garantiza la atomicidad y simplifica los 404 (cualquiera de los
      // dos faltando es el mismo error semántico).
      const [product, group] = await Promise.all([
        prisma.product.findFirst({
          where: { id: productId, tenantId: auth.tenantId },
          select: { id: true },
        }),
        prisma.modifierGroup.findFirst({
          where: { id: groupId, tenantId: auth.tenantId, deletedAt: null },
          select: { id: true },
        }),
      ]);
      if (!product) {
        return reply
          .code(404)
          .send({ error: "PRODUCT_NOT_FOUND", message: "Producto no encontrado" });
      }
      if (!group) {
        return reply
          .code(404)
          .send({ error: "MODIFIER_GROUP_NOT_FOUND", message: "Grupo no encontrado" });
      }

      // Upsert: idempotente; si la PWA repinta y reenvía, no falla.
      const link = await prisma.productModifierGroup.upsert({
        where: {
          productId_modifierGroupId: {
            productId,
            modifierGroupId: groupId,
          },
        },
        create: {
          productId,
          modifierGroupId: groupId,
          sortOrder: body.sortOrder ?? 0,
        },
        update: { sortOrder: body.sortOrder ?? 0 },
      });
      return reply.code(200).send({
        link: {
          productId: link.productId,
          modifierGroupId: link.modifierGroupId,
          sortOrder: link.sortOrder,
        },
      });
    },
  );

  app.delete(
    "/admin/products/:productId/modifier-groups/:groupId",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["productId", "groupId"],
          properties: {
            productId: { type: "string", format: "uuid" },
            groupId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { productId, groupId } = request.params as {
        productId: string;
        groupId: string;
      };
      const prisma = getPrisma();
      // El deleteMany con la cláusula cross-tenant en cascada evita un
      // findFirst+delete y devuelve count=0 si no era del tenant.
      const result = await prisma.productModifierGroup.deleteMany({
        where: {
          productId,
          modifierGroupId: groupId,
          product: { tenantId: auth.tenantId },
          modifierGroup: { tenantId: auth.tenantId },
        },
      });
      if (result.count === 0) {
        return reply
          .code(404)
          .send({ error: "LINK_NOT_FOUND", message: "Asociación no encontrada" });
      }
      return reply.code(204).send();
    },
  );
}
