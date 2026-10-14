// residencia-1 (D-54) · LOS TURNOS DEL CENTRO.
//
// Lista, alta, edición y baja. La semilla pone los tres de serie al
// encender el interruptor (`semilla.ts`), así que esta pantalla nunca
// arranca vacía — un centro sin turnos deja todos los registros de
// residencia-3 sin turno, y el turno es la unidad del relevo.
//
// La función que contesta «¿en qué turno cae este instante?» vive aparte y
// es pura (`turnos.ts`). Aquí sólo se guarda el dato.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import {
  requireOwnerOrCashier,
  requireOwnerOrManager,
} from "../auth/middleware.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { ensureResidenciaEnabled } from "./gate.js";
import { turnoDe } from "./turnos.js";

const PUERTAS_LECTURA = [
  requireOwnerOrCashier,
  ensureClinicaEnabled,
  ensureResidenciaEnabled,
];
const PUERTAS_ESCRITURA = [
  requireOwnerOrManager,
  ensureClinicaEnabled,
  ensureResidenciaEnabled,
];

const TURNO_SELECT = {
  id: true,
  code: true,
  name: true,
  startsAt: true,
  endsAt: true,
  sortOrder: true,
} as const;

const HORA = "^([01][0-9]|2[0-3]):[0-5][0-9]$";

export async function registerResidenciaTurnosRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/residencia/turnos",
    { preHandler: PUERTAS_LECTURA },
    async (request: FastifyRequest) => {
      const tenantId = request.auth?.tenantId ?? request.cashier!.tid;
      const prisma = getPrisma();
      const turnos = await prisma.centerShift.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }, { startsAt: "asc" }],
        select: TURNO_SELECT,
      });
      const ahora = new Date();
      return {
        turnos,
        // El turno de AHORA, calculado por la misma función que usará la
        // puerta. Que la pantalla lo pinte («ahora: tarde») es la forma más
        // barata de que la dirección vea si sus horas están bien puestas:
        // un hueco en el cuadrante se nota porque aquí sale `null`.
        ahora: turnoDe(ahora, turnos)?.code ?? null,
      };
    },
  );

  app.post(
    "/residencia/turnos",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        body: {
          type: "object",
          required: ["code", "name", "startsAt", "endsAt"],
          additionalProperties: false,
          properties: {
            code: { type: "string", minLength: 1, maxLength: 8 },
            name: { type: "string", minLength: 1, maxLength: 40 },
            startsAt: { type: "string", pattern: HORA },
            endsAt: { type: "string", pattern: HORA },
            sortOrder: { type: "integer", minimum: 0, maximum: 999 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        code: string;
        name: string;
        startsAt: string;
        endsAt: string;
        sortOrder?: number;
      };
      const prisma = getPrisma();
      const code = body.code.trim().toUpperCase();

      if (body.startsAt === body.endsAt) {
        return reply.code(400).send({
          error: "TURNO_DE_CERO_HORAS",
          message:
            "La hora de inicio y la de fin no pueden ser la misma: no se sabría si el turno dura cero horas o veinticuatro.",
        });
      }
      const repetido = await prisma.centerShift.findFirst({
        where: { tenantId: auth.tenantId, code },
        select: { id: true },
      });
      if (repetido) {
        return reply.code(409).send({
          error: "TURNO_REPETIDO",
          message: `Ya hay un turno con el código «${code}».`,
        });
      }
      const turno = await prisma.centerShift.create({
        data: {
          tenantId: auth.tenantId,
          code,
          name: body.name.trim(),
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          sortOrder: body.sortOrder ?? 50,
        },
        select: TURNO_SELECT,
      });
      return reply.code(201).send({ turno });
    },
  );

  app.patch(
    "/residencia/turnos/:shiftId",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["shiftId"],
          additionalProperties: false,
          properties: { shiftId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 40 },
            startsAt: { type: "string", pattern: HORA },
            endsAt: { type: "string", pattern: HORA },
            sortOrder: { type: "integer", minimum: 0, maximum: 999 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { shiftId } = request.params as { shiftId: string };
      const body = request.body as {
        name?: string;
        startsAt?: string;
        endsAt?: string;
        sortOrder?: number;
      };
      const prisma = getPrisma();

      const turno = await prisma.centerShift.findFirst({
        where: { id: shiftId, tenantId: auth.tenantId },
        select: TURNO_SELECT,
      });
      if (!turno) {
        return reply.code(404).send({
          error: "TURNO_NO_ENCONTRADO",
          message: "Ese turno no es de este centro.",
        });
      }
      const inicio = body.startsAt ?? turno.startsAt;
      const fin = body.endsAt ?? turno.endsAt;
      if (inicio === fin) {
        return reply.code(400).send({
          error: "TURNO_DE_CERO_HORAS",
          message:
            "La hora de inicio y la de fin no pueden ser la misma: no se sabría si el turno dura cero horas o veinticuatro.",
        });
      }
      const actualizado = await prisma.centerShift.update({
        where: { id: shiftId },
        data: {
          ...(body.name ? { name: body.name.trim() } : {}),
          ...(body.startsAt ? { startsAt: body.startsAt } : {}),
          ...(body.endsAt ? { endsAt: body.endsAt } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        },
        select: TURNO_SELECT,
      });
      return { turno: actualizado };
    },
  );

  // Borrar un turno SÍ se puede —a diferencia de un rol de serie— porque
  // en este bloque nada apunta todavía a un turno: lo que se adscribe al
  // turno es el `CareRecord` de residencia-3, y ese bloque le pondrá su
  // propia FK `Restrict`. Lo que no se puede es quedarse sin ninguno.
  app.delete(
    "/residencia/turnos/:shiftId",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["shiftId"],
          additionalProperties: false,
          properties: { shiftId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { shiftId } = request.params as { shiftId: string };
      const prisma = getPrisma();

      const turno = await prisma.centerShift.findFirst({
        where: { id: shiftId, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!turno) {
        return reply.code(404).send({
          error: "TURNO_NO_ENCONTRADO",
          message: "Ese turno no es de este centro.",
        });
      }
      const cuantos = await prisma.centerShift.count({
        where: { tenantId: auth.tenantId },
      });
      if (cuantos <= 1) {
        return reply.code(409).send({
          error: "ULTIMO_TURNO",
          message:
            "Un centro no puede quedarse sin turnos: todo lo que se registre se adscribe a uno. Edita este en vez de borrarlo.",
        });
      }
      await prisma.centerShift.delete({ where: { id: shiftId } });
      return { borrado: true };
    },
  );
}
