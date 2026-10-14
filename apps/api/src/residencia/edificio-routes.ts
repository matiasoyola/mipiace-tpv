// residencia-1 · EL EDIFICIO: plantas → habitaciones → camas.
//
// Alta y edición para OWNER/MANAGER, más la vista que pinta la pantalla de
// Edificio: cada habitación con quién ocupa cada cama y qué tablet es su
// puerta.
//
// ── Lo que estas rutas NO enseñan ────────────────────────────────────
//
// **Ni un dato de salud.** La vista del edificio lleva el NOMBRE de quien
// ocupa cada cama y nada más: ni nivel de dependencia, ni grado, ni tipo
// de plaza. Es la misma decisión que la pantalla de la puerta (§7 del
// prompt: «el número de habitación y quién la ocupa, sin un dato de
// salud»), y por lo mismo: esta pantalla se mira de pie, con gente
// alrededor.
//
// ── Y por qué no pasa por `conHistoria` ──────────────────────────────
//
// Porque lo que devuelve no es historia: es el plano del edificio, que hoy
// está colgado en la pared del office. Apuntar una línea de acceso por
// cada una de las 30 habitaciones y por cada apertura de la pantalla
// llenaría el registro de lo que NO es un acceso a una historia, y eso lo
// hace menos útil (decisión 1 de clinica-1).
//
// Sí lleva el gate del módulo y `requireOwnerOrManager` en todo lo que
// escribe: el edificio lo configura la dirección, no el personal.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import {
  requireOwnerOrCashier,
  requireOwnerOrManager,
} from "../auth/middleware.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { ensureResidenciaEnabled } from "./gate.js";

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

