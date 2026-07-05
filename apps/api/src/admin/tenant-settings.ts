// Pantalla de Ajustes de tenant (B6 §4).
//
// El propietario controla aquí los flags que hasta ahora vivían sólo
// en BD con defaults sensatos:
//
//   - cashierAutoLogoutMinutes (B3, default 10)
//   - cashierSessionTtlMinutes (v1.0-pilotos #18, default 720)
//   - requireManagerPinForForceClose (B3, default true)
//   - requireOwnerPinForCashClose (v1.4-Bugs-Operativos, default false)
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
          cashierSessionTtlMinutes: true,
          requireManagerPinForForceClose: true,
          requireOwnerPinForCashClose: true,
          deviceNewLoginAlertEnabled: true,
          discountThresholdPct: true,
          cashierSearchableContacts: true,
          creditSalesEnabled: true,
        },
      });
      return {
        settings: {
          cashierAutoLogoutMinutes: tenant.cashierAutoLogoutMinutes,
          cashierSessionTtlMinutes: tenant.cashierSessionTtlMinutes,
          requireManagerPinForForceClose: tenant.requireManagerPinForForceClose,
          requireOwnerPinForCashClose: tenant.requireOwnerPinForCashClose,
          deviceNewLoginAlertEnabled: tenant.deviceNewLoginAlertEnabled,
          discountThresholdPct: Number(tenant.discountThresholdPct),
          cashierSearchableContacts: tenant.cashierSearchableContacts,
          creditSalesEnabled: tenant.creditSalesEnabled,
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
            // v1.0-pilotos · Lote 4 (#18): TTL del JWT de sesión del
            // cajero. 30 min a 24 h — el default 720 cubre un turno.
            cashierSessionTtlMinutes: { type: "integer", minimum: 30, maximum: 1440 },
            requireManagerPinForForceClose: { type: "boolean" },
            requireOwnerPinForCashClose: { type: "boolean" },
            deviceNewLoginAlertEnabled: { type: "boolean" },
            // 5 dec.2 — encajamos con la columna Decimal(5,2). El UI
            // lo manda como número entero o con un decimal; aceptamos
            // ambos para no obligar al admin a manejar formato.
            discountThresholdPct: { type: "number", minimum: 0, maximum: 100 },
            cashierSearchableContacts: { type: "boolean" },
            // v1.8-Fiado · activa la venta a crédito para el tenant.
            creditSalesEnabled: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const body = request.body as {
        cashierAutoLogoutMinutes?: number;
        cashierSessionTtlMinutes?: number;
        requireManagerPinForForceClose?: boolean;
        requireOwnerPinForCashClose?: boolean;
        deviceNewLoginAlertEnabled?: boolean;
        discountThresholdPct?: number;
        cashierSearchableContacts?: boolean;
        creditSalesEnabled?: boolean;
      };
      const prisma = getPrisma();
      const updated = await prisma.tenant.update({
        where: { id: auth.tenantId },
        data: {
          cashierAutoLogoutMinutes: body.cashierAutoLogoutMinutes,
          cashierSessionTtlMinutes: body.cashierSessionTtlMinutes,
          requireManagerPinForForceClose: body.requireManagerPinForForceClose,
          requireOwnerPinForCashClose: body.requireOwnerPinForCashClose,
          deviceNewLoginAlertEnabled: body.deviceNewLoginAlertEnabled,
          discountThresholdPct: body.discountThresholdPct,
          cashierSearchableContacts: body.cashierSearchableContacts,
          creditSalesEnabled: body.creditSalesEnabled,
        },
        select: {
          cashierAutoLogoutMinutes: true,
          cashierSessionTtlMinutes: true,
          requireManagerPinForForceClose: true,
          requireOwnerPinForCashClose: true,
          deviceNewLoginAlertEnabled: true,
          discountThresholdPct: true,
          cashierSearchableContacts: true,
          creditSalesEnabled: true,
        },
      });
      return reply.code(200).send({
        settings: {
          cashierAutoLogoutMinutes: updated.cashierAutoLogoutMinutes,
          cashierSessionTtlMinutes: updated.cashierSessionTtlMinutes,
          requireManagerPinForForceClose: updated.requireManagerPinForForceClose,
          requireOwnerPinForCashClose: updated.requireOwnerPinForCashClose,
          deviceNewLoginAlertEnabled: updated.deviceNewLoginAlertEnabled,
          discountThresholdPct: Number(updated.discountThresholdPct),
          cashierSearchableContacts: updated.cashierSearchableContacts,
          creditSalesEnabled: updated.creditSalesEnabled,
        },
      });
    },
  );
}
