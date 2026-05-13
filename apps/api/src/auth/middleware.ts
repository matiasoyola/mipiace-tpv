import type { FastifyReply, FastifyRequest } from "fastify";

import { verifyAccessToken, type AccessTokenPayload } from "./tokens.js";
import { verifyCashierSession } from "../shift/cashier-session.js";

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

// Accept owner JWT *or* cashier session JWT. Decora `request.auth` con
// el tenant del actor para que la ruta haga el aislamiento normal.
// Usado por contactos y catálogo TPV — el cajero puede crear contactos
// on-the-fly y consultar el catálogo, no sólo el owner.
export async function requireOwnerOrCashier(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    reply.code(401).send({ error: "UNAUTHENTICATED", message: "Falta token" });
    return;
  }
  const token = header.slice(7);
  try {
    const access = verifyAccessToken(token);
    request.auth = {
      userId: access.sub,
      tenantId: access.tid,
      role: access.role,
    };
    return;
  } catch {
    // Fallback al cashier session token.
  }
  try {
    const cashier = verifyCashierSession(token);
    request.auth = {
      userId: cashier.sub,
      tenantId: cashier.tid,
      role: cashier.role,
    };
    request.cashier = { ...cashier, userId: cashier.sub };
  } catch {
    reply
      .code(401)
      .send({ error: "UNAUTHENTICATED", message: "Token inválido o caducado" });
  }
}
