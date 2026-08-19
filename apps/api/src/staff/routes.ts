// Endpoints de Personal + horarios (B-reservas-3).
//
// Base de la agenda multi-profesional (B4). El "personal" NO es una
// entidad nueva: es el `user` existente extendido (ADR-R1 — no hay tabla
// `Staff` paralela). Estas rutas gestionan el perfil de agenda, la matriz
// profesional × servicio y los turnos (plantillas `rrule` RFC 5545 +
// ventana de validez).
//
//   GET    /staff                              — usuarios del tenant como
//                                                candidatos a profesional
//                                                + su perfil/skills si los
//                                                tienen.
//   GET    /staff/services                     — servicios del tenant
//                                                (kind=SERVICE) para pintar
//                                                la matriz de skills.
//   PUT    /staff/:userId                       — alta/edición del perfil
//                                                (displayName, color, active).
//   DELETE /staff/:userId                       — quita al profesional de la
//                                                agenda (perfil + skills +
//                                                turnos, en transacción).
//   PUT    /staff/:userId/skills                — set de servicios que da.
//   GET    /staff/:userId/shifts                — turnos del profesional.
//   POST   /staff/:userId/shifts                — crear turno (rrule + validez).
//   PATCH  /staff/:userId/shifts/:shiftId       — editar turno.
//   DELETE /staff/:userId/shifts/:shiftId       — borrar turno.
//   GET    /staff/:userId/availability-template — expande la `rrule` a
//                                                franjas concretas para un
//                                                rango (lo consume el motor
//                                                de B4; interno).
//
// ADR-R6: todo el módulo se gatea por `Tenant.agendaEnabled` (columna
// propiedad de B-reservas-2). Si está OFF, cada endpoint responde 403.
// Aislamiento por fila: toda query filtra por `auth.tenantId`; las tablas
// hijas se acceden SIEMPRE a través de un `user` validado como del tenant.
// Vocabulario neutro: "profesional" (peluquero, esteticista, médico…).

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { RRule } from "rrule";
import type { Prisma } from "@mipiacetpv/db";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";

// "HH:MM" en 24h (00:00–23:59). Las horas son de pared (la recurrencia da
// los días; la hora la ponen start/end del turno).
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Cota del rango de expansión de `availability-template` para no generar
// expansiones desmedidas (un año largo es de sobra para la agenda).
const MAX_RANGE_DAYS = 366;

