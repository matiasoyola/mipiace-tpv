// residencia-4 (D-66) · QUIÉN ES EL MÓVIL DE GUARDIA, y qué NO puede
// hacer.
//
// Copia estructural de `puerta-auth.ts` —que a su vez copia
// `kitchen/auth.ts`— y la copia es deliberada por tercera vez: es el
// mismo problema (la misma APK en otro modo, identidad = el dispositivo)
// y que se lean igual es lo que hace que el día que uno cambie, se vea
// que los otros no.
//
// ── Las dos puertas, y por qué son dos ───────────────────────────────
//
// 1. **`requireGuardiaDevice`** (aquí): el `X-Device-Token` de un
//    dispositivo `GUARD` vivo, de un tenant con la residencia encendida.
//    Deja en el request el CANAL de ese móvil, que es lo único con lo que
//    puede filtrar.
//
// 2. **El rechazo en `devices/auth.ts`**: `requireDeviceToken` —el
//    preHandler de TODAS las rutas del TPV— devuelve **403
//    GUARD_DEVICE_NOT_ALLOWED** a un `GUARD`.
//
// La segunda es la que de verdad protege, y está allí y no aquí por lo
// mismo que en cocina y en la puerta: hay decenas de rutas de TPV y
// acordarse de añadir un `if` en cada una es la forma de que falte en la
// próxima.
//
// Y al revés, que es la mitad que este bloque tiene que probar: **un
// TERMINAL o una PUERTA no entran en las rutas de guardia**, porque las
// rutas de guardia no aceptan otra puerta de auth que ésta. Las dos
// mitades tienen su fila en la tabla de sabotajes.
//
// ── LO QUE EL CANAL ES Y LO QUE NO ───────────────────────────────────
//
// El canal (`ENFERMERIA` / `RESPONSABLE`) lo decide **el código de
// emparejamiento**, que lo creó alguien autenticado desde el admin. No
// viene del cuerpo de ninguna petición y el móvil no lo puede cambiar: si
// pudiera, cualquiera con un móvil emparejado se pondría en el canal de
// enfermería y recibiría los avisos de salud del centro entero.
//
// ── Y NO HAY UNO POR CANAL ───────────────────────────────────────────
//
// Al revés que la puerta, que releva a la anterior de su habitación: un
// centro puede tener tres móviles de enfermería a la vez y **los tres
// tienen que sonar**. El motor lo permite por omisión: el índice
// `devices_one_active_per_room_key` filtra `kind = 'ROOM'` y el trigger
// `devices_revoke_previous` sale por la puerta de atrás con
// `NEW.kind <> 'TERMINAL'`.

import type { FastifyReply, FastifyRequest } from "fastify";

import type { GuardChannel } from "@mipiacetpv/db";

import { getPrisma } from "../context.js";
import { hashDeviceToken } from "../devices/auth.js";

export interface GuardiaContext {
  deviceId: string;
  tenantId: string;
  canal: GuardChannel;
  deviceName: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    guardia?: GuardiaContext;
  }
}

/**
 * Resuelve un `X-Device-Token` a un móvil de guardia, o un error.
 *
 * Separado del preHandler por lo mismo que `resolverPuerta` y
 * `resolverPantalla`: el socket (`/ws/guardia`) lo necesita y allí no hay
 * `reply` donde responder.
 */
export async function resolverGuardia(
  token: string,
): Promise<
  | GuardiaContext
  | { error: "UNKNOWN" | "REVOKED" | "NOT_GUARD" | "MODULE_OFF" }
> {
  const prisma = getPrisma();
  const device = await prisma.device.findUnique({
    where: { deviceTokenHash: hashDeviceToken(token) },
    select: {
      id: true,
      name: true,
      kind: true,
      revokedAt: true,
      tenantId: true,
      guardChannel: true,
      tenant: { select: { residenciaEnabled: true } },
    },
  });
  if (!device) return { error: "UNKNOWN" };
  if (device.revokedAt) return { error: "REVOKED" };
  if (device.kind !== "GUARD") return { error: "NOT_GUARD" };
  if (!device.tenant.residenciaEnabled) return { error: "MODULE_OFF" };
  // El CHECK `devices_guard_canal` garantiza que un `GUARD` tiene canal.
  // Se comprueba igual, por lo mismo que el `roomId == null` de la
  // puerta: un `!` sobre una fila que la base no admite es una afirmación
  // que nadie vuelve a revisar.
  if (device.guardChannel == null) return { error: "UNKNOWN" };
  return {
    deviceId: device.id,
    tenantId: device.tenantId,
    canal: device.guardChannel,
    deviceName: device.name,
  };
}

export async function requireGuardiaDevice(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers["x-device-token"];
  const token =
    typeof header === "string" ? header : Array.isArray(header) ? header[0] : null;
  if (!token || token.length < 16) {
    reply.code(401).send({
      error: "DEVICE_TOKEN_REQUIRED",
      message: "Falta X-Device-Token",
    });
    return;
  }
  const res = await resolverGuardia(token);
  if ("error" in res) {
    switch (res.error) {
      case "UNKNOWN":
      case "REVOKED":
        reply.code(401).send({
          error: "DEVICE_REVOKED",
          message: "Dispositivo revocado o desconocido",
        });
        return;
      case "NOT_GUARD":
        // Un TERMINAL, una pantalla de cocina o **una puerta** llamando a
        // una ruta de guardia. 403 y no 404: el aparato existe y es de
        // este cliente, lo que no es es un móvil de guardia.
        reply.code(403).send({
          error: "NOT_A_GUARD_DEVICE",
          message: "Este dispositivo no es un móvil de guardia.",
        });
        return;
      case "MODULE_OFF":
        // Mismo criterio exacto que la puerta y que cocina: a un aparato
        // emparejado no se le esconde un módulo que estaba usando hace un
        // minuto. El 404 es para quien NO tiene el módulo.
        reply.code(403).send({
          error: "RESIDENCIA_MODULE_DISABLED",
          message: "El módulo de residencia no está activo en esta cuenta.",
        });
        return;
    }
  }
  request.guardia = res;
}
