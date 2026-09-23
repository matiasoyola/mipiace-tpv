// F1 · la API del empleado (ADR-018).
//
// Prefijo `/fichaje/v1` desde el primer día, y no por costumbre: ESTA es
// la API que consumirá la app nativa de la fase 2. Cuando llegue, la PWA
// de hoy seguirá hablando con la v1 mientras la app migre a lo que haga
// falta. Versionar después es una migración; versionar antes es un
// prefijo.
//
// Tres decisiones que atraviesan el fichero:
//
//   1. **Aislamiento por empleado Y por tenant, en cada consulta.** El
//      token del móvil identifica a UNA persona. Pedir el fichaje de otro
//      devuelve 404 y no 403: un 403 confirmaría que ese fichaje existe.
//
//   2. **La hora que cuenta es la del toque** (`deviceAt`), no la de
//      llegada. Es la razón de ser de la cola offline del móvil. Lo único
//      que se acota es el futuro: un reloj adelantado no puede crear un
//      fichaje de mañana (ver `resolveTapTime`).
//
//   3. **Idempotencia por `externalId`**, como el outbox del TPV. El
//      mismo toque reenviado no crea un segundo tramo; devuelve el que ya
//      existe con `duplicate: true`.

import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { ensureFichajeEnabled } from "../lib/fichaje-gate.js";
import {
  generateEmployeeToken,
  hashEmployeeToken,
  requireEmployeeDevice,
} from "./auth.js";
import {
  recordTimeEntryCorrection,
  correctionKind,
  listTimeEntryCorrections,
  TimeCorrectionRejectedError,
  CORRECTION_REASONS,
  type CorrectableField,
  type CorrectionReason,
} from "./corrections.js";
import { FICHAJE_TZ, localDate, monthRange, suggestedExitAt } from "./time.js";
import { groupByDay, toEntryView, totalMinutes, type TimeEntryRow } from "./view.js";

/** Cuántos días atrás puede corregir el PROPIO empleado. Más allá, sólo la
 *  empresa. No es desconfianza: es que a los dos meses ya nadie se acuerda,
 *  y una corrección que no se recuerda no es una corrección. */
export const EMPLOYEE_CORRECTION_WINDOW_DAYS = 30;

/** Historial que mira la propuesta de salida olvidada. */
const EXIT_HISTORY_DAYS = 30;

/** Margen de reloj adelantado que se tolera antes de acotar al servidor. */
export const CLOCK_AHEAD_TOLERANCE_MS = 5 * 60_000;

/**
 * Una hora corregida no puede estar en el futuro.
 *
 * El registro de jornada dice lo que PASÓ. Con el selector de horas del
 * móvil es un resbalón de un dedo dejar dicho que se salió a las 20:00
 * siendo las 11:00, y eso son nueve horas que nadie ha trabajado en un
 * documento que se le enseña a la Inspección. El mismo margen de cinco
 * minutos que el toque, por la misma razón: relojes que no coinciden.
 */
export function isInFuture(value: Date, serverNow: Date): boolean {
  return value.getTime() > serverNow.getTime() + CLOCK_AHEAD_TOLERANCE_MS;
}

const ENTRY_SELECT = {
  id: true,
  employeeId: true,
  startedAt: true,
  endedAt: true,
  startedDeviceAt: true,
  startedServerAt: true,
  endedDeviceAt: true,
  endedServerAt: true,
  startSource: true,
  endSource: true,
} as const;

/**
 * La hora del toque, acotada por arriba.
 *
 * Hacia el pasado NO se acota: un fichaje que llega tres días tarde desde
 * el sótano de un colegio es exactamente el caso que este bloque
 * protege, y su hora buena es la del toque por vieja que sea.
 *
 * Hacia el futuro sí: un móvil con el reloj adelantado crearía un tramo
 * que todavía no ha pasado, y con él un total de jornada inventado. Se
 * acota al instante del servidor — y la divergencia sigue visible, porque
 * `*DeviceAt` guarda el valor crudo y la marca "enviado sin conexión"
 * salta sola.
 */
export function resolveTapTime(deviceAt: Date, serverNow: Date): Date {
  if (deviceAt.getTime() > serverNow.getTime() + CLOCK_AHEAD_TOLERANCE_MS) {
    return serverNow;
  }
  return deviceAt;
}

