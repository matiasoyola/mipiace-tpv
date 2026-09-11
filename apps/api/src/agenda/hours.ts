// B-reservas-7a · Los ajustes de agenda del propietario: el horario del
// centro, los días especiales y la retícula.
//
//   GET    /admin/agenda/hours           — la semana, los días y la retícula
//   PUT    /admin/agenda/hours/week      — reemplaza la semana tipo
//   PUT    /admin/agenda/hours/slot      — la retícula (15 o 30)
//   POST   /admin/agenda/hours/days      — alta/edición de un día especial
//   DELETE /admin/agenda/hours/days/:id  — quitar un día especial
//   POST   /admin/agenda/hours/impact    — SIMULACRO: qué citas quedan fuera
//
// Gate `agendaEnabled` en RUTA además de en UI (ADR-R6), como el resto del
// módulo. Lectura para owner/manager, escritura sólo para el owner.
//
// ESTE MÓDULO ES EL DUEÑO de `tenants.agenda_slot_minutes`. No se toca
// `admin/tenant-settings.ts`: dos sitios escribiendo la misma columna es
// cómo se acaba con dos verdades.
//
// LAS CITAS YA DADAS NO SE MUEVEN. Ni un día especial, ni un horario más
// corto, ni un cambio de retícula cancelan o mueven nada: `/impact` dice
// cuáles quedarían fuera para que el front las enseñe ANTES de confirmar, y
// el operador decide. Una cita fuera de la retícula sigue siendo válida y
// cobrable; sólo al MOVERLA se le exige un inicio en la retícula nueva.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { requireOwner, requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import {
  isoWeekday,
  resolveCenterSchedule,
  wallDatesBetween,
  type CenterDayRow,
  type CenterHoursRow,
} from "./center-hours.js";
import {
  CENTER_TZ,
  timeToMinutes,
  utcToWallDate,
  utcToWallTime,
  wallTimeToUtc,
} from "./time.js";

// Hasta dónde mira el simulacro de impacto. Un barrido sin cota sobre un
// centro con dos años de agenda no es una consulta, es un susto — y no
// aporta: lo que hay que avisar son las citas de las próximas semanas.
const IMPACT_DAYS = 90;

// Los estados VIVOS. Una cancelada o una no-show que quede fuera del
// horario nuevo no hay que avisarla: ya no va a venir nadie.
const LIVE_STATUSES = ["PENDING", "CONFIRMED", "IN_SERVICE"] as const;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** El día de pared de hoy, para acotar el simulacro. */
function hoyWall(): string {
  return utcToWallDate(new Date(), CENTER_TZ);
}

function plusDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

interface WeekRowInput {
  weekday: number;
  openTime: string;
  closeTime: string;
}

/** Valida la semana tipo entera. Devuelve el mensaje del primer problema,
 *  o `null`. Se valida ANTES de borrar nada: reemplazar la semana por una
 *  inválida dejaría el centro cerrado sin que nadie lo pidiera. */
function validateWeek(rows: WeekRowInput[]): string | null {
  for (const r of rows) {
    if (r.weekday < 1 || r.weekday > 7) {
      return "El día de la semana tiene que ir de 1 (lunes) a 7 (domingo).";
    }
    if (!HHMM.test(r.openTime) || !HHMM.test(r.closeTime)) {
      return "Las horas se escriben como HH:MM (por ejemplo 09:00).";
    }
    if (timeToMinutes(r.openTime) >= timeToMinutes(r.closeTime)) {
      return "La hora de cierre tiene que ser posterior a la de apertura.";
    }
  }
  // Dos tramos del mismo día que se pisan no son un horario partido: es un
  // error de dedo que deja al operador creyendo que ha puesto dos.
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!;
      const b = rows[j]!;
      if (a.weekday !== b.weekday) continue;
      if (
        timeToMinutes(a.openTime) < timeToMinutes(b.closeTime) &&
        timeToMinutes(b.openTime) < timeToMinutes(a.closeTime)
      ) {
        return "Hay dos tramos del mismo día que se solapan.";
      }
    }
  }
  return null;
}

// Una cita viva, ya traducida a hora de pared del centro.
export interface LiveAppointment {
  id: string;
  date: string; // YYYY-MM-DD de pared
  wallTime: string; // "HH:MM" de pared
  clientName: string | null;
}

