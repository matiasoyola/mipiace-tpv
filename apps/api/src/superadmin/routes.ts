import type { FastifyInstance } from "fastify";

import { registerSuperAdminAdminsRoutes } from "./admins.js";
import { registerSuperAdminAuthRoutes } from "./auth.js";
import { registerSuperAdminHubRoutes } from "./hub.js";
import { registerSuperAdminReconciliationRoutes } from "./reconciliation.js";
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
}

export { registerTenantBlockGuard } from "./tenant-block-guard.js";
