import { createHash, randomBytes } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import { verifyCashierSession } from "../shift/cashier-session.js";

// Contexto que dejamos en el request cuando el header `X-Device-Token`
// valida. Lo decora `requireDeviceToken` para que las rutas del TPV
// puedan leer `request.device.tenantId` / `registerId` sin volver a
// consultar BD.
export interface DeviceContext {
  deviceId: string;
  tenantId: string;
  registerId: string;
  // B-OnboardingV2: true cuando el "device token" no es realmente un
  // device emparejado sino un JWT test-cashier que el super-admin emitió
  // desde la consola. En ese caso el flag `isTest` viaja con el contexto
  // para que los handlers que dispersan tickets, abrir shift, etc. los
  // marquen como TEST.
  isTest?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    device?: DeviceContext;
  }
}

// El device token es alto-entropía (32 bytes random base64) por lo que
// SHA-256 es suficiente y la única opción viable para un lookup O(1)
// vía índice unique. Argon2id se usa para PINs/contraseñas (baja
// entropía); aplicarlo a tokens random obligaría a iterar todos los
// devices del tenant en cada request y romper el SLA de latencia. La
// columna `deviceTokenHash` está marcada `@unique` precisamente para
// permitir este lookup. Deviación deliberada respecto al prompt B3 que
// sugería argon2id — documentada en B3-done.md.
const TOKEN_BYTES = 32;

export function generateDeviceToken(): { plain: string; hash: string } {
  const buf = randomBytes(TOKEN_BYTES);
  const plain = buf.toString("base64url");
  return { plain, hash: hashDeviceToken(plain) };
}

export function hashDeviceToken(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

export async function requireDeviceToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers["x-device-token"];
  const token =
    typeof header === "string" ? header : Array.isArray(header) ? header[0] : null;
  if (!token || token.length < 16) {
    reply
      .code(401)
      .send({ error: "DEVICE_TOKEN_REQUIRED", message: "Falta X-Device-Token" });
    return;
  }
  // B-OnboardingV2: si el token parece un JWT (tres segmentos
  // base64url), intentamos validarlo como cashier session con purpose
  // "test-cashier". Esto permite al super-admin operar el TPV completo
  // (incluido el endpoint /devices/me que arranca la PWA) sin tener
  // emparejado un device físico. Si la verificación falla, caemos al
  // flujo normal (lookup en la tabla `devices`).
  if (token.split(".").length === 3) {
    try {
      const payload = verifyCashierSession(token);
      if (payload.purpose === "test-cashier") {
        request.device = {
          deviceId: payload.did,
          tenantId: payload.tid,
          registerId: payload.rid,
          isTest: true,
        };
        return;
      }
    } catch {
      // No es un JWT test-cashier válido; sigue con el lookup normal.
    }
  }
  const prisma = getPrisma();
  const device = await prisma.device.findUnique({
    where: { deviceTokenHash: hashDeviceToken(token) },
    select: {
      id: true,
      tenantId: true,
      registerId: true,
      revokedAt: true,
    },
  });
  if (!device || device.revokedAt) {
    reply
      .code(401)
      .send({ error: "DEVICE_REVOKED", message: "Dispositivo revocado o desconocido" });
    return;
  }
  request.device = {
    deviceId: device.id,
    tenantId: device.tenantId,
    registerId: device.registerId,
  };
}
