// Catálogo de servicios extendido (B-koibox-2).
//
//   GET   /services/scheduling?query=          — servicios (product,
//                                                kind=SERVICE) con sus
//                                                campos de agenda (join
//                                                con service_scheduling).
//   PUT   /services/:productId/scheduling      — upsert de los campos de
//                                                agenda de un servicio.
//   GET   /services/:productId/resource-needs  — necesidades de recurso
//                                                de un servicio.
//   PUT   /services/:productId/resource-needs  — reemplaza el set de
//                                                necesidades de recurso.
//   GET   /resources                           — lista de recursos.
//   POST  /resources                           — alta de recurso.
//   PATCH /resources/:id                       — edición de recurso.
//   DELETE /resources/:id                      — baja de recurso.
//
// ADR-K1: es una capa de EXTENSIÓN local sobre el `product` espejo de
// Holded, NO una tabla `Service` paralela. Precio/IVA/alta viven en
// Holded y aquí NUNCA se tocan — sólo se añade el overlay de agenda.
// Un servicio sin fila en `service_scheduling` no tiene duración ni es
// reservable: la agenda (B4) lo ignora.
//
// Aislamiento por fila: toda query filtra por `auth.tenantId`. El
// scheduling y las necesidades de recurso se acceden SIEMPRE tras validar
// que el producto es un SERVICE del tenant (`loadOwnedService`).
//
// Gate por capability: el flag `agendaEnabled` viaja al front (TPV y
// admin), que muestra/oculta el módulo (ADR-K6). Los endpoints siguen la
// convención de B1 (CRM): existen con independencia del flag, el front es
// quien lo esconde. No se enforce el flag server-side.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ResourceKind, type Prisma } from "@mipiacetpv/db";

import {
  requireOwner,
  requireOwnerOrManager,
} from "../auth/middleware.js";
import { getPrisma } from "../context.js";

// Forma estable de los flags de canal. El front la lee tal cual; `online`
// debe ir de la mano de `onlineBookable`.
interface Channels {
  caja: boolean;
  ticket: boolean;
  agenda: boolean;
  online: boolean;
}

const DEFAULT_CHANNELS: Channels = {
  caja: true,
  ticket: true,
  agenda: true,
  online: false,
};

// Normaliza el jsonb `channels` a la forma estable (defensivo: filas
// viejas o payloads parciales caen a los defaults por clave).
function toChannels(raw: unknown): Channels {
  const c = (raw ?? {}) as Partial<Record<keyof Channels, unknown>>;
  return {
    caja: c.caja === undefined ? DEFAULT_CHANNELS.caja : Boolean(c.caja),
    ticket: c.ticket === undefined ? DEFAULT_CHANNELS.ticket : Boolean(c.ticket),
    agenda: c.agenda === undefined ? DEFAULT_CHANNELS.agenda : Boolean(c.agenda),
    online: c.online === undefined ? DEFAULT_CHANNELS.online : Boolean(c.online),
  };
}

function schedulingView(s: {
  productId: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  staffRequired: number;
  onlineBookable: boolean;
  family: string | null;
  channels: unknown;
  updatedAt: Date;
}) {
  return {
    durationMin: s.durationMin,
    bufferBeforeMin: s.bufferBeforeMin,
    bufferAfterMin: s.bufferAfterMin,
    staffRequired: s.staffRequired,
    onlineBookable: s.onlineBookable,
    family: s.family,
    channels: toChannels(s.channels),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// Carga un producto validando que es un SERVICE del tenant del actor.
// Devuelve null (→ 404) si no existe, es de otro tenant o no es servicio.
// Es la puerta de aislamiento para scheduling y necesidades de recurso.
async function loadOwnedService(tenantId: string, productId: string) {
  const prisma = getPrisma();
  return prisma.product.findFirst({
    where: { id: productId, tenantId, kind: "SERVICE" },
    select: { id: true },
  });
}

function serviceNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: "SERVICE_NOT_FOUND",
    message: "Servicio no encontrado.",
  });
}

const RESOURCE_KINDS = ["CABIN", "ROOM", "DEVICE"] as const;

