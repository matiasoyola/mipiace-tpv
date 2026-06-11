// Endpoint super-admin de la conciliación diaria (v1.5-B Lote 4).
//
//   GET /super-admin/tenants/:id/reconciliation?limit=N
//
// Devuelve los últimos N runs (default 14, máx 100) del tenant. SIN UI
// todavía — la pantalla en la consola super-admin va en otro bloque;
// mientras tanto, este endpoint sirve para soporte (curl / devtools) y
// como contrato estable para esa UI futura.

import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { requireSuperAdmin } from "./middleware.js";

export async function registerSuperAdminReconciliationRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/super-admin/tenants/:id/reconciliation",
    {
      preHandler: requireSuperAdmin,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 14 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { limit } = request.query as { limit?: number };
      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!tenant) {
        return reply.code(404).send({
          error: "TENANT_NOT_FOUND",
          message: "Tenant no existe",
        });
      }
      const runs = await prisma.reconciliationRun.findMany({
        where: { tenantId: id },
        orderBy: { runAt: "desc" },
        take: limit ?? 14,
        select: {
          id: true,
          runAt: true,
          ticketsChecked: true,
          mismatches: true,
        },
      });
      return {
        tenant: { id: tenant.id, name: tenant.name },
        runs: runs.map((r) => ({
          id: r.id,
          runAt: r.runAt.toISOString(),
          ticketsChecked: r.ticketsChecked,
          mismatches: r.mismatches,
          mismatchCount: Array.isArray(r.mismatches)
            ? (r.mismatches as unknown[]).length
            : 0,
        })),
      };
    },
  );
}
