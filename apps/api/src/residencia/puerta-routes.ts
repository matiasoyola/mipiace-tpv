// residencia-1 (D-52) · LA PUERTA, de parte del servidor.
//
// Dos rutas y nada más:
//
//   · `POST /residencia/habitaciones/:roomId/pairing-codes` — el admin
//     genera el código de 6 dígitos de ESA puerta.
//   · `GET /residencia/puerta/me` — la tablet, ya emparejada, pregunta qué
//     puerta es.
//
// El emparejamiento en sí lo hace `POST /devices/pair`, que es **el mismo
// de siempre** y no se duplica: el código ya dice qué se empareja (`kind` y
// `roomId`), y esa ruta copia las dos cosas al dispositivo. Lo único que
// este bloque le añadió allí son dos columnas en la respuesta.
//
// ── Por qué el código NO se pide por `/admin/registers/:id/...` ──────
//
// Porque esa ruta lleva `ensureCajaEnabled`, y **un tenant de residencia
// tiene la caja apagada** (D-48). Pedirle una caja a un centro que no
// cobra para poder emparejar la tablet de una habitación era pedirle que
// se inventara una caja. De ahí la ruta propia, y de ahí que `register_id`
// sea nullable: las dos mitades de la misma decisión.
//
// Lo que sí se reutiliza letra por letra: el formato del código (6 dígitos
// con ceros a la izquierda, `randomInt` sin sesgo), la ventana de una hora,
// el reintento por colisión y el uso único. Una segunda implementación de
// eso habría sido una segunda forma de equivocarse.

import { randomInt } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import { requireOwnerOrManager } from "../auth/middleware.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { ensureResidenciaEnabled } from "./gate.js";
import { requirePuertaDevice } from "./puerta-auth.js";

// Los mismos números que `devices/routes.ts`. Si uno cambia, los dos.
const PAIRING_CODE_TTL_MINUTES = 60;
const PAIRING_CODE_MAX_ATTEMPTS = 8;

function newSixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function registerResidenciaPuertaRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/residencia/habitaciones/:roomId/pairing-codes",
    {
      preHandler: [
        requireOwnerOrManager,
        ensureClinicaEnabled,
        ensureResidenciaEnabled,
      ],
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
          properties: { name: { type: "string", maxLength: 80 } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { roomId } = request.params as { roomId: string };
      const prisma = getPrisma();

      const habitacion = await prisma.room.findFirst({
        where: { id: roomId, tenantId: auth.tenantId },
        select: { id: true, number: true, active: true },
      });
      if (!habitacion) {
        return reply.code(404).send({
          error: "HABITACION_NO_ENCONTRADA",
          message: "Esa habitación no es de este centro.",
        });
      }
      if (!habitacion.active) {
        return reply.code(409).send({
          error: "HABITACION_INACTIVA",
          message:
            "Esa habitación está fuera de servicio. Vuelve a activarla antes de emparejarle una tablet.",
        });
      }

      const expiresAt = new Date(
        Date.now() + PAIRING_CODE_TTL_MINUTES * 60 * 1000,
      );
      for (let attempt = 0; attempt < PAIRING_CODE_MAX_ATTEMPTS; attempt++) {
        const code = newSixDigitCode();
        const existing = await prisma.pairingCode.findUnique({
          where: { tenantId_code: { tenantId: auth.tenantId, code } },
          select: { consumedAt: true, expiresAt: true },
        });
        const vivo =
          existing &&
          existing.consumedAt == null &&
          existing.expiresAt > new Date();
        if (vivo) continue;
        if (existing) {
          await prisma.pairingCode.delete({
            where: { tenantId_code: { tenantId: auth.tenantId, code } },
          });
        }
        const creado = await prisma.pairingCode.create({
          data: {
            tenantId: auth.tenantId,
            // La CAJA va a NULL y la HABITACIÓN va puesta: es el CHECK
            // `pairing_codes_register_o_habitacion`, y es lo que hace que
            // este código no pueda emparejar un terminal por error.
            registerId: null,
            roomId,
            code,
            createdByUserId: auth.userId,
            expiresAt,
            kind: "ROOM",
          },
          select: { code: true, expiresAt: true, kind: true },
        });
        return reply.code(201).send({
          code: creado.code,
          expiresAt: creado.expiresAt.toISOString(),
          kind: creado.kind,
          roomId,
          roomNumber: habitacion.number,
        });
      }
      return reply.code(503).send({
        error: "CODE_COLLISION",
        message: "No se pudo generar un código único, reintenta",
      });
    },
  );

  // ── `GET /residencia/puerta/me` · qué puerta soy ───────────────────
  //
  // Lo que la APK pinta en «modo puerta» en este bloque: el número de la
  // habitación, su nombre si lo tiene, y quién la ocupa — **nombre y nada
  // más**. Ni un dato de salud: la tablet está colgada en un pasillo.
  //
  // Sin `ensureResidenciaEnabled`: el gate del módulo lo aplica
  // `requirePuertaDevice`, y con otro cuerpo a propósito (403 y no 404, ver
  // su cabecera). A una tablet emparejada no se le esconde el módulo que
  // estaba usando.
  app.get(
    "/residencia/puerta/me",
    { preHandler: [requirePuertaDevice] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.puerta!;
      const prisma = getPrisma();
      const now = new Date();

      const habitacion = await prisma.room.findFirst({
        where: { id: ctx.roomId, tenantId: ctx.tenantId },
        select: {
          id: true,
          number: true,
          name: true,
          active: true,
          floor: { select: { id: true, name: true } },
          beds: {
            where: { active: true },
            orderBy: { label: "asc" },
            select: {
              id: true,
              label: true,
              assignments: {
                where: { toAt: null },
                take: 1,
                select: {
                  client: { select: { id: true, firstName: true, lastName: true } },
                },
              },
            },
          },
        },
      });
      if (!habitacion) {
        // La habitación se retiró con la tablet emparejada. No puede pasar
        // —la FK es `Restrict`— y si pasara, la tablet tiene que poder
        // contarlo en vez de quedarse en blanco.
        return reply.code(409).send({
          error: "HABITACION_RETIRADA",
          message:
            "Esta tablet estaba emparejada a una habitación que ya no existe. Avisa a dirección.",
        });
      }

      await prisma.device.update({
        where: { id: ctx.deviceId },
        data: { lastSeenAt: now },
      });

      // Los turnos del centro viajan con la identidad de la puerta, y van
      // aquí y no en una ruta aparte por lo que viene en residencia-3: cada
      // registro se adscribe al turno en que ocurre, y una tablet que
      // registre SIN RED tiene que poder decidirlo sola. Mismo criterio que
      // `serverTime` en `/kitchen/me` de kds-2: lo que la tablet va a
      // necesitar offline se le da al arrancar.
      const turnos = await prisma.centerShift.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: [{ sortOrder: "asc" }, { startsAt: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          startsAt: true,
          endsAt: true,
        },
      });

      return {
        device: { id: ctx.deviceId, name: ctx.deviceName },
        habitacion: {
          id: habitacion.id,
          number: habitacion.number,
          name: habitacion.name,
          active: habitacion.active,
          plantaId: habitacion.floor.id,
          plantaName: habitacion.floor.name,
        },
        // Nombre y cama. NADA MÁS. Ver la cabecera de `puerta-auth.ts`.
        //
        // residencia-3 añade el `clientId`, y sólo porque la pantalla en
        // reposo necesita con qué pedir la foto (D-64). Un uuid no dice
        // nada de nadie —no es el DNI, no es el nivel de dependencia— y la
        // foto que abre sigue exigiendo consentimiento de imagen vigente.
        ocupantes: habitacion.beds.map((b) => {
          const ocupacion = b.assignments[0] ?? null;
          return {
            bedId: b.id,
            bedLabel: b.label,
            clientId: ocupacion?.client.id ?? null,
            nombre: ocupacion
              ? `${ocupacion.client.firstName} ${ocupacion.client.lastName}`.trim()
              : null,
          };
        }),
        turnos,
        // La hora del SERVIDOR al arrancar, por lo mismo que en kds-2: con
        // ella la tablet calcula su desvío de reloj, y sin desvío no puede
        // adscribir un registro offline al turno correcto.
        serverTime: now.toISOString(),
      };
    },
  );
}