async function correctionCounts(
  prisma: ReturnType<typeof getPrisma>,
  entryIds: string[],
): Promise<Map<string, number>> {
  if (entryIds.length === 0) return new Map();
  const rows = await prisma.timeEntryCorrection.groupBy({
    by: ["timeEntryId"],
    where: { timeEntryId: { in: entryIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.timeEntryId, r._count._all]));
}

export async function registerFichajeRoutes(app: FastifyInstance): Promise<void> {
  // ── emparejar ────────────────────────────────────────────────────────
  //
  // Sin auth: el token del enlace ES la credencial. Copia el claim atómico
  // de `/devices/pair` (v1.3-hotfix11): el SELECT informa, el `updateMany`
  // reclama. Dos aperturas simultáneas del mismo enlace y sólo una
  // empareja.
  //
  // Sin `ensureFichajeEnabled` como preHandler —no hay tenant hasta
  // resolver el token— pero SÍ con la comprobación dentro del handler, y
  // sobre el tenant que el propio token ya trae. Mismo patrón que la
  // excepción documentada de `GET /tpv/catalog/products` en ADR-016 §6.
  app.post(
    "/fichaje/v1/pair",
    {
      schema: {
        body: {
          type: "object",
          required: ["token"],
          additionalProperties: false,
          properties: {
            token: { type: "string", minLength: 20, maxLength: 200 },
            userAgent: { type: "string", maxLength: 512 },
          },
        },
      },
    },
    async (request, reply) => {
      const { token, userAgent } = request.body as {
        token: string;
        userAgent?: string;
      };
      const prisma = getPrisma();
      const now = new Date();

      const candidate = await prisma.employeePairingToken.findUnique({
        where: { tokenHash: hashEmployeeToken(token) },
        select: {
          id: true,
          tenantId: true,
          employeeId: true,
          expiresAt: true,
          consumedAt: true,
          employee: { select: { id: true, name: true, active: true } },
        },
      });
      // Un enlace inválido, caducado o YA USADO dicen lo mismo y con el
      // mismo código: no hay nada que un atacante pueda distinguir, y el
      // empleado lee una frase que le dice qué hacer.
      const invalido = () =>
        reply.code(404).send({
          error: "INVALID_PAIRING_LINK",
          message:
            "Este enlace ya no vale. Pídele a tu empresa que te genere uno nuevo.",
        });
      if (!candidate || candidate.consumedAt || candidate.expiresAt <= now) {
        return invalido();
      }
      if (!candidate.employee.active) return invalido();

      const tenant = await prisma.tenant.findUnique({
        where: { id: candidate.tenantId },
        select: { id: true, name: true, fichajeEnabled: true },
      });
      if (!tenant || tenant.fichajeEnabled !== true) {
        return reply.code(403).send({
          error: "FICHAJE_DISABLED",
          message:
            "Esta empresa no tiene el módulo de control horario activado.",
        });
      }

      // El claim. Si devuelve 0, otra apertura llegó primero.
      const claimed = await prisma.employeePairingToken.updateMany({
        where: { id: candidate.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (claimed.count === 0) return invalido();

      const { plain, hash } = generateEmployeeToken();
      const device = await prisma.$transaction(async (tx) => {
        // UN móvil activo por empleado: el anterior se revoca AQUÍ, en la
        // misma transacción. Si esta línea desapareciera, el INSERT de
        // abajo reventaría contra `employee_devices_one_active_key` en vez
        // de dejar dos móviles vivos — la invariante la garantiza la base.
        await tx.employeeDevice.updateMany({
          where: { employeeId: candidate.employeeId, revokedAt: null },
          data: { revokedAt: now },
        });
        const d = await tx.employeeDevice.create({
          data: {
            tenantId: candidate.tenantId,
            employeeId: candidate.employeeId,
            deviceTokenHash: hash,
            userAgent: userAgent ?? null,
          },
          select: { id: true },
        });
        await tx.employeePairingToken.update({
          where: { id: candidate.id },
          data: { consumedByDeviceId: d.id },
        });
        return d;
      });

      return reply.code(201).send({
        employeeToken: plain,
        employee: { id: candidate.employee.id, name: candidate.employee.name },
        tenant: { id: tenant.id, name: tenant.name },
        timeZone: FICHAJE_TZ,
      });
    },
  );

  // ── la pantalla ──────────────────────────────────────────────────────

  app.get(
    "/fichaje/v1/me",
    { preHandler: [requireEmployeeDevice, ensureFichajeEnabled] },
    async (request) => {
      const ctx = request.employee!;
      const prisma = getPrisma();
      const now = new Date();
      const hoy = localDate(now);

      const [employee, tenant, open] = await Promise.all([
        prisma.employee.findUniqueOrThrow({
          where: { id: ctx.employeeId },
          select: { id: true, name: true },
        }),
        prisma.tenant.findUniqueOrThrow({
          where: { id: ctx.tenantId },
          select: { id: true, name: true },
        }),
        prisma.timeEntry.findFirst({
          where: { employeeId: ctx.employeeId, endedAt: null },
          select: ENTRY_SELECT,
        }),
      ]);

      await prisma.employeeDevice.update({
        where: { id: ctx.deviceId },
        data: { lastSeenAt: now },
      });

      // LA SALIDA OLVIDADA. Un tramo abierto de un día local ANTERIOR es
      // lo primero que ve el empleado, antes que su botón. Nunca se cierra
      // solo: se pregunta.
      let pendingExit: {
        entryId: string;
        startedAt: string;
        date: string;
        suggestedEndAt: string | null;
      } | null = null;
      if (open && localDate(open.startedAt) !== hoy) {
        const desde = new Date(now.getTime() - EXIT_HISTORY_DAYS * 86_400_000);
        const historial = await prisma.timeEntry.findMany({
          where: {
            employeeId: ctx.employeeId,
            endedAt: { not: null, gte: desde },
          },
          select: { endedAt: true },
        });
        const sugerida = suggestedExitAt(
          open.startedAt,
          historial.map((h) => h.endedAt!),
        );
        pendingExit = {
          entryId: open.id,
          startedAt: open.startedAt.toISOString(),
          date: localDate(open.startedAt),
          suggestedEndAt: sugerida?.toISOString() ?? null,
        };
      }

      // El día de hoy, para el resumen de debajo del botón.
      const { from, to } = monthRange(hoy.slice(0, 7));
      const delMes = await prisma.timeEntry.findMany({
        where: {
          employeeId: ctx.employeeId,
          startedAt: { gte: from, lt: to },
        },
        select: ENTRY_SELECT,
        orderBy: { startedAt: "asc" },
      });
      const counts = await correctionCounts(
        prisma,
        delMes.map((e) => e.id),
      );
      const dias = groupByDay(
        delMes.map((e) => toEntryView(e as TimeEntryRow, counts.get(e.id) ?? 0)),
      );

      return {
        employee,
        tenant,
        timeZone: FICHAJE_TZ,
        serverNow: now.toISOString(),
        today: hoy,
        openEntry: open
          ? {
              id: open.id,
              startedAt: open.startedAt.toISOString(),
              date: localDate(open.startedAt),
            }
          : null,
        pendingExit,
        month: { month: hoy.slice(0, 7), days: dias, totalMinutes: totalMinutes(dias) },
      };
    },
  );

  // ── fichar ───────────────────────────────────────────────────────────

  app.post(
    "/fichaje/v1/entries",
    {
      preHandler: [requireEmployeeDevice, ensureFichajeEnabled],
      schema: {
        body: {
          type: "object",
          required: ["externalId", "deviceAt"],
          additionalProperties: false,
          properties: {
            externalId: { type: "string", minLength: 8, maxLength: 64 },
            deviceAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = request.employee!;
      const { externalId, deviceAt } = request.body as {
        externalId: string;
        deviceAt: string;
      };
      const prisma = getPrisma();
      const now = new Date();
      const device = new Date(deviceAt);

      // Idempotencia: el mismo toque reenviado por la cola no crea otro
      // tramo. Primero se mira, porque es lo más barato.
      const yaEsta = await prisma.timeEntry.findUnique({
        where: { startExternalId: externalId },
        select: ENTRY_SELECT,
      });
      if (yaEsta) {
        if (yaEsta.employeeId !== ctx.employeeId) {
          return reply.code(404).send({
            error: "ENTRY_NOT_FOUND",
            message: "Ese fichaje no es tuyo",
          });
        }
        return reply.code(200).send({
          duplicate: true,
          entry: toEntryView(yaEsta as TimeEntryRow, 0),
        });
      }

      const abierto = await prisma.timeEntry.findFirst({
        where: { employeeId: ctx.employeeId, endedAt: null },
        select: { id: true, startedAt: true },
      });
      if (abierto) {
        return reply.code(409).send({
          error: "ENTRY_ALREADY_OPEN",
          message: "Ya estás dentro desde hace un rato.",
          openEntryId: abierto.id,
          openStartedAt: abierto.startedAt.toISOString(),
        });
      }

      const startedAt = resolveTapTime(device, now);
      const creado = await prisma.timeEntry.create({
        data: {
          tenantId: ctx.tenantId,
          employeeId: ctx.employeeId,
          startedAt,
          startedDeviceAt: device,
          startedServerAt: now,
          startSource: "MOBILE",
          startExternalId: externalId,
        },
        select: ENTRY_SELECT,
      });
      return reply
        .code(201)
        .send({ duplicate: false, entry: toEntryView(creado as TimeEntryRow, 0) });
    },
  );

  app.post(
    "/fichaje/v1/entries/:id/close",
    {
      preHandler: [requireEmployeeDevice, ensureFichajeEnabled],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["externalId", "deviceAt"],
          additionalProperties: false,
          properties: {
            externalId: { type: "string", minLength: 8, maxLength: 64 },
            deviceAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = request.employee!;
      const { id } = request.params as { id: string };
      const { externalId, deviceAt } = request.body as {
        externalId: string;
        deviceAt: string;
      };
      const prisma = getPrisma();
      const now = new Date();
      const device = new Date(deviceAt);

      const yaEsta = await prisma.timeEntry.findUnique({
        where: { endExternalId: externalId },
        select: ENTRY_SELECT,
      });
      if (yaEsta) {
        if (yaEsta.employeeId !== ctx.employeeId) {
          return reply
            .code(404)
            .send({ error: "ENTRY_NOT_FOUND", message: "Ese fichaje no es tuyo" });
        }
        return reply
          .code(200)
          .send({ duplicate: true, entry: toEntryView(yaEsta as TimeEntryRow, 0) });
      }

      const entry = await prisma.timeEntry.findFirst({
        where: { id, employeeId: ctx.employeeId },
        select: ENTRY_SELECT,
      });
      // 404 y no 403: un 403 confirmaría que ese fichaje existe.
      if (!entry) {
        return reply
          .code(404)
          .send({ error: "ENTRY_NOT_FOUND", message: "Ese fichaje no existe" });
      }
      if (entry.endedAt) {
        return reply
          .code(200)
          .send({ duplicate: true, entry: toEntryView(entry as TimeEntryRow, 0) });
      }

      // La salida OLVIDADA no se cierra por aquí. Cerrar un tramo de ayer
      // con el toque de hoy dejaría en el registro una jornada de veinte
      // horas sin que nadie diga por qué. Va por la vía de corrección, con
      // motivo — y la pantalla ya se lo ha preguntado.
      if (localDate(entry.startedAt) !== localDate(now)) {
        return reply.code(409).send({
          error: "PENDING_EXIT_REQUIRES_REASON",
          message:
            "Este fichaje es de otro día. Dinos a qué hora saliste y queda corregido.",
          entryId: entry.id,
        });
      }

      const endedAt = resolveTapTime(device, now);
      if (endedAt.getTime() <= entry.startedAt.getTime()) {
        return reply.code(400).send({
          error: "END_BEFORE_START",
          message: "La salida no puede ser anterior a la entrada.",
        });
      }

      // `WHERE ended_at IS NULL` en el propio UPDATE: dos cierres a la vez
      // y sólo uno cuenta. El trigger exige además la procedencia —
      // `endedServerAt` y `endSource` viajan en el mismo UPDATE.
      const cerrado = await prisma.timeEntry.updateMany({
        where: { id: entry.id, employeeId: ctx.employeeId, endedAt: null },
        data: {
          endedAt,
          endedDeviceAt: device,
          endedServerAt: now,
          endSource: "MOBILE",
          endExternalId: externalId,
        },
      });
      const fresco = await prisma.timeEntry.findUniqueOrThrow({
        where: { id: entry.id },
        select: ENTRY_SELECT,
      });
      return reply.code(200).send({
        duplicate: cerrado.count === 0,
        entry: toEntryView(fresco as TimeEntryRow, 0),
      });
    },
  );

  // ── mis fichajes ─────────────────────────────────────────────────────

  app.get(
    "/fichaje/v1/entries",
    {
      preHandler: [requireEmployeeDevice, ensureFichajeEnabled],
      schema: {
        querystring: {
          type: "object",
          properties: { month: { type: "string", pattern: "^\\d{4}-\\d{2}$" } },
        },
      },
    },
    async (request) => {
      const ctx = request.employee!;
      const { month } = request.query as { month?: string };
      const mes = month ?? localDate(new Date()).slice(0, 7);
      const { from, to } = monthRange(mes);
      const prisma = getPrisma();

      const rows = await prisma.timeEntry.findMany({
        where: {
          employeeId: ctx.employeeId,
          tenantId: ctx.tenantId,
          startedAt: { gte: from, lt: to },
        },
        select: ENTRY_SELECT,
        orderBy: { startedAt: "asc" },
      });
      const counts = await correctionCounts(prisma, rows.map((r) => r.id));
      const days = groupByDay(
        rows.map((r) => toEntryView(r as TimeEntryRow, counts.get(r.id) ?? 0)),
      );
      return { month: mes, timeZone: FICHAJE_TZ, days, totalMinutes: totalMinutes(days) };
    },
  );

  // ── corregir ─────────────────────────────────────────────────────────

  app.post(
    "/fichaje/v1/entries/:id/corrections",
    {
      preHandler: [requireEmployeeDevice, ensureFichajeEnabled],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["field", "value", "reasonCode"],
          additionalProperties: false,
          properties: {
            field: { type: "string", enum: ["started_at", "ended_at"] },
            value: { type: "string", format: "date-time" },
            reasonCode: { type: "string", enum: [...CORRECTION_REASONS] },
            reasonText: { type: "string", maxLength: 300 },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = request.employee!;
      const { id } = request.params as { id: string };
      const body = request.body as {
        field: CorrectableField;
        value: string;
        reasonCode: CorrectionReason;
        reasonText?: string;
      };
      const prisma = getPrisma();

      const entry = await prisma.timeEntry.findFirst({
        where: { id, employeeId: ctx.employeeId, tenantId: ctx.tenantId },
        select: { id: true, startedAt: true, endedAt: true },
      });
      if (!entry) {
        return reply
          .code(404)
          .send({ error: "ENTRY_NOT_FOUND", message: "Ese fichaje no existe" });
      }

      const value = new Date(body.value);
      if (isInFuture(value, new Date())) {
        return reply.code(400).send({
          error: "CORRECTION_IN_FUTURE",
          message: "Esa hora todavía no ha pasado.",
        });
      }

      // El límite de 30 días. Más atrás corrige la empresa, que es quien
      // puede cruzarlo con lo que pasó ese día.
      const limite = new Date(
        Date.now() - EMPLOYEE_CORRECTION_WINDOW_DAYS * 86_400_000,
      );
      if (entry.startedAt < limite) {
        return reply.code(403).send({
          error: "CORRECTION_TOO_OLD",
          message: `Este fichaje tiene más de ${EMPLOYEE_CORRECTION_WINDOW_DAYS} días. Pídeselo a tu empresa y lo corrige desde el panel.`,
        });
      }

      const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: ctx.employeeId },
        select: { name: true },
      });

      try {
        await recordTimeEntryCorrection(prisma, {
          entryId: entry.id,
          field: body.field,
          value,
          reasonCode: body.reasonCode,
          reasonText: body.reasonText ?? null,
          authorKind: "EMPLOYEE",
          author: employee.name,
          employeeId: ctx.employeeId,
        });
      } catch (err) {
        if (err instanceof TimeCorrectionRejectedError) {
          return reply
            .code(400)
            .send({ error: "CORRECTION_REJECTED", message: err.message });
        }
        throw err;
      }

      const fresco = await prisma.timeEntry.findUniqueOrThrow({
        where: { id: entry.id },
        select: ENTRY_SELECT,
      });
      const counts = await correctionCounts(prisma, [entry.id]);
      return reply
        .code(201)
        .send({ entry: toEntryView(fresco as TimeEntryRow, counts.get(entry.id) ?? 1) });
    },
  );

  app.get(
    "/fichaje/v1/entries/:id/corrections",
    {
      preHandler: [requireEmployeeDevice, ensureFichajeEnabled],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const ctx = request.employee!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const entry = await prisma.timeEntry.findFirst({
        where: { id, employeeId: ctx.employeeId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!entry) {
        return reply
          .code(404)
          .send({ error: "ENTRY_NOT_FOUND", message: "Ese fichaje no existe" });
      }
      const corrections = await listTimeEntryCorrections(prisma, entry.id);
      return reply.code(200).send({
        corrections: corrections.map((c) => ({
          ...c,
          kind: correctionKind(c),
          createdAt: c.createdAt.toISOString(),
        })),
      });
    },
  );
}