export async function registerResidenciaEdificioRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── LA VISTA · plantas → habitaciones → camas, en una petición ─────
  //
  // Una y no tres, y no es por ahorrar: la pantalla de Edificio es un
  // árbol y pintarlo a trozos deja a la dirección viendo habitaciones sin
  // planta durante medio segundo. Con 30 habitaciones y 49 camas esto es
  // una consulta con dos `include`.
  app.get(
    "/residencia/edificio",
    { preHandler: PUERTAS_LECTURA },
    async (request: FastifyRequest) => {
      // `requireOwnerOrCashier` puebla SIEMPRE `request.auth`, también
      // cuando el token es una sesión de TPV: ahí copia el `sub`, el `tid`
      // y el rol del cajero. Así que una sola lectura, sin `??` sobre
      // `request.cashier` — que era una rama que no se alcanza nunca y un
      // `!` que nadie volvería a comprobar.
      const tenantId = request.auth!.tenantId;
      const prisma = getPrisma();

      const plantas = await prisma.floor.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          sortOrder: true,
          rooms: {
            orderBy: { number: "asc" },
            select: {
              id: true,
              number: true,
              name: true,
              active: true,
              beds: {
                orderBy: { label: "asc" },
                select: {
                  id: true,
                  label: true,
                  active: true,
                  assignments: {
                    where: { toAt: null },
                    take: 1,
                    select: {
                      id: true,
                      fromAt: true,
                      client: {
                        select: { id: true, firstName: true, lastName: true },
                      },
                    },
                  },
                },
              },
              // La tablet de la puerta: la VIVA, que es como mucho una
              // (índice parcial `devices_one_active_per_room_key`).
              devices: {
                where: { revokedAt: null, kind: "ROOM" },
                take: 1,
                select: { id: true, name: true, lastSeenAt: true },
              },
            },
          },
        },
      });

      return {
        plantas: plantas.map((f) => ({
          id: f.id,
          name: f.name,
          sortOrder: f.sortOrder,
          habitaciones: f.rooms.map((r) => {
            const tablet = r.devices[0] ?? null;
            return {
              id: r.id,
              number: r.number,
              name: r.name,
              active: r.active,
              camas: r.beds.map((b) => {
                const ocupacion = b.assignments[0] ?? null;
                return {
                  id: b.id,
                  label: b.label,
                  active: b.active,
                  // Nombre y nada más. Ver la cabecera.
                  ocupa: ocupacion
                    ? {
                        clientId: ocupacion.client.id,
                        nombre: `${ocupacion.client.firstName} ${ocupacion.client.lastName}`.trim(),
                        desde: ocupacion.fromAt.toISOString(),
                      }
                    : null,
                };
              }),
              puerta: tablet
                ? {
                    deviceId: tablet.id,
                    name: tablet.name,
                    lastSeenAt: tablet.lastSeenAt?.toISOString() ?? null,
                  }
                : null,
            };
          }),
        })),
      };
    },
  );

  // ── PLANTAS ────────────────────────────────────────────────────────
  app.post(
    "/residencia/plantas",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            sortOrder: { type: "integer", minimum: 0, maximum: 999 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as { name: string; sortOrder?: number };
      const prisma = getPrisma();
      const name = body.name.trim();
      const repetida = await prisma.floor.findFirst({
        where: { tenantId: auth.tenantId, name },
        select: { id: true },
      });
      if (repetida) {
        return reply.code(409).send({
          error: "PLANTA_REPETIDA",
          message: `Ya hay una planta llamada «${name}».`,
        });
      }
      const planta = await prisma.floor.create({
        data: {
          tenantId: auth.tenantId,
          name,
          sortOrder: body.sortOrder ?? 0,
        },
        select: { id: true, name: true, sortOrder: true },
      });
      return reply.code(201).send({ planta });
    },
  );

  app.patch(
    "/residencia/plantas/:floorId",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["floorId"],
          additionalProperties: false,
          properties: { floorId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            sortOrder: { type: "integer", minimum: 0, maximum: 999 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { floorId } = request.params as { floorId: string };
      const body = request.body as { name?: string; sortOrder?: number };
      const prisma = getPrisma();
      const existe = await prisma.floor.findFirst({
        where: { id: floorId, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!existe) {
        return reply.code(404).send({
          error: "PLANTA_NO_ENCONTRADA",
          message: "Esa planta no es de este centro.",
        });
      }
      if (body.name) {
        const repetida = await prisma.floor.findFirst({
          where: {
            tenantId: auth.tenantId,
            name: body.name.trim(),
            id: { not: floorId },
          },
          select: { id: true },
        });
        if (repetida) {
          return reply.code(409).send({
            error: "PLANTA_REPETIDA",
            message: `Ya hay una planta llamada «${body.name.trim()}».`,
          });
        }
      }
      const planta = await prisma.floor.update({
        where: { id: floorId },
        data: {
          ...(body.name ? { name: body.name.trim() } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        },
        select: { id: true, name: true, sortOrder: true },
      });
      return { planta };
    },
  );

  // ── HABITACIONES ───────────────────────────────────────────────────
  app.post(
    "/residencia/habitaciones",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        body: {
          type: "object",
          required: ["floorId", "number"],
          additionalProperties: false,
          properties: {
            floorId: { type: "string", format: "uuid" },
            number: { type: "string", minLength: 1, maxLength: 20 },
            name: { type: "string", maxLength: 80 },
            // Cuántas camas crear de una vez. Es lo que la dirección hace
            // de verdad al montar el centro —«la 112 es doble»— y
            // obligarla a dar de alta 49 camas una por una después de 30
            // habitaciones era pedirle media mañana.
            camas: { type: "integer", minimum: 0, maximum: 6 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        floorId: string;
        number: string;
        name?: string;
        camas?: number;
      };
      const prisma = getPrisma();
      const number = body.number.trim();

      const planta = await prisma.floor.findFirst({
        where: { id: body.floorId, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!planta) {
        return reply.code(404).send({
          error: "PLANTA_NO_ENCONTRADA",
          message: "Esa planta no es de este centro.",
        });
      }
      const repetida = await prisma.room.findFirst({
        where: { tenantId: auth.tenantId, number },
        select: { id: true },
      });
      if (repetida) {
        return reply.code(409).send({
          error: "HABITACION_REPETIDA",
          message: `Ya hay una habitación «${number}» en este centro.`,
        });
      }

      // Las camas se llaman A, B, C… Una sola cama en una individual se
      // llama «A» y no se queda sin nombre: el personal dice «la 112 A».
      const etiquetas = ["A", "B", "C", "D", "E", "F"];
      const cuantas = body.camas ?? 1;

      const habitacion = await prisma.$transaction(async (tx) => {
        const r = await tx.room.create({
          data: {
            tenantId: auth.tenantId,
            floorId: body.floorId,
            number,
            name: body.name?.trim() || null,
          },
          select: { id: true, number: true, name: true, active: true },
        });
        if (cuantas > 0) {
          await tx.bed.createMany({
            data: etiquetas.slice(0, cuantas).map((label) => ({
              tenantId: auth.tenantId,
              roomId: r.id,
              label,
            })),
          });
        }
        return r;
      });

      const camas = await prisma.bed.findMany({
        where: { roomId: habitacion.id },
        orderBy: { label: "asc" },
        select: { id: true, label: true, active: true },
      });
      return reply.code(201).send({ habitacion: { ...habitacion, camas } });
    },
  );

  app.patch(
    "/residencia/habitaciones/:roomId",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["roomId"],
          additionalProperties: false,
          properties: { roomId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            floorId: { type: "string", format: "uuid" },
            number: { type: "string", minLength: 1, maxLength: 20 },
            name: { type: "string", maxLength: 80 },
            active: { type: "boolean" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { roomId } = request.params as { roomId: string };
      const body = request.body as {
        floorId?: string;
        number?: string;
        name?: string;
        active?: boolean;
      };
      const prisma = getPrisma();

      const habitacion = await prisma.room.findFirst({
        where: { id: roomId, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!habitacion) {
        return reply.code(404).send({
          error: "HABITACION_NO_ENCONTRADA",
          message: "Esa habitación no es de este centro.",
        });
      }
      if (body.floorId) {
        const planta = await prisma.floor.findFirst({
          where: { id: body.floorId, tenantId: auth.tenantId },
          select: { id: true },
        });
        if (!planta) {
          return reply.code(404).send({
            error: "PLANTA_NO_ENCONTRADA",
            message: "Esa planta no es de este centro.",
          });
        }
      }
      if (body.number) {
        const repetida = await prisma.room.findFirst({
          where: {
            tenantId: auth.tenantId,
            number: body.number.trim(),
            id: { not: roomId },
          },
          select: { id: true },
        });
        if (repetida) {
          return reply.code(409).send({
            error: "HABITACION_REPETIDA",
            message: `Ya hay una habitación «${body.number.trim()}» en este centro.`,
          });
        }
      }
      // Sacar de servicio una habitación OCUPADA, no. La cama sigue
      // teniendo a alguien dentro y lo que haría es esconderlo de la
      // pantalla de Edificio — que es donde se mira para saber dónde
      // está la gente.
      if (body.active === false) {
        const ocupadas = await prisma.bedAssignment.count({
          where: { tenantId: auth.tenantId, toAt: null, bed: { roomId } },
        });
        if (ocupadas > 0) {
          return reply.code(409).send({
            error: "HABITACION_OCUPADA",
            message:
              "Esa habitación tiene residentes dentro. Muévelos antes de sacarla de servicio.",
            ocupadas,
          });
        }
      }
      const actualizada = await prisma.room.update({
        where: { id: roomId },
        data: {
          ...(body.floorId ? { floorId: body.floorId } : {}),
          ...(body.number ? { number: body.number.trim() } : {}),
          ...(body.name !== undefined ? { name: body.name.trim() || null } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
        select: { id: true, number: true, name: true, active: true, floorId: true },
      });
      return { habitacion: actualizada };
    },
  );

  // ── CAMAS ──────────────────────────────────────────────────────────
  app.post(
    "/residencia/camas",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        body: {
          type: "object",
          required: ["roomId", "label"],
          additionalProperties: false,
          properties: {
            roomId: { type: "string", format: "uuid" },
            label: { type: "string", minLength: 1, maxLength: 8 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as { roomId: string; label: string };
      const prisma = getPrisma();
      const label = body.label.trim().toUpperCase();

      const habitacion = await prisma.room.findFirst({
        where: { id: body.roomId, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!habitacion) {
        return reply.code(404).send({
          error: "HABITACION_NO_ENCONTRADA",
          message: "Esa habitación no es de este centro.",
        });
      }
      const repetida = await prisma.bed.findFirst({
        where: { roomId: body.roomId, label },
        select: { id: true },
      });
      if (repetida) {
        return reply.code(409).send({
          error: "CAMA_REPETIDA",
          message: `Esa habitación ya tiene una cama «${label}».`,
        });
      }
      const cama = await prisma.bed.create({
        data: { tenantId: auth.tenantId, roomId: body.roomId, label },
        select: { id: true, label: true, active: true, roomId: true },
      });
      return reply.code(201).send({ cama });
    },
  );

  app.patch(
    "/residencia/camas/:bedId",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["bedId"],
          additionalProperties: false,
          properties: { bedId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string", minLength: 1, maxLength: 8 },
            active: { type: "boolean" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { bedId } = request.params as { bedId: string };
      const body = request.body as { label?: string; active?: boolean };
      const prisma = getPrisma();

      const cama = await prisma.bed.findFirst({
        where: { id: bedId, tenantId: auth.tenantId },
        select: { id: true, roomId: true },
      });
      if (!cama) {
        return reply.code(404).send({
          error: "CAMA_NO_ENCONTRADA",
          message: "Esa cama no es de este centro.",
        });
      }
      if (body.label) {
        const repetida = await prisma.bed.findFirst({
          where: {
            roomId: cama.roomId,
            label: body.label.trim().toUpperCase(),
            id: { not: bedId },
          },
          select: { id: true },
        });
        if (repetida) {
          return reply.code(409).send({
            error: "CAMA_REPETIDA",
            message: "Esa habitación ya tiene una cama con esa letra.",
          });
        }
      }
      // Sacar de servicio una cama ocupada, no: ver la nota de la
      // habitación.
      if (body.active === false) {
        const ocupada = await prisma.bedAssignment.count({
          where: { tenantId: auth.tenantId, bedId, toAt: null },
        });
        if (ocupada > 0) {
          return reply.code(409).send({
            error: "CAMA_OCUPADA",
            message:
              "Esa cama tiene un residente. Muévelo antes de sacarla de servicio.",
          });
        }
      }
      const actualizada = await prisma.bed.update({
        where: { id: bedId },
        data: {
          ...(body.label ? { label: body.label.trim().toUpperCase() } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
        select: { id: true, label: true, active: true, roomId: true },
      });
      return { cama: actualizada };
    },
  );
}
