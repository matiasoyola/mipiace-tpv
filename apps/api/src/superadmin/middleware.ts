import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";

import {
  verifySuperAdminAccessToken,
  type SuperAdminAccessPayload,
} from "./tokens.js";

// Contexto super-admin que las rutas leen como `request.superAdmin`.
// Lote 3 v1.1 Thalia: `isRoot` se lee fresco de BD en cada request
// (autoritativo). El claim JWT que también lo lleva sirve solo como
// hint para el frontend.
export interface SuperAdminContext {
  superAdminId: string;
  isRoot: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    superAdmin?: SuperAdminContext;
  }
}

// Middleware que protege todos los endpoints `/super-admin/...`.
// Acepta SÓLO JWT con `purpose: "super-admin"`, `type: "access"` y `tv`
// coincidente con la BD. Rechaza con 401 cualquier otro token (incluso
// un OWNER válido).
export async function requireSuperAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    reply
      .code(401)
      .send({ error: "UNAUTHENTICATED", message: "Falta token super-admin" });
    return;
  }
  const token = header.slice(7);
  let payload: SuperAdminAccessPayload;
  try {
    payload = verifySuperAdminAccessToken(token);
  } catch {
    reply
      .code(401)
      .send({ error: "UNAUTHENTICATED", message: "Token super-admin inválido o caducado" });
    return;
  }
  const prisma = getPrisma();
  const sa = await prisma.superAdminUser.findUnique({
    where: { id: payload.sub },
    select: { id: true, tokenVersion: true, deletedAt: true, isRoot: true },
  });
  if (!sa) {
    reply
      .code(401)
      .send({ error: "UNAUTHENTICATED", message: "Cuenta super-admin no existe" });
    return;
  }
  // B-Multi-Vertical SB4: super-admin soft-deleted (otro super-admin
  // lo eliminó). El delete bumpea tokenVersion también, así que la
  // siguiente request ya fallaría por tokenVersion. Este check es
  // defensivo por si alguien restaura el row sin reactivar.
  if (sa.deletedAt != null) {
    reply
      .code(401)
      .send({ error: "UNAUTHENTICATED", message: "Cuenta super-admin desactivada" });
    return;
  }
  if (sa.tokenVersion !== payload.tv) {
    reply
      .code(401)
      .send({ error: "UNAUTHENTICATED", message: "Sesión super-admin revocada" });
    return;
  }
  request.superAdmin = { superAdminId: sa.id, isRoot: sa.isRoot };
}

// Lote 3 v1.1 Thalia: middleware adicional para endpoints que sólo
// puede usar el super-admin root (invitar/eliminar a otros super-admins).
// Compose: requireSuperAdmin → check isRoot leído de BD. Un super-admin
// no-root recibe 403 (autenticado pero sin permiso) en lugar de 401
// (no autenticado).
export async function requireRootSuperAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireSuperAdmin(request, reply);
  if (reply.sent) return;
  if (!request.superAdmin?.isRoot) {
    reply.code(403).send({
      error: "FORBIDDEN_NOT_ROOT",
      message:
        "Esta acción requiere ser super-admin root.",
    });
    return;
  }
}
