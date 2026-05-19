import type { FastifyInstance } from "fastify";

import { registerSuperAdminAdminsRoutes } from "./admins.js";
import { registerSuperAdminAuthRoutes } from "./auth.js";
import { registerSuperAdminTenantsRoutes } from "./tenants.js";

export async function registerSuperAdminRoutes(
  app: FastifyInstance,
): Promise<void> {
  await registerSuperAdminAuthRoutes(app);
  await registerSuperAdminTenantsRoutes(app);
  await registerSuperAdminAdminsRoutes(app);
}

export { registerTenantBlockGuard } from "./tenant-block-guard.js";
