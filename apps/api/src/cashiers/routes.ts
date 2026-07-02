import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { requireOwner, requireOwnerOrManager } from "../auth/middleware.js";
import { hashPassword } from "../auth/passwords.js";

// CRUD mínimo de cajeros/encargados (B3 §1.4 ampliado). Sólo el OWNER
// crea o revoca cajeros (§15 nucleus). El alta exige un PIN inicial —
// el propietario lo comunica al cajero por canal seguro, y el cajero
// puede pedir reset al propietario si lo olvida.
//
// B6 §1: MANAGER puede listar cajeros y resetear su PIN (operativa diaria),
// pero NO crearlos ni borrarlos (eso queda en el OWNER).
//
// Roles aceptados: MANAGER y CASHIER. OWNER se crea sólo vía /signup.

const emailFormat = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";
const pinFormat = "^[0-9]{4,8}$";

// v1.7-alias-cajeros: unicidad del alias por tenant entre cajeros
// activos (case-insensitive), validada aquí y no como constraint de
// BD — "María" puede existir en dos tenants. Los revocados (email
// sentinel @revoked.local) no bloquean el alias para nuevos cajeros.
async function findAliasCollision(
  prisma: ReturnType<typeof getPrisma>,
  tenantId: string,
  alias: string,
  excludeUserId?: string,
): Promise<{ id: string } | null> {
  return prisma.user.findFirst({
    where: {
      tenantId,
      role: { in: ["MANAGER", "CASHIER"] },
      alias: { equals: alias, mode: "insensitive" },
      NOT: [
        { email: { endsWith: "@revoked.local" } },
        ...(excludeUserId ? [{ id: excludeUserId }] : []),
      ],
    },
    select: { id: true },
  });
}

