import jwt from "jsonwebtoken";

import type { FastifyReply, FastifyRequest } from "fastify";

import { loadEnv } from "../env.js";

// Sesión del cajero en la PWA. Es independiente del JWT del owner
// (admin). Vive en memoria del cliente y se invalida por:
//   - cierre explícito (POST /shift/cashier-logout)
//   - timeout de inactividad (la PWA lo descarta tras N min)
//   - revocación del device (server-side, devuelve 401)
//
// Firmamos con JWT_ACCESS_SECRET pero con `type: "cashier"` para que
// no se confunda con un access token del owner. TTL inicial = ventana
// de auto-logout del tenant (default 10m); cada acción del cajero
// renueva el sessionToken de facto vía cookie/local-storage refresh.
//
// B-OnboardingV2: `purpose: "test-cashier"` marca un JWT emitido por el
// super-admin para que el equipo mipiacetpv pruebe el TPV antes de
// activar el tenant. TTL 24h, sin refresh, sin device check (el handler
// X-Device-Token también lo acepta), mutaciones permitidas. Los workers
// detectan los tickets generados por estos usuarios vía
// `User.isTestCashier` y los marcan TEST sin subirlos a Holded.
export type CashierSessionPurpose = "cashier" | "test-cashier";

export interface CashierSessionPayload {
  sub: string; // userId
  tid: string; // tenantId
  did: string; // deviceId
  rid: string; // registerId
  // v1.3-piloto-feedback · Lote 1: aceptamos OWNER en el TPV. El OWNER
  // creado en super-admin/activate también lleva pinHash, así que el
  // mismo User funciona como cajero por defecto sin necesidad de crear
  // un CASHIER duplicado en el onboarding.
  role: "OWNER" | "MANAGER" | "CASHIER";
  type: "cashier";
  purpose?: CashierSessionPurpose;
}

export function signCashierSession(
  payload: Omit<CashierSessionPayload, "type">,
  ttlMinutes: number,
): string {
  const env = loadEnv();
  return jwt.sign({ ...payload, type: "cashier" }, env.JWT_ACCESS_SECRET, {
    expiresIn: `${ttlMinutes}m` as jwt.SignOptions["expiresIn"],
  });
}

export function verifyCashierSession(token: string): CashierSessionPayload {
  const env = loadEnv();
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as CashierSessionPayload;
  if (payload.type !== "cashier") throw new Error("not a cashier session");
  return payload;
}

export interface CashierContext extends CashierSessionPayload {
  userId: string;
  isTest: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    cashier?: CashierContext;
  }
}

export async function requireCashierSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    reply.code(401).send({ error: "UNAUTHENTICATED", message: "Falta token" });
    return;
  }
  try {
    const payload = verifyCashierSession(header.slice(7));
    request.cashier = {
      ...payload,
      userId: payload.sub,
      isTest: payload.purpose === "test-cashier",
    };
  } catch {
    reply
      .code(401)
      .send({ error: "UNAUTHENTICATED", message: "Sesión inválida o expirada" });
  }
}
