// residencia-5 (D-67) · QUIÉN ES LA TABLET DE LA SALA, y qué NO puede
// hacer.
//
// Copia estructural de `guardia-auth.ts` —que copia `puerta-auth.ts`, que
// copia `kitchen/auth.ts`— y la copia es deliberada por **cuarta** vez:
// es el mismo problema (la misma APK en otro modo, identidad = el
// dispositivo) y que las cuatro se lean igual es lo que hace que el día
// que una cambie, se vea que las otras no.
//
// ── LAS DOS PUERTAS, Y POR QUÉ SON DOS ──────────────────────────────
//
// 1. **`requireSalaDevice`** (aquí): el `X-Device-Token` de un
//    dispositivo `HANDOVER` vivo, de un tenant con la residencia
//    encendida.
//
// 2. **El rechazo en `devices/auth.ts`**: `requireDeviceToken` —el
//    preHandler de TODAS las rutas del TPV— devuelve **403
//    HANDOVER_DEVICE_NOT_ALLOWED** a un `HANDOVER`.
//
// La segunda es la que de verdad protege, y está allí y no aquí por lo
// mismo que en cocina, en la puerta y en guardia: hay decenas de rutas de
// TPV y acordarse de añadir un `if` en cada una es la forma de que falte
// en la próxima.
//
// Y al revés, que es la mitad que este bloque tiene que probar: **un
// TERMINAL, una PUERTA o un MÓVIL DE GUARDIA no entran en las rutas de la
// sala**, porque las rutas de la sala no aceptan otra puerta de auth que
// ésta. Las dos mitades tienen su fila en la tabla de sabotajes.
//
// ── LA SALA ES DEL CENTRO, Y POR ESO NO HAY TERCERA COLUMNA ─────────
//
// Una puerta es de una habitación (`room_id`) y un móvil de guardia es de
// un canal (`guard_channel`). La tablet de la sala es **del centro**, y el
// centro es el tenant: no hay nada que guardar. El CHECK
// `devices_register_o_habitacion` lo dice al revés —un `HANDOVER` no tiene
// ni caja ni habitación— y eso es toda la información que hace falta.
//
// Consecuencia dicha: **un centro puede tener más de una tablet de sala**
// —una por planta es un caso real— y las dos enseñan el mismo parte. No
// hay índice de unicidad, al revés que la puerta de una habitación.

import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import { hashDeviceToken } from "../devices/auth.js";

export interface SalaContext {
  deviceId: string;
  tenantId: string;
  deviceName: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    sala?: SalaContext;
  }
}

/**
 * Resuelve un `X-Device-Token` a una tablet de sala, o un error.
 *
 * Separado del preHandler por lo mismo que `resolverPuerta`,
 * `resolverPantalla` y `resolverGuardia`: quien lo necesite fuera de una
 * petición con `reply` no tiene dónde responder.
 */
export async function resolverSala(
  token: string,
): Promise<SalaContext | { error: "UNKNOWN" | "REVOKED" | "NOT_SALA" | "MODULE_OFF" }> {
  const prisma = getPrisma();
  const device = await prisma.device.findUnique({
    where: { deviceTokenHash: hashDeviceToken(token) },
    select: {
      id: true,
      name: true,
      kind: true,
      revokedAt: true,
      tenantId: true,
      tenant: { select: { residenciaEnabled: true } },
    },
  });
  if (!device) return { error: "UNKNOWN" };
  if (device.revokedAt) return { error: "REVOKED" };
  if (device.kind !== "HANDOVER") return { error: "NOT_SALA" };
  if (!device.tenant.residenciaEnabled) return { error: "MODULE_OFF" };
  return {
    deviceId: device.id,
    tenantId: device.tenantId,
    deviceName: device.name,
  };
}

export async function requireSalaDevice(
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
  const res = await resolverSala(token);
  if ("error" in res) {
    switch (res.error) {
      case "UNKNOWN":
      case "REVOKED":
        reply.code(401).send({
          error: "DEVICE_REVOKED",
          message: "Dispositivo revocado o desconocido",
        });
        return;
      case "NOT_SALA":
        // Un TERMINAL, una pantalla de cocina, una puerta o un móvil de
        // guardia llamando a una ruta de la sala. 403 y no 404: el
        // aparato existe y es de este cliente; lo que no es es la tablet
        // de la sala.
        reply.code(403).send({
          error: "NOT_A_HANDOVER_DEVICE",
          message: "Este dispositivo no es la tablet de la sala.",
        });
        return;
      case "MODULE_OFF":
        // Mismo criterio exacto que cocina, la puerta y la guardia: a un
        // aparato emparejado no se le esconde un módulo que estaba usando
        // hace un minuto. El 404 es para quien NO tiene el módulo.
        reply.code(403).send({
          error: "RESIDENCIA_MODULE_DISABLED",
          message: "El módulo de residencia no está activo en esta cuenta.",
        });
        return;
    }
  }
  request.sala = res;
}
