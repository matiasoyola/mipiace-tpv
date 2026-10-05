// clinica-1 · las rutas de la historia clínica.
//
//   GET    /clinica/clients/:clientId/entries       — la historia
//   POST   /clinica/clients/:clientId/entries       — una anotación nueva
//   POST   /clinica/entries/:entryId/addenda        — añadir a una entrada
//   GET    /clinica/clients/:clientId/access-log    — quién la ha abierto
//   GET    /clinica/clinicians/:userId/clients      — la selección de un
//                                                     sanitario
//   POST   /clinica/clinicians/:userId/clients      — dar acceso a mano
//   DELETE /clinica/clinicians/:userId/clients/:cid — revocarlo
//
// Las TRES primeras pasan por `conHistoria` (`registro.ts`), que resuelve
// LA función de acceso (`acceso.ts`) y apunta la línea del registro antes
// de dejar correr el handler. Ninguna repite la regla por su cuenta.
//
// Las CUATRO últimas son de gestión, no de historia: las lleva la dueña o
// el encargado, no se mira la marca sanitaria (una dueña no sanitaria
// administra el personal) y NO devuelven ni una línea de contenido
// clínico — solo quién tiene acceso a quién. Por eso no van por
// `conHistoria`: apuntar "la dueña abrió la historia" cuando lo que hizo
// fue gestionar permisos sería una línea falsa en el registro.
//
// Todas llevan `ensureClinicaEnabled`, que con el módulo apagado contesta
// la 404 de Fastify carácter por carácter.
//
// ── Datos de salud y logs ─────────────────────────────────────────────
//
// El `body` de una entrada o de una anotación NO se escribe en ningún
// log, ni en Sentry, ni en un mensaje de error. Ni aquí ni en ningún
// `catch` de este fichero.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { requireOwnerOrCashier } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { ensureClinicaEnabled } from "./gate.js";
import { conHistoria } from "./registro.js";

// El tope de una página. El mismo criterio que el resto del CRM: 50 por
// defecto, 200 como techo.
const PAGINA_DEFECTO = 50;
const PAGINA_MAXIMA = 200;

const guard = { preHandler: [requireOwnerOrCashier, ensureClinicaEnabled] };

/**
 * Sólo la dueña o el encargado gestionan accesos. Corre DESPUÉS de la
 * autenticación y DESPUÉS del gate del módulo, en ese orden: con la
 * clínica apagada la respuesta tiene que ser 404 y no 403, o el 403
 * destaparía el módulo.
 */
async function requireGestorDePersonal(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const role = request.auth?.role;
  if (role !== "OWNER" && role !== "MANAGER") {
    reply.code(403).send({
      error: "FORBIDDEN",
      code: "FORBIDDEN",
      message:
        "Sólo la propietaria o el encargado pueden gestionar el acceso a las historias.",
    });
  }
}

const guardGestion = {
  preHandler: [requireOwnerOrCashier, ensureClinicaEnabled, requireGestorDePersonal],
};

/**
 * Carga un paciente validando que es del tenant. Es la puerta de
 * AISLAMIENTO; la de autorización clínica es `conHistoria`. Las dos, y en
 * este orden: un id de otro tenant tiene que ser 404 antes de que nadie
 * pregunte si este sanitario podría verlo.
 */
async function cargarPacienteDelTenant(
  tenantId: string,
  clientId: string,
): Promise<{ id: string } | null> {
  const prisma = getPrisma();
  return prisma.client.findFirst({
    where: { id: clientId, tenantId },
    select: { id: true },
  });
}

/** Carga un sanitario del tenant. `null` si no existe o no es sanitario. */
async function cargarSanitarioDelTenant(
  tenantId: string,
  userId: string,
): Promise<{ id: string; isClinician: boolean } | null> {
  const prisma = getPrisma();
  return prisma.user.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
    select: { id: true, isClinician: true },
  });
}

function pacienteNoExiste(reply: FastifyReply) {
  return reply.code(404).send({
    error: "CLIENT_NOT_FOUND",
    code: "CLIENT_NOT_FOUND",
    message: "Paciente no encontrado.",
  });
}

