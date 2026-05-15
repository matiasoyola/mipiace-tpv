import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import { verifyAccessToken } from "../auth/tokens.js";
import { verifyImpersonationToken } from "./tokens.js";

// Lista de prefijos exentos del check de tenant bloqueado. Todo lo demás
// pasa por el guard; si el JWT identifica un tenant cuyo `blocked_at`
// no es nulo, devolvemos 423 Locked.
const EXEMPT_PREFIXES = [
  "/super-admin",
  "/auth/login",
  "/auth/refresh",
  "/auth/password-reset",
  "/auth/signup",
  "/health",
];

function isExempt(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(p));
}

// Extrae el tenantId del JWT Bearer si es:
//  - Access token per-tenant (purpose implícito): payload.tid
//  - Impersonation token: payload.tid (también)
// Devuelve null si no hay Bearer o el token no es decodificable.
// NO valida la firma con secret real — la comprobación de auth real la
// hace el middleware per-route (`requireOwner`, etc). Aquí sólo
// extraemos el tenantId para el lookup de blocked_at. Si el JWT está
// firmado por otro secret simplemente no lo desempaquetamos.
function extractTenantId(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  // Intento 1: JWT per-tenant access token.
  try {
    const payload = verifyAccessToken(token);
    return payload.tid;
  } catch {
    // sigue
  }
  // Intento 2: JWT impersonation (firmado con SUPER_ADMIN_JWT_SECRET).
  try {
    const payload = verifyImpersonationToken(token);
    return payload.tid;
  } catch {
    // sigue
  }
  return null;
}

export function registerTenantBlockGuard(app: FastifyInstance): void {
  app.addHook("preHandler", async (request, reply: FastifyReply) => {
    if (isExempt(request.url)) return;
    const tenantId = extractTenantId(request);
    if (!tenantId) return; // no tenant claimable → otros middlewares decidirán
    const prisma = getPrisma();
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { blockedAt: true, blockedReason: true },
    });
    if (!tenant) return; // tenant inexistente → dejar que el middleware downstream falle con 401/404
    if (tenant.blockedAt != null) {
      reply.code(423).send({
        error: "TENANT_BLOCKED",
        code: "TENANT_BLOCKED",
        message: "Cuenta bloqueada. Contacta con soporte.",
        reason: tenant.blockedReason ?? null,
      });
    }
  });
}
