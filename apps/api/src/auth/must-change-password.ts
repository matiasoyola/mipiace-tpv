import jwt from "jsonwebtoken";

import { loadEnv } from "../env.js";

// JWT especial emitido en login cuando user.mustChangePasswordAt != null.
// Distinto del access token regular — el middleware `requireOwner` etc.
// lo rechaza (verifyAccessToken exige type=access). Sólo el endpoint
// /auth/change-password-initial lo acepta.
//
// TTL 15 min — el OWNER tiene tiempo de cambiar la password tras recibir
// el email, pero no se queda válido eternamente.

export interface MustChangePasswordPayload {
  sub: string; // userId
  tid: string; // tenantId
  role: "OWNER" | "MANAGER" | "CASHIER";
  purpose: "must-change-password";
  tv: number;
}

const MUST_CHANGE_TTL = "15m";

export function signMustChangePasswordToken(
  payload: Omit<MustChangePasswordPayload, "purpose">,
): string {
  const env = loadEnv();
  return jwt.sign(
    { ...payload, purpose: "must-change-password" },
    env.JWT_ACCESS_SECRET,
    { expiresIn: MUST_CHANGE_TTL as jwt.SignOptions["expiresIn"] },
  );
}

export function verifyMustChangePasswordToken(
  token: string,
): MustChangePasswordPayload {
  const env = loadEnv();
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as MustChangePasswordPayload;
  if (payload.purpose !== "must-change-password") {
    throw new Error("not a must-change-password token");
  }
  return payload;
}
