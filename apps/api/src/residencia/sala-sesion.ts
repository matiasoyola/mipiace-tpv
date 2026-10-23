// residencia-5 (D-67) · **LA SESIÓN DE LA TABLET DE LA SALA.**
//
// Copia estructural de `puerta-sesion.ts`, con dos diferencias de fondo
// que conviene leer antes que el código.
//
// ── LO QUE ESTA SESIÓN PRUEBA, Y AQUÍ SÍ ES LA FIRMA ────────────────
//
// La de la puerta prueba «alguien con un PIN bueno está delante de esta
// tablet», y la firma de cada registro viaja aparte porque un lote puede
// salir horas después con otra persona delante.
//
// Aquí **la sesión ES la firma**, como en el móvil de guardia y por lo
// mismo: «Leído y recibido» lo pulsa quien está mirando la pantalla, en
// la reunión de cambio de turno, y no lo puede firmar nadie que no esté
// delante. El cuerpo de la confirmación no lleva ninguna firma.
//
// La consecuencia práctica, y es la que importa: **sin red la
// confirmación se encola con la sesión dentro**, y sale cuando vuelve la
// red con su `at` original. Eso funciona porque el TTL es de turno
// —doce horas— y no de dos minutos: lo que caduca a los dos minutos es la
// PANTALLA, no el token.
//
// ── DOS MINUTOS DE PANTALLA, Y NO UNO ──────────────────────────────
//
// La puerta se cierra sola **al minuto** (residencia-3, decisión 8): es
// una tablet de pasillo con la historia de dos personas abierta y por
// delante pasa cualquiera.
//
// La sala son **dos minutos**, y la diferencia es de uso: el parte se LEE,
// y leer el parte de una planta con nueve líneas delante del turno lleva
// más de un minuto. Una pantalla que se apaga a mitad de la lectura
// obliga a teclear el PIN otra vez con seis personas esperando, y eso es
// cómo se consigue que alguien deje el PIN apuntado en la pared.
//
// Dos minutos **sin tocar**: cualquier toque lo reinicia, igual que en la
// puerta. Y «Terminar» la cierra al momento, que es lo que se pulsa
// cuando acaba la reunión.
//
// El TTL del token sigue siendo `Tenant.cashierSessionTtlMinutes` (12 h),
// por lo mismo que en la puerta: lo que cierra la pantalla no tiene que
// invalidar lo que la cola necesita para salir.

import jwt from "jsonwebtoken";

import type { FastifyReply, FastifyRequest } from "fastify";

import { loadEnv } from "../env.js";

/**
 * **Los dos minutos**, en un sitio. La tablet los aplica (es ella la que
 * sabe cuándo se tocó por última vez) y el número vive aquí para que la
 * pantalla y el done digan el mismo.
 */
export const MINUTOS_SIN_TOCAR_EN_LA_SALA = 2;

export interface SalaSesionPayload {
  /** userId de quien tecleó el PIN. */
  sub: string;
  tid: string;
  /** La tablet de sala. */
  did: string;
  /** La asignación de rol de cuidado con la que entró (D-31). */
  caid: string;
  /** Su código, para pintar «Ana · Auxiliar» sin otra consulta. */
  crc: string;
  /** `true` si ese rol ve todo el centro (D-51). Es lo que decide qué
   *  parte se le enseña y qué zonas cubre su confirmación. */
  tot: boolean;
  type: "relevo";
}

export function signSalaSesion(
  payload: Omit<SalaSesionPayload, "type">,
  ttlMinutes: number,
): string {
  const env = loadEnv();
  // `type: "relevo"` por lo mismo que `"puerta"`, `"guardia"` y
  // `"cashier"`: el secreto es el mismo y lo que impide confundirlas es el
  // tipo. Sin él, un token de sala serviría de sesión de puerta y al
  // revés — y en la sala no se registran cuidados de ninguna habitación.
  return jwt.sign({ ...payload, type: "relevo" }, env.JWT_ACCESS_SECRET, {
    expiresIn: `${ttlMinutes}m` as jwt.SignOptions["expiresIn"],
  });
}

export function verifySalaSesion(token: string): SalaSesionPayload {
  const env = loadEnv();
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as SalaSesionPayload;
  if (payload.type !== "relevo") throw new Error("not a relevo session");
  return payload;
}

export interface SalaSesionContext extends SalaSesionPayload {
  userId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    salaSesion?: SalaSesionContext;
  }
}

/**
 * Exige la sesión de la sala **además** de la del dispositivo, y en ese
 * orden: primero qué tablet es, después quién la está usando. Al revés,
 * un token robado serviría desde cualquier aparato.
 */
export async function requireSalaSesion(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const sala = request.sala;
  if (!sala) {
    reply.code(401).send({
      error: "DEVICE_TOKEN_REQUIRED",
      message: "Falta X-Device-Token",
    });
    return;
  }
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    reply.code(401).send({
      error: "SALA_SIN_SESION",
      message: "Teclea tu PIN para leer el parte.",
    });
    return;
  }
  let payload: SalaSesionPayload;
  try {
    payload = verifySalaSesion(header.slice(7));
  } catch {
    reply.code(401).send({
      error: "SALA_SESION_CADUCADA",
      message: "La sesión se ha cerrado. Vuelve a teclear tu PIN.",
    });
    return;
  }
  if (payload.tid !== sala.tenantId || payload.did !== sala.deviceId) {
    // 403 y no 401: el token es bueno, lo que no es suya es esta tablet.
    reply.code(403).send({
      error: "SALA_SESION_DE_OTRA_TABLET",
      message: "Esa sesión se abrió en otra tablet. Teclea tu PIN aquí.",
    });
    return;
  }
  request.salaSesion = { ...payload, userId: payload.sub };
}
