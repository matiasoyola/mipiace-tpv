// residencia-4 (D-66) · **LA SESIÓN DEL MÓVIL DE GUARDIA.**
//
// Copia estructural de `puerta-sesion.ts`, con una diferencia de fondo
// que conviene leer antes que el código.
//
// ── LO QUE ESTA SESIÓN PRUEBA, Y QUÉ ES DISTINTO DE LA PUERTA ───────
//
// La de la puerta prueba «alguien con un PIN bueno está delante de esta
// tablet», y la firma de cada registro viaja aparte porque un lote puede
// salir horas después, con otra persona delante.
//
// Aquí no: **el acuse es inmediato y es de quien tiene el móvil en la
// mano**. «Voy» no se encola, no sale sin red y no lo firma nadie que no
// esté mirando la pantalla. Así que aquí la sesión SÍ es la firma, y el
// cuerpo del acuse no lleva ninguna.
//
// Y hay una segunda cosa que esta sesión significa y la de la puerta no:
// **estar de guardia**. Quien teclea el PIN en el móvil al empezar el
// turno no «entra en una pantalla»: se hace cargo del teléfono, y eso
// abre una `GuardShiftSession` que es lo que le dice al sistema si hay
// enfermera de guardia en este turno. Por eso el TTL no es el del cajero.
//
// ── EL TTL ES EL DEL TURNO, Y DURA DOCE HORAS ───────────────────────
//
// `Tenant.cashierSessionTtlMinutes` (12 h por defecto), igual que la
// puerta. No es casualidad que cuadre: un turno de noche son diez horas y
// el móvil tiene que seguir siendo suyo a las seis de la mañana, con la
// pantalla apagada y la app en segundo plano. Una sesión que caduca a
// mitad de la noche es un móvil que deja de sonar.
//
// Lo que **no** hay aquí es ventana de inactividad. La de la puerta cierra
// la pantalla al minuto porque es una tablet de pasillo con la historia
// de dos personas abierta; un móvil de guardia está en un bolsillo y
// cerrarlo solo significaría que el aviso de las cuatro de la mañana
// llega a una pantalla de PIN.

import jwt from "jsonwebtoken";

import type { FastifyReply, FastifyRequest } from "fastify";

import type { GuardChannel } from "@mipiacetpv/db";

import { loadEnv } from "../env.js";

export interface GuardiaSesionPayload {
  /** userId de quien cogió el móvil. */
  sub: string;
  tid: string;
  /** El dispositivo `GUARD` y su canal. */
  did: string;
  can: GuardChannel;
  /** La asignación de rol de cuidado con la que entró (D-31). */
  caid: string;
  crc: string;
  /** La guardia que abrió al teclear el PIN. */
  gsid: string;
  type: "guardia";
}

export function signGuardiaSesion(
  payload: Omit<GuardiaSesionPayload, "type">,
  ttlMinutes: number,
): string {
  const env = loadEnv();
  // `type: "guardia"` por lo mismo que `"puerta"` y `"cashier"`: el
  // secreto es el mismo y lo que impide confundirlas es el tipo. Sin él,
  // un token de guardia serviría de sesión de puerta y al revés — y un
  // móvil de guardia no registra cuidados en ninguna habitación.
  return jwt.sign({ ...payload, type: "guardia" }, env.JWT_ACCESS_SECRET, {
    expiresIn: `${ttlMinutes}m` as jwt.SignOptions["expiresIn"],
  });
}

export function verifyGuardiaSesion(token: string): GuardiaSesionPayload {
  const env = loadEnv();
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as GuardiaSesionPayload;
  if (payload.type !== "guardia") throw new Error("not a guardia session");
  return payload;
}

export interface GuardiaSesionContext extends GuardiaSesionPayload {
  userId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    guardiaSesion?: GuardiaSesionContext;
  }
}

/**
 * Exige la sesión de guardia **además** de la del dispositivo, y en ese
 * orden: primero qué móvil es, después quién lo lleva. Al revés, un token
 * robado serviría desde cualquier aparato.
 */
export async function requireGuardiaSesion(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const g = request.guardia;
  if (!g) {
    reply.code(401).send({
      error: "DEVICE_TOKEN_REQUIRED",
      message: "Falta X-Device-Token",
    });
    return;
  }
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    reply.code(401).send({
      error: "GUARDIA_SIN_SESION",
      message: "Teclea tu PIN para ponerte de guardia.",
    });
    return;
  }
  let payload: GuardiaSesionPayload;
  try {
    payload = verifyGuardiaSesion(header.slice(7));
  } catch {
    reply.code(401).send({
      error: "GUARDIA_SESION_CADUCADA",
      message: "La guardia se ha cerrado. Vuelve a teclear tu PIN.",
    });
    return;
  }
  if (payload.tid !== g.tenantId || payload.did !== g.deviceId) {
    // 403 y no 401: el token es bueno, lo que no es suyo es este móvil.
    reply.code(403).send({
      error: "GUARDIA_SESION_DE_OTRO_MOVIL",
      message: "Esa guardia se abrió en otro móvil. Teclea tu PIN aquí.",
    });
    return;
  }
  request.guardiaSesion = { ...payload, userId: payload.sub };
}
