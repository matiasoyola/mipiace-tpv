// H1 · la puerta de la caja (ADR-016).
//
// Mismo patrón que `ensureAgendaEnabled` (ADR-R6): un `preHandler` que
// corre DESPUÉS de la autenticación, lee la capability del tenant y
// devuelve 403 con un error nombrado si está apagada.
//
//   app.post("/shift/open", {
//     preHandler: [requireCashierSession, ensureCajaEnabled],
//   }, handler)
//
// Diferencias con el gate de la agenda, las dos deliberadas:
//
//   1. Resuelve el tenant desde las TRES puertas de auth que existen
//      (`request.auth` del panel, `request.cashier` y `request.device`
//      del TPV), porque la caja se cruza desde las tres. La agenda sólo
//      se cruza desde `auth`.
//
//   2. Compara con `=== false`, no con `!`. `caja_enabled` es
//      `@default(true)`: sólo un `false` explícito apaga la caja. Si la
//      fila no se puede leer —no existe, o el cliente Prisma en uso no
//      expone el modelo `tenant`— la caja queda ENCENDIDA.
//
//      Esa dirección del fallo es la correcta: esto es una *capability*,
//      no la frontera de aislamiento. El aislamiento por tenant lo hacen
//      `requireCashierSession`, `requireDeviceToken` y `requireOwner`, y
//      ninguno depende de esta función. Fallar hacia "apagado" dejaría
//      sin cobrar a un cliente que cobra, que es lo peor que este bloque
//      puede romper; fallar hacia "encendido" deja exactamente el
//      comportamiento de master.
//
// El gate es la puerta del SERVIDOR. El TPV y el panel además esconden
// lo que no aplica, pero esconder no es gatear: el flag que cachea el
// TPV es UI, y un catálogo cacheado no abre esta puerta.

import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";

export const CAJA_DISABLED_MESSAGE =
  "Esta empresa no tiene el módulo de caja activado. Si crees que debería tenerlo, avisa a Mi Piace.";

// Las tres puertas de auth, en el orden en que se pueblan. Devuelve null
// cuando ninguna ha corrido todavía: en ese caso no hay nada que gatear
// y el `preHandler` de auth que va delante ya habrá respondido 401.
function resolveTenantId(request: FastifyRequest): string | null {
  return (
    request.auth?.tenantId ??
    request.cashier?.tid ??
    request.device?.tenantId ??
    null
  );
}

/**
 * `true` sólo cuando la fila del tenant dice explícitamente que la caja
 * está apagada. Ver la nota 2 de la cabecera sobre por qué el default es
 * "encendida".
 *
 * La lectura es tolerante a propósito, y es la otra cara de la nota 2:
 * **esta función no puede ser nunca la razón por la que un request
 * revienta**. Si el modelo `tenant` no está disponible, o la lectura
 * lanza, la caja queda encendida y el handler sigue su camino — el
 * mismo comportamiento que master. Un gate de capability que tumba una
 * venta con un 500 es peor que un gate que no llega a cerrarse.
 */
export async function cajaIsDisabled(tenantId: string): Promise<boolean> {
  const model = getPrisma().tenant as
    | {
        findUnique?: (args: unknown) => Promise<{ cajaEnabled?: boolean } | null>;
        findUniqueOrThrow?: (args: unknown) => Promise<{ cajaEnabled?: boolean }>;
      }
    | undefined;
  const read = model?.findUnique ?? model?.findUniqueOrThrow;
  if (typeof read !== "function") return false;
  try {
    const tenant = await read.call(model, {
      where: { id: tenantId },
      select: { cajaEnabled: true },
    });
    return tenant?.cajaEnabled === false;
  } catch {
    return false;
  }
}

export async function ensureCajaEnabled(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const tenantId = resolveTenantId(request);
  if (!tenantId) return;
  if (await cajaIsDisabled(tenantId)) {
    reply.code(403).send({
      error: "CAJA_DISABLED",
      message: CAJA_DISABLED_MESSAGE,
    });
  }
}
