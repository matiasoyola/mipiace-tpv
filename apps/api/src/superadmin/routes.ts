import type { FastifyInstance } from "fastify";

import { registerSuperAdminAuthRoutes } from "./auth.js";
import { registerSuperAdminTenantsRoutes } from "./tenants.js";

export async function registerSuperAdminRoutes(
  app: FastifyInstance,
): Promise<void> {
  await registerSuperAdminAuthRoutes(app);
  await registerSuperAdminTenantsRoutes(app);
}

export { registerTenantBlockGuard } from "./tenant-block-guard.js";
