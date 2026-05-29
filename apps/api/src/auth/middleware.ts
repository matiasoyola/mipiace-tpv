import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import { writeAudit } from "../superadmin/audit.js";
import { verifyAccessToken, type AccessTokenPayload } from "./tokens.js";
import { verifyCashierSession } from "../shift/cashier-session.js";
import {
  verifyImpersonationToken,
  type ImpersonationMode,
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
  // v1.3-SuperAdmin-Hub Lote 1: modo de la sesión de impersonación.
  // `null` cuando la request no es impersonada. `readonly` rechaza
  // mutaciones; `full` las permite y registra audit por cada una.
  impersonationMode?: ImpersonationMode | null;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

const READONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function extractRequestSignals(req: FastifyRequest): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const fwd = req.headers["x-forwarded-for"];
  let ip: string | null = null;
  if (typeof fwd === "string" && fwd.length > 0) {
    ip = fwd.split(",")[0]!.trim();
  } else if (req.ip) {
    ip = req.ip;
  }
  const ua = req.headers["user-agent"];
  const userAgent =
    typeof ua === "string" && ua.length > 0 ? ua.slice(0, 500) : null;
  return { ipAddress: ip, userAgent };
}

// v1.3-SuperAdmin-Hub Lote 1: registra una entrada `impersonate_write`
// por cada mutación ejecutada en modo full. Awaited — si el audit cae,
// preferimos que la mutación también falle (trazabilidad por encima de
// disponibilidad puntual de la consola super-admin).
async function recordImpersonationWrite(
  request: FastifyRequest,
  payload: ImpersonationPayload,
): Promise<void> {
  const prisma = getPrisma();
  const url = request.url.split("?")[0] ?? request.url;
  const signals = extractRequestSignals(request);
  // Hint compacto sobre el body: nombres de claves de primer nivel.
  // Si no hay body, lo dejamos null para no inventar metadata.
  let payloadSummary: Record<string, unknown> | null = null;
  const body = request.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    payloadSummary = { fields: Object.keys(body).slice(0, 20) };
  }
  await writeAudit({
    prisma,
    superAdminId: payload.by,
    action: "impersonate_write",
    tenantId: payload.tid,
    metadata: {
      ...signals,
      route: url,
      method: request.method.toUpperCase(),
      payloadSummary,
    },
  });
}

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

// v1.3-SuperAdmin-Hub Lote 1: el guard pasa a ser asíncrono porque en
// modo full registra audit antes de dejar pasar la mutación. Sigue
// siendo idempotente para readonly (devuelve true tras enviar 403).
async function handleImpersonationMutation(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: ImpersonationPayload,
): Promise<boolean> {
  if (READONLY_METHODS.has(request.method.toUpperCase())) return false;
  if (payload.mode === "full") {
    // Audit por cada acción de escritura — falla cerrado.
    try {
      await recordImpersonationWrite(request, payload);
    } catch (err) {
      request.log.error(
        { event: "impersonate_write_audit_failed", err },
        "no se pudo registrar audit impersonate_write — bloqueamos la mutación",
      );
      reply.code(500).send({
        error: "IMPERSONATION_AUDIT_FAILED",
        code: "IMPERSONATION_AUDIT_FAILED",
        message:
          "No se pudo registrar la acción en el log de auditoría. Reintenta o cierra la sesión de configuración.",
      });
      return true;
    }
    return false;
  }
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
      impersonationMode: resolved.payload.mode,
    };
  } else {
    request.auth = {
      userId: resolved.payload.sub,
      tenantId: resolved.payload.tid,
      role: resolved.payload.role,
      isImpersonation: false,
      impersonatedBy: null,
      impersonationMode: null,
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
    if (await handleImpersonationMutation(request, reply, resolved.payload)) return;
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
    if (await handleImpersonationMutation(request, reply, resolved.payload)) return;
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
      impersonationMode: null,
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
      impersonationMode: null,
    };
    request.cashier = {
      ...cashier,
      userId: cashier.sub,
      isTest: cashier.purpose === "test-cashier",
    };
    return;
  } catch {
    // sigue
  }
  // Intento 3: JWT impersonation. v1.3-SuperAdmin-Hub Lote 1 admite
  // mode=full (mutaciones permitidas + audit) o mode=readonly (rechaza
  // mutaciones con 403).
  let imp: ImpersonationPayload;
  try {
    imp = verifyImpersonationToken(token);
  } catch {
    reply
      .code(401)
      .send({ error: "UNAUTHENTICATED", message: "Token inválido o caducado" });
    return;
  }
  if (await handleImpersonationMutation(request, reply, imp)) return;
  request.auth = {
    userId: imp.sub,
    tenantId: imp.tid,
    role: imp.role,
    isImpersonation: true,
    impersonatedBy: imp.by,
    impersonationMode: imp.mode,
  };
}
