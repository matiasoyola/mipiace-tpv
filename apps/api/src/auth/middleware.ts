import type { FastifyReply, FastifyRequest } from "fastify";

import { verifyAccessToken, type AccessTokenPayload } from "./tokens.js";

// Tipo extendido que se publica en cada request autenticado.
export interface AuthContext {
  userId: string;
  tenantId: string;
  role: "OWNER" | "MANAGER" | "CASHIER";
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export async function requireOwner(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    reply.code(401).send({ error: "UNAUTHENTICATED", message: "Falta token" });
    return;
  }
  const token = header.slice(7);
  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    reply.code(401).send({ error: "UNAUTHENTICATED", message: "Token inválido o caducado" });
    return;
  }
  if (payload.role !== "OWNER") {
    reply.code(403).send({ error: "FORBIDDEN", message: "Sólo propietarios" });
    return;
  }
  request.auth = {
    userId: payload.sub,
    tenantId: payload.tid,
    role: payload.role,
  };
}
