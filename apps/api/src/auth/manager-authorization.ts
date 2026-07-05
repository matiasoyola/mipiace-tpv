import jwt from "jsonwebtoken";

import { loadEnv } from "../env.js";

// JWT corto que firma el endpoint POST /admin/auth/manager-authorize
// (B6 §2). El TPV lo recibe tras validar PIN del encargado y lo adjunta
// al `POST /tickets` para autorizar el descuento sobre umbral. TTL fijo
// de 5 min — vida útil pensada para "el encargado entra a la caja,
// teclea su PIN y se va". Si el cajero tarda más, vuelve a pedir.
//
// `purpose` discrimina el uso: hoy solo "discount-override", pero el
// mecanismo está pensado para reutilizarse (force-close, refund-over,
// etc.). Cualquier ruta que lo consuma verifica `purpose` exacto.

export interface ManagerAuthorizationPayload {
  sub: string; // manager userId
  tid: string; // tenant id
  // v1.8-Fiado añade "credit-void" (anular un fiado no saldado). Cada
  // ruta consumidora verifica el purpose EXACTO — un token de descuento
  // no sirve para anular un fiado y viceversa.
  purpose: "discount-override" | "credit-void";
  reason: string;
  context: {
    // Descuento máximo (%) que este token autoriza. 100 = autorización
    // total — habitual cuando el manager validó el PIN sin condiciones.
    maxDiscountPct: number;
  };
  type: "manager-auth";
}

const TTL_SECONDS = 5 * 60;

export function signManagerAuthorization(
  payload: Omit<ManagerAuthorizationPayload, "type">,
): string {
  const env = loadEnv();
  return jwt.sign({ ...payload, type: "manager-auth" }, env.JWT_ACCESS_SECRET, {
    expiresIn: `${TTL_SECONDS}s` as jwt.SignOptions["expiresIn"],
  });
}

export function verifyManagerAuthorization(
  token: string,
): ManagerAuthorizationPayload {
  const env = loadEnv();
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as ManagerAuthorizationPayload;
  if (payload.type !== "manager-auth") {
    throw new Error("not a manager authorization token");
  }
  return payload;
}

export const MANAGER_AUTH_TTL_SECONDS = TTL_SECONDS;