export type OutsideReason = "CLOSED" | "OUT_OF_HOURS" | "OFF_GRID";

export interface OutsideAppointment extends LiveAppointment {
  reason: OutsideReason;
}

/**
 * Cuáles de estas citas quedarían FUERA con el horario y la retícula
 * propuestos. Pura, para que la decisión se pueda probar sin Postgres.
 *
 * NO cancela ni mueve nada: es un simulacro. Y el orden de las causas
 * importa, porque es lo que el front le lee al operador: primero el día
 * cerrado (la más gorda), luego la hora fuera del horario, y sólo si la
 * cita cabe en el horario se mira la retícula.
 *
 * Un centro SIN techo (`open === null`) no deja fuera a nadie por horario:
 * un tenant que no configura nada no puede ver avisos de este simulacro.
 */
export function appointmentsOutside(
  appointments: LiveAppointment[],
  schedule: Map<string, { open: Array<{ startTime: string; endTime: string }> | null }>,
  slotMinutes: number | null,
): OutsideAppointment[] {
  const out: OutsideAppointment[] = [];
  for (const a of appointments) {
    const min = timeToMinutes(a.wallTime);
    const hours = schedule.get(a.date);
    let reason: OutsideReason | null = null;
    if (hours && hours.open !== null) {
      if (hours.open.length === 0) reason = "CLOSED";
      else if (
        !hours.open.some(
          (o) =>
            timeToMinutes(o.startTime) <= min &&
            min < timeToMinutes(o.endTime),
        )
      ) {
        reason = "OUT_OF_HOURS";
      }
    }
    if (reason === null && slotMinutes !== null && min % slotMinutes !== 0) {
      reason = "OFF_GRID";
    }
    if (reason) out.push({ ...a, reason });
  }
  return out;
}

