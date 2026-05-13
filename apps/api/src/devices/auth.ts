import { createHash, randomBytes } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";

// Contexto que dejamos en el request cuando el header `X-Device-Token`
// valida. Lo decora `requireDeviceToken` para que las rutas del TPV
// puedan leer `request.device.tenantId` / `registerId` sin volver a
// consultar BD.
export interface DeviceContext {
  deviceId: string;
  tenantId: string;
  registerId: string;
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