export async function registerClinicaRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── La historia de un paciente ──────────────────────────────────────
  app.get(
    "/clinica/clients/:clientId/entries",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            cursor: { type: "string", format: "uuid" },
            limit: { type: "integer", minimum: 1, maximum: PAGINA_MAXIMA },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const { cursor, limit } = request.query as {
        cursor?: string;
        limit?: number;
      };
      if (!(await cargarPacienteDelTenant(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      return conHistoria(
        request,
        reply,
        { clientId, action: "READ" },
        async (ctx) => {
          const prisma = getPrisma();
          const take = limit ?? PAGINA_DEFECTO;
          const rows = await prisma.clinicalEntry.findMany({
            where: { tenantId: ctx.tenantId, clientId },
            orderBy: { createdAt: "desc" },
            take: take + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: {
              id: true,
              kind: true,
              body: true,
              createdAt: true,
              appointmentId: true,
              author: { select: { id: true, alias: true, email: true } },
              addenda: {
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  body: true,
                  createdAt: true,
                  author: { select: { id: true, alias: true, email: true } },
                },
              },
            },
          });
          const hayMas = rows.length > take;
          const pagina = hayMas ? rows.slice(0, take) : rows;
          return {
            entries: pagina.map((e) => ({
              id: e.id,
              kind: e.kind,
              body: e.body,
              createdAt: e.createdAt.toISOString(),
              appointmentId: e.appointmentId,
              author: autorView(e.author),
              addenda: e.addenda.map((a) => ({
                id: a.id,
                body: a.body,
                createdAt: a.createdAt.toISOString(),
                author: autorView(a.author),
              })),
            })),
            nextCursor: hayMas ? (pagina[pagina.length - 1]?.id ?? null) : null,
          };
        },
      );
    },
  );

  // ── Una anotación nueva ─────────────────────────────────────────────
  //
  // INMUTABLE desde el instante en que se escribe: no hay PATCH ni DELETE
  // en este fichero, y si alguien los escribiera el trigger
  // `clinical_entries_inmutable` los rechazaría igual.
  app.post(
    "/clinica/clients/:clientId/entries",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["body"],
          additionalProperties: false,
          properties: {
            // Hoy sólo `NOTE`. El enum entra en el schema para que una
            // pieza futura (valoración, sesión) no necesite cambiar el
            // contrato, sólo añadir un valor.
            kind: { type: "string", enum: ["NOTE"] },
            appointmentId: { type: "string", format: "uuid" },
            // Objeto y no texto: lo que viene es estructurado. El CHECK
            // `clinical_entries_body_object` rechaza el objeto vacío
            // también desde la base.
            body: { type: "object", minProperties: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const body = request.body as {
        kind?: "NOTE";
        appointmentId?: string;
        body: Record<string, unknown>;
      };
      if (!(await cargarPacienteDelTenant(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      return conHistoria(
        request,
        reply,
        { clientId, action: "WRITE" },
        async (ctx) => {
          const prisma = getPrisma();
          // La cita, si viene, tiene que ser de ESTE tenant y de ESTE
          // paciente. Sin la segunda mitad, una anotación podría colgar
          // de la cita de otra persona y el histórico mentiría.
          if (body.appointmentId) {
            const cita = await prisma.appointment.findFirst({
              where: {
                id: body.appointmentId,
                tenantId: ctx.tenantId,
                clientId,
              },
              select: { id: true },
            });
            if (!cita) {
              return reply.code(409).send({
                error: "APPOINTMENT_NOT_OF_CLIENT",
                code: "APPOINTMENT_NOT_OF_CLIENT",
                message: "Esa cita no es de este paciente.",
              });
            }
          }
          const creada = await prisma.clinicalEntry.create({
            data: {
              tenantId: ctx.tenantId,
              clientId,
              authorUserId: ctx.userId,
              appointmentId: body.appointmentId ?? null,
              kind: body.kind ?? "NOTE",
              body: body.body as never,
            },
            select: {
              id: true,
              kind: true,
              body: true,
              createdAt: true,
              appointmentId: true,
              author: { select: { id: true, alias: true, email: true } },
            },
          });
          return reply.code(201).send({
            entry: {
              id: creada.id,
              kind: creada.kind,
              body: creada.body,
              createdAt: creada.createdAt.toISOString(),
              appointmentId: creada.appointmentId,
              author: autorView(creada.author),
              addenda: [],
            },
          });
        },
      );
    },
  );

  // ── Añadir a una entrada ────────────────────────────────────────────
  //
  // Lo ÚNICO que se le puede hacer a algo ya escrito. El `clientId` no
  // viene en la URL: sale de la entrada, porque la autorización es sobre
  // el paciente y dejar que el llamante diga de quién es la entrada sería
  // dejarle elegir contra qué paciente se comprueba el acceso.
  app.post(
    "/clinica/entries/:entryId/addenda",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["entryId"],
          additionalProperties: false,
          properties: { entryId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["body"],
          additionalProperties: false,
          properties: { body: { type: "object", minProperties: 1 } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { entryId } = request.params as { entryId: string };
      const body = request.body as { body: Record<string, unknown> };
      const prisma = getPrisma();
      const entrada = await prisma.clinicalEntry.findFirst({
        where: { id: entryId, tenantId: auth.tenantId },
        select: { id: true, clientId: true },
      });
      if (!entrada) {
        return reply.code(404).send({
          error: "CLINICAL_ENTRY_NOT_FOUND",
          code: "CLINICAL_ENTRY_NOT_FOUND",
          message: "Esa anotación no existe.",
        });
      }
      return conHistoria(
        request,
        reply,
        { clientId: entrada.clientId, action: "WRITE" },
        async (ctx) => {
          const creada = await prisma.clinicalAddendum.create({
            data: {
              tenantId: ctx.tenantId,
              entryId: entrada.id,
              authorUserId: ctx.userId,
              body: body.body as never,
            },
            select: {
              id: true,
              body: true,
              createdAt: true,
              author: { select: { id: true, alias: true, email: true } },
            },
          });
          return reply.code(201).send({
            addendum: {
              id: creada.id,
              body: creada.body,
              createdAt: creada.createdAt.toISOString(),
              author: autorView(creada.author),
            },
          });
        },
      );
    },
  );

  // ── Quién ha abierto la historia de este paciente ───────────────────
  //
  // La ruta que se le enseña a un inspector o a un paciente que ejerce su
  // derecho de acceso. Dueña y encargado, paginada, y los DENEGADOS
  // dentro: un intento que se negó es parte de la respuesta.
  app.get(
    "/clinica/clients/:clientId/access-log",
    {
      ...guardGestion,
      schema: {
        params: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            cursor: { type: "string", format: "uuid" },
            limit: { type: "integer", minimum: 1, maximum: PAGINA_MAXIMA },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const { cursor, limit } = request.query as {
        cursor?: string;
        limit?: number;
      };
      if (!(await cargarPacienteDelTenant(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      const prisma = getPrisma();
      const take = limit ?? PAGINA_DEFECTO;
      const rows = await prisma.clinicalAccessLog.findMany({
        where: { tenantId: auth.tenantId, clientId },
        orderBy: [{ at: "desc" }, { id: "desc" }],
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          action: true,
          outcome: true,
          at: true,
          deviceId: true,
          route: true,
          user: { select: { id: true, alias: true, email: true } },
        },
      });
      const hayMas = rows.length > take;
      const pagina = hayMas ? rows.slice(0, take) : rows;
      return {
        accesses: pagina.map((r) => ({
          id: r.id,
          action: r.action,
          outcome: r.outcome,
          at: r.at.toISOString(),
          deviceId: r.deviceId,
          route: r.route,
          user: autorView(r.user),
        })),
        nextCursor: hayMas ? (pagina[pagina.length - 1]?.id ?? null) : null,
      };
    },
  );

  // ── La selección de un sanitario ────────────────────────────────────
  //
  // Devuelve los accesos VIGENTES con el nombre del paciente y de dónde
  // vino cada uno (agenda o a mano), que es lo que pinta la ficha del
  // sanitario en la pantalla de Personal. El histórico de revocaciones no
  // sale aquí: es otra pregunta y otra pantalla.
  app.get(
    "/clinica/clinicians/:userId/clients",
    {
      ...guardGestion,
      schema: {
        params: {
          type: "object",
          required: ["userId"],
          additionalProperties: false,
          properties: { userId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId } = request.params as { userId: string };
      const sanitario = await cargarSanitarioDelTenant(auth.tenantId, userId);
      if (!sanitario) {
        return reply.code(404).send({
          error: "STAFF_USER_NOT_FOUND",
          code: "STAFF_USER_NOT_FOUND",
          message: "Usuario no encontrado.",
        });
      }
      const prisma = getPrisma();
      const rows = await prisma.clinicalAccess.findMany({
        where: {
          tenantId: auth.tenantId,
          clinicianUserId: userId,
          revokedAt: null,
        },
        orderBy: { grantedAt: "desc" },
        select: {
          id: true,
          clientId: true,
          source: true,
          grantedAt: true,
          client: { select: { firstName: true, lastName: true } },
        },
      });
      return {
        clients: rows.map((r) => ({
          accessId: r.id,
          clientId: r.clientId,
          name: `${r.client.firstName} ${r.client.lastName}`.trim(),
          source: r.source,
          grantedAt: r.grantedAt.toISOString(),
        })),
      };
    },
  );

  // ── Dar acceso a mano ───────────────────────────────────────────────
  //
  // Idempotente por el índice único PARCIAL: si ya hay uno vigente
  // devuelve 200 con `created: false` en vez de reventar con un 500 de
  // constraint. Un doble toque no es un error.
  app.post(
    "/clinica/clinicians/:userId/clients",
    {
      ...guardGestion,
      schema: {
        params: {
          type: "object",
          required: ["userId"],
          additionalProperties: false,
          properties: { userId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId } = request.params as { userId: string };
      const { clientId } = request.body as { clientId: string };
      const sanitario = await cargarSanitarioDelTenant(auth.tenantId, userId);
      if (!sanitario) {
        return reply.code(404).send({
          error: "STAFF_USER_NOT_FOUND",
          code: "STAFF_USER_NOT_FOUND",
          message: "Usuario no encontrado.",
        });
      }
      // Dar acceso a quien no es sanitario no es un permiso: es una fila
      // que no significa nada y que la función de acceso ignoraría.
      if (!sanitario.isClinician) {
        return reply.code(409).send({
          error: "NOT_A_CLINICIAN",
          code: "NOT_A_CLINICIAN",
          message:
            "Esa persona no está marcada como sanitaria, así que no puede tener pacientes asignados.",
        });
      }
      if (!(await cargarPacienteDelTenant(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      const prisma = getPrisma();
      const vigente = await prisma.clinicalAccess.findFirst({
        where: {
          tenantId: auth.tenantId,
          clinicianUserId: userId,
          clientId,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (vigente) {
        return reply.code(200).send({ created: false, accessId: vigente.id });
      }
      const creado = await prisma.clinicalAccess.create({
        data: {
          tenantId: auth.tenantId,
          clinicianUserId: userId,
          clientId,
          source: "MANUAL",
          grantedByUserId: auth.userId,
        },
        select: { id: true },
      });
      return reply.code(201).send({ created: true, accessId: creado.id });
    },
  );

  // ── Revocarlo ───────────────────────────────────────────────────────
  //
  // NO BORRA: rellena `revokedAt` y `revokedByUserId`. La fila se queda
  // para siempre, y el trigger `clinical_access_guard` rechaza el DELETE
  // aunque alguien lo intente desde psql.
  app.delete(
    "/clinica/clinicians/:userId/clients/:clientId",
    {
      ...guardGestion,
      schema: {
        params: {
          type: "object",
          required: ["userId", "clientId"],
          additionalProperties: false,
          properties: {
            userId: { type: "string", format: "uuid" },
            clientId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId, clientId } = request.params as {
        userId: string;
        clientId: string;
      };
      const prisma = getPrisma();
      const vigente = await prisma.clinicalAccess.findFirst({
        where: {
          tenantId: auth.tenantId,
          clinicianUserId: userId,
          clientId,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (!vigente) {
        return reply.code(404).send({
          error: "CLINICAL_ACCESS_NOT_FOUND",
          code: "CLINICAL_ACCESS_NOT_FOUND",
          message: "Esa persona no tiene acceso vigente a ese paciente.",
        });
      }
      await prisma.clinicalAccess.update({
        where: { id: vigente.id },
        data: { revokedAt: new Date(), revokedByUserId: auth.userId },
      });
      return reply.code(200).send({ revoked: true, accessId: vigente.id });
    },
  );
}

/**
 * El nombre visible de quien firma. `alias` primero (v1.7-alias-cajeros:
 * el email es credencial, no display) y el email como respaldo para los
 * users legacy sin alias.
 */
function autorView(u: { id: string; alias: string | null; email: string }) {
  return { id: u.id, name: u.alias?.trim() || u.email };
}
