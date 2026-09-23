// F1 · la identidad del móvil del empleado (ADR-018).
//
// Copia el patrón de `devices/auth.ts` pieza por pieza —32 bytes random
// base64url, SHA-256, columna `@unique` para lookup O(1)— con UNA
// diferencia estructural: no cuelga de un `Register`.
//
// El emparejamiento de terminales del TPV pertenece a una caja: el código
// se pide desde `/admin/registers/:registerId/pairing-codes` y todas sus
// rutas pasan por `ensureCajaEnabled`. El colegio de Talavera no tiene
// caja. Por eso esto es una tabla y un middleware propios y no un campo
// nullable en `devices` — decisión de Matías del 23-09: un terminal sigue
// perteneciendo a una caja, y no se toca.
//
// Por qué SHA-256 y no argon2id, igual que en B3: el token es de alta
// entropía (32 bytes random), así que no hay nada que derivar lentamente,
// y argon2id obligaría a iterar todos los móviles del tenant en cada
// petición. Argon2id es para PINs y contraseñas, que son adivinables.
//
// Sin PIN, a propósito: el móvil es personal y ya es la identidad. Un PIN
// añadiría fricción a lo único que el empleado hace en esta pantalla, y
// la palanca de seguridad real —un móvil perdido— ya existe y es mejor:
// generar otro enlace revoca el anterior.

import { createHash, randomBytes } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import "./context.js";

const TOKEN_BYTES = 32;

export function generateEmployeeToken(): { plain: string; hash: string } {
  const plain = randomBytes(TOKEN_BYTES).toString("base64url");
  return { plain, hash: hashEmployeeToken(plain) };
}

export function hashEmployeeToken(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

/**
 * El enlace de emparejamiento. También 32 bytes random: viaja en una URL
 * que se comparte por WhatsApp y vive 7 días, así que un código de 6
 * dígitos como el de `PairingCode` sería enumerable (10⁶ combinaciones
 * contra una semana de validez). Aquél se teclea en un terminal y vive
 * una hora; éste no se teclea nunca.
 */
export function generatePairingToken(): { plain: string; hash: string } {
  const plain = randomBytes(TOKEN_BYTES).toString("base64url");
  return { plain, hash: hashEmployeeToken(plain) };
}

export const EMPLOYEE_TOKEN_HEADER = "x-employee-token";

export async function requireEmployeeDevice(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers[EMPLOYEE_TOKEN_HEADER];
  const token =
    typeof header === "string" ? header : Array.isArray(header) ? header[0] : null;
  if (!token || token.length < 16) {
    reply.code(401).send({
      error: "EMPLOYEE_TOKEN_REQUIRED",
      message: "Falta el token del móvil",
    });
    return;
  }
  const prisma = getPrisma();
  const device = await prisma.employeeDevice.findUnique({
    where: { deviceTokenHash: hashEmployeeToken(token) },
    select: {
      id: true,
      tenantId: true,
      revokedAt: true,
      employee: { select: { id: true, active: true } },
    },
  });
  if (!device || device.revokedAt) {
    reply.code(401).send({
      error: "EMPLOYEE_DEVICE_REVOKED",
      message:
        "Este móvil ya no está emparejado. Pide a tu empresa un enlace nuevo.",
    });
    return;
  }
  // Un empleado dado de baja no ficha. Sus registros siguen ahí —los
  // triggers impiden borrarlos— pero su móvil deja de valer, y el mensaje
  // lo dice sin hacerle pensar.
  if (!device.employee.active) {
    reply.code(401).send({
      error: "EMPLOYEE_INACTIVE",
      message: "Tu empresa te ha dado de baja en el control horario.",
    });
    return;
  }
  request.employee = {
    employeeId: device.employee.id,
    tenantId: device.tenantId,
    deviceId: device.id,
  };
}
