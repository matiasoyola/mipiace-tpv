// B-reservas-8 · la puerta del módulo de BONOS.
//
// Copia del patrón de `clinica/gate.ts` y `residencia/gate.ts`, con las dos
// decisiones heredadas enteras:
//
//   1. **Contesta 404, no 403.** Un bar o una librería no tienen por qué
//      enterarse de que este módulo existe. Se reutiliza
//      `respondeComoRutaInexistente` en vez de escribir un segundo cuerpo
//      igual, que es la forma de que las dos respuestas se separen.
//   2. **La lectura falla hacia APAGADO.** La columna es `@default(false)`,
//      así que «no se pudo leer la fila» se parece mucho más a «no lo
//      tiene»; y fallar hacia encendido enseñaría saldos de una clienta a
//      una cuenta que no ha contratado el módulo.
//
// ── Independiente de `agendaEnabled`, a propósito ──────────────────────
//
// Un bono se VENDE y se CANJEA en caja sin agenda (la peluquería de Sole no
// usa rejilla). Lo que la agenda añade es el APARTADO al dar la cita, y eso
// ya está detrás de `ensureAgendaEnabled` donde vive. Las dos capabilities
// se cruzan, no se implican.

import type { FastifyReply, FastifyRequest } from "fastify";

import { respondeComoRutaInexistente } from "../clinica/gate.js";
import { getPrisma } from "../context.js";

/** Las puertas de auth desde las que se cruzan los bonos: el panel de la
 *  empresa (`auth`) y el TPV (`cashier`). */
function resolveTenantId(request: FastifyRequest): string | null {
  return request.auth?.tenantId ?? request.cashier?.tid ?? null;
}

/**
 * `true` sólo cuando la fila del tenant dice explícitamente que los bonos
 * están encendidos.
 *
 * Defensiva con la FORMA del cliente Prisma (igual que `clinicaIsEnabled`)
 * porque la suite tiene dobles que no exponen el modelo entero: un doble
 * sin `tenant.findUnique` deja el módulo apagado, que es el lado seguro.
 */
export async function bonosIsEnabled(tenantId: string): Promise<boolean> {
  const model = getPrisma().tenant as
    | {
        findUnique?: (args: unknown) => Promise<{ bonosEnabled?: boolean } | null>;
        findUniqueOrThrow?: (args: unknown) => Promise<{ bonosEnabled?: boolean }>;
      }
    | undefined;
  const read = model?.findUnique ?? model?.findUniqueOrThrow;
  if (typeof read !== "function") return false;
  try {
    const tenant = await read.call(model, {
      where: { id: tenantId },
      select: { bonosEnabled: true },
    });
    return tenant?.bonosEnabled === true;
  } catch {
    return false;
  }
}

export async function ensureBonosEnabled(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const tenantId = resolveTenantId(request);
  // Sin tenant no hay nada que gatear: el `preHandler` de auth que va
  // delante ya habrá respondido 401.
  if (tenantId == null) return;
  if (!(await bonosIsEnabled(tenantId))) {
    respondeComoRutaInexistente(request, reply);
  }
}
