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
  type: "refresh";
}

export function signAccessToken(payload: Omit<AccessTokenPayload, "type">): string {
  const env = loadEnv();
  return jwt.sign({ ...payload, type: "access" }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"],
  });
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, "type">): string {
  const env = loadEnv();
  return jwt.sign({ ...payload, type: "refresh" }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL as jwt.SignOptions["expiresIn"],
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
  return payload;
}