// ── Gate por capability flag (ADR-R6) ────────────────────────────────
// Corre DESPUÉS de la autenticación: `request.auth` ya está poblado.
async function ensureAgendaEnabled(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const auth = request.auth!;
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({
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

function notFoundUser(reply: FastifyReply) {
  return reply.code(404).send({
    error: "STAFF_USER_NOT_FOUND",
    message: "Usuario no encontrado.",
  });
}

// Valida que el `userId` es un usuario real del tenant (no borrado, no
// cajero técnico de pruebas). Puerta de aislamiento para todas las
// operaciones sobre perfil/skills/turnos.
async function loadTenantUser(tenantId: string, userId: string) {
  const prisma = getPrisma();
  return prisma.user.findFirst({
    where: { id: userId, tenantId, deletedAt: null, isTestCashier: false },
    select: { id: true, alias: true, email: true, role: true },
  });
}

// Carga el perfil de agenda del profesional (o null si el usuario aún no
// es profesional). Las skills y los turnos exigen perfil previo.
async function loadStaffProfile(tenantId: string, userId: string) {
  const prisma = getPrisma();
  return prisma.staffProfile.findFirst({
    where: { userId, tenantId },
    select: {
      userId: true,
      displayName: true,
      active: true,
      color: true,
    },
  });
}

function profileView(p: {
  userId: string;
  displayName: string;
  active: boolean;
  color: string | null;
}) {
  return {
    userId: p.userId,
    displayName: p.displayName,
    active: p.active,
    color: p.color,
  };
}

// Construye la RRule con un `dtstart` explícito. Lanza si el string no es
// una recurrencia RFC 5545 válida (formato propio = rechazado).
function buildRule(rruleStr: string, dtstart: Date): RRule {
  const options = RRule.parseString(rruleStr);
  if (options.freq === undefined) {
    throw new Error("RRULE sin FREQ");
  }
  return new RRule({ ...options, dtstart });
}

function isValidRrule(rruleStr: string): boolean {
  try {
    buildRule(rruleStr, new Date(Date.UTC(2020, 0, 1)));
    return true;
  } catch {
    return false;
  }
}

interface ExpandedSlot {
  date: string; // YYYY-MM-DD
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  shiftId: string;
  kind: "REGULAR" | "REINFORCEMENT" | "SWAP";
}

// Expande un turno recurrente a franjas concretas dentro de [windowFrom,
// windowTo], intersecando con su ventana de validez. NO cruza con citas ni
// bloqueos — eso es B4; aquí sólo la expansión de la plantilla.
function expandShiftToSlots(
  shift: {
    id: string;
    rrule: string;
    startTime: string;
    endTime: string;
    validFrom: Date;
    validUntil: Date | null;
    kind: "REGULAR" | "REINFORCEMENT" | "SWAP";
  },
  windowFrom: Date,
  windowTo: Date,
): ExpandedSlot[] {
  const start = new Date(
    Math.max(windowFrom.getTime(), shift.validFrom.getTime()),
  );
  const end = shift.validUntil
    ? new Date(Math.min(windowTo.getTime(), shift.validUntil.getTime()))
    : windowTo;
  if (start.getTime() > end.getTime()) return [];

  let rule: RRule;
  try {
    // dtstart = validFrom (medianoche UTC, @db.Date). La recurrencia
    // ancla ahí; las horas concretas las ponen start/endTime.
    rule = buildRule(shift.rrule, shift.validFrom);
  } catch {
    // Un turno con rrule corrupto no aporta franjas (defensivo; el POST
    // ya valida la rrule al crear).
    return [];
  }
  const occurrences = rule.between(start, end, true);
  return occurrences.map((d) => ({
    date: d.toISOString().slice(0, 10),
    startTime: shift.startTime,
    endTime: shift.endTime,
    shiftId: shift.id,
    kind: shift.kind,
  }));
}

const guard = { preHandler: [requireOwnerOrManager, ensureAgendaEnabled] };

export async function registerStaffRoutes(app: FastifyInstance): Promise<void> {
  // ── Candidatos a profesional (usuarios del tenant) ──────────────────
  app.get("/staff", guard, async (request: FastifyRequest) => {
    const auth = request.auth!;
    const prisma = getPrisma();
    const users = await prisma.user.findMany({
      where: {
        tenantId: auth.tenantId,
        role: { in: ["OWNER", "MANAGER", "CASHIER"] },
        deletedAt: null,
        isTestCashier: false,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        alias: true,
        email: true,
        role: true,
        staffProfile: {
          select: {
            userId: true,
            displayName: true,
            active: true,
            color: true,
          },
        },
        // Set de skills para prellenar la matriz servicio × profesional en
        // el panel sin una llamada por profesional.
        staffSkills: { select: { serviceId: true } },
      },
    });
    return {
      staff: users.map((u) => ({
        userId: u.id,
        alias: u.alias,
        email: u.email,
        role: u.role,
        // null → todavía no es profesional; el panel puede darlo de alta.
        profile: u.staffProfile ? profileView(u.staffProfile) : null,
        serviceIds: u.staffSkills.map((s) => s.serviceId),
        skillCount: u.staffSkills.length,
      })),
    };
  });

  // ── Servicios del tenant (para la matriz de skills) ─────────────────
  app.get("/staff/services", guard, async (request: FastifyRequest) => {
    const auth = request.auth!;
    const prisma = getPrisma();
    const services = await prisma.product.findMany({
      where: { tenantId: auth.tenantId, kind: "SERVICE", active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    // `id` = product.id (uuid) — misma clave que usa `staff_skill.serviceId`
    // y la extensión de B-reservas-2.
    return { services };
  });

  // ── Alta / edición de perfil de profesional ─────────────────────────
  app.put(
    "/staff/:userId",
    {
      preHandler: [requireOwnerOrManager, ensureAgendaEnabled],
      schema: {
        body: {
          type: "object",
          required: ["displayName"],
          additionalProperties: false,
          properties: {
            displayName: { type: "string", minLength: 1, maxLength: 120 },
            color: { type: ["string", "null"], maxLength: 32 },
            active: { type: "boolean" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId } = request.params as { userId: string };
      const body = request.body as {
        displayName: string;
        color?: string | null;
        active?: boolean;
      };
      const user = await loadTenantUser(auth.tenantId, userId);
      if (!user) return notFoundUser(reply);
      const prisma = getPrisma();

      const displayName = body.displayName.trim();
      const color = body.color?.trim() || null;
      const profile = await prisma.staffProfile.upsert({
        where: { userId },
        create: {
          userId,
          tenantId: auth.tenantId,
          displayName,
          color,
          active: body.active ?? true,
        },
        update: {
          displayName,
          color,
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
        select: {
          userId: true,
          displayName: true,
          active: true,
          color: true,
        },
      });
      return { profile: profileView(profile) };
    },
  );

  // ── Baja del profesional (perfil + skills + turnos) ─────────────────
  app.delete(
    "/staff/:userId",
    guard,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId } = request.params as { userId: string };
      const user = await loadTenantUser(auth.tenantId, userId);
      if (!user) return notFoundUser(reply);
      const prisma = getPrisma();
      // Transacción: quitar del todo la configuración de agenda de este
      // profesional. El `user` como credencial/cajero NO se toca.
      await prisma.$transaction([
        prisma.staffShift.deleteMany({ where: { userId, tenantId: auth.tenantId } }),
        prisma.staffSkill.deleteMany({ where: { userId, tenantId: auth.tenantId } }),
        prisma.staffProfile.deleteMany({ where: { userId, tenantId: auth.tenantId } }),
      ]);
      return reply.code(200).send({ ok: true });
    },
  );

  // ── Matriz de skills: set de servicios que da el profesional ────────
  app.put(
    "/staff/:userId/skills",
    {
      preHandler: [requireOwnerOrManager, ensureAgendaEnabled],
      schema: {
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
      const body = request.body as { serviceIds: string[] };
      const user = await loadTenantUser(auth.tenantId, userId);
      if (!user) return notFoundUser(reply);
      const prisma = getPrisma();

      const profile = await loadStaffProfile(auth.tenantId, userId);
      if (!profile) {
        return reply.code(409).send({
          error: "NO_STAFF_PROFILE",
          message: "Da de alta el perfil del profesional antes de asignar servicios.",
        });
      }

      // Deduplica y valida que cada serviceId es un servicio (kind=SERVICE)
      // del tenant. Un id desconocido/ajeno → 400 (no se ignora en silencio).
      const requested = [...new Set(body.serviceIds)];
      if (requested.length > 0) {
        const valid = await prisma.product.findMany({
          where: {
            tenantId: auth.tenantId,
            id: { in: requested },
            kind: "SERVICE",
          },
          select: { id: true },
        });
        if (valid.length !== requested.length) {
          return reply.code(400).send({
            error: "INVALID_SERVICE_ID",
            message: "Algún servicio no existe o no pertenece a este negocio.",
          });
        }
      }

      // Reemplazo del set completo en transacción.
      await prisma.$transaction([
        prisma.staffSkill.deleteMany({ where: { userId, tenantId: auth.tenantId } }),
        prisma.staffSkill.createMany({
          data: requested.map((serviceId) => ({
            userId,
            serviceId,
            tenantId: auth.tenantId,
          })),
        }),
      ]);
      return { serviceIds: requested };
    },
  );

  // ── Turnos: listado ─────────────────────────────────────────────────
  app.get(
    "/staff/:userId/shifts",
    guard,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId } = request.params as { userId: string };
      const user = await loadTenantUser(auth.tenantId, userId);
      if (!user) return notFoundUser(reply);
      const prisma = getPrisma();
      const shifts = await prisma.staffShift.findMany({
        where: { userId, tenantId: auth.tenantId },
        orderBy: [{ validFrom: "asc" }, { startTime: "asc" }],
        select: {
          id: true,
          rrule: true,
          startTime: true,
          endTime: true,
          validFrom: true,
          validUntil: true,
          kind: true,
        },
      });
      return { shifts: shifts.map(shiftView) };
    },
  );

  // ── Turnos: creación ────────────────────────────────────────────────
  app.post(
    "/staff/:userId/shifts",
    {
      preHandler: [requireOwnerOrManager, ensureAgendaEnabled],
      schema: {
        body: {
          type: "object",
          required: ["rrule", "startTime", "endTime", "validFrom"],
          additionalProperties: false,
          properties: {
            rrule: { type: "string", minLength: 1, maxLength: 500 },
            startTime: { type: "string" },
            endTime: { type: "string" },
            validFrom: { type: "string", format: "date" },
            validUntil: { type: ["string", "null"], format: "date" },
            kind: { type: "string", enum: ["REGULAR", "REINFORCEMENT", "SWAP"] },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId } = request.params as { userId: string };
      const body = request.body as {
        rrule: string;
        startTime: string;
        endTime: string;
        validFrom: string;
        validUntil?: string | null;
        kind?: "REGULAR" | "REINFORCEMENT" | "SWAP";
      };
      const user = await loadTenantUser(auth.tenantId, userId);
      if (!user) return notFoundUser(reply);
      const prisma = getPrisma();

      const profile = await loadStaffProfile(auth.tenantId, userId);
      if (!profile) {
        return reply.code(409).send({
          error: "NO_STAFF_PROFILE",
          message: "Da de alta el perfil del profesional antes de definir turnos.",
        });
      }

      const invalid = validateShiftInput(body);
      if (invalid) {
        return reply.code(400).send({ error: "INVALID_SHIFT", message: invalid });
      }

      const created = await prisma.staffShift.create({
        data: {
          userId,
          tenantId: auth.tenantId,
          rrule: body.rrule.trim(),
          startTime: body.startTime,
          endTime: body.endTime,
          validFrom: new Date(body.validFrom),
          validUntil: body.validUntil ? new Date(body.validUntil) : null,
          kind: body.kind ?? "REGULAR",
        },
        select: {
          id: true,
          rrule: true,
          startTime: true,
          endTime: true,
          validFrom: true,
          validUntil: true,
          kind: true,
        },
      });
      return reply.code(201).send({ shift: shiftView(created) });
    },
  );

  // ── Turnos: edición ─────────────────────────────────────────────────
  app.patch(
    "/staff/:userId/shifts/:shiftId",
    {
      preHandler: [requireOwnerOrManager, ensureAgendaEnabled],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            rrule: { type: "string", minLength: 1, maxLength: 500 },
            startTime: { type: "string" },
            endTime: { type: "string" },
            validFrom: { type: "string", format: "date" },
            validUntil: { type: ["string", "null"], format: "date" },
            kind: { type: "string", enum: ["REGULAR", "REINFORCEMENT", "SWAP"] },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId, shiftId } = request.params as {
        userId: string;
        shiftId: string;
      };
      const body = request.body as {
        rrule?: string;
        startTime?: string;
        endTime?: string;
        validFrom?: string;
        validUntil?: string | null;
        kind?: "REGULAR" | "REINFORCEMENT" | "SWAP";
      };
      const user = await loadTenantUser(auth.tenantId, userId);
      if (!user) return notFoundUser(reply);
      const prisma = getPrisma();

      const existing = await prisma.staffShift.findFirst({
        where: { id: shiftId, userId, tenantId: auth.tenantId },
        select: {
          id: true,
          rrule: true,
          startTime: true,
          endTime: true,
          validFrom: true,
          validUntil: true,
          kind: true,
        },
      });
      if (!existing) {
        return reply.code(404).send({
          error: "SHIFT_NOT_FOUND",
          message: "Turno no encontrado.",
        });
      }

      // Validar el resultado efectivo (merge de existing + cambios).
      const merged = {
        rrule: body.rrule?.trim() ?? existing.rrule,
        startTime: body.startTime ?? existing.startTime,
        endTime: body.endTime ?? existing.endTime,
        validFrom:
          body.validFrom ?? existing.validFrom.toISOString().slice(0, 10),
        validUntil:
          body.validUntil !== undefined
            ? body.validUntil
            : existing.validUntil?.toISOString().slice(0, 10) ?? null,
      };
      const invalid = validateShiftInput(merged);
      if (invalid) {
        return reply.code(400).send({ error: "INVALID_SHIFT", message: invalid });
      }

      const data: Prisma.StaffShiftUpdateInput = {};
      if (body.rrule !== undefined) data.rrule = body.rrule.trim();
      if (body.startTime !== undefined) data.startTime = body.startTime;
      if (body.endTime !== undefined) data.endTime = body.endTime;
      if (body.validFrom !== undefined) data.validFrom = new Date(body.validFrom);
      if (body.validUntil !== undefined)
        data.validUntil = body.validUntil ? new Date(body.validUntil) : null;
      if (body.kind !== undefined) data.kind = body.kind;

      const updated = await prisma.staffShift.update({
        where: { id: shiftId },
        data,
        select: {
          id: true,
          rrule: true,
          startTime: true,
          endTime: true,
          validFrom: true,
          validUntil: true,
          kind: true,
        },
      });
      return { shift: shiftView(updated) };
    },
  );

  // ── Turnos: borrado ─────────────────────────────────────────────────
  app.delete(
    "/staff/:userId/shifts/:shiftId",
    guard,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId, shiftId } = request.params as {
        userId: string;
        shiftId: string;
      };
      const user = await loadTenantUser(auth.tenantId, userId);
      if (!user) return notFoundUser(reply);
      const prisma = getPrisma();
      const deleted = await prisma.staffShift.deleteMany({
        where: { id: shiftId, userId, tenantId: auth.tenantId },
      });
      if (deleted.count === 0) {
        return reply.code(404).send({
          error: "SHIFT_NOT_FOUND",
          message: "Turno no encontrado.",
        });
      }
      return reply.code(200).send({ ok: true });
    },
  );

  // ── Expansión de la semana tipo a franjas concretas (para B4) ───────
  app.get(
    "/staff/:userId/availability-template",
    {
      preHandler: [requireOwnerOrManager, ensureAgendaEnabled],
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId } = request.params as { userId: string };
      const q = request.query as { from: string; to: string };
      const user = await loadTenantUser(auth.tenantId, userId);
      if (!user) return notFoundUser(reply);

      const windowFrom = new Date(`${q.from}T00:00:00.000Z`);
      const windowTo = new Date(`${q.to}T23:59:59.999Z`);
      if (windowFrom.getTime() > windowTo.getTime()) {
        return reply.code(400).send({
          error: "INVALID_RANGE",
          message: "`from` debe ser anterior o igual a `to`.",
        });
      }
      const rangeDays =
        (windowTo.getTime() - windowFrom.getTime()) / 86_400_000;
      if (rangeDays > MAX_RANGE_DAYS) {
        return reply.code(400).send({
          error: "RANGE_TOO_LARGE",
          message: `El rango no puede superar ${MAX_RANGE_DAYS} días.`,
        });
      }

      const prisma = getPrisma();
      const shifts = await prisma.staffShift.findMany({
        where: {
          userId,
          tenantId: auth.tenantId,
          // Sólo turnos cuya validez solapa el rango pedido.
          validFrom: { lte: windowTo },
          OR: [{ validUntil: null }, { validUntil: { gte: windowFrom } }],
        },
        select: {
          id: true,
          rrule: true,
          startTime: true,
          endTime: true,
          validFrom: true,
          validUntil: true,
          kind: true,
        },
      });

      const slots = shifts
        .flatMap((s) => expandShiftToSlots(s, windowFrom, windowTo))
        // Orden estable por fecha + hora de inicio.
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            a.startTime.localeCompare(b.startTime),
        );

      return { userId, from: q.from, to: q.to, slots };
    },
  );
}

function shiftView(s: {
  id: string;
  rrule: string;
  startTime: string;
  endTime: string;
  validFrom: Date;
  validUntil: Date | null;
  kind: "REGULAR" | "REINFORCEMENT" | "SWAP";
}) {
  return {
    id: s.id,
    rrule: s.rrule,
    startTime: s.startTime,
    endTime: s.endTime,
    validFrom: s.validFrom.toISOString().slice(0, 10),
    validUntil: s.validUntil ? s.validUntil.toISOString().slice(0, 10) : null,
    kind: s.kind,
  };
}

// Valida horas, orden start<end, rrule RFC 5545 y validFrom<=validUntil.
// Devuelve el mensaje de error o null si todo es válido.
function validateShiftInput(input: {
  rrule: string;
  startTime: string;
  endTime: string;
  validFrom: string;
  validUntil?: string | null;
}): string | null {
  if (!TIME_RE.test(input.startTime) || !TIME_RE.test(input.endTime)) {
    return "Las horas deben tener formato HH:MM (00:00–23:59).";
  }
  if (input.startTime >= input.endTime) {
    return "La hora de inicio debe ser anterior a la de fin.";
  }
  if (!isValidRrule(input.rrule)) {
    return "La recurrencia (rrule) no es válida (RFC 5545).";
  }
  if (input.validUntil && input.validFrom > input.validUntil) {
    return "`validFrom` debe ser anterior o igual a `validUntil`.";
  }
  return null;
}
