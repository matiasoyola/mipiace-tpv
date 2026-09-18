// API de la agenda (B-reservas-4, modo CITA). Aislamiento por tenant + gate
// `ensureAgendaEnabled` (403 AGENDA_DISABLED, mismo patrón que B3), a nivel
// de RUTA (no sólo de UI). Auth `requireOwnerOrCashier`: la agenda la usa el
// cajero del TPV (buscar hueco, alta, "en sala", cobrar) tanto como el
// owner/manager.
//
//   GET   /agenda?date= | ?from=&to=          — citas por profesional (columnas)
//                                              + B-7a: retícula, horario del
//                                                centro, tramos y ausencias
//   POST  /agenda/availability                — buscar hueco → slots[]
//   POST  /agenda/appointments                — alta (presencial = confirmada)
//   PATCH /agenda/appointments/:id            — transición de estado / mover
//   POST  /agenda/appointments/:id/checkout   — cita → caja (ticket pre-poblado)
//   GET   /agenda/blocks?from=&to=            — bloqueos puntuales
//   POST  /agenda/blocks                      — crear bloqueo puntual
//   DELETE /agenda/blocks/:id                 — borrar bloqueo
//
// B-reservas-9 · el panel de salud y la matriz:
//
//   GET   /agenda/health                      — las seis tarjetas, cada una
//                                               con su cifra, su consulta y
//                                               su explicación
//   GET   /agenda/skill-matrix                — servicio × profesional
//   PUT   /agenda/skill-matrix/staff/:userId  — lado A: qué servicios da
//   PUT   /agenda/skill-matrix/service/:id    — lado B: quién lo da
//
// Las dos escrituras son configuración del centro: las hace el propietario
// o la encargada, no la cajera (`requireConfigRole`). Leer el panel sí lo
// puede hacer cualquiera del mostrador: diagnosticar no rompe nada.
//
// Motor agnóstico: cero `if(businessType)`, vocabulario neutro. Lo específico
// de cita vive en `CitaMode`; el núcleo (engine/store/GiST) es compartido.
//
// B-reservas-6a · el suelo temporal viaja como `409` con la frase que la
// cajera lee en voz alta y las tres horas que sí se pueden dar:
//
//   { error: "BOOKING_IN_PAST",  code, message, alternatives }
//   { error: "BOOKING_OFF_GRID", code, message, alternatives }
//
// `code` lleva hoy el mismo valor que `error`: es el hueco donde B-6b
// pondrá la key de la regla que bloqueó (`POLICY_BLOCKED`), y así el front
// lee `code` desde ya y no se reescribe dos veces.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { requireOwnerOrCashier } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import type { PrismaClient } from "@mipiacetpv/db";
import { checkoutAppointment } from "./checkout.js";
import {
  createCitaEngine,
  type BookingEngine,
  type HoldFailureReason,
} from "./engine.js";
import { buildAgendaDays } from "./day-view.js";
import { resolveBookingNow, systemClock, type Clock } from "./floor.js";
import { runAgendaHealth } from "./health.js";
import {
  loadSkillMatrix,
  setSkillsForStaff,
  setStaffForService,
  SkillMatrixError,
} from "./skill-matrix.js";
import { parseOccurredAt } from "../shift/impute.js";
import { createAgendaStore, type AgendaStore } from "./store.js";
import { CENTER_TZ, SLOT_MINUTES, wallTimeToUtc } from "./time.js";
import type { AppointmentStatus } from "./types.js";

// Minutos por defecto del hold PENDING (reserva no presencial).
const HOLD_TTL_MINUTES = 10;

// B-reservas-7a · la retícula del centro viaja en la request. El gate ya
// hacía una lectura de tenant por petición: se le añade la columna y no hay
// ninguna lectura nueva. Es lo que el prompt llama "una sola lectura por
// petición y ninguna constante suelta".
declare module "fastify" {
  interface FastifyRequest {
    agendaSlotMinutes?: number;
  }
}

