// F1 · la puerta del control horario (ADR-018).
//
// Mismo patrón que `ensureCajaEnabled` (ADR-016) y que `ensureAgendaEnabled`
// (ADR-R6): un `preHandler` que corre DESPUÉS de la autenticación, lee la
// capability del tenant y devuelve 403 con un error nombrado si está apagada.
//
//   app.get("/admin/fichaje/today", {
//     preHandler: [requireOwnerOrManager, ensureFichajeEnabled],
//   }, handler)
//
// Dos diferencias con el gate de la caja, las dos deliberadas:
//
//   1. Resuelve el tenant desde DOS puertas: `request.auth` (el panel de la
//      empresa) y `request.employee` (el móvil del empleado). Ni cajero ni
//      device del TPV: el control horario no se cruza desde la caja, y ésa
//      es justamente la razón de que exista este bloque.
//
//   2. **La lectura falla hacia APAGADO**, al revés que la de la caja.
//
//      `cajaIsDisabled` falla hacia "encendida" porque fallar hacia
//      "apagada" dejaría sin cobrar a un cliente que cobra, y eso es lo peor
//      que aquel bloque podía romper (ADR-016 §6).
//
//      Aquí el cálculo es el contrario, por tres razones que apuntan al
//      mismo sitio:
//
//        · La columna es `@default(false)`. Hoy NADIE tiene el módulo, así
//          que "no se pudo leer la fila" se parece mucho más a "no lo tiene"
//          que a "lo tiene".
//        · Fallar hacia encendido abriría el módulo a un tenant que no lo ha
//          contratado. Fallar hacia apagado no le quita nada a nadie que lo
//          tenga: una lectura que revienta es la BD caída, y con la BD caída
//          el POST del fichaje tampoco se iba a escribir.
//        · El toque del empleado no depende de esta puerta para no perderse.
//          Vive en la cola local del móvil desde el instante en que se pulsa
//          (`apps/admin/src/fichar/lib/outbox.ts`) y se reenvía solo. Ahí es
//          donde este producto protege el fichaje, no aquí.
//
// El gate es la puerta del SERVIDOR. El panel además esconde la sección y
// envuelve sus pantallas en `<FichajeGate>`, pero esconder no es gatear: la
// URL sigue existiendo y alguien la tiene en un marcador.
//
// Y lo que NO lleva, a propósito: `ensureCajaEnabled`. Ninguna ruta de este
// bloque pasa por la puerta de la caja. El cliente 0 es un colegio con
// `caja_enabled = false`; ponerle la puerta de la caja al fichaje lo dejaría
// fuera de lo único que ha comprado.

import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
// Import de efecto: trae la augmentación de `FastifyRequest.employee`.
import "../fichaje/context.js";

export const FICHAJE_DISABLED_MESSAGE =
  "Esta empresa no tiene el módulo de control horario activado. Si crees que debería tenerlo, avisa a Mi Piace.";

// Las dos puertas de auth desde las que se cruza el control horario, en el
// orden en que se pueblan. Devuelve null cuando ninguna ha corrido todavía:
// en ese caso no hay nada que gatear y el `preHandler` de auth que va
// delante ya habrá respondido 401.
function resolveTenantId(request: FastifyRequest): string | null {
  return request.auth?.tenantId ?? request.employee?.tenantId ?? null;
}

/**
 * `true` sólo cuando la fila del tenant dice explícitamente que el control
 * horario está encendido. Ver la nota 2 de la cabecera sobre por qué la
 * lectura falla hacia "apagado".
 */
export async function fichajeIsEnabled(tenantId: string): Promise<boolean> {
  const model = getPrisma().tenant as
    | {
        findUnique?: (args: unknown) => Promise<{ fichajeEnabled?: boolean } | null>;
        findUniqueOrThrow?: (args: unknown) => Promise<{ fichajeEnabled?: boolean }>;
      }
    | undefined;
  const read = model?.findUnique ?? model?.findUniqueOrThrow;
  if (typeof read !== "function") return false;
  try {
    const tenant = await read.call(model, {
      where: { id: tenantId },
      select: { fichajeEnabled: true },
    });
    return tenant?.fichajeEnabled === true;
  } catch {
    return false;
  }
}

export async function ensureFichajeEnabled(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const tenantId = resolveTenantId(request);
  // Sin tenant no hay nada que gatear: el preHandler de auth que va delante
  // ya respondió 401. Devolver aquí un 403 taparía ese 401 con un mensaje
  // que no explica nada.
  if (!tenantId) return;
  if (!(await fichajeIsEnabled(tenantId))) {
    reply.code(403).send({
      error: "FICHAJE_DISABLED",
      message: FICHAJE_DISABLED_MESSAGE,
    });
  }
}
