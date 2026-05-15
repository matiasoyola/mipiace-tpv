import jwt from "jsonwebtoken";

import { loadEnv } from "../env.js";

// JWT del super-admin. Firmado con SUPER_ADMIN_JWT_SECRET (distinto de
// los secrets per-tenant). Aceptamos `purpose: "super-admin"` en los
// access/refresh y `purpose: "impersonation"` en el JWT efímero de
// impersonación (firmado con el MISMO secret super-admin, distinguido
// por el campo `purpose`).

export interface SuperAdminAccessPayload {
  sub: string; // superAdminId
  purpose: "super-admin";
  tv: number;
  type: "access";
}

export interface SuperAdminRefreshPayload {
  sub: string;
  purpose: "super-admin";
  tv: number;
  type: "refresh";
}

export interface SuperAdminPending2faPayload {
  sub: string;
  purpose: "super-admin";
  type: "2fa-pending";
}

// JWT de impersonación. El frontend per-tenant lo recibe vía query
// param, lo guarda en sessionStorage y lo manda como Bearer. Los
// middlewares per-tenant lo aceptan SI purpose=impersonation,
// role=OWNER, readOnly=true (siempre).
export interface ImpersonationPayload {
  sub: string; // ownerUserId del tenant impersonado
  tid: string; // tenantId
  role: "OWNER";
  purpose: "impersonation";
  readOnly: true;
  // tokenVersion del OWNER al momento de emitir. Si el OWNER hace
  // logout-everywhere mientras hay una sesión de impersonation viva,
  // el JWT queda invalidado igual.
  tv: number;
  // superAdminId que originó la impersonación (auditoría).
  by: string;
}

export function signSuperAdminAccessToken(
  payload: Omit<SuperAdminAccessPayload, "type" | "purpose">,
): string {
  const env = loadEnv();
  return jwt.sign(
    { ...payload, purpose: "super-admin", type: "access" },
    env.SUPER_ADMIN_JWT_SECRET,
    { expiresIn: env.SUPER_ADMIN_ACCESS_TTL as jwt.SignOptions["expiresIn"] },
  );
}

export function signSuperAdminRefreshToken(
  payload: Omit<SuperAdminRefreshPayload, "type" | "purpose">,
): string {
  const env = loadEnv();
  return jwt.sign(
    { ...payload, purpose: "super-admin", type: "refresh" },
    env.SUPER_ADMIN_JWT_SECRET,
    { expiresIn: env.SUPER_ADMIN_REFRESH_TTL as jwt.SignOptions["expiresIn"] },
  );
}

export function verifySuperAdminAccessToken(token: string): SuperAdminAccessPayload {
  const env = loadEnv();
  const payload = jwt.verify(token, env.SUPER_ADMIN_JWT_SECRET) as
    SuperAdminAccessPayload;
  if (payload.type !== "access" || payload.purpose !== "super-admin") {
    throw new Error("not a super-admin access token");
  }
  return payload;
}

export function verifySuperAdminRefreshToken(
  token: string,
): SuperAdminRefreshPayload {
  const env = loadEnv();
  const payload = jwt.verify(token, env.SUPER_ADMIN_JWT_SECRET) as
    SuperAdminRefreshPayload;
  if (payload.type !== "refresh" || payload.purpose !== "super-admin") {
    throw new Error("not a super-admin refresh token");
  }
  return payload;
}

export function signSuperAdminPending2faToken(superAdminId: string): string {
  const env = loadEnv();
  return jwt.sign(
    { sub: superAdminId, purpose: "super-admin", type: "2fa-pending" },
    env.SUPER_ADMIN_JWT_SECRET,
    { expiresIn: "5m" as jwt.SignOptions["expiresIn"] },
  );
}

export function verifySuperAdminPending2faToken(
  token: string,
): SuperAdminPending2faPayload {
  const env = loadEnv();
  const payload = jwt.verify(token, env.SUPER_ADMIN_JWT_SECRET) as
    SuperAdminPending2faPayload;
  if (payload.type !== "2fa-pending" || payload.purpose !== "super-admin") {
    throw new Error("not a super-admin pending-2fa token");
  }
  return payload;
}

export function signImpersonationToken(payload: Omit<ImpersonationPayload, "purpose" | "readOnly" | "role">): string {
  const env = loadEnv();
  const body: ImpersonationPayload = {
    ...payload,
    role: "OWNER",
    purpose: "impersonation",
    readOnly: true,
  };
  return jwt.sign(body, env.SUPER_ADMIN_JWT_SECRET, {
    expiresIn: env.SUPER_ADMIN_IMPERSONATION_TTL as jwt.SignOptions["expiresIn"],
  });
}

// Verifica un JWT impersonation. Lo usan los middlewares per-tenant —
// se firma con el mismo SUPER_ADMIN_JWT_SECRET para que el JWT per-tenant
// (firmado con JWT_ACCESS_SECRET) nunca colisione: si un atacante consigue
// uno, no puede falsificar el otro.
export function verifyImpersonationToken(token: string): ImpersonationPayload {
  const env = loadEnv();
  const payload = jwt.verify(token, env.SUPER_ADMIN_JWT_SECRET) as
    ImpersonationPayload;
  if (payload.purpose !== "impersonation") {
    throw new Error("not an impersonation token");
  }
  if (payload.readOnly !== true) {
    throw new Error("impersonation token must be read-only");
  }
  if (payload.role !== "OWNER") {
    throw new Error("impersonation token must be OWNER");
  }
  return payload;
}