// Gate por capability flag (ADR-R6). Corre tras la autenticación.
async function ensureAgendaEnabled(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const auth = request.auth!;
  const tenant = await getPrisma().tenant.findUnique({
    where: { id: auth.tenantId },
    select: { agendaEnabled: true, agendaSlotMinutes: true },
  });
  if (!tenant?.agendaEnabled) {
    reply.code(403).send({
      error: "AGENDA_DISABLED",
      message: "El módulo de agenda no está activado para este negocio.",
    });
    return;
  }
  request.agendaSlotMinutes = tenant.agendaSlotMinutes;
}

// B-reservas-9 · la matriz es configuración del centro. El gate de ruta ya
// deja pasar la sesión de cajera (la agenda la usa el mostrador entero);
// esta guarda corre DESPUÉS y sólo sobre las dos escrituras. La cajera ve
// el panel y ve la matriz — el diagnóstico no se esconde — pero no la
// edita, y la pantalla se lo dice en vez de dejarla fallar al guardar.
async function requireConfigRole(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const role = request.auth?.role;
  if (role !== "OWNER" && role !== "MANAGER") {
    reply.code(403).send({
      error: "FORBIDDEN",
      message:
        "Sólo el propietario o la encargada pueden cambiar quién da cada servicio.",
    });
  }
}

// B-reservas-6a · un solo sitio traduce el motor a HTTP. `NO_REQUIREMENTS`
// es del pedido (400); todo lo demás es el hueco (409), incluido el suelo.
function statusFor(reason: HoldFailureReason): number {
  return reason === "NO_REQUIREMENTS" ? 400 : 409;
}

// La frase por defecto, para los rechazos que el motor no redacta. Los del
// suelo SÍ la traen: sólo el motor conoce el huso y las alternativas.
function defaultMessage(reason: HoldFailureReason): string {
  if (reason === "NO_REQUIREMENTS") {
    return "Algún servicio no es agendable (sin duración configurada).";
  }
  return "El hueco ya no está disponible.";
}

export interface AgendaRoutesOptions {
  // Overrides para tests (fake store/prisma). En producción se construyen
  // desde `getPrisma()`.
  store?: AgendaStore;
  prisma?: PrismaClient;
  // B-reservas-9 · el panel de salud cuenta "las últimas 24 h", así que
  // necesita el mismo reloj inyectable que el motor (B-6a): un panel con
  // reloj propio no se puede probar.
  clock?: Clock;
}

