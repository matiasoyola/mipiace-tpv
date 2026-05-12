import jwt from "jsonwebtoken";

import { loadEnv } from "../env.js";

export interface AccessTokenPayload {
  sub: string; // userId
  tid: string; // tenantId
  role: "OWNER" | "MANAGER" | "CASHIER";
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  tid: string;
  // Token-version del usuario. POST /auth/logout-everywhere lo
  // incrementa en BD; el refresh con `tv` antiguo es rechazado por
  // `verifyRefreshToken`. Mecanismo de revocación masiva sin tabla
  // blacklist.
  tv: number;
  // "Recuérdame": cuando es 1, el refresh nace con TTL largo
  // (JWT_REFRESH_TTL_REMEMBER) y los siguientes refreshes preservan la
  // política. El front lo guarda en localStorage en lugar de
  // sessionStorage. 0 o undefined → política por defecto.
  rmb?: 0 | 1;
  type: "refresh";
}

export interface SignRefreshOptions {
  tv: number;
  remember?: boolean;
}

export function signAccessToken(payload: Omit<AccessTokenPayload, "type">): string {
  const env = loadEnv();
  return jwt.sign({ ...payload, type: "access" }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"],
  });
}

export function signRefreshToken(
  payload: { sub: string; tid: string },
  options: SignRefreshOptions,
): string {
  const env = loadEnv();
  const remember = options.remember === true;
  const ttl = remember ? env.JWT_REFRESH_TTL_REMEMBER : env.JWT_REFRESH_TTL;
  const body: Omit<RefreshTokenPayload, "type"> = {
    sub: payload.sub,
    tid: payload.tid,
    tv: options.tv,
    rmb: remember ? 1 : 0,
  };
  return jwt.sign({ ...body, type: "refresh" }, env.JWT_REFRESH_SECRET, {
    expiresIn: ttl as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const env = loadEnv();
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  if (payload.type !== "access") throw new Error("not an access token");
  return payload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const env = loadEnv();
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
  if (payload.type !== "refresh") throw new Error("not a refresh token");
  // `tv` puede no venir en tokens emitidos antes de B2. Defendemos
  // explícitamente y forzamos a numero — el caller compara con BD.
  if (typeof payload.tv !== "number") throw new Error("refresh token without tv");
  return payload;
}