export async function registerCashiersRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/cashiers",
    { preHandler: requireOwnerOrManager },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const users = await prisma.user.findMany({
        where: {
          tenantId: auth.tenantId,
          role: { in: ["MANAGER", "CASHIER"] },
        },
        select: {
          id: true,
          email: true,
          alias: true,
          role: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      });
      return {
        cashiers: users.map((u) => ({
          id: u.id,
          email: u.email,
          alias: u.alias,
          role: u.role,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    "/cashiers",
    {
      preHandler: requireOwner,
      schema: {
        body: {
          type: "object",
          required: ["email", "alias", "role", "pin"],
          additionalProperties: false,
          properties: {
            email: { type: "string", pattern: emailFormat, maxLength: 320 },
            alias: { type: "string", minLength: 1, maxLength: 40 },
            role: { type: "string", enum: ["MANAGER", "CASHIER"] },
            pin: { type: "string", pattern: pinFormat },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { email, alias, role, pin } = request.body as {
        email: string;
        alias: string;
        role: "MANAGER" | "CASHIER";
        pin: string;
      };
      const lowerEmail = email.toLowerCase();
      // El schema garantiza 1..40 chars pero no impide sólo-espacios.
      const trimmedAlias = alias.trim();
      if (trimmedAlias.length === 0) {
        return reply.code(400).send({
          error: "INVALID_ALIAS",
          message: "El alias no puede estar vacío",
        });
      }
      const prisma = getPrisma();

      const collision = await prisma.user.findUnique({
        where: { email: lowerEmail },
        select: { id: true },
      });
      if (collision) {
        return reply.code(409).send({
          error: "EMAIL_TAKEN",
          message: "Ya existe un usuario con ese email",
        });
      }

      const aliasCollision = await findAliasCollision(
        prisma,
        auth.tenantId,
        trimmedAlias,
      );
      if (aliasCollision) {
        return reply.code(409).send({
          error: "ALIAS_TAKEN",
          message: `Ya hay un cajero llamado ${trimmedAlias}`,
        });
      }

      const pinHash = await hashPassword(pin);
      const created = await prisma.user.create({
        data: {
          tenantId: auth.tenantId,
          email: lowerEmail,
          alias: trimmedAlias,
          pinHash,
          role,
        },
        select: { id: true, email: true, alias: true, role: true, createdAt: true },
      });
      return reply.code(201).send({
        cashier: {
          id: created.id,
          email: created.email,
          alias: created.alias,
          role: created.role,
          createdAt: created.createdAt.toISOString(),
        },
      });
    },
  );

  // v1.7-alias-cajeros: edición del alias. Sólo OWNER (misma política
  // que alta/revocación). El email no se edita — es la credencial.
  app.patch(
    "/cashiers/:cashierId",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["cashierId"],
          properties: { cashierId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["alias"],
          additionalProperties: false,
          properties: {
            alias: { type: "string", minLength: 1, maxLength: 40 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { cashierId } = request.params as { cashierId: string };
      const { alias } = request.body as { alias: string };
      const trimmedAlias = alias.trim();
      if (trimmedAlias.length === 0) {
        return reply.code(400).send({
          error: "INVALID_ALIAS",
          message: "El alias no puede estar vacío",
        });
      }
      const prisma = getPrisma();
      const target = await prisma.user.findFirst({
        where: {
          id: cashierId,
          tenantId: auth.tenantId,
          role: { in: ["MANAGER", "CASHIER"] },
        },
        select: { id: true },
      });
      if (!target) {
        return reply
          .code(404)
          .send({ error: "CASHIER_NOT_FOUND", message: "Cajero no encontrado" });
      }
      const aliasCollision = await findAliasCollision(
        prisma,
        auth.tenantId,
        trimmedAlias,
        target.id,
      );
      if (aliasCollision) {
        return reply.code(409).send({
          error: "ALIAS_TAKEN",
          message: `Ya hay un cajero llamado ${trimmedAlias}`,
        });
      }
      const updated = await prisma.user.update({
        where: { id: target.id },
        data: { alias: trimmedAlias },
        select: { id: true, email: true, alias: true, role: true },
      });
      return reply.code(200).send({
        cashier: {
          id: updated.id,
          email: updated.email,
          alias: updated.alias,
          role: updated.role,
        },
      });
    },
  );

  app.patch(
    "/cashiers/:cashierId/pin",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["cashierId"],
          properties: { cashierId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["pin"],
          additionalProperties: false,
          properties: { pin: { type: "string", pattern: pinFormat } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { cashierId } = request.params as { cashierId: string };
      const { pin } = request.body as { pin: string };
      const prisma = getPrisma();
      const target = await prisma.user.findFirst({
        where: {
          id: cashierId,
          tenantId: auth.tenantId,
          role: { in: ["MANAGER", "CASHIER"] },
        },
        select: { id: true },
      });
      if (!target) {
        return reply
          .code(404)
          .send({ error: "CASHIER_NOT_FOUND", message: "Cajero no encontrado" });
      }
      await prisma.user.update({
        where: { id: target.id },
        data: { pinHash: await hashPassword(pin) },
      });
      return reply.code(200).send({ ok: true });
    },
  );

  app.delete(
    "/cashiers/:cashierId",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["cashierId"],
          properties: { cashierId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { cashierId } = request.params as { cashierId: string };
      const prisma = getPrisma();
      const target = await prisma.user.findFirst({
        where: {
          id: cashierId,
          tenantId: auth.tenantId,
          role: { in: ["MANAGER", "CASHIER"] },
        },
        select: { id: true, _count: { select: { shifts: true, tickets: true } } },
      });
      if (!target) {
        return reply
          .code(404)
          .send({ error: "CASHIER_NOT_FOUND", message: "Cajero no encontrado" });
      }
      // No borramos: hay FKs en shifts y tickets. Soft-delete vía PIN
      // nuked + email prefijado para que el propietario lo distinga.
      // Esto preserva el histórico operativo.
      const sentinel = `revoked-${Date.now()}-${target.id}@revoked.local`;
      await prisma.user.update({
        where: { id: target.id },
        data: {
          pinHash: null,
          email: sentinel,
          tokenVersion: { increment: 1 },
        },
      });
      return reply.code(200).send({
        ok: true,
        softDeleted: true,
        preservedShifts: target._count.shifts,
        preservedTickets: target._count.tickets,
      });
    },
  );
}
