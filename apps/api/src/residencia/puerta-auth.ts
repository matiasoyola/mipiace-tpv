// residencia-1 (D-52) · QUIÉN ES LA PUERTA, y qué NO puede hacer.
//
// Copia estructural de `kitchen/auth.ts`, y la copia es deliberada: son el
// mismo problema (la misma APK en otro modo, identidad = el dispositivo) y
// que se lean igual es lo que hace que el día que uno cambie, se vea que
// el otro no.
//
// ── Las dos puertas, y por qué son dos ───────────────────────────────
//
// 1. **`requirePuertaDevice`** (aquí): el `X-Device-Token` de un
//    dispositivo `ROOM` vivo, de un tenant con la residencia encendida.
//    Deja en el request la habitación de ESA tablet, que es lo único con
//    lo que puede filtrar.
//
// 2. **El rechazo en `devices/auth.ts`**: `requireDeviceToken` —el
//    preHandler de TODAS las rutas del TPV— devuelve **403
//    ROOM_DEVICE_NOT_ALLOWED** a un `ROOM`.
//
// La segunda es la que de verdad protege, y está allí y no aquí por lo
// mismo que en cocina: hay decenas de rutas de TPV (cobro, turno, registro
// de facturación, arqueo, catálogo, devoluciones) y acordarse de añadir un
// `if` en cada una es la forma de que falte en la próxima. Una puerta no
// puede ni hacer login de cajero, así que no puede llegar a tener una
// sesión con la que cobrar: el 403 cae antes del PIN.
//
// Y al revés: un TERMINAL no puede leer una puerta, porque las rutas de la
// puerta no aceptan otra puerta de auth que ésta. Las dos mitades tienen
// su fila en la tabla de sabotajes del bloque.
//
// ── SIN TURNO, SIN COBRO, SIN RELEVO ─────────────────────────────────
//
// La puerta no abre turno de caja (no hay cajero detrás), no cobra, no
// emite registro fiscal y **no releva a nadie**: lo último sale del motor,
// no de aquí — el trigger `devices_revoke_previous` sólo releva al
// terminal de una caja cuando el aparato nuevo es un `TERMINAL`, y a la
// puerta anterior de SU habitación cuando es un `ROOM`.
//
// ── Y EN ESTE BLOQUE, NI UN DATO DE SALUD ────────────────────────────
//
// `GET /residencia/puerta/me` devuelve el número de habitación, su nombre
// y quién la ocupa — **nombre y nada más**. Ni nivel de dependencia, ni
// grado, ni tipo de plaza, ni una alergia. Una tablet colgada en la pared
// de un pasillo la ve cualquiera que pase: la familia de la 110, el
// técnico del ascensor, el inspector. La pantalla donde el personal
// registra (con PIN delante) es residencia-3.

import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import { hashDeviceToken } from "../devices/auth.js";

export interface PuertaContext {
  deviceId: string;
  tenantId: string;
  roomId: string;
  deviceName: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    puerta?: PuertaContext;
  }
}

/**
 * Resuelve un `X-Device-Token` a la puerta de una habitación, o un error.
 *
 * Separado del preHandler por lo mismo que `resolverPantalla`: el día que
 * la puerta tenga socket (residencia-3, para que un registro de otra
 * tablet refresque esta), no habrá `reply` donde responder.
 */
export async function resolverPuerta(
  token: string,
): Promise<
  | PuertaContext
  | { error: "UNKNOWN" | "REVOKED" | "NOT_ROOM" | "MODULE_OFF" }
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
      roomId: true,
      tenant: { select: { residenciaEnabled: true } },
    },
  });
  if (!device) return { error: "UNKNOWN" };
  if (device.revokedAt) return { error: "REVOKED" };
  if (device.kind !== "ROOM") return { error: "NOT_ROOM" };
  if (!device.tenant.residenciaEnabled) return { error: "MODULE_OFF" };
  // El CHECK `devices_register_o_habitacion` garantiza que un `ROOM` tiene
  // habitación. Se comprueba igual, por lo mismo que en cocina: un `!`
  // sobre una fila que la base no admite es una afirmación que nadie
  // vuelve a revisar.
  if (device.roomId == null) return { error: "UNKNOWN" };
  return {
    deviceId: device.id,
    tenantId: device.tenantId,
    roomId: device.roomId,
    deviceName: device.name,
  };
}

export async function requirePuertaDevice(
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
  const res = await resolverPuerta(token);
  if ("error" in res) {
    switch (res.error) {
      case "UNKNOWN":
      case "REVOKED":
        // Mismo cuerpo que el TPV y que cocina: la tablet vuelve a pedir
        // código de emparejamiento.
        reply.code(401).send({
          error: "DEVICE_REVOKED",
          message: "Dispositivo revocado o desconocido",
        });
        return;
      case "NOT_ROOM":
        // Un TERMINAL o una pantalla de cocina llamando a una ruta de
        // puerta. 403 y no 404: el aparato existe y es de este cliente, lo
        // que no es es una puerta.
        reply.code(403).send({
          error: "NOT_A_ROOM_DEVICE",
          message: "Este dispositivo no es la tablet de una habitación.",
        });
        return;
      case "MODULE_OFF":
        // El módulo se apagó con la tablet emparejada. **403 y no 404**, y
        // aquí sí se separa de la regla del gate: a esta tablet no se le
        // esconde un módulo que estaba usando hace un minuto — sería
        // mentirle, y el técnico que vaya a mirarla necesita leer por qué.
        // El 404 es para quien NO tiene el módulo y no debe enterarse de
        // que existe, que es un bar con un token de panel. Mismo criterio
        // exacto que `KITCHEN_MODULE_DISABLED` en kds-1.
        reply.code(403).send({
          error: "RESIDENCIA_MODULE_DISABLED",
          message: "El módulo de residencia no está activo en esta cuenta.",
        });
        return;
    }
  }
  request.puerta = res;
}
