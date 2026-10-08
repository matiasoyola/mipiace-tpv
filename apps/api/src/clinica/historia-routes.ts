// clinica-6 · las rutas de la historia viva.
//
//   GET /clinica/clients/:clientId/historia              — la pantalla
//   GET /clinica/clients/:clientId/historia/visitas/:id  — una visita
//
// Las DOS pasan por `conHistoria` (`registro.ts`), así que **cada apertura
// de la historia deja su línea en el registro de accesos** antes de hacer
// nada (decisión 9 del prompt: que la pantalla nueva no sea una puerta sin
// registro). Y las dos llevan `ensureClinicaEnabled`, que con el módulo
// apagado contesta la 404 de Fastify carácter por carácter.
//
// Las dos exigen `SANITARIO` —el permiso por defecto de `conHistoria`—
// porque aquí se leen lesiones, dolor y alertas. Ni la recepcionista ni
// una dueña no sanitaria entran, y el intento les queda escrito. Es la
// misma puerta que la sesión de clinica-3, y se hereda entera: este bloque
// no inventa una segunda forma de decidir quién ve una historia.
//
// ── Por qué cuelgan del PACIENTE y no de la cita ─────────────────────
//
// Al revés que la sesión, y por el motivo contrario: la historia no es de
// un día. Se abre desde la ficha del cliente y desde la cita, y en los dos
// casos lo que se mira es la persona. El `entryId` de una visita se
// comprueba CONTRA ese paciente (`detalleDeVisita`), así que quien llama
// no puede elegir contra qué historia se comprueba el acceso — la misma
// lección que las anotaciones de clinica-1.
//
// ── Nada de salud en los logs ────────────────────────────────────────
//
// Ni las marcas, ni el dolor, ni las alertas. Ni aquí ni en ningún `catch`
// de este fichero.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { requireOwnerOrCashier } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { ensureClinicaEnabled } from "./gate.js";
import { detalleDeVisita, vistaDeLaHistoria } from "./historia.js";
import { conHistoria } from "./registro.js";

const guard = { preHandler: [requireOwnerOrCashier, ensureClinicaEnabled] };

const PARAMS_PACIENTE = {
  type: "object",
  required: ["clientId"],
  additionalProperties: false,
  properties: { clientId: { type: "string", format: "uuid" } },
} as const;

const PARAMS_VISITA = {
  type: "object",
  required: ["clientId", "entryId"],
  additionalProperties: false,
  properties: {
    clientId: { type: "string", format: "uuid" },
    entryId: { type: "string", format: "uuid" },
  },
} as const;

function pacienteNoExiste(reply: FastifyReply) {
  return reply.code(404).send({
    error: "CLIENT_NOT_FOUND",
    code: "CLIENT_NOT_FOUND",
    message: "Paciente no encontrado.",
  });
}

/**
 * ¿Existe este paciente en este tenant?
 *
 * Es la puerta de AISLAMIENTO, y va ANTES de la de autorización clínica
 * (`conHistoria`): un id de otro tenant tiene que ser 404 antes de que
 * nadie pregunte si este sanitario podría verlo. Misma forma y mismo orden
 * que `routes.ts` de clinica-1.
 */
async function existePaciente(
  tenantId: string,
  clientId: string,
): Promise<boolean> {
  const fila = await getPrisma().client.findFirst({
    where: { id: clientId, tenantId },
    select: { id: true },
  });
  return fila != null;
}

export async function registerHistoriaRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── La historia viva ────────────────────────────────────────────────
  app.get(
    "/clinica/clients/:clientId/historia",
    { ...guard, schema: { params: PARAMS_PACIENTE } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      if (!(await existePaciente(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      return conHistoria(
        request,
        reply,
        { clientId, action: "READ" },
        async (ctx) =>
          vistaDeLaHistoria(getPrisma(), {
            tenantId: ctx.tenantId,
            clientId,
            // El reloj entra UNA VEZ y por aquí. Las funciones puras no lo
            // tienen, y la pantalla recibe el instante con el que se contó
            // «hace cuatro semanas»: la tablet puede tener la hora mal.
            ahora: new Date(),
          }),
      );
    },
  );

  // ── Una visita, de solo lectura ─────────────────────────────────────
  //
  // Sin importes y sin bloque de caja: es historia, no cobro (decisión 8).
  // El cuerpo entero SÍ sale —es la historia, y el sanitario es quien la
  // escribió—, y lo que el cuerpo no lleva es ni un precio, garantizado en
  // origen desde clinica-3 (`normalizarSesion` guarda el nombre del
  // tratamiento y nunca su precio).
  app.get(
    "/clinica/clients/:clientId/historia/visitas/:entryId",
    { ...guard, schema: { params: PARAMS_VISITA } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId, entryId } = request.params as {
        clientId: string;
        entryId: string;
      };
      if (!(await existePaciente(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      return conHistoria(
        request,
        reply,
        { clientId, action: "READ" },
        async (ctx) => {
          const visita = await detalleDeVisita(getPrisma(), {
            tenantId: ctx.tenantId,
            clientId,
            entryId,
          });
          if (!visita) {
            return reply.code(404).send({
              error: "ENTRY_NOT_FOUND",
              code: "ENTRY_NOT_FOUND",
              message: "Esa visita no está en la historia de este paciente.",
            });
          }
          return visita;
        },
      );
    },
  );
}
