// Pantalla de Ajustes de tenant (B6 §4).
//
// El propietario controla aquí los flags que hasta ahora vivían sólo
// en BD con defaults sensatos:
//
//   - cashierAutoLogoutMinutes (B3, default 10)
//   - requireManagerPinForForceClose (B3, default true)
//   - deviceNewLoginAlertEnabled (B3, default true)
//   - discountThresholdPct (B6 §2, default 10)
//   - cashierSearchableContacts (B6 §4, default true)
//
//   GET  /admin/tenant/settings  → requireOwnerOrManager (sólo lectura).
//   POST /admin/tenant/settings  → requireOwner (mutación).

import type { FastifyInstance } from "fastify";

import { requireOwner, requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";

export async function registerAdminTenantSettingsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/admin/tenant/settings",
    { preHandler: requireOwnerOrManager },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: {
          cashierAutoLogoutMinutes: true,
          requireManagerPinForForceClose: true,
          deviceNewLoginAlertEnabled: true,
          discountThresholdPct: true,
          cashierSearchableContacts: true,
        },
      });
      return {
        settings: {
          cashierAutoLogoutMinutes: tenant.cashierAutoLogoutMinutes,
          requireManagerPinForForceClose: tenant.requireManagerPinForForceClose,
          deviceNewLoginAlertEnabled: tenant.deviceNewLoginAlertEnabled,
          discountThresholdPct: Number(tenant.discountThresholdPct),
          cashierSearchableContacts: tenant.cashierSearchableContacts,
        },
      };
    },
  );

  app.post(
    "/admin/tenant/settings",
    {
      preHandler: requireOwner,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            cashierAutoLogoutMinutes: { type: "integer", minimum: 5, maximum: 60 },
            requireManagerPinForForceClose: { type: "boolean" },
            deviceNewLoginAlertEnabled: { type: "boolean" },
            // 5 dec.2 — encajamos con la columna Decimal(5,2). El UI
            // lo manda como número entero o con un decimal; aceptamos
            // ambos para no obligar al admin a manejar formato.
            discountThresholdPct: { type: "number", minimum: 0, maximum: 100 },
            cashierSearchableContacts: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const body = request.body as {
        cashierAutoLogoutMinutes?: number;
        requireManagerPinForForceClose?: boolean;
        deviceNewLoginAlertEnabled?: boolean;
        discountThresholdPct?: number;
        cashierSearchableContacts?: boolean;
      };
      const prisma = getPrisma();
      const updated = await prisma.tenant.update({
        where: { id: auth.tenantId },
        data: {
          cashierAutoLogoutMinutes: body.cashierAutoLogoutMinutes,
          requireManagerPinForForceClose: body.requireManagerPinForForceClose,
          deviceNewLoginAlertEnabled: body.deviceNewLoginAlertEnabled,
          discountThresholdPct: body.discountThresholdPct,
          cashierSearchableContacts: body.cashierSearchableContacts,
        },
        select: {
          cashierAutoLogoutMinutes: true,
          requireManagerPinForForceClose: true,
          deviceNewLoginAlertEnabled: true,
          discountThresholdPct: true,
          cashierSearchableContacts: true,
        },
      });
      return reply.code(200).send({
        settings: {
          cashierAutoLogoutMinutes: updated.cashierAutoLogoutMinutes,
          requireManagerPinForForceClose: updated.requireManagerPinForForceClose,
          deviceNewLoginAlertEnabled: updated.deviceNewLoginAlertEnabled,
          discountThresholdPct: Number(updated.discountThresholdPct),
          cashierSearchableContacts: updated.cashierSearchableContacts,
        },
      });
    },
  );
}
