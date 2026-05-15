import type { FastifyReply, FastifyRequest } from "fastify";

import { verifyAccessToken, type AccessTokenPayload } from "./tokens.js";
import { verifyCashierSession } from "../shift/cashier-session.js";
import {
  verifyImpersonationToken,
  type ImpersonationPayload,
} from "../superadmin/tokens.js";

// Tipo extendido que se publica en cada request autenticado.
export interface AuthContext {
  userId: string;
  tenantId: string;
  role: "OWNER" | "MANAGER" | "CASHIER";
  // Cuando el actor es un super-admin impersonando al OWNER del tenant,
  // este flag está true. Los handlers que mutan estado pueden usarlo
  // para decisiones específicas (la regla principal — bloquear mutaciones
  // — la aplica el propio middleware). El audit log de mutaciones (cuando
  // exista) puede leer `impersonatedBy` para registrar al super-admin.
  isImpersonation?: boolean;
  // ID del super-admin que originó la sesión de impersonación. Null
  // cuando no es impersonación.
  impersonatedBy?: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

const READONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Intenta interpretar el Bearer token primero como access token per-tenant
// y, si falla, como JWT de impersonación super-admin. Si ninguno valida,
// devuelve null. Centraliza la lógica para los tres middlewares OWNER/
// OWNER-or-MANAGER/OWNER-or-Cashier.
type ResolvedToken =
  | { kind: "access"; payload: AccessTokenPayload }
  | { kind: "impersonation"; payload: ImpersonationPayload };

function resolveToken(token: string): ResolvedToken | null {
  try {
    return { kind: "access", payload: verifyAccessToken(token) };
  } catch {
    // sigue
  }
  try {
    return { kind: "impersonation", payload: verifyImpersonationToken(token) };
  } catch {
    return null;
  }
}

function rejectImpersonationMutation(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  if (READONLY_METHODS.has(request.method.toUpperCase())) return false;
  reply.code(403).send({
    error: "IMPERSONATION_READONLY",
    code: "IMPERSONATION_READONLY",
    message: "Sesión de impersonación es sólo lectura",
  });
  return true;
}

function applyAuthContext(
  request: FastifyRequest,
  resolved: ResolvedToken,
): void {
  if (resolved.kind === "impersonation") {
    request.auth = {
      userId: resolved.payload.sub,
      tenantId: resolved.payload.tid,
      role: "OWNER",
      isImpersonation: true,
      impersonatedBy: resolved.payload.by,
    };
  } else {
    request.auth = {
      userId: resolved.payload.sub,
      tenantId: resolved.payload.tid,
      role: resolved.payload.role,
      isImpersonation: false,
      impersonatedBy: null,
    };
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
  const resolved = resolveToken(token);
  if (!resolved) {
    reply.code(401).send({ error: "UNAUTHENTICATED", message: "Token inválido o caducado" });
    return;
  }
  // Tanto access OWNER como impersonation cumplen el requisito de
  // "owner". Impersonation siempre es role OWNER (validado en verify).
  const role = resolved.kind === "access" ? resolved.payload.role : "OWNER";
  if (role !== "OWNER") {
    reply.code(403).send({ error: "FORBIDDEN", message: "Sólo propietarios" });
    return;
  }
  if (resolved.kind === "impersonation") {
    if (rejectImpersonationMutation(request, reply)) return;
  }
  applyAuthContext(request, resolved);
}

// Acepta JWT de OWNER o MANAGER (B6 §1). Sustituye a `requireOwner` en
// la mayoría de endpoints del admin — el MANAGER puede gestionar la
// operativa diaria pero NO toca infraestructura (stores/registers/users/
// rotación de claves/fiscal/ajustes de tenant).
export async function requireOwnerOrManager(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    reply.code(401).send({ error: "UNAUTHENTICATED", message: "Falta token" });
    return;
  }
  const token = header.slice(7);
  const resolved = resolveToken(token);
  if (!resolved) {
    reply.code(401).send({ error: "UNAUTHENTICATED", message: "Token inválido o caducado" });
    return;
  }
  const role = resolved.kind === "access" ? resolved.payload.role : "OWNER";
  if (role !== "OWNER" && role !== "MANAGER") {
    reply
      .code(403)
      .send({ error: "FORBIDDEN", message: "Sólo propietarios o encargados" });
    return;
  }
  if (resolved.kind === "impersonation") {
    if (rejectImpersonationMutation(request, reply)) return;
  }
  applyAuthContext(request, resolved);
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
  // Intento 1: access token per-tenant (cualquier rol).
  try {
    const access = verifyAccessToken(token);
    request.auth = {
      userId: access.sub,
      tenantId: access.tid,
      role: access.role,
      isImpersonation: false,
      impersonatedBy: null,
    };
    return;
  } catch {
    // Fallback al cashier session token.
  }
  // Intento 2: cashier session.
  try {
    const cashier = verifyCashierSession(token);
    request.auth = {
      userId: cashier.sub,
      tenantId: cashier.tid,
      role: cashier.role,
      isImpersonation: false,
      impersonatedBy: null,
    };
    request.cashier = { ...cashier, userId: cashier.sub };
    return;
  } catch {
    // sigue
  }
  // Intento 3: JWT impersonation (read-only). Read-only impersonation
  // del OWNER también pasa por aquí: rechazamos mutaciones igual.
  try {
    const imp = verifyImpersonationToken(token);
    if (rejectImpersonationMutation(request, reply)) return;
    request.auth = {
      userId: imp.sub,
      tenantId: imp.tid,
      role: imp.role,
      isImpersonation: true,
      impersonatedBy: imp.by,
    };
    return;
  } catch {
    reply
      .code(401)
      .send({ error: "UNAUTHENTICATED", message: "Token inválido o caducado" });
  }
}