export async function registerAgendaRoutes(
  app: FastifyInstance,
  opts: AgendaRoutesOptions = {},
): Promise<void> {
  const store: AgendaStore =
    opts.store ?? createAgendaStore(opts.prisma ?? getPrisma());
  const prismaFor = (): PrismaClient => opts.prisma ?? getPrisma();
  const clock: Clock = opts.clock ?? systemClock;

  // B-reservas-7a · el motor se construye POR PETICIÓN, con la retícula del
  // centro que el gate acaba de leer. Antes era uno solo, creado al
  // arrancar y sin tenant — imposible darle una retícula por centro.
  // El coste es una closure: el motor no tiene estado, todo lo que sabe
  // viene del store y de estas opciones.
  const engineFor = (request: FastifyRequest): BookingEngine =>
    createCitaEngine(store, {
      slotMinutes: request.agendaSlotMinutes ?? SLOT_MINUTES,
    });

  // ── Día / semana por profesional ────────────────────────────────────
  app.get(
    "/agenda",
    {
      preHandler: [requireOwnerOrCashier, ensureAgendaEnabled],
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            date: { type: "string", format: "date" },
            from: { type: "string", format: "date" },
            to: { type: "string", format: "date" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const q = request.query as { date?: string; from?: string; to?: string };
      const fromDate = q.from ?? q.date;
      const toDate = q.to ?? q.date;
      if (!fromDate || !toDate) {
        return reply.code(400).send({
          error: "MISSING_RANGE",
          message: "Indica `date` o `from`+`to`.",
        });
      }
      const from = wallTimeToUtc(fromDate, "00:00");
      const to = wallTimeToUtc(toDate, "23:59");
      const [staff, appointments] = await Promise.all([
        store.getStaffProfiles(auth.tenantId),
        store.listAppointments(auth.tenantId, from, to),
      ]);
      // B-reservas-7a · la rejilla deja de ser ciega. Los cuatro campos de
      // antes siguen ahí y con el mismo nombre: quien no lea los nuevos no
      // se entera de que existen. Todo esto viaja a la caché offline del
      // día (`lib/agenda.ts`), porque sin red la cajera sigue teniendo que
      // saber a qué hora abre y quién falta.
      const days = await buildAgendaDays(
        store,
        auth.tenantId,
        fromDate,
        toDate,
        // Sólo las columnas que la rejilla pinta.
        staff.filter((s) => s.active).map((s) => s.userId),
        CENTER_TZ,
        (d) => wallTimeToUtc(d, "00:00"),
      );
      return {
        from: fromDate,
        to: toDate,
        staff,
        appointments,
        slotMinutes: request.agendaSlotMinutes ?? SLOT_MINUTES,
        days,
      };
    },
  );

  // ── Buscar hueco ────────────────────────────────────────────────────
  app.post(
    "/agenda/availability",
    {
      preHandler: [requireOwnerOrCashier, ensureAgendaEnabled],
      schema: {
        body: {
          type: "object",
          required: ["items", "from", "to"],
          additionalProperties: false,
          properties: {
            items: {
              type: "array",
              minItems: 1,
              maxItems: 10,
              items: {
                type: "object",
                required: ["serviceId"],
                additionalProperties: false,
                properties: {
                  serviceId: { type: "string", format: "uuid" },
                  staffUserId: { type: ["string", "null"], format: "uuid" },
                },
              },
            },
            staffUserId: { type: ["string", "null"], format: "uuid" },
            from: { type: "string", format: "date" },
            to: { type: "string", format: "date" },
          },
        },
      },
    },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const body = request.body as {
        items: Array<{ serviceId: string; staffUserId?: string | null }>;
        staffUserId?: string | null;
        from: string;
        to: string;
      };
      const slots = await engineFor(request).availability({
        tenantId: auth.tenantId,
        items: body.items,
        staffUserId: body.staffUserId ?? null,
        fromDate: body.from,
        toDate: body.to,
      });
      return { slots };
    },
  );

  // ── Alta de cita ────────────────────────────────────────────────────
  app.post(
    "/agenda/appointments",
    {
      preHandler: [requireOwnerOrCashier, ensureAgendaEnabled],
      schema: {
        body: {
          type: "object",
          required: ["items", "start"],
          additionalProperties: false,
          properties: {
            externalId: { type: ["string", "null"], format: "uuid" },
            clientId: { type: ["string", "null"], format: "uuid" },
            items: {
              type: "array",
              minItems: 1,
              maxItems: 10,
              items: {
                type: "object",
                required: ["serviceId"],
                additionalProperties: false,
                properties: {
                  serviceId: { type: "string", format: "uuid" },
                  staffUserId: { type: ["string", "null"], format: "uuid" },
                },
              },
            },
            start: { type: "string", format: "date-time" },
            // B-reservas-6a frente O · el instante en que la cajera creó
            // el alta, sellado por el outbox al encolar. Sin este campo en
            // el schema, el `removeAdditional` de Fastify lo borraría antes
            // de que nadie lo viera — que es exactamente lo que le pasó al
            // checkout de borrador en B-5 (§2.12 de reservas-5-done).
            occurredAt: { type: ["string", "null"], format: "date-time" },
            source: {
              type: "string",
              enum: ["PRESENCIAL", "WEB", "PHONE", "GIFT_REDEMPTION"],
            },
            notes: { type: ["string", "null"], maxLength: 1000 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        externalId?: string | null;
        clientId?: string | null;
        items: Array<{ serviceId: string; staffUserId?: string | null }>;
        start: string;
        occurredAt?: string | null;
        source?: "PRESENCIAL" | "WEB" | "PHONE" | "GIFT_REDEMPTION";
        notes?: string | null;
      };
      const source = body.source ?? "PRESENCIAL";

      // Frente O · el alta que se creó sin red. Dos filtros encadenados,
      // cada uno con su dueño:
      //   1. `parseOccurredAt` (v1.11) descarta el FUTURO con la misma
      //      tolerancia de 5 min que usan los tickets — un reloj
      //      adelantado no abre el futuro de la agenda;
      //   2. `resolveBookingNow` (el suelo) descarta lo más viejo que la
      //      cota. Manda el motor, que la vuelve a llamar; aquí se llama
      //      sólo para dejar escrito QUÉ pasó con el campo.
      const { at: parsedOccurredAt, skewed } = parseOccurredAt(body.occurredAt);
      const decision = resolveBookingNow(new Date(), parsedOccurredAt);
      if (body.occurredAt) {
        request.log.info(
          {
            event: "agenda.booking_occurred_at",
            externalId: body.externalId,
            occurredAt: body.occurredAt,
            start: body.start,
            // "future" también cuando `parseOccurredAt` ya lo tiró.
            source: skewed ? "future" : decision.source,
          },
          decision.source === "occurred_at"
            ? "el suelo se evalúa con el instante del alta (creada sin red)"
            : "occurredAt no se usa para el suelo",
        );
      }
      // Presencial = confirmada directa; el resto entra como hold PENDING.
      const confirmed = source === "PRESENCIAL";
      const result = await engineFor(request).hold({
        tenantId: auth.tenantId,
        externalId: body.externalId ?? null,
        clientId: body.clientId ?? null,
        items: body.items,
        start: body.start,
        occurredAt: parsedOccurredAt,
        source,
        confirmed,
        pendingTtlMinutes: HOLD_TTL_MINUTES,
        notes: body.notes ?? null,
      });
      if (result.ok) {
        if (result.duplicate) {
          return reply
            .code(200)
            .send({ appointment: result.appointment, duplicate: true });
        }
        return reply.code(201).send({ appointment: result.appointment });
      }
      return reply.code(statusFor(result.reason)).send({
        error: result.reason,
        code: result.reason,
        message: result.message ?? defaultMessage(result.reason),
        alternatives: result.alternatives,
      });
    },
  );

  // ── Transición de estado / reprogramar ──────────────────────────────
  app.patch(
    "/agenda/appointments/:id",
    {
      preHandler: [requireOwnerOrCashier, ensureAgendaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: {
              type: "string",
              enum: [
                "CONFIRMED",
                "IN_SERVICE",
                "COMPLETED",
                "NO_SHOW",
                "CANCELLED",
              ],
            },
            start: { type: "string", format: "date-time" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as {
        status?: AppointmentStatus;
        start?: string;
      };

      // Reprogramar (mover el slot).
      if (body.start) {
        const moved = await engineFor(request).reschedule(
          auth.tenantId,
          id,
          body.start,
        );
        if (moved.ok) return { appointment: moved.appointment };
        if (moved.reason === "NOT_FOUND") {
          return reply.code(404).send({
            error: "APPOINTMENT_NOT_FOUND",
            message: "Cita no encontrada.",
          });
        }
        return reply.code(statusFor(moved.reason)).send({
          error: moved.reason,
          code: moved.reason,
          message: moved.message ?? "No se pudo mover a ese hueco.",
          alternatives: moved.alternatives,
        });
      }

      if (!body.status) {
        return reply.code(400).send({
          error: "NO_CHANGE",
          message: "Indica `status` o `start`.",
        });
      }
      let updated;
      switch (body.status) {
        case "CONFIRMED":
          updated = await engineFor(request).confirm(auth.tenantId, id);
          break;
        case "IN_SERVICE":
          updated = await engineFor(request).setInService(auth.tenantId, id);
          break;
        case "COMPLETED":
          updated = await engineFor(request).complete(auth.tenantId, id);
          break;
        case "NO_SHOW":
          updated = await engineFor(request).noShow(auth.tenantId, id);
          break;
        case "CANCELLED":
          updated = await engineFor(request).cancel(auth.tenantId, id);
          break;
      }
      if (!updated) {
        return reply.code(404).send({
          error: "APPOINTMENT_NOT_FOUND",
          message: "Cita no encontrada.",
        });
      }
      return { appointment: updated };
    },
  );

  // ── Cita → caja (ticket pre-poblado; camino de cobro existente) ─────
  app.post(
    "/agenda/appointments/:id/checkout",
    {
      preHandler: [requireOwnerOrCashier, ensureAgendaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      // El checkout necesita una caja abierta (register + turno): sólo un
      // cajero logueado en el TPV puede abrir el ticket. Con JWT de owner sin
      // sesión de caja no hay register.
      const cashier = request.cashier;
      if (!cashier) {
        return reply.code(409).send({
          error: "NO_CASHIER_SESSION",
          message: "Abre el cobro desde el TPV con una caja abierta.",
        });
      }
      const result = await checkoutAppointment(
        prismaFor(),
        store,
        {
          tenantId: auth.tenantId,
          registerId: cashier.rid,
          cashierUserId: cashier.sub,
        },
        id,
      );
      if (!result.ok) {
        return reply.code(result.status).send({
          error: result.error,
          message: result.message,
          // B-reservas-5 F5 · APPOINTMENT_ALREADY_PAID lo trae para que
          // el TPV pueda llevar al ticket en vez de dejar un callejón.
          ...(result.ticketId ? { ticketId: result.ticketId } : {}),
        });
      }
      return reply
        .code(result.alreadyLinked ? 200 : 201)
        .send({ ticket: result.ticket });
    },
  );

  // ── Bloqueos puntuales ──────────────────────────────────────────────
  app.get(
    "/agenda/blocks",
    {
      preHandler: [requireOwnerOrCashier, ensureAgendaEnabled],
      schema: {
        querystring: {
          type: "object",
          required: ["from", "to"],
          additionalProperties: false,
          properties: {
            from: { type: "string", format: "date" },
            to: { type: "string", format: "date" },
          },
        },
      },
    },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const q = request.query as { from: string; to: string };
      const blocks = await store.listBlocks(
        auth.tenantId,
        wallTimeToUtc(q.from, "00:00"),
        wallTimeToUtc(q.to, "23:59"),
      );
      return {
        blocks: blocks.map((b) => ({
          // B-reservas-7a · `id` y `reason`: una ausencia se quita desde la
          // agenda tocándola (hace falta el id) y se pinta con su motivo.
          id: b.id ?? null,
          scope: b.scope,
          staffUserId: b.staffUserId,
          resourceId: b.resourceId,
          reason: b.reason ?? null,
          start: b.startsAt.toISOString(),
          end: b.endsAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    "/agenda/blocks",
    {
      preHandler: [requireOwnerOrCashier, ensureAgendaEnabled],
      schema: {
        body: {
          type: "object",
          required: ["scope", "date", "startTime", "endTime"],
          additionalProperties: false,
          properties: {
            scope: { type: "string", enum: ["CENTER", "STAFF", "RESOURCE"] },
            staffUserId: { type: ["string", "null"], format: "uuid" },
            resourceId: { type: ["string", "null"], format: "uuid" },
            date: { type: "string", format: "date" },
            startTime: { type: "string" },
            // B-reservas-7a · "24:00" es legal y es lo que manda la agenda
            // para una ausencia de DÍA ENTERO: `wallTimeToUtc` lo resuelve
            // a la medianoche de pared del día siguiente, así que el día
            // del cambio de hora cubre sus 23 o sus 25 horas. Restar 24 h
            // daría una hora de más o de menos justo esos dos días.
            endTime: { type: "string" },
            reason: { type: ["string", "null"], maxLength: 200 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        scope: "CENTER" | "STAFF" | "RESOURCE";
        staffUserId?: string | null;
        resourceId?: string | null;
        date: string;
        startTime: string;
        endTime: string;
        reason?: string | null;
      };
      if (body.scope === "STAFF" && !body.staffUserId) {
        return reply.code(400).send({
          error: "INVALID_BLOCK",
          message: "Un bloqueo de profesional requiere `staffUserId`.",
        });
      }
      if (body.scope === "RESOURCE" && !body.resourceId) {
        return reply.code(400).send({
          error: "INVALID_BLOCK",
          message: "Un bloqueo de recurso requiere `resourceId`.",
        });
      }
      const startsAt = wallTimeToUtc(body.date, body.startTime);
      const endsAt = wallTimeToUtc(body.date, body.endTime);
      if (endsAt.getTime() <= startsAt.getTime()) {
        return reply.code(400).send({
          error: "INVALID_BLOCK",
          message: "La hora de fin debe ser posterior a la de inicio.",
        });
      }
      const { id } = await store.createBlock({
        tenantId: auth.tenantId,
        scope: body.scope,
        staffUserId: body.scope === "STAFF" ? body.staffUserId! : null,
        resourceId: body.scope === "RESOURCE" ? body.resourceId! : null,
        startsAt,
        endsAt,
        reason: body.reason ?? null,
      });
      return reply.code(201).send({ id });
    },
  );

  app.delete(
    "/agenda/blocks/:id",
    {
      preHandler: [requireOwnerOrCashier, ensureAgendaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const ok = await store.deleteBlock(auth.tenantId, id);
      if (!ok) {
        return reply
          .code(404)
          .send({ error: "BLOCK_NOT_FOUND", message: "Bloqueo no encontrado." });
      }
      return { ok: true };
    },
  );

  // ── B-reservas-9 · Panel de salud ───────────────────────────────────
  //
  // El endpoint no calcula nada: le pide las seis tarjetas a `health.ts` y
  // devuelve lo que salga, cifra Y explicación Y consulta. El front pinta.
  app.get(
    "/agenda/health",
    { preHandler: [requireOwnerOrCashier, ensureAgendaEnabled] },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      return runAgendaHealth({
        prisma: prismaFor(),
        tenantId: auth.tenantId,
        now: clock.now(),
        logError: (key, err) =>
          request.log.error({ err, card: key }, "agenda-health card failed"),
      });
    },
  );

  // ── B-reservas-9 · La matriz servicio × profesional ─────────────────

  app.get(
    "/agenda/skill-matrix",
    { preHandler: [requireOwnerOrCashier, ensureAgendaEnabled] },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const matrix = await loadSkillMatrix(prismaFor(), auth.tenantId);
      // El front necesita saber si esta sesión puede escribir ANTES de
      // enseñar casillas que no van a guardar (H7: nada que prometa una
      // acción que no existe).
      return { ...matrix, editable: canConfigure(request) };
    },
  );

  // Lado A · desde la ficha del profesional: qué servicios da.
  app.put(
    "/agenda/skill-matrix/staff/:userId",
    {
      preHandler: [requireOwnerOrCashier, ensureAgendaEnabled, requireConfigRole],
      schema: {
        params: {
          type: "object",
          required: ["userId"],
          properties: { userId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["serviceIds"],
          additionalProperties: false,
          properties: {
            serviceIds: {
              type: "array",
              maxItems: 500,
              items: { type: "string", format: "uuid" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId } = request.params as { userId: string };
      const { serviceIds } = request.body as { serviceIds: string[] };
      try {
        const saved = await setSkillsForStaff(
          prismaFor(),
          auth.tenantId,
          userId,
          serviceIds,
        );
        return { userId, serviceIds: saved };
      } catch (err) {
        return sendSkillMatrixError(reply, err);
      }
    },
  );

  // Lado B · desde la ficha del servicio: quién lo da. Es la vía de un clic
  // desde la tarjeta 1 del panel.
  app.put(
    "/agenda/skill-matrix/service/:serviceId",
    {
      preHandler: [requireOwnerOrCashier, ensureAgendaEnabled, requireConfigRole],
      schema: {
        params: {
          type: "object",
          required: ["serviceId"],
          properties: { serviceId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["staffUserIds"],
          additionalProperties: false,
          properties: {
            staffUserIds: {
              type: "array",
              maxItems: 500,
              items: { type: "string", format: "uuid" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { serviceId } = request.params as { serviceId: string };
      const { staffUserIds } = request.body as { staffUserIds: string[] };
      try {
        const saved = await setStaffForService(
          prismaFor(),
          auth.tenantId,
          serviceId,
          staffUserIds,
        );
        return { serviceId, staffUserIds: saved };
      } catch (err) {
        return sendSkillMatrixError(reply, err);
      }
    },
  );
}

function canConfigure(request: FastifyRequest): boolean {
  const role = request.auth?.role;
  return role === "OWNER" || role === "MANAGER";
}

// Los dos lados fallan igual, con el mismo código y el mismo mensaje.
function sendSkillMatrixError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof SkillMatrixError) {
    return reply.code(err.status).send({ error: err.code, message: err.message });
  }
  throw err;
}
