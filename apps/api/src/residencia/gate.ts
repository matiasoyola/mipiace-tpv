// residencia-1 · la puerta del módulo de residencia.
//
// Copia del patrón de `clinica/gate.ts`, no de `caja-gate.ts`, y las dos
// decisiones que lo distinguen se heredan enteras:
//
//   1. **Contesta 404, no 403.** Un 403 «no tienes el módulo de residencia»
//      le dice a un bar que ese módulo existe y que alguien guarda en este
//      sistema quién vive en qué habitación y qué le pasa. La respuesta es
//      literalmente la de Fastify para una ruta que no existe —por eso
//      reutiliza `respondeComoRutaInexistente` de la clínica en vez de
//      escribir una segunda copia de ese cuerpo, que es la forma de que
//      las dos se separen.
//   2. **La lectura falla hacia APAGADO.** La columna es `@default(false)`,
//      así que «no se pudo leer la fila» se parece mucho más a «no lo
//      tiene»; y fallar hacia encendido abriría datos de una residencia a
//      quien no la ha contratado.
//
// ── Y una pregunta que esta puerta NO contesta ───────────────────────
//
// «¿Puede este usuario ver a ESTE residente?» Eso es la función de acceso
// (`clinica/acceso.ts`, ampliada por este bloque), y va aparte por lo
// mismo que en la clínica: el gate es del TENANT, la función es de la
// PERSONA y del RESIDENTE. Una ruta de residencia que lea datos de un
// residente lleva las dos.

import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import { respondeComoRutaInexistente } from "../clinica/gate.js";

// Las puertas de auth desde las que se cruza la residencia: el panel de la
// empresa (`auth`) y el TPV (`cashier`). No `device`: la puerta de una
// habitación tiene su propia puerta de auth (`puerta-auth.ts`), que
// comprueba el módulo por su cuenta y con otro cuerpo —a una tablet ya
// emparejada no se le esconde el módulo que estaba usando.
function resolveTenantId(request: FastifyRequest): string | null {
  return request.auth?.tenantId ?? request.cashier?.tid ?? null;
}

/**
 * `true` sólo cuando la fila del tenant dice explícitamente que la
 * residencia está encendida.
 *
 * La lectura es defensiva con la FORMA del cliente Prisma (igual que
 * `clinicaIsEnabled`) porque la suite tiene dobles que no exponen el
 * modelo entero: un doble sin `tenant.findUnique` deja el módulo apagado,
 * que es el lado seguro.
 */
export async function residenciaIsEnabled(tenantId: string): Promise<boolean> {
  const model = getPrisma().tenant as
    | {
        findUnique?: (args: unknown) => Promise<{
          residenciaEnabled?: boolean;
        } | null>;
        findUniqueOrThrow?: (args: unknown) => Promise<{
          residenciaEnabled?: boolean;
        }>;
      }
    | undefined;
  const read = model?.findUnique ?? model?.findUniqueOrThrow;
  if (typeof read !== "function") return false;
  try {
    const tenant = await read.call(model, {
      where: { id: tenantId },
      select: { residenciaEnabled: true },
    });
    return tenant?.residenciaEnabled === true;
  } catch {
    return false;
  }
}

export async function ensureResidenciaEnabled(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const tenantId = resolveTenantId(request);
  // Sin tenant no hay nada que gatear: el `preHandler` de auth que va
  // delante ya habrá respondido 401.
  if (tenantId == null) return;
  if (!(await residenciaIsEnabled(tenantId))) {
    respondeComoRutaInexistente(request, reply);
  }
}
