// kds-1-cocina · QUIÉN ES LA PANTALLA, y qué NO puede hacer.
//
// ── Las dos puertas, y por qué son dos ────────────────────────────────
//
// 1. **`requireKitchenDevice`** (aquí): el `X-Device-Token` de un
//    dispositivo `KITCHEN` vivo de un tenant con el módulo encendido.
//    Deja en el request la tienda y las secciones de ESA pantalla, que es
//    lo único con lo que puede filtrar.
//
// 2. **El rechazo en `devices/auth.ts`**: `requireDeviceToken` —el
//    preHandler de TODAS las rutas del TPV— devuelve **403** a un
//    dispositivo `KITCHEN`.
//
// La segunda es la que de verdad protege, y está allí y no aquí a
// propósito: hay decenas de rutas de TPV (cobro, turno, registro de
// facturación, arqueo, catálogo, devoluciones) y acordarse de añadir un
// `if` en cada una es la forma de que falte en la próxima. Un `KITCHEN` no
// puede ni hacer login de cajero, así que no puede llegar a tener una
// sesión con la que cobrar: el 403 cae antes del PIN.
//
// Y al revés: un TERMINAL no puede tachar en cocina, porque las rutas de
// cocina no aceptan otra puerta que ésta. Las dos mitades tienen su fila en
// la tabla de sabotajes del bloque.
//
// ── SIN TURNO, SIN PIN, SIN IMPORTES ──────────────────────────────────
//
// La pantalla no abre turno (no hay cajero detrás) ni pide PIN: está
// colgada de la pared de una cocina y el cocinero tiene las manos
// ocupadas. Su identidad es el dispositivo, y lo que marca queda a nombre
// del dispositivo (`KitchenOrderLine.doneByDeviceId`), no de una persona.
//
// Y **no ve importes**: ni la comanda ni el GET de cocina llevan precios.
// No es sólo que no haga falta: una pantalla en la pared de la cocina la
// ve cualquiera que pase, incluido el cliente que va al baño.

import type { FastifyReply, FastifyRequest } from "fastify";

import type { KitchenSection } from "@mipiacetpv/db";

import { getPrisma } from "../context.js";
import { hashDeviceToken } from "../devices/auth.js";

export interface KitchenContext {
  deviceId: string;
  tenantId: string;
  registerId: string;
  /** La tienda de la caja de esta pantalla. El filtro del GET. */
  storeId: string;
  /** Las secciones que esta pantalla muestra. El otro filtro. */
  sections: KitchenSection[];
  deviceName: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    kitchen?: KitchenContext;
  }
}

/**
 * Resuelve un `X-Device-Token` a una pantalla de cocina, o null.
 *
 * Separado del preHandler porque el WebSocket de la pantalla usa el mismo
 * camino y no tiene `reply` donde responder: el token del dispositivo **no
 * caduca nunca**, así que no puede viajar en la query string de una URL
 * (acabaría en los logs de Caddy y en los de cualquier proxy). Igual que
 * `/ws/device` de A5, el socket se abre sin autenticar y el primer mensaje
 * es un `hello` con el token. Ver la cabecera de `devices/ws-route.ts`.
 */
export async function resolverPantalla(
  token: string,
): Promise<KitchenContext | { error: "UNKNOWN" | "REVOKED" | "NOT_KITCHEN" | "MODULE_OFF" }> {
  const prisma = getPrisma();
  const device = await prisma.device.findUnique({
    where: { deviceTokenHash: hashDeviceToken(token) },
    select: {
      id: true,
      name: true,
      kind: true,
      revokedAt: true,
      tenantId: true,
      registerId: true,
      kitchenSections: true,
      register: { select: { storeId: true } },
      tenant: { select: { kitchenDisplayEnabled: true } },
    },
  });
  if (!device) return { error: "UNKNOWN" };
  if (device.revokedAt) return { error: "REVOKED" };
  if (device.kind !== "KITCHEN") return { error: "NOT_KITCHEN" };
  if (!device.tenant.kitchenDisplayEnabled) return { error: "MODULE_OFF" };
  return {
    deviceId: device.id,
    tenantId: device.tenantId,
    registerId: device.registerId,
    storeId: device.register.storeId,
    sections: device.kitchenSections,
    deviceName: device.name,
  };
}

export async function requireKitchenDevice(
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
  const res = await resolverPantalla(token);
  if ("error" in res) {
    switch (res.error) {
      case "UNKNOWN":
      case "REVOKED":
        // Mismo cuerpo que el TPV: la pantalla vuelve a pedir código.
        reply.code(401).send({
          error: "DEVICE_REVOKED",
          message: "Dispositivo revocado o desconocido",
        });
        return;
      case "NOT_KITCHEN":
        // Un TERMINAL llamando a una ruta de cocina. 403 y no 404: el
        // aparato existe y es de este cliente, lo que no es es una
        // pantalla. Su fila en la tabla de sabotajes: «Un terminal no
        // puede tachar en cocina».
        reply.code(403).send({
          error: "NOT_A_KITCHEN_DEVICE",
          message: "Este dispositivo no es una pantalla de cocina.",
        });
        return;
      case "MODULE_OFF":
        // El módulo se apagó con la tablet emparejada. 403 y no 404: el
        // aparato sabe perfectamente que la cocina existe —la estaba
        // usando—, así que esconderla sería mentirle. Lo que se esconde
        // (404) es la clínica, y por el dato que protege.
        reply.code(403).send({
          error: "KITCHEN_MODULE_DISABLED",
          message: "El módulo de cocina no está activo en esta cuenta.",
        });
        return;
    }
  }
  request.kitchen = res;
}
