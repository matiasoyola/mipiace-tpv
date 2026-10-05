// clinica-1 · la puerta del módulo de historia clínica.
//
// Mismo patrón que `ensureCajaEnabled` (ADR-016), `ensureFichajeEnabled`
// (ADR-018) y `ensureAgendaEnabled` (ADR-R6): un `preHandler` que corre
// DESPUÉS de la autenticación, lee la capability del tenant y corta si
// está apagada.
//
// Con DOS diferencias, las dos deliberadas:
//
//   1. **Contesta 404, no 403.** Es la única capability de la casa que se
//      esconde en lugar de explicarse. Un 403 "no tienes el módulo de
//      historia clínica" le dice a un bar que ese módulo existe y que
//      alguien guarda datos de salud en este sistema; un 404 no le dice
//      nada. La respuesta es literalmente la de Fastify para una ruta que
//      no existe —mismo cuerpo, mismas claves, mismo texto— porque una
//      404 distinguible no esconde nada.
//
//   2. **La lectura falla hacia APAGADO**, como la del control horario y
//      al revés que la de la caja. Las tres razones de ADR-018 valen aquí
//      y la tercera con más fuerza: la columna es `@default(false)`, así
//      que "no se pudo leer la fila" se parece mucho más a "no lo tiene";
//      fallar hacia encendido abriría datos de salud a un tenant que no
//      los tiene; y no hay nada que un fallo hacia apagado le quite a
//      quien sí los tiene, porque con la base caída tampoco habría
//      historia que leer.
//
// El gate es la puerta del SERVIDOR. El panel esconde además la sección y
// el TPV no pinta el botón, pero esconder no es gatear.

import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";

// Las puertas de auth desde las que se cruza lo clínico, en el orden en
// que se pueblan: el panel de la empresa (`auth`) y el TPV
// (`cashier`). No `device`: una historia clínica no la abre un aparato,
// la abre una persona identificada.
function resolveTenantId(request: FastifyRequest): string | null {
  return request.auth?.tenantId ?? request.cashier?.tid ?? null;
}

/**
 * `true` sólo cuando la fila del tenant dice explícitamente que la
 * historia clínica está encendida. Ver la nota 2 de la cabecera sobre por
 * qué la lectura falla hacia "apagado".
 */
export async function clinicaIsEnabled(tenantId: string): Promise<boolean> {
  const model = getPrisma().tenant as
    | {
        findUnique?: (args: unknown) => Promise<{
          clinicalRecordsEnabled?: boolean;
        } | null>;
        findUniqueOrThrow?: (args: unknown) => Promise<{
          clinicalRecordsEnabled?: boolean;
        }>;
      }
    | undefined;
  const read = model?.findUnique ?? model?.findUniqueOrThrow;
  if (typeof read !== "function") return false;
  try {
    const tenant = await read.call(model, {
      where: { id: tenantId },
      select: { clinicalRecordsEnabled: true },
    });
    return tenant?.clinicalRecordsEnabled === true;
  } catch {
    return false;
  }
}

/**
 * La 404 de Fastify, carácter por carácter. Si este cuerpo se separa del
 * de una ruta inexistente, el módulo deja de estar escondido: basta
 * comparar dos respuestas para saber que existe.
 */
export function respondeComoRutaInexistente(
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  reply.code(404).send({
    message: `Route ${request.method.toUpperCase()}:${request.url} not found`,
    error: "Not Found",
    statusCode: 404,
  });
}

export async function ensureClinicaEnabled(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const tenantId = resolveTenantId(request);
  // Sin tenant no hay nada que gatear: el `preHandler` de auth que va
  // delante ya habrá respondido 401.
  if (tenantId == null) return;
  if (!(await clinicaIsEnabled(tenantId))) {
    respondeComoRutaInexistente(request, reply);
  }
}
