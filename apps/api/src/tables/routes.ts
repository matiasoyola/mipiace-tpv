// Endpoints de gestión de mesas y barra del vertical bar (B7 §2).
//
//   GET    /admin/stores/:storeId/tables                  — listado completo + estado derivado.
//   POST   /admin/stores/:storeId/tables                  — alta de mesa individual.
//   POST   /admin/stores/:storeId/tables/bar-setup        — alta masiva de N puestos de barra.
//   PATCH  /admin/tables/:tableId                         — edita nombre/capacidad/posición/zona.
//   DELETE /admin/tables/:tableId                         — soft-delete si no hay DRAFT activo.
//
// Reglas de negocio:
// - Mutaciones siempre `requireOwner`. El MANAGER puede leer el listado
//   (necesita saber el estado del salón) pero no editar estructura.
// - `(storeId, name)` único — colisión devuelve 409 CONFLICT.
// - Cambiar la zona de una mesa con histórico de tickets queda
//   bloqueado: rompe estadísticas por zona y desconcierta auditoría.
// - DELETE es soft (deleted_at = now). Bloqueamos el borrado si la
//   mesa tiene un ticket DRAFT activo (mesa abierta) — el cajero debe
//   cerrar/cobrar primero.

import type { FastifyInstance } from "fastify";

import { requireOwner, requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { requireCashierSession } from "../shift/cashier-session.js";

interface TableSummaryDto {
  id: string;
  name: string;
  capacity: number;
  zone: "SALON" | "TERRAZA" | "BARRA" | "RESERVADO";
  positionX: number | null;
  positionY: number | null;
  width: number | null;
  height: number | null;
  barSeatIndex: number | null;
  groupedIntoTableId: string | null;
  state: "FREE" | "OPEN" | "BILLING";
  // Si OPEN/BILLING, snapshot del ticket DRAFT activo.
  activeTicket: {
    id: string;
    total: string;
    diners: number | null;
    openedAt: string;
    // v1.7-alias-cajeros: email se mantiene por compat con SW viejos;
    // el TPV muestra alias con fallback a la local-part del email.
    openedByEmail: string | null;
    openedByAlias: string | null;
    lineCount: number;
  } | null;
  createdAt: string;
}

// Construye el snapshot enriquecido de las mesas de una tienda. Se
// usa tanto desde el admin (/admin/stores/:id/tables) como desde el
// TPV (/tpv/tables) — el shape es idéntico para no duplicar tipos en
// el cliente.
export async function buildTableSnapshot(
  prisma: ReturnType<typeof getPrisma>,
  tenantId: string,
  storeId: string,
): Promise<TableSummaryDto[]> {
  const tables = await prisma.table.findMany({
    where: { storeId, deletedAt: null },
    orderBy: [{ zone: "asc" }, { barSeatIndex: "asc" }, { name: "asc" }],
  });
  const tableIds = tables.map((t) => t.id);
  const drafts =
    tableIds.length === 0
      ? []
      : await prisma.ticket.findMany({
          where: {
            tableId: { in: tableIds },
            status: "DRAFT",
            tenantId,
          },
          select: {
            id: true,
            tableId: true,
            total: true,
            diners: true,
            createdAt: true,
            userId: true,
            _count: { select: { lines: true } },
          },
        });
  const userIds = Array.from(new Set(drafts.map((d) => d.userId)));
  const users =
    userIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, alias: true },
        });
  const userById = new Map(users.map((u) => [u.id, u] as const));
  const draftByTableId = new Map<string, (typeof drafts)[number]>();
  for (const d of drafts) {
    if (d.tableId) draftByTableId.set(d.tableId, d);
  }
  return tables.map((t) => {
    const draft = draftByTableId.get(t.id);
    return {
      id: t.id,
      name: t.name,
      capacity: t.capacity,
      zone: t.zone,
      positionX: t.positionX,
      positionY: t.positionY,
      width: t.width,
      height: t.height,
      barSeatIndex: t.barSeatIndex,
      groupedIntoTableId: t.groupedIntoTableId,
      state: draft ? "OPEN" : "FREE",
      activeTicket: draft
        ? {
            id: draft.id,
            total: draft.total.toString(),
            diners: draft.diners,
            openedAt: draft.createdAt.toISOString(),
            openedByEmail: userById.get(draft.userId)?.email ?? null,
            openedByAlias: userById.get(draft.userId)?.alias ?? null,
            lineCount: draft._count.lines,
          }
        : null,
      createdAt: t.createdAt.toISOString(),
    };
  });
}

