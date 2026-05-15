import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";

import {
  verifySuperAdminAccessToken,
  type SuperAdminAccessPayload,
} from "./tokens.js";

// Contexto super-admin que las rutas leen como `request.superAdmin`.
export interface SuperAdminContext {
  superAdminId: string;
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
    select: { id: true, tokenVersion: true },
  });
  if (!sa) {
    reply
      .code(401)
      .send({ error: "UNAUTHENTICATED", message: "Cuenta super-admin no existe" });
    return;
  }
  if (sa.tokenVersion !== payload.tv) {
    reply
      .code(401)
      .send({ error: "UNAUTHENTICATED", message: "Sesión super-admin revocada" });
    return;
  }
  request.superAdmin = { superAdminId: sa.id };
}