export async function registerAgendaHoursRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guardRead = [requireOwnerOrManager, ensureAgendaEnabled];
  const guardWrite = [requireOwner, ensureAgendaEnabled];

  // ── Leer ────────────────────────────────────────────────────────────
  app.get("/admin/agenda/hours", { preHandler: guardRead }, async (request) => {
    const auth = request.auth!;
    const prisma = getPrisma();
    const [tenant, week, days] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: { agendaSlotMinutes: true },
      }),
      prisma.centerHours.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: [{ weekday: "asc" }, { openTime: "asc" }],
        select: {
          id: true,
          weekday: true,
          openTime: true,
          closeTime: true,
          validFrom: true,
          validUntil: true,
        },
      }),
      prisma.centerDay.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: { date: "asc" },
        select: {
          id: true,
          date: true,
          closed: true,
          name: true,
          openTime: true,
          closeTime: true,
        },
      }),
    ]);
    return {
      slotMinutes: tenant.agendaSlotMinutes,
      week: week.map((r) => ({
        id: r.id,
        weekday: r.weekday,
        openTime: r.openTime,
        closeTime: r.closeTime,
        validFrom: isoDate(r.validFrom),
        validUntil: r.validUntil ? isoDate(r.validUntil) : null,
      })),
      days: days.map((d) => ({
        id: d.id,
        date: isoDate(d.date),
        closed: d.closed,
        name: d.name,
        openTime: d.openTime,
        closeTime: d.closeTime,
      })),
    };
  });

  // ── La semana tipo ──────────────────────────────────────────────────
  //
  // Se reemplaza entera. Es una tabla de siete filas que el operador ve de
  // un vistazo: un CRUD fila a fila le obligaría a acordarse de qué borró.
  app.put(
    "/admin/agenda/hours/week",
    {
      preHandler: guardWrite,
      schema: {
        body: {
          type: "object",
          required: ["rows"],
          additionalProperties: false,
          properties: {
            rows: {
              type: "array",
              maxItems: 28, // siete días × cuatro tramos, de sobra
              items: {
                type: "object",
                required: ["weekday", "openTime", "closeTime"],
                additionalProperties: false,
                properties: {
                  weekday: { type: "integer", minimum: 1, maximum: 7 },
                  openTime: { type: "string" },
                  closeTime: { type: "string" },
                },
              },
            },
            validFrom: { type: "string", format: "date" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        rows: WeekRowInput[];
        validFrom?: string;
      };
      const invalid = validateWeek(body.rows);
      if (invalid) {
        return reply
          .code(400)
          .send({ error: "INVALID_HOURS", message: invalid });
      }
      const validFrom = new Date(
        `${body.validFrom ?? "1970-01-01"}T00:00:00.000Z`,
      );
      const prisma = getPrisma();
      await prisma.$transaction([
        prisma.centerHours.deleteMany({ where: { tenantId: auth.tenantId } }),
        prisma.centerHours.createMany({
          data: body.rows.map((r) => ({
            tenantId: auth.tenantId,
            weekday: r.weekday,
            openTime: r.openTime,
            closeTime: r.closeTime,
            validFrom,
            validUntil: null,
          })),
        }),
      ]);
      return reply.code(200).send({ ok: true, count: body.rows.length });
    },
  );

  // ── La retícula ─────────────────────────────────────────────────────
  app.put(
    "/admin/agenda/hours/slot",
    {
      preHandler: guardWrite,
      schema: {
        body: {
          type: "object",
          required: ["slotMinutes"],
          additionalProperties: false,
          properties: {
            // El CHECK de verdad vive en la base de datos; esto es la
            // puerta de delante, para que el 400 llegue con una frase.
            slotMinutes: { type: "integer", enum: [15, 30] },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { slotMinutes } = request.body as { slotMinutes: number };
      await getPrisma().tenant.update({
        where: { id: auth.tenantId },
        data: { agendaSlotMinutes: slotMinutes },
      });
      return reply.code(200).send({ ok: true, slotMinutes });
    },
  );

  // ── Los días especiales ─────────────────────────────────────────────
  app.post(
    "/admin/agenda/hours/days",
    {
      preHandler: guardWrite,
      schema: {
        body: {
          type: "object",
          required: ["date", "name"],
          additionalProperties: false,
          properties: {
            date: { type: "string", format: "date" },
            // Por defecto CERRADO: el caso corriente es el festivo, y el
            // alta tiene que caber en dos toques (fecha y guardar).
            closed: { type: "boolean" },
            name: { type: "string", minLength: 1, maxLength: 120 },
            openTime: { type: ["string", "null"] },
            closeTime: { type: ["string", "null"] },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        date: string;
        closed?: boolean;
        name: string;
        openTime?: string | null;
        closeTime?: string | null;
      };
      const closed = body.closed ?? true;
      if (!closed) {
        if (!body.openTime || !body.closeTime) {
          return reply.code(400).send({
            error: "INVALID_CENTER_DAY",
            message:
              "Un día con horario propio necesita hora de apertura y de cierre.",
          });
        }
        if (!HHMM.test(body.openTime) || !HHMM.test(body.closeTime)) {
          return reply.code(400).send({
            error: "INVALID_CENTER_DAY",
            message: "Las horas se escriben como HH:MM (por ejemplo 08:30).",
          });
        }
        if (timeToMinutes(body.openTime) >= timeToMinutes(body.closeTime)) {
          return reply.code(400).send({
            error: "INVALID_CENTER_DAY",
            message:
              "La hora de cierre tiene que ser posterior a la de apertura.",
          });
        }
      }
      if (!body.name.trim()) {
        return reply.code(400).send({
          error: "INVALID_CENTER_DAY",
          // El nombre es lo que la rejilla dice en voz alta.
          message: "Ponle nombre: es lo que la agenda enseña ese día.",
        });
      }
      const date = new Date(`${body.date}T00:00:00.000Z`);
      const data = {
        closed,
        name: body.name.trim(),
        openTime: closed ? null : body.openTime!,
        closeTime: closed ? null : body.closeTime!,
      };
      // Un día especial por fecha (`@@unique`): volver a darlo de alta es
      // editarlo, no un error que obligue a borrar primero.
      const saved = await getPrisma().centerDay.upsert({
        where: { tenantId_date: { tenantId: auth.tenantId, date } },
        create: { tenantId: auth.tenantId, date, ...data },
        update: data,
        select: {
          id: true,
          date: true,
          closed: true,
          name: true,
          openTime: true,
          closeTime: true,
        },
      });
      return reply.code(201).send({
        day: { ...saved, date: isoDate(saved.date) },
      });
    },
  );

  app.delete(
    "/admin/agenda/hours/days/:id",
    {
      preHandler: guardWrite,
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
      const { count } = await getPrisma().centerDay.deleteMany({
        where: { id, tenantId: auth.tenantId },
      });
      if (count === 0) {
        return reply.code(404).send({
          error: "CENTER_DAY_NOT_FOUND",
          message: "Ese día especial ya no está.",
        });
      }
      return { ok: true };
    },
  );

  // ── El simulacro: qué citas quedarían fuera ─────────────────────────
  //
  // No escribe nada. Recibe el cambio PROPUESTO y devuelve las citas vivas
  // que quedarían fuera, para que el front las enseñe antes de confirmar:
  // «ese día hay 3 citas: 10:00 Cristina, 11:30 Manoli…, se quedan como
  // están, avísalas».
  app.post(
    "/admin/agenda/hours/impact",
    {
      preHandler: guardRead,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            // Uno de los tres, o varios a la vez.
            week: {
              type: "array",
              maxItems: 28,
              items: {
                type: "object",
                required: ["weekday", "openTime", "closeTime"],
                additionalProperties: false,
                properties: {
                  weekday: { type: "integer", minimum: 1, maximum: 7 },
                  openTime: { type: "string" },
                  closeTime: { type: "string" },
                },
              },
            },
            day: {
              type: "object",
              required: ["date"],
              additionalProperties: false,
              properties: {
                date: { type: "string", format: "date" },
                closed: { type: "boolean" },
                name: { type: "string", maxLength: 120 },
                openTime: { type: ["string", "null"] },
                closeTime: { type: ["string", "null"] },
              },
            },
            slotMinutes: { type: "integer", enum: [15, 30] },
          },
        },
      },
    },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const body = request.body as {
        week?: WeekRowInput[];
        day?: {
          date: string;
          closed?: boolean;
          name?: string;
          openTime?: string | null;
          closeTime?: string | null;
        };
        slotMinutes?: number;
      };
      const prisma = getPrisma();

      // El rango del barrido. Un día especial sólo afecta a su día; lo
      // demás se mira de hoy a +90.
      const desde = body.day ? body.day.date : hoyWall();
      const hasta = body.day
        ? body.day.date
        : plusDays(desde, IMPACT_DAYS);
      // Un día especial en el pasado no tiene a quién avisar.
      if (body.day && body.day.date < hoyWall()) {
        return { count: 0, appointments: [], scannedFrom: desde, scannedTo: hasta };
      }

      // El horario que RESULTARÍA del cambio: la semana propuesta si la
      // hay, si no la que está puesta; más el día especial propuesto
      // encima de los que ya existen.
      const semanaActual = await prisma.centerHours.findMany({
        where: { tenantId: auth.tenantId },
        select: {
          weekday: true,
          openTime: true,
          closeTime: true,
          validFrom: true,
          validUntil: true,
        },
      });
      const week: CenterHoursRow[] = body.week
        ? body.week.map((r) => ({
            weekday: r.weekday,
            openTime: r.openTime,
            closeTime: r.closeTime,
            validFrom: "1970-01-01",
            validUntil: null,
          }))
        : semanaActual.map((r) => ({
            weekday: r.weekday,
            openTime: r.openTime,
            closeTime: r.closeTime,
            validFrom: isoDate(r.validFrom),
            validUntil: r.validUntil ? isoDate(r.validUntil) : null,
          }));

      const diasActuales = await prisma.centerDay.findMany({
        where: {
          tenantId: auth.tenantId,
          date: {
            gte: new Date(`${desde}T00:00:00.000Z`),
            lte: new Date(`${hasta}T00:00:00.000Z`),
          },
        },
        select: {
          date: true,
          closed: true,
          name: true,
          openTime: true,
          closeTime: true,
        },
      });
      const days: CenterDayRow[] = diasActuales
        .map((d) => ({
          date: isoDate(d.date),
          closed: d.closed,
          name: d.name,
          openTime: d.openTime,
          closeTime: d.closeTime,
        }))
        .filter((d) => d.date !== body.day?.date);
      if (body.day) {
        const closed = body.day.closed ?? true;
        days.push({
          date: body.day.date,
          closed,
          name: body.day.name ?? "",
          openTime: closed ? null : (body.day.openTime ?? null),
          closeTime: closed ? null : (body.day.closeTime ?? null),
        });
      }
      const schedule = resolveCenterSchedule(week, days, desde, hasta);

      // Las citas vivas del rango. `timeslot` es `tstzrange` y Prisma no
      // la lee: se consulta con SQL crudo, como todo lo demás del módulo.
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          starts_at: Date;
          client_first: string | null;
          client_last: string | null;
        }>
      >(
        `SELECT a.id,
                lower(a.timeslot) AS starts_at,
                c.first_name AS client_first,
                c.last_name  AS client_last
           FROM appointments a
           LEFT JOIN clients c ON c.id = a.client_id
          WHERE a.tenant_id = $1::uuid
            AND a.status = ANY($2::"AppointmentStatus"[])
            AND a.timeslot && tstzrange($3::timestamptz, $4::timestamptz, '[)')
          ORDER BY lower(a.timeslot) ASC`,
        auth.tenantId,
        LIVE_STATUSES,
        wallTimeToUtc(desde, "00:00", CENTER_TZ).toISOString(),
        wallTimeToUtc(plusDays(hasta, 1), "00:00", CENTER_TZ).toISOString(),
      );

      const fuera = appointmentsOutside(
        rows.map((r) => ({
          id: r.id,
          date: utcToWallDate(r.starts_at, CENTER_TZ),
          wallTime: utcToWallTime(r.starts_at, CENTER_TZ),
          clientName:
            [r.client_first, r.client_last].filter(Boolean).join(" ").trim() ||
            null,
        })),
        schedule,
        body.slotMinutes ?? null,
      );
      return {
        count: fuera.length,
        appointments: fuera,
        scannedFrom: desde,
        scannedTo: hasta,
      };
    },
  );

  // ── ¿Tiene alguien turno a esa hora ese día? ────────────────────────
  //
  // Al abrir un día especial MÁS TEMPRANO que el turno de todo el personal,
  // la pantalla lo dice y ofrece el refuerzo. Sin esto, el owner marca el
  // sábado de la boda de 8:30 a 14:00 y la agenda sigue sin ofrecer las
  // 8:30, porque el techo recorta pero no crea turno.
  app.get(
    "/admin/agenda/hours/coverage",
    {
      preHandler: guardRead,
      schema: {
        querystring: {
          type: "object",
          required: ["date", "time"],
          additionalProperties: false,
          properties: {
            date: { type: "string", format: "date" },
            time: { type: "string" },
          },
        },
      },
    },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const q = request.query as { date: string; time: string };
      const prisma = getPrisma();
      const profiles = await prisma.staffProfile.findMany({
        where: { tenantId: auth.tenantId, active: true },
        select: { userId: true, displayName: true },
      });
      if (profiles.length === 0) {
        return { covered: false, staff: [], candidates: [] };
      }
      // Se reutiliza el mismo expander de turnos del motor a través del
      // store: si la cobertura se calculara con otra aritmética, la
      // pantalla diría una cosa y la agenda haría otra.
      const { createAgendaStore } = await import("./store.js");
      const store = createAgendaStore(prisma);
      const slots = await store.getTemplateSlots(
        auth.tenantId,
        profiles.map((p) => p.userId),
        q.date,
        q.date,
      );
      const minuto = timeToMinutes(q.time);
      const cubren = new Set(
        slots
          .filter(
            (s) =>
              timeToMinutes(s.startTime) <= minuto &&
              minuto < timeToMinutes(s.endTime),
          )
          .map((s) => s.userId),
      );
      return {
        covered: cubren.size > 0,
        weekday: isoWeekday(q.date),
        staff: profiles
          .filter((p) => cubren.has(p.userId))
          .map((p) => ({ userId: p.userId, displayName: p.displayName })),
        // A quién se le puede añadir el refuerzo de un día.
        candidates: profiles
          .filter((p) => !cubren.has(p.userId))
          .map((p) => ({ userId: p.userId, displayName: p.displayName })),
      };
    },
  );
}

// Se exporta para los tests: la cota del barrido es una decisión, no un
// número escondido.
export { IMPACT_DAYS, validateWeek, wallDatesBetween };