export async function registerServicesRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── Servicios + campos de agenda ────────────────────────────────────
  app.get(
    "/services/scheduling",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string", maxLength: 120 },
          },
        },
      },
    },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const q = request.query as { query?: string };
      const prisma = getPrisma();
      const trimmed = (q.query ?? "").trim();

      const where: Prisma.ProductWhereInput = {
        tenantId: auth.tenantId,
        kind: "SERVICE",
      };
      if (trimmed.length > 0) {
        where.OR = [
          { name: { contains: trimmed, mode: "insensitive" } },
          { sku: { contains: trimmed, mode: "insensitive" } },
        ];
      }

      const services = await prisma.product.findMany({
        where,
        orderBy: { name: "asc" },
        take: 500,
        select: {
          id: true,
          holdedProductId: true,
          name: true,
          sku: true,
          basePrice: true,
          taxRate: true,
          active: true,
          scheduling: {
            select: {
              productId: true,
              durationMin: true,
              bufferBeforeMin: true,
              bufferAfterMin: true,
              staffRequired: true,
              onlineBookable: true,
              family: true,
              channels: true,
              updatedAt: true,
            },
          },
        },
      });

      return {
        items: services.map((s) => ({
          productId: s.id,
          holdedProductId: s.holdedProductId,
          name: s.name,
          sku: s.sku,
          // Precio/IVA vienen de Holded; se muestran informativos, NO se
          // editan aquí (ADR-K1).
          basePrice: Number(s.basePrice),
          taxRate: Number(s.taxRate),
          active: s.active,
          // null → el servicio aún no tiene overlay de agenda: no es
          // reservable ni tiene duración. El panel ofrece "añadir".
          scheduling: s.scheduling ? schedulingView(s.scheduling) : null,
        })),
      };
    },
  );

  // ── Upsert de los campos de agenda de un servicio ───────────────────
  app.put(
    "/services/:productId/scheduling",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["durationMin"],
          additionalProperties: false,
          properties: {
            durationMin: { type: "integer", minimum: 1, maximum: 1440 },
            bufferBeforeMin: { type: "integer", minimum: 0, maximum: 480 },
            bufferAfterMin: { type: "integer", minimum: 0, maximum: 480 },
            staffRequired: { type: "integer", minimum: 1, maximum: 12 },
            onlineBookable: { type: "boolean" },
            family: { type: ["string", "null"], maxLength: 120 },
            channels: {
              type: "object",
              additionalProperties: false,
              properties: {
                caja: { type: "boolean" },
                ticket: { type: "boolean" },
                agenda: { type: "boolean" },
                online: { type: "boolean" },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { productId } = request.params as { productId: string };
      const body = request.body as {
        durationMin: number;
        bufferBeforeMin?: number;
        bufferAfterMin?: number;
        staffRequired?: number;
        onlineBookable?: boolean;
        family?: string | null;
        channels?: Partial<Channels>;
      };
      const service = await loadOwnedService(auth.tenantId, productId);
      if (!service) return serviceNotFound(reply);
      const prisma = getPrisma();

      const channels: Channels = {
        ...DEFAULT_CHANNELS,
        ...(body.channels ?? {}),
      };
      // Coherencia: si el servicio no es reservable online, el canal
      // online no puede estar activo (contrato para B4/B6).
      const onlineBookable = body.onlineBookable ?? false;
      if (!onlineBookable) channels.online = false;

      const family = body.family?.trim() || null;
      const bufferBeforeMin = body.bufferBeforeMin ?? 0;
      const bufferAfterMin = body.bufferAfterMin ?? 0;
      const staffRequired = body.staffRequired ?? 1;

      const saved = await prisma.serviceScheduling.upsert({
        where: { productId },
        create: {
          productId,
          tenantId: auth.tenantId,
          durationMin: body.durationMin,
          bufferBeforeMin,
          bufferAfterMin,
          staffRequired,
          onlineBookable,
          family,
          channels: channels as unknown as Prisma.InputJsonValue,
        },
        update: {
          durationMin: body.durationMin,
          bufferBeforeMin,
          bufferAfterMin,
          staffRequired,
          onlineBookable,
          family,
          channels: channels as unknown as Prisma.InputJsonValue,
        },
        select: {
          productId: true,
          durationMin: true,
          bufferBeforeMin: true,
          bufferAfterMin: true,
          staffRequired: true,
          onlineBookable: true,
          family: true,
          channels: true,
          updatedAt: true,
        },
      });
      return { scheduling: schedulingView(saved) };
    },
  );

  // ── Necesidades de recurso de un servicio ───────────────────────────
  app.get(
    "/services/:productId/resource-needs",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { productId } = request.params as { productId: string };
      const service = await loadOwnedService(auth.tenantId, productId);
      if (!service) return serviceNotFound(reply);
      const prisma = getPrisma();
      const needs = await prisma.serviceResourceNeed.findMany({
        where: { serviceId: productId, tenantId: auth.tenantId },
        orderBy: { resourceKind: "asc" },
        select: { resourceKind: true, qty: true },
      });
      return { needs };
    },
  );

  // ── Reemplaza el set de necesidades de recurso de un servicio ───────
  // PUT = idempotente: el body define el estado final. Una necesidad por
  // tipo de recurso (pk compuesta serviceId+resourceKind).
  app.put(
    "/services/:productId/resource-needs",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["needs"],
          additionalProperties: false,
          properties: {
            needs: {
              type: "array",
              maxItems: 3,
              items: {
                type: "object",
                required: ["resourceKind"],
                additionalProperties: false,
                properties: {
                  resourceKind: { type: "string", enum: RESOURCE_KINDS },
                  qty: { type: "integer", minimum: 1, maximum: 20 },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { productId } = request.params as { productId: string };
      const body = request.body as {
        needs: Array<{ resourceKind: (typeof RESOURCE_KINDS)[number]; qty?: number }>;
      };
      const service = await loadOwnedService(auth.tenantId, productId);
      if (!service) return serviceNotFound(reply);
      const prisma = getPrisma();

      // Dedup por tipo (el último gana): la pk no admite duplicados.
      const byKind = new Map<
        (typeof RESOURCE_KINDS)[number],
        number
      >();
      for (const n of body.needs) byKind.set(n.resourceKind, n.qty ?? 1);

      await prisma.$transaction([
        prisma.serviceResourceNeed.deleteMany({
          where: { serviceId: productId, tenantId: auth.tenantId },
        }),
        ...(byKind.size > 0
          ? [
              prisma.serviceResourceNeed.createMany({
                data: [...byKind.entries()].map(([resourceKind, qty]) => ({
                  serviceId: productId,
                  tenantId: auth.tenantId,
                  resourceKind: ResourceKind[resourceKind],
                  qty,
                })),
              }),
            ]
          : []),
      ]);

      const needs = await prisma.serviceResourceNeed.findMany({
        where: { serviceId: productId, tenantId: auth.tenantId },
        orderBy: { resourceKind: "asc" },
        select: { resourceKind: true, qty: true },
      });
      return { needs };
    },
  );

  // ── Recursos (CRUD) ─────────────────────────────────────────────────
  app.get(
    "/resources",
    { preHandler: requireOwnerOrManager },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const resources = await prisma.resource.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: [{ kind: "asc" }, { name: "asc" }],
        select: { id: true, name: true, kind: true },
      });
      return { resources };
    },
  );

  app.post(
    "/resources",
    {
      preHandler: requireOwner,
      schema: {
        body: {
          type: "object",
          required: ["name", "kind"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            kind: { type: "string", enum: RESOURCE_KINDS },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        name: string;
        kind: (typeof RESOURCE_KINDS)[number];
      };
      const prisma = getPrisma();
      const resource = await prisma.resource.create({
        data: {
          tenantId: auth.tenantId,
          name: body.name.trim(),
          kind: ResourceKind[body.kind],
        },
        select: { id: true, name: true, kind: true },
      });
      return reply.code(201).send({ resource });
    },
  );

  app.patch(
    "/resources/:id",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            kind: { type: "string", enum: RESOURCE_KINDS },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        kind?: (typeof RESOURCE_KINDS)[number];
      };
      const prisma = getPrisma();
      // Aislamiento: validar propiedad antes de mutar.
      const existing = await prisma.resource.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({
          error: "RESOURCE_NOT_FOUND",
          message: "Recurso no encontrado.",
        });
      }
      const data: Prisma.ResourceUpdateInput = {};
      if (body.name !== undefined) data.name = body.name.trim();
      if (body.kind !== undefined) data.kind = ResourceKind[body.kind];
      const resource = await prisma.resource.update({
        where: { id },
        data,
        select: { id: true, name: true, kind: true },
      });
      return { resource };
    },
  );

  app.delete(
    "/resources/:id",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const existing = await prisma.resource.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({
          error: "RESOURCE_NOT_FOUND",
          message: "Recurso no encontrado.",
        });
      }
      await prisma.resource.delete({ where: { id } });
      return reply.code(200).send({ deleted: true });
    },
  );
}
