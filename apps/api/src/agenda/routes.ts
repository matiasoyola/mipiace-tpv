// API de la agenda (B-koibox-4, modo CITA). Aislamiento por tenant + gate
// `ensureAgendaEnabled` (403 AGENDA_DISABLED, mismo patrón que B3), a nivel
// de RUTA (no sólo de UI). Auth `requireOwnerOrCashier`: la agenda la usa el
// cajero del TPV (buscar hueco, alta, "en sala", cobrar) tanto como el
// owner/manager.
//
//   GET   /agenda?date= | ?from=&to=          — citas por profesional (columnas)
//   POST  /agenda/availability                — buscar hueco → slots[]
//   POST  /agenda/appointments                — alta (presencial = confirmada)
//   PATCH /agenda/appointments/:id            — transición de estado / mover
//   POST  /agenda/appointments/:id/checkout   — cita → caja (ticket pre-poblado)
//   GET   /agenda/blocks?from=&to=            — bloqueos puntuales
//   POST  /agenda/blocks                      — crear bloqueo puntual
//   DELETE /agenda/blocks/:id                 — borrar bloqueo
//
// Motor agnóstico: cero `if(businessType)`, vocabulario neutro. Lo específico
// de cita vive en `CitaMode`; el núcleo (engine/store/GiST) es compartido.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { requireOwnerOrCashier } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import type { PrismaClient } from "@mipiacetpv/db";
import { checkoutAppointment } from "./checkout.js";
import { createCitaEngine, type BookingEngine } from "./engine.js";
import { createAgendaStore, type AgendaStore } from "./store.js";
import { wallTimeToUtc } from "./time.js";
import type { AppointmentStatus } from "./types.js";

// Minutos por defecto del hold PENDING (reserva no presencial).
const HOLD_TTL_MINUTES = 10;

// Gate por capability flag (ADR-K6). Corre tras la autenticación.
async function ensureAgendaEnabled(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const auth = request.auth!;
  const tenant = await getPrisma().tenant.findUnique({
    where: { id: auth.tenantId },
    select: { agendaEnabled: true },
  });
  if (!tenant?.agendaEnabled) {
    reply.code(403).send({
      error: "AGENDA_DISABLED",
      message: "El módulo de agenda no está activado para este negocio.",
    });
  }
}

export interface AgendaRoutesOptions {
  // Overrides para tests (fake store/prisma). En producción se construyen
  // desde `getPrisma()`.
  store?: AgendaStore;
  prisma?: PrismaClient;
}

export async function registerAgendaRoutes(
  app: FastifyInstance,
  opts: AgendaRoutesOptions = {},
): Promise<void> {
  const store: AgendaStore =
    opts.store ?? createAgendaStore(opts.prisma ?? getPrisma());
  const engine: BookingEngine = createCitaEngine(store);
  const prismaFor = (): PrismaClient => opts.prisma ?? getPrisma();

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
      return { from: fromDate, to: toDate, staff, appointments };
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
      const slots = await engine.availability({
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
        source?: "PRESENCIAL" | "WEB" | "PHONE" | "GIFT_REDEMPTION";
        notes?: string | null;
      };
      const source = body.source ?? "PRESENCIAL";
      // Presencial = confirmada directa; el resto entra como hold PENDING.
      const confirmed = source === "PRESENCIAL";
      const result = await engine.hold({
        tenantId: auth.tenantId,
        externalId: body.externalId ?? null,
        clientId: body.clientId ?? null,
        items: body.items,
        start: body.start,
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
      const code = result.reason === "NO_REQUIREMENTS" ? 400 : 409;
      return reply.code(code).send({
        error: result.reason,
        message:
          result.reason === "NO_REQUIREMENTS"
            ? "Algún servicio no es agendable (sin duración configurada)."
            : "El hueco ya no está disponible.",
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
        const moved = await engine.reschedule(auth.tenantId, id, body.start);
        if (moved.ok) return { appointment: moved.appointment };
        if (moved.reason === "NOT_FOUND") {
          return reply.code(404).send({
            error: "APPOINTMENT_NOT_FOUND",
            message: "Cita no encontrada.",
          });
        }
        return reply.code(409).send({
          error: moved.reason,
          message: "No se pudo mover a ese hueco.",
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
          updated = await engine.confirm(auth.tenantId, id);
          break;
        case "IN_SERVICE":
          updated = await engine.setInService(auth.tenantId, id);
          break;
        case "COMPLETED":
          updated = await engine.complete(auth.tenantId, id);
          break;
        case "NO_SHOW":
          updated = await engine.noShow(auth.tenantId, id);
          break;
        case "CANCELLED":
          updated = await engine.cancel(auth.tenantId, id);
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
        return reply
          .code(result.status)
          .send({ error: result.error, message: result.message });
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
          scope: b.scope,
          staffUserId: b.staffUserId,
          resourceId: b.resourceId,
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
}