export async function registerTablesRoutes(app: FastifyInstance): Promise<void> {
  // ── Listado + estado derivado ────────────────────────────────────────
  app.get(
    "/admin/stores/:storeId/tables",
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
        select: { id: true },
      });
      if (!store) {
        return reply.code(404).send({
          error: "STORE_NOT_FOUND",
          message: "Tienda no encontrada",
        });
      }
      const tables = await buildTableSnapshot(prisma, auth.tenantId, storeId);
      return { tables };
    },
  );

  // Mismo snapshot que el admin pero scoped al register del cashier.
  // El TPV lo usa para pintar el mapa de sala. Devuelve también el
  // storeId/registerId del cashier para que el cliente sepa cuál es
  // "su" store sin un round-trip extra.
  app.get(
    "/tpv/tables",
    { preHandler: requireCashierSession },
    async (request) => {
      const cashier = request.cashier!;
      const prisma = getPrisma();
      const register = await prisma.register.findFirst({
        where: { id: cashier.rid, deletedAt: null },
        select: { id: true, storeId: true, name: true },
      });
      if (!register) {
        return { storeId: null, registerId: cashier.rid, tables: [] };
      }
      const tables = await buildTableSnapshot(
        prisma,
        cashier.tid,
        register.storeId,
      );
      return {
        storeId: register.storeId,
        registerId: register.id,
        tables,
      };
    },
  );

  // ── Alta individual ──────────────────────────────────────────────────
  app.post(
    "/admin/stores/:storeId/tables",
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
          required: ["name", "zone"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 40 },
            capacity: { type: "integer", minimum: 1, maximum: 50 },
            zone: { type: "string", enum: ["SALON", "TERRAZA", "BARRA", "RESERVADO"] },
            positionX: { type: "integer", minimum: 0, maximum: 10_000 },
            positionY: { type: "integer", minimum: 0, maximum: 10_000 },
            width: { type: "integer", minimum: 1, maximum: 2_000 },
            height: { type: "integer", minimum: 1, maximum: 2_000 },
            barSeatIndex: { type: "integer", minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { storeId } = request.params as { storeId: string };
      const body = request.body as {
        name: string;
        capacity?: number;
        zone: "SALON" | "TERRAZA" | "BARRA" | "RESERVADO";
        positionX?: number;
        positionY?: number;
        width?: number;
        height?: number;
        barSeatIndex?: number;
      };
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
      // Colisión por nombre dentro de la tienda → 409. Incluimos
      // soft-deleted: si el dueño borró M1 y crea otra M1, el unique
      // index del schema lo rechazaría con un error feo. Mejor avisar.
      const existing = await prisma.table.findFirst({
        where: { storeId, name: body.name },
        select: { id: true, deletedAt: true },
      });
      if (existing) {
        return reply.code(409).send({
          error: "TABLE_NAME_TAKEN",
          message: existing.deletedAt
            ? "Ya existe una mesa eliminada con ese nombre. Restáurala o usa otro."
            : "Ya existe una mesa con ese nombre en esta tienda.",
        });
      }
      const table = await prisma.table.create({
        data: {
          storeId,
          name: body.name,
          capacity: body.capacity ?? 2,
          zone: body.zone,
          positionX: body.positionX ?? null,
          positionY: body.positionY ?? null,
          width: body.width ?? null,
          height: body.height ?? null,
          barSeatIndex: body.barSeatIndex ?? null,
        },
      });
      return reply.code(201).send({
        table: { id: table.id, name: table.name, zone: table.zone, capacity: table.capacity },
      });
    },
  );

  // ── Bar setup masivo ────────────────────────────────────────────────
  app.post(
    "/admin/stores/:storeId/tables/bar-setup",
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
          required: ["seatCount"],
          additionalProperties: false,
          properties: {
            seatCount: { type: "integer", minimum: 1, maximum: 100 },
            baseName: { type: "string", minLength: 1, maxLength: 5, default: "B" },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { storeId } = request.params as { storeId: string };
      const body = request.body as { seatCount: number; baseName?: string };
      const baseName = body.baseName ?? "B";
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
      // No reabrimos la barra si ya existe alguna mesa BARRA con
      // barSeatIndex en esta tienda — el botón sólo debe aparecer una
      // vez. El admin puede crear puestos sueltos con el endpoint
      // individual si quiere extender.
      const existingBar = await prisma.table.count({
        where: { storeId, zone: "BARRA", barSeatIndex: { not: null }, deletedAt: null },
      });
      if (existingBar > 0) {
        return reply.code(409).send({
          error: "BAR_ALREADY_SET_UP",
          message: "Esta tienda ya tiene una barra configurada. Añade puestos sueltos manualmente.",
        });
      }
      const names = Array.from(
        { length: body.seatCount },
        (_, i) => `${baseName}${i + 1}`,
      );
      // Comprobamos colisiones con cualquier mesa existente (no
      // BARRA o soft-deleted).
      const conflict = await prisma.table.findFirst({
        where: { storeId, name: { in: names } },
        select: { name: true },
      });
      if (conflict) {
        return reply.code(409).send({
          error: "TABLE_NAME_TAKEN",
          message: `Ya existe una mesa llamada "${conflict.name}" en esta tienda.`,
        });
      }
      const created = await prisma.$transaction(
        names.map((name, i) =>
          prisma.table.create({
            data: {
              storeId,
              name,
              capacity: 1,
              zone: "BARRA",
              barSeatIndex: i + 1,
            },
            select: { id: true, name: true, barSeatIndex: true },
          }),
        ),
      );
      return reply.code(201).send({ tables: created });
    },
  );

  // ── Edición ─────────────────────────────────────────────────────────
  app.patch(
    "/admin/tables/:tableId",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["tableId"],
          properties: { tableId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 40 },
            capacity: { type: "integer", minimum: 1, maximum: 50 },
            zone: { type: "string", enum: ["SALON", "TERRAZA", "BARRA", "RESERVADO"] },
            positionX: { type: ["integer", "null"], minimum: 0, maximum: 10_000 },
            positionY: { type: ["integer", "null"], minimum: 0, maximum: 10_000 },
            width: { type: ["integer", "null"], minimum: 1, maximum: 2_000 },
            height: { type: ["integer", "null"], minimum: 1, maximum: 2_000 },
            barSeatIndex: { type: ["integer", "null"], minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { tableId } = request.params as { tableId: string };
      const body = request.body as Record<string, unknown>;
      const prisma = getPrisma();
      const table = await prisma.table.findFirst({
        where: { id: tableId, store: { tenantId: auth.tenantId }, deletedAt: null },
        select: { id: true, storeId: true, zone: true, name: true },
      });
      if (!table) {
        return reply.code(404).send({
          error: "TABLE_NOT_FOUND",
          message: "Mesa no encontrada",
        });
      }
      // Bloquea cambio de zona si hay tickets (cualquier status) — la
      // mesa M1 con histórico no puede pasar de SALON a BARRA porque
      // confunde reporting y rompe los criterios "ventas por zona".
      if (typeof body.zone === "string" && body.zone !== table.zone) {
        const usage = await prisma.ticket.count({
          where: { tableId, tenantId: auth.tenantId },
        });
        if (usage > 0) {
          return reply.code(409).send({
            error: "TABLE_ZONE_LOCKED",
            message:
              "No se puede cambiar la zona de una mesa con histórico de tickets. Crea una nueva.",
          });
        }
      }
      // Si renombra, validar colisión en la tienda.
      if (typeof body.name === "string" && body.name !== table.name) {
        const collision = await prisma.table.findFirst({
          where: {
            storeId: table.storeId,
            name: body.name as string,
            NOT: { id: tableId },
          },
          select: { id: true },
        });
        if (collision) {
          return reply.code(409).send({
            error: "TABLE_NAME_TAKEN",
            message: "Ya existe una mesa con ese nombre en esta tienda.",
          });
        }
      }
      const updated = await prisma.table.update({
        where: { id: tableId },
        data: {
          name: typeof body.name === "string" ? body.name : undefined,
          capacity: typeof body.capacity === "number" ? body.capacity : undefined,
          zone:
            typeof body.zone === "string"
              ? (body.zone as "SALON" | "TERRAZA" | "BARRA" | "RESERVADO")
              : undefined,
          positionX: "positionX" in body ? (body.positionX as number | null) : undefined,
          positionY: "positionY" in body ? (body.positionY as number | null) : undefined,
          width: "width" in body ? (body.width as number | null) : undefined,
          height: "height" in body ? (body.height as number | null) : undefined,
          barSeatIndex:
            "barSeatIndex" in body ? (body.barSeatIndex as number | null) : undefined,
        },
      });
      return {
        table: {
          id: updated.id,
          name: updated.name,
          capacity: updated.capacity,
          zone: updated.zone,
        },
      };
    },
  );

  // ── Borrado ─────────────────────────────────────────────────────────
  app.delete(
    "/admin/tables/:tableId",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["tableId"],
          properties: { tableId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { tableId } = request.params as { tableId: string };
      const prisma = getPrisma();
      const table = await prisma.table.findFirst({
        where: { id: tableId, store: { tenantId: auth.tenantId }, deletedAt: null },
        select: { id: true },
      });
      if (!table) {
        return reply.code(404).send({
          error: "TABLE_NOT_FOUND",
          message: "Mesa no encontrada",
        });
      }
      const draft = await prisma.ticket.findFirst({
        where: { tableId, status: "DRAFT", tenantId: auth.tenantId },
        select: { id: true },
      });
      if (draft) {
        return reply.code(409).send({
          error: "TABLE_HAS_OPEN_TICKET",
          message:
            "No se puede eliminar una mesa con ticket abierto. Cobra o vacía la mesa primero.",
        });
      }
      await prisma.table.update({
        where: { id: tableId },
        data: { deletedAt: new Date() },
      });
      return reply.code(204).send();
    },
  );
}
