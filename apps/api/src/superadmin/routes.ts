import type { FastifyInstance } from "fastify";

import { registerSuperAdminAdminsRoutes } from "./admins.js";
import { registerSuperAdminAuthRoutes } from "./auth.js";
import {
  registerSuperAdminDeviceCommandRoutes,
  registerSuperAdminDevicesRoutes,
  registerSuperAdminScreenshotRoutes,
} from "./devices.js";
import { registerSuperAdminHubRoutes } from "./hub.js";
import { registerSuperAdminReconciliationRoutes } from "./reconciliation.js";
import { registerSuperAdminTenantCashiersRoutes } from "./tenant-cashiers.js";
import { registerSuperAdminTenantsRoutes } from "./tenants.js";

export async function registerSuperAdminRoutes(
  app: FastifyInstance,
): Promise<void> {
  await registerSuperAdminAuthRoutes(app);
  await registerSuperAdminTenantsRoutes(app);
  await registerSuperAdminAdminsRoutes(app);
  // v1.3-SuperAdmin-Hub Lote 2: nueva pantalla de inicio /superadmin/hub.
  await registerSuperAdminHubRoutes(app);
  // v1.5-consistencia-B Lote 4: runs de la conciliación diaria.
  await registerSuperAdminReconciliationRoutes(app);
  // Bloque soporte-cajeros-superadmin: lista de cajeros de un tenant
  // (lectura, auditada) para atender "no puedo entrar" sin impersonar.
  await registerSuperAdminTenantCashiersRoutes(app);
  // A5 · inventario de terminales: quién está online, con qué versión y con
  // cuánta cola. Es la pantalla que decide a qué local hay que ir.
  await registerSuperAdminDevicesRoutes(app);
  // A5 · comandos con lista blanca cerrada, cada uno con motivo y auditado.
  await registerSuperAdminDeviceCommandRoutes(app);
  // A5 · las capturas guardadas: listado y binario, ambos auditados.
  await registerSuperAdminScreenshotRoutes(app);
}

export { registerTenantBlockGuard } from "./tenant-block-guard.js";
