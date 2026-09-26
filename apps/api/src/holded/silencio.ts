// holded-desconectar · UN sitio donde está escrito por qué no se llama a
// Holded. ADR-020, criterio 3 del bloque: «tras el corte no sale ni una
// llamada a Holded para ese tenant».
//
// ── Por qué un módulo y no diecinueve `if` ─────────────────────────────
//
// Al inventariar los caminos que hablan con Holded salieron DIECINUEVE:
// dos syncs, la conciliación de catálogo, la conciliación diaria, cuatro
// entradas de contactos, dos de imágenes, dos de subida, el sweeper, cuatro
// botones del super-admin, la bandeja de errores y la revisión de SKU. Casi
// todos ya se protegían solos con `if (!tenant.holdedApiKeyCiphertext)`, y
// eso es lo que hace que el corte funcione al borrar la clave. Pero:
//
//   1. «Sin clave» y «no usa Holded» significan cosas distintas y merecen
//      mensajes distintos. Un comercio que dejó Holded no tiene que leer
//      "conecta tu cuenta de Holded antes de sincronizar": eso es un
//      pendiente, y aquí no hay nada pendiente.
//   2. Un camino nuevo que se olvide de comprobar la clave vuelve a abrir
//      el agujero. Ya pasó con `catalogo-local`: de los CUATRO caminos que
//      encolan subidas, dos no miraban la clave.
//   3. Sin un predicado compartido, el test por worker del criterio 3
//      tendría que saber cómo comprueba cada uno lo suyo.
//
// ── La diferencia con `caja-gate.ts`, y es grande ─────────────────────
//
// `cajaIsDisabled` es TOLERANTE: si no puede leer la fila, deja pasar,
// porque lo peor que puede hacer ese gate es dejar sin cobrar a quien
// cobra. Aquí es al contrario, igual que en `catalogo-local-gate.ts`:
// ninguno de estos caminos está en el camino de cobro —nadie se queda sin
// vender porque un sync no corra— y fallar hacia «abierto» significaría
// llamar a Holded en nombre de un comercio que lo dejó, o escribirle en su
// ERP. Un error al leer deja el silencio puesto.

import type { FastifyReply, FastifyRequest } from "fastify";

import { Prisma, type PrismaClient } from "@mipiacetpv/db";

import { getPrisma } from "../context.js";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Por qué NO se habla con Holded en nombre de este comercio.
 *
 * Tres valores y no un booleano, por la misma razón que `HoldedDestination`
 * en `tickets/holded-upload-gate.ts`: tres situaciones que HACEN lo mismo
 * (callarse) y no SIGNIFICAN lo mismo, así que no pueden compartir el
 * mensaje ni el nivel de log.
 *
 *   `desconectado`  — lo TUVO y lo dejó (este bloque). Tiene histórico en
 *                     Holded y fichas con `holded_product_id` vivo. Nada
 *                     pendiente: es el estado final y correcto.
 *   `no_lo_usa`     — nunca lo tuvo (catalogo-local, ADR-017). Tampoco hay
 *                     nada pendiente.
 *   `sin_clave`     — está PREVISTO que lo use y no lo ha conectado. Esto
 *                     SÍ es un pendiente y su mensaje tiene que decirlo.
 */
export type MotivoSilencio = "desconectado" | "no_lo_usa" | "sin_clave";

export interface TenantSilencio {
  holdedEnabled?: boolean | null;
  holdedApiKeyCiphertext?: string | null;
  holdedDisconnectedAt?: Date | null;
}

/**
 * `null` cuando SÍ hay que hablar con Holded. Un motivo cuando no.
 *
 * El orden de las comprobaciones es el orden de la información: un comercio
 * desconectado cumple también «interruptor apagado» y «sin clave», y lo que
 * hay que decir de él es lo primero, no lo último.
 *
 * `holdedEnabled !== false` y no `!holdedEnabled`: la columna es
 * `@default(true)` y sólo un `false` explícito la apaga. Un `select` al que
 * se le olvide la columna se comporta como el comercio de siempre en vez de
 * dejar de sincronizar en silencio.
 */
export function motivoSilencio(tenant: TenantSilencio): MotivoSilencio | null {
  if (tenant.holdedDisconnectedAt != null) return "desconectado";
  if (tenant.holdedEnabled === false) return "no_lo_usa";
  if (tenant.holdedApiKeyCiphertext == null) return "sin_clave";
  return null;
}

/** La frase, en el idioma del que la va a leer, para cada motivo. */
export const MENSAJE_SILENCIO: Record<MotivoSilencio, string> = {
  desconectado:
    "Este comercio dejó de usar Holded. Su catálogo se gestiona desde el panel y sus facturas " +
    "las emite mipiacetpv: no queda nada que sincronizar ni subir. Volver a conectarlo es una " +
    "operación aparte.",
  no_lo_usa:
    "Este comercio no usa Holded. Su catálogo se gestiona desde el panel del cliente.",
  sin_clave: "Conecta la cuenta de Holded antes de hacer esto.",
};

/** El código de error HTTP nombrado de cada motivo. Distintos a propósito:
 *  la pantalla tiene que poder enseñar «conéctalo» sólo en el caso en que
 *  hay algo que conectar. */
export const ERROR_SILENCIO: Record<MotivoSilencio, string> = {
  desconectado: "HOLDED_DESCONECTADO",
  no_lo_usa: "HOLDED_NO_HABILITADO",
  sin_clave: "NO_HOLDED_KEY",
};

/**
 * Lee el tenant y contesta. Lanza si no puede leerlo — a diferencia de
 * `cajaIsDisabled`, que se traga el error. Ver la cabecera: fallar hacia
 * «habla con Holded» es el fallo que este módulo existe para impedir.
 */
export async function comprobarSilencio(
  tx: Tx,
  tenantId: string,
): Promise<MotivoSilencio | null> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: {
      holdedEnabled: true,
      holdedApiKeyCiphertext: true,
      holdedDisconnectedAt: true,
    },
  });
  // Tenant inexistente: callado. No hay ningún caso legítimo en el que un
  // runner apunte a un tenant que no existe, y llamar a Holded «por si
  // acaso» no tiene sentido.
  if (!tenant) return "no_lo_usa";
  return motivoSilencio(tenant);
}

/**
 * `preHandler` de Fastify para las rutas que escriben o leen en Holded.
 * 409 y no 403: no es una capability apagada, es que la operación no tiene
 * destino. El 403 dice «no puedes»; el 409 dice «no hay dónde».
 *
 * Resuelve el tenant desde las tres puertas de auth, como
 * `ensureCajaEnabled`: la revisión de SKU es del panel, pero la búsqueda de
 * contactos se cruza desde el TPV.
 */
export async function ensureHoldedVivo(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const tenantId =
    request.auth?.tenantId ??
    request.cashier?.tid ??
    request.device?.tenantId ??
    null;
  if (!tenantId) return;
  let motivo: MotivoSilencio | null;
  try {
    motivo = await comprobarSilencio(getPrisma(), tenantId);
  } catch (err) {
    request.log.error(
      { tenantId },
      `no se pudo comprobar si el comercio usa Holded: ${err instanceof Error ? err.message : String(err)}`,
    );
    reply.code(503).send({
      error: "HOLDED_GATE_UNAVAILABLE",
      message:
        "No hemos podido comprobar si este comercio usa Holded. Inténtalo de nuevo en un momento.",
    });
    return;
  }
  if (motivo != null) {
    reply
      .code(409)
      .send({ error: ERROR_SILENCIO[motivo], message: MENSAJE_SILENCIO[motivo] });
  }
}
