// residencia-3 (decisión de producto 8) · LA SESIÓN DE LA PUERTA.
//
// Copia estructural de `shift/cashier-session.ts`, y la copia es
// deliberada por lo mismo que `puerta-auth.ts` copia `kitchen/auth.ts`:
// son el mismo problema (un JWT corto emitido tras un PIN en un
// dispositivo emparejado) y que se lean igual es lo que hace que el día
// que uno cambie, se vea que el otro no.
//
// ── QUÉ PRUEBA ESTA SESIÓN, Y QUÉ NO ────────────────────────────────
//
// Prueba **que alguien con un PIN bueno de este centro está en esta
// puerta**. Eso es lo que autoriza a leer lo que hay detrás del PIN y a
// mandar un lote de registros.
//
// **No es la firma de los registros.** La firma —persona + capacidad
// (D-31)— viaja en CADA registro del lote, y el servidor la comprueba una
// por una. Son dos cosas distintas a propósito, y la razón es la red:
//
//   · Un lote puede salir de la tablet **horas después** de que se
//     registrara, con la auxiliar que lo tecleó ya en su casa. Si el lote
//     tuviera que ir firmado con SU sesión, un turno de noche sin wifi
//     perdería los cambios posturales al caducar el token — y «un cuidado
//     hecho se apunta» (residencia-1 §11.5) es la invariante de este
//     módulo, el equivalente de «cobrar siempre se puede».
//   · Con la firma en el cuerpo, los registros **salen con la sesión de la
//     siguiente persona que entre en esa puerta**. La del turno de mañana
//     teclea su PIN y, sin saberlo, sube los de la noche. Cada uno con su
//     autor, su capacidad y su `recordedAt` original.
//
// Dicho de otra forma: el token dice QUIÉN ESTÁ DELANTE; el cuerpo dice
// QUIÉN HIZO CADA COSA. Y lo que el servidor no puede comprobar —que la
// persona que firma un registro hecho sin red tecleara de verdad su PIN—
// no lo puede comprobar ningún diseño offline-first. Es la misma
// confianza que el TPV deposita en su sesión de cajero local (v1.10 §1-2)
// y está dicha también en el `-done`.
//
// Lo que el servidor SÍ comprueba de cada firma, y es bastante:
//
//   1. la asignación de rol de cuidado existe, es de esa persona, de este
//      centro, de un rol que REGISTRA y **estaba vigente en el instante
//      del registro** (no «ahora»);
//   2. esa persona ALCANZA a ese residente (D-51: zona o alcance total),
//      por LA función de acceso de la casa;
//   3. el residente está en LA HABITACIÓN DE ESTA TABLET.
//
// ── TTL: el del centro, el mismo que el del cajero ──────────────────
//
// `Tenant.cashierSessionTtlMinutes` (12 h por defecto). No es la ventana
// de inactividad: ésa es de **un minuto** y la aplica la tablet (decisión
// 8), igual que `cashierAutoLogoutMinutes` en el TPV. El token vive más
// porque lo que cierra la pantalla no tiene que invalidar lo que la cola
// necesita para salir.

import jwt from "jsonwebtoken";

import type { FastifyReply, FastifyRequest } from "fastify";

import { loadEnv } from "../env.js";

export interface PuertaSesionPayload {
  /** userId de quien tecleó el PIN. */
  sub: string;
  tid: string;
  /** El dispositivo `ROOM` y su habitación. */
  did: string;
  rid: string;
  /** La asignación de rol de cuidado con la que entró (D-31). */
  caid: string;
  /** Y su código, para que la pantalla pinte «Ana · Auxiliar» sin otra
   *  consulta. */
  crc: string;
  type: "puerta";
}

export function signPuertaSesion(
  payload: Omit<PuertaSesionPayload, "type">,
  ttlMinutes: number,
): string {
  const env = loadEnv();
  // Se firma con `JWT_ACCESS_SECRET` y con `type: "puerta"`, por lo mismo
  // que la del cajero lleva `type: "cashier"`: el secreto es el mismo y lo
  // que impide confundirlas es el tipo. Sin él, un token de puerta serviría
  // de sesión de cajero y al revés — y una puerta no puede cobrar.
  return jwt.sign({ ...payload, type: "puerta" }, env.JWT_ACCESS_SECRET, {
    expiresIn: `${ttlMinutes}m` as jwt.SignOptions["expiresIn"],
  });
}

export function verifyPuertaSesion(token: string): PuertaSesionPayload {
  const env = loadEnv();
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as PuertaSesionPayload;
  if (payload.type !== "puerta") throw new Error("not a puerta session");
  return payload;
}

export interface PuertaSesionContext extends PuertaSesionPayload {
  userId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    puertaSesion?: PuertaSesionContext;
  }
}

/**
 * Exige la sesión de la puerta **además** de la del dispositivo.
 *
 * Se usa SIEMPRE junto a `requirePuertaDevice` y en ese orden: primero qué
 * puerta es (y que su módulo esté encendido), después quién está delante.
 * Al revés, un token de puerta robado serviría desde cualquier aparato.
 *
 * Y comprueba que las dos identidades CUADRAN: el token se emitió para
 * este dispositivo y esta habitación. Sin eso, el PIN tecleado en la 112
 * abriría la 114 — y la 114 puede estar fuera de la zona de esa persona.
 */
export async function requirePuertaSesion(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const puerta = request.puerta;
  if (!puerta) {
    // No puede pasar: `requirePuertaDevice` va antes. Se comprueba igual,
    // por lo mismo que el `roomId == null` de allí — un `!` sobre algo que
    // el orden de los preHandler garantiza es una afirmación que nadie
    // vuelve a revisar.
    reply.code(401).send({
      error: "DEVICE_TOKEN_REQUIRED",
      message: "Falta X-Device-Token",
    });
    return;
  }
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    reply.code(401).send({
      error: "PUERTA_SIN_SESION",
      message: "Teclea tu PIN para registrar.",
    });
    return;
  }
  let payload: PuertaSesionPayload;
  try {
    payload = verifyPuertaSesion(header.slice(7));
  } catch {
    reply.code(401).send({
      error: "PUERTA_SESION_CADUCADA",
      message: "La sesión se ha cerrado. Vuelve a teclear tu PIN.",
    });
    return;
  }
  if (payload.tid !== puerta.tenantId || payload.rid !== puerta.roomId) {
    // 403 y no 401: el token es bueno, lo que no es suya es esta puerta.
    reply.code(403).send({
      error: "PUERTA_SESION_DE_OTRA_HABITACION",
      message: "Esa sesión se abrió en otra habitación. Teclea tu PIN aquí.",
    });
    return;
  }
  request.puertaSesion = { ...payload, userId: payload.sub };
}
