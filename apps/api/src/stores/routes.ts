// Endpoints de gestión de tiendas, almacenes y cajas (B4 §0.2).
//
//   GET    /admin/warehouses              — listado de almacenes Holded del tenant.
//   GET    /admin/stores                  — listado con conteos + ventas mes.
//   POST   /admin/stores                  — alta de tienda.
//   GET    /admin/stores/:id              — detalle con sus cajas.
//   PATCH  /admin/stores/:id              — edita name / fiscalAddress / warehouseHoldedId.
//   DELETE /admin/stores/:id              — soft-delete si no quedan cajas activas.
//   POST   /admin/stores/:id/registers    — alta de caja.
//   PATCH  /admin/registers/:id           — edita name / numSerieHolded / printerConfig.
//   DELETE /admin/registers/:id           — soft-delete si no hay devices ni tickets.
//
// El prompt B4 §0.2 distingue entre crear stores, crear registers, y
// editar campos sensibles (warehouseHoldedId con tickets ya hechos no
// debería cambiarse). Estas rutas implementan esos guardrails.

import type { FastifyInstance } from "fastify";

import { requireOwner, requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";

export async function registerStoresRoutes(app: FastifyInstance): Promise<void> {
  // Listado de almacenes Holded del tenant. Se usa para alimentar el
  // select "Almacén Holded" al crear/editar una tienda. Devuelve el
  // cache local poblado por el sync inicial — no llama a Holded en vivo.
  app.get(
    "/admin/warehouses",
    { preHandler: requireOwnerOrManager },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const warehouses = await prisma.warehouse.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: { name: "asc" },
        select: { id: true, holdedWarehouseId: true, name: true },
      });
      return { warehouses };
    },
  );

  app.get(
    "/admin/stores",
    { preHandler: requireOwnerOrManager },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const stores = await prisma.store.findMany({
        where: { tenantId: auth.tenantId, deletedAt: null },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          fiscalAddress: true,
          warehouseHoldedId: true,
          createdAt: true,
          registers: {
            where: { deletedAt: null },
            select: { id: true },
          },
        },
      });
      // Conteo de devices activos y ventas del último mes en agregados
      // separados — evitamos N+1 con un único query agrupado.
      const storeIds = stores.map((s) => s.id);
      const registers = stores.flatMap((s) =>
        s.registers.map((r) => ({ storeId: s.id, registerId: r.id })),
      );
      const registerIds = registers.map((r) => r.registerId);

      const [warehouseList, devicesByRegister, salesByStore] = await Promise.all([
        prisma.warehouse.findMany({
          where: { tenantId: auth.tenantId },
          select: { holdedWarehouseId: true, name: true },
        }),
        registerIds.length === 0
          ? []
          : prisma.device.groupBy({
              by: ["registerId"],
              where: {
                registerId: { in: registerIds },
                revokedAt: null,
              },
              _count: true,
            }),
        storeIds.length === 0
          ? []
          : prisma.ticket.findMany({
              where: {
                tenantId: auth.tenantId,
                createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
                status: { in: ["PAID", "PENDING_SYNC", "SYNCED"] },
              },
              select: {
                registerId: true,
                total: true,
              },
            }),
      ]);

      const warehouseNameById = new Map(
        warehouseList.map((w) => [w.holdedWarehouseId, w.name]),
      );
      const devicesByRegisterId = new Map<string, number>();
      for (const row of devicesByRegister) {
        devicesByRegisterId.set(row.registerId, row._count);
      }
      const storeOfRegister = new Map(
        registers.map((r) => [r.registerId, r.storeId]),
      );
      const salesByStoreId = new Map<string, number>();
      for (const t of salesByStore as Array<{
        registerId: string;
        total: { toString(): string } | string | number;
      }>) {
        const storeId = storeOfRegister.get(t.registerId);
        if (!storeId) continue;
        const amount = Number((t.total as { toString(): string }).toString());
        salesByStoreId.set(storeId, (salesByStoreId.get(storeId) ?? 0) + amount);
      }

      return {
        stores: stores.map((s) => {
          const registerCount = s.registers.length;
          const activeDevices = s.registers.reduce(
            (acc, r) => acc + (devicesByRegisterId.get(r.id) ?? 0),
            0,
          );
          return {
            id: s.id,
            name: s.name,
            fiscalAddress: s.fiscalAddress,
            warehouseHoldedId: s.warehouseHoldedId,
            warehouseName: s.warehouseHoldedId
              ? warehouseNameById.get(s.warehouseHoldedId) ?? null
              : null,
            registerCount,
            activeDevices,
            salesLast30d: salesByStoreId.get(s.id) ?? 0,
            createdAt: s.createdAt.toISOString(),
          };
        }),
      };
    },
  );

  app.post(
    "/admin/stores",
    {
      preHandler: requireOwner,
      schema: {
        body: {
          type: "object",
          required: ["name", "warehouseHoldedId"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            warehouseHoldedId: { type: "string", minLength: 1, maxLength: 64 },
            fiscalAddress: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const body = request.body as {
        name: string;
        warehouseHoldedId: string;
        fiscalAddress?: Record<string, unknown>;
      };
      const prisma = getPrisma();
      // Defensa: el warehouseHoldedId debe existir en el tenant. Si no,
      // el sync de stock pintaría datos incoherentes y el cierre Z saldría
      // sin almacén.
      const warehouse = await prisma.warehouse.findFirst({
        where: {
          tenantId: auth.tenantId,
          holdedWarehouseId: body.warehouseHoldedId,
        },
        select: { id: true },
      });
      if (!warehouse) {
        return reply.code(400).send({
          error: "WAREHOUSE_NOT_FOUND",
          message: "El almacén Holded no existe en tu cuenta.",
        });
      }
      const store = await prisma.store.create({
        data: {
          tenantId: auth.tenantId,
          name: body.name,
          warehouseHoldedId: body.warehouseHoldedId,
          fiscalAddress: (body.fiscalAddress ?? undefined) as object | undefined,
        },
        select: { id: true, name: true, warehouseHoldedId: true },
      });
      return reply.code(201).send({ store });
    },
  );

  app.get(
    "/admin/stores/:storeId",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { storeId } = request.params as { storeId: string };
      const prisma = getPrisma();
      const store = await prisma.store.findFirst({
        where: { id: storeId, tenantId: auth.tenantId, deletedAt: null },
        select: {
          id: true,
          name: true,
          fiscalAddress: true,
          warehouseHoldedId: true,
          createdAt: true,
          registers: {
            where: { deletedAt: null },
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              numSerieHolded: true,
              ticketCounter: true,
              printerConfig: true,
              createdAt: true,
            },
          },
        },
      });
      if (!store) {
        return reply.code(404).send({
          error: "STORE_NOT_FOUND",
          message: "Tienda no encontrada",
        });
      }
      // Por cada register, devices activos y última venta.
      const registerIds = store.registers.map((r) => r.id);
      const [devicesByRegister, lastSales] = await Promise.all([
        registerIds.length === 0
          ? []
          : prisma.device.groupBy({
              by: ["registerId"],
              where: { registerId: { in: registerIds }, revokedAt: null },
              _count: true,
            }),
        registerIds.length === 0
          ? []
          : prisma.ticket.groupBy({
              by: ["registerId"],
              where: { registerId: { in: registerIds } },
              _max: { createdAt: true },
            }),
      ]);
      const devicesMap = new Map<string, number>();
      for (const row of devicesByRegister) {
        devicesMap.set(row.registerId, row._count);
      }
      const lastSaleMap = new Map<string, string>();
      for (const row of lastSales) {
        const last = row._max.createdAt;
        if (last) lastSaleMap.set(row.registerId, last.toISOString());
      }

      const warehouse = store.warehouseHoldedId
        ? await prisma.warehouse.findFirst({
            where: {
              tenantId: auth.tenantId,
              holdedWarehouseId: store.warehouseHoldedId,
            },
            select: { holdedWarehouseId: true, name: true },
          })
        : null;

      return {
        store: {
          id: store.id,
          name: store.name,
          fiscalAddress: store.fiscalAddress,
          warehouseHoldedId: store.warehouseHoldedId,
          warehouseName: warehouse?.name ?? null,
          createdAt: store.createdAt.toISOString(),
          registers: store.registers.map((r) => ({
            id: r.id,
            name: r.name,
            numSerieHolded: r.numSerieHolded,
            ticketCounter: r.ticketCounter,
            activeDevices: devicesMap.get(r.id) ?? 0,
            lastSaleAt: lastSaleMap.get(r.id) ?? null,
            createdAt: r.createdAt.toISOString(),
          })),
        },
      };
    },
  );

  app.patch(
    "/admin/stores/:storeId",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            warehouseHoldedId: { type: "string", minLength: 1, maxLength: 64 },
            fiscalAddress: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { storeId } = request.params as { storeId: string };
      const body = request.body as {
        name?: string;
        warehouseHoldedId?: string;
        fiscalAddress?: Record<string, unknown>;
      };
      const prisma = getPrisma();
      const store = await prisma.store.findFirst({
        where: { id: storeId, tenantId: auth.tenantId, deletedAt: null },
        select: { id: true, warehouseHoldedId: true },
      });
      if (!store) {
        return reply.code(404).send({
          error: "STORE_NOT_FOUND",
          message: "Tienda no encontrada",
        });
      }
      // Guardrail: cambiar el warehouse de una tienda con tickets ya
      // emitidos rompe el histórico de stock. El propietario debe crear
      // tienda nueva si quiere otro almacén.
      if (
        body.warehouseHoldedId &&
        body.warehouseHoldedId !== store.warehouseHoldedId
      ) {
        const hasTickets = await prisma.ticket.findFirst({
          where: { register: { storeId } },
          select: { id: true },
        });
        if (hasTickets) {
          return reply.code(409).send({
            error: "STORE_HAS_TICKETS",
            message:
              "Esta tienda ya tiene tickets emitidos. Cambiar el almacén rompería el histórico de stock.",
          });
        }
        const warehouse = await prisma.warehouse.findFirst({
          where: {
            tenantId: auth.tenantId,
            holdedWarehouseId: body.warehouseHoldedId,
          },
          select: { id: true },
        });
        if (!warehouse) {
          return reply.code(400).send({
            error: "WAREHOUSE_NOT_FOUND",
            message: "El almacén Holded no existe en tu cuenta.",
          });
        }
      }
      const updated = await prisma.store.update({
        where: { id: storeId },
        data: {
          name: body.name,
          warehouseHoldedId: body.warehouseHoldedId,
          fiscalAddress: body.fiscalAddress
            ? (body.fiscalAddress as object)
            : undefined,
        },
        select: { id: true, name: true, warehouseHoldedId: true, fiscalAddress: true },
      });
      return reply.code(200).send({ store: updated });
    },
  );

  app.delete(
    "/admin/stores/:storeId",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { storeId } = request.params as { storeId: string };
      const prisma = getPrisma();
      const store = await prisma.store.findFirst({
        where: { id: storeId, tenantId: auth.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!store) {
        return reply.code(404).send({
          error: "STORE_NOT_FOUND",
          message: "Tienda no encontrada",
        });
      }
      const activeRegisters = await prisma.register.count({
        where: { storeId, deletedAt: null },
      });
      if (activeRegisters > 0) {
        return reply.code(409).send({
          error: "STORE_HAS_REGISTERS",
          message:
            "Elimina o desactiva primero las cajas de esta tienda.",
        });
      }
      await prisma.store.update({
        where: { id: storeId },
        data: { deletedAt: new Date() },
      });
      return reply.code(200).send({ ok: true });
    },
  );

  app.post(
    "/admin/stores/:storeId/registers",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            numSerieHolded: { type: "string", maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { storeId } = request.params as { storeId: string };
      const body = request.body as { name: string; numSerieHolded?: string };
      const prisma = getPrisma();
      const store = await prisma.store.findFirst({
        where: { id: storeId, tenantId: auth.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!store) {
        return reply.code(404).send({
          error: "STORE_NOT_FOUND",
          message: "Tienda no encontrada",
        });
      }
      const register = await prisma.register.create({
        data: {
          storeId,
          name: body.name,
          numSerieHolded: body.numSerieHolded ?? null,
        },
        select: {
          id: true,
          name: true,
          numSerieHolded: true,
          ticketCounter: true,
        },
      });
      return reply.code(201).send({ register });
    },
  );

  // Listado plano de registers del tenant — usado por el modal
  // "Generar código" de DevicesPage. En B3 se derivaba del listado de
  // devices; en B4 ya tenemos creación explícita.
  app.get(
    "/admin/registers",
    { preHandler: requireOwnerOrManager },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const registers = await prisma.register.findMany({
        where: {
          deletedAt: null,
          store: { tenantId: auth.tenantId, deletedAt: null },
        },
        orderBy: [{ store: { name: "asc" } }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          numSerieHolded: true,
          store: { select: { id: true, name: true } },
        },
      });
      return {
        registers: registers.map((r) => ({
          id: r.id,
          name: r.name,
          numSerieHolded: r.numSerieHolded,
          storeId: r.store.id,
          storeName: r.store.name,
        })),
      };
    },
  );

  app.patch(
    "/admin/registers/:registerId",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["registerId"],
          properties: { registerId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            numSerieHolded: { type: "string", maxLength: 64 },
            printerConfig: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { registerId } = request.params as { registerId: string };
      const body = request.body as {
        name?: string;
        numSerieHolded?: string;
        printerConfig?: Record<string, unknown>;
      };
      const prisma = getPrisma();
      const register = await prisma.register.findFirst({
        where: {
          id: registerId,
          deletedAt: null,
          store: { tenantId: auth.tenantId },
        },
        select: { id: true },
      });
      if (!register) {
        return reply.code(404).send({
          error: "REGISTER_NOT_FOUND",
          message: "Caja no encontrada",
        });
      }
      const updated = await prisma.register.update({
        where: { id: registerId },
        data: {
          name: body.name,
          numSerieHolded:
            body.numSerieHolded === undefined ? undefined : body.numSerieHolded,
          printerConfig: body.printerConfig
            ? (body.printerConfig as object)
            : undefined,
        },
        select: {
          id: true,
          name: true,
          numSerieHolded: true,
          printerConfig: true,
        },
      });
      return reply.code(200).send({ register: updated });
    },
  );

  app.delete(
    "/admin/registers/:registerId",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["registerId"],
          properties: { registerId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { registerId } = request.params as { registerId: string };
      const prisma = getPrisma();
      const register = await prisma.register.findFirst({
        where: {
          id: registerId,
          deletedAt: null,
          store: { tenantId: auth.tenantId },
        },
        select: { id: true },
      });
      if (!register) {
        return reply.code(404).send({
          error: "REGISTER_NOT_FOUND",
          message: "Caja no encontrada",
        });
      }
      const [activeDevices, ticketsCount] = await Promise.all([
        prisma.device.count({
          where: { registerId, revokedAt: null },
        }),
        prisma.ticket.count({ where: { registerId } }),
      ]);
      if (activeDevices > 0) {
        return reply.code(409).send({
          error: "REGISTER_HAS_DEVICES",
          message:
            "Revoca primero los dispositivos emparejados a esta caja.",
        });
      }
      if (ticketsCount > 0) {
        return reply.code(409).send({
          error: "REGISTER_HAS_TICKETS",
          message:
            "Esta caja tiene tickets emitidos. No se puede eliminar.",
        });
      }
      await prisma.register.update({
        where: { id: registerId },
        data: { deletedAt: new Date() },
      });
      return reply.code(200).send({ ok: true });
    },
  );
}
