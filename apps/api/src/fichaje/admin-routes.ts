// F1 · la API del panel de la empresa (ADR-018).
//
// Tres pantallas y nada más: Hoy, Empleados y Registro. Esta es su
// superficie.
//
// `requireOwnerOrManager` y no `requireOwner`: en un colegio, quien da de
// alta a un profesor y quien le corrige un olvido es la secretaría, no la
// dirección. Mismo reparto que ya vale para cajeros y dispositivos (B6
// §1). Decisión tomada sin preguntar; se dice en el -done.
//
// Y `ensureFichajeEnabled` en TODAS. `ensureCajaEnabled` en NINGUNA: el
// cliente 0 es un colegio con `caja_enabled = false`, y ponerle la puerta
// de la caja al control horario lo dejaría fuera de lo único que ha
// comprado.
//
// No hay DELETE en este fichero. Ni de un fichaje, ni de un empleado con
// fichajes: la baja desactiva. Aunque alguien lo añadiera, los triggers de
// la migración lo pararían — pero no hace falta llegar ahí.

import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { loadEnv } from "../env.js";
import { requireOwnerOrManager } from "../auth/middleware.js";
import { ensureFichajeEnabled } from "../lib/fichaje-gate.js";
import { generatePairingToken } from "./auth.js";
import { buildRegistroCsv, buildRegistroPdf, type ExportBlock } from "./export.js";
import {
  CORRECTION_REASONS,
  correctionKind,
  listTenantCorrections,
  listTimeEntryCorrections,
  recordTimeEntryCorrection,
  TimeCorrectionRejectedError,
  type CorrectableField,
  type CorrectionReason,
} from "./corrections.js";
import { entrySentOffline } from "./offline.js";
import { isInFuture } from "./routes.js";
import { FICHAJE_TZ, localDate, monthRange } from "./time.js";
import { groupByDay, toEntryView, totalMinutes, type TimeEntryRow } from "./view.js";

/** Lo que vive un enlace de emparejamiento. Una semana: lo suficiente para
 *  que al profesor le dé tiempo a abrirlo el lunes, poco para que un
 *  enlace olvidado en un chat siga valiendo un mes después. */
export const PAIRING_LINK_TTL_DAYS = 7;

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

/** La URL que la empresa copia o comparte. El servidor NO manda nada: ni
 *  SMS, ni WhatsApp, ni email. La empresa sabe mejor que nosotros por
 *  dónde habla con su gente. */
export function pairingLinkUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}/fichar?p=${token}`;
}

export async function registerFichajeAdminRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [requireOwnerOrManager, ensureFichajeEnabled] };

  // ── empleados ────────────────────────────────────────────────────────

  app.get("/admin/fichaje/employees", guard, async (request) => {
    const auth = request.auth!;
    const prisma = getPrisma();
    const employees = await prisma.employee.findMany({
      where: { tenantId: auth.tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        active: true,
        deactivatedAt: true,
        createdAt: true,
        devices: {
          where: { revokedAt: null },
          select: { id: true, pairedAt: true, lastSeenAt: true },
          take: 1,
        },
        pairingTokens: {
          where: { consumedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true, expiresAt: true },
          orderBy: { expiresAt: "desc" },
          take: 1,
        },
      },
      // Los de baja al final: la pantalla es para trabajar con los que
      // están, pero los que se fueron no desaparecen (sus registros se
      // conservan 4 años y alguien puede tener que mirarlos).
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return {
      employees: employees.map((e) => ({
        id: e.id,
        name: e.name,
        email: e.email,
        phone: e.phone,
        active: e.active,
        deactivatedAt: e.deactivatedAt?.toISOString() ?? null,
        // "¿Tiene móvil emparejado, y desde cuándo?" es la pregunta que la
        // empresa se hace en esta pantalla. Va contestada, no deducible.
        device: e.devices[0]
          ? {
              id: e.devices[0].id,
              pairedAt: e.devices[0].pairedAt.toISOString(),
              lastSeenAt: e.devices[0].lastSeenAt?.toISOString() ?? null,
            }
          : null,
        pendingLink: e.pairingTokens[0]
          ? { expiresAt: e.pairingTokens[0].expiresAt.toISOString() }
          : null,
      })),
    };
  });

  app.post(
    "/admin/fichaje/employees",
    {
      ...guard,
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            email: { type: "string", maxLength: 200 },
            phone: { type: "string", maxLength: 40 },
            userId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const body = request.body as {
        name: string;
        email?: string;
        phone?: string;
        userId?: string;
      };
      const prisma = getPrisma();
      const name = body.name.trim();
      if (name === "") {
        return reply
          .code(400)
          .send({ error: "INVALID_NAME", message: "El nombre no puede estar vacío." });
      }
      // El `userId` tiene que ser de ESTE tenant. Sin esta comprobación, el
      // panel de una empresa podría enlazar un empleado suyo a un usuario
      // de otra.
      if (body.userId) {
        const user = await prisma.user.findFirst({
          where: { id: body.userId, tenantId: auth.tenantId },
          select: { id: true },
        });
        if (!user) {
          return reply.code(404).send({
            error: "USER_NOT_FOUND",
            message: "Ese usuario no es de esta empresa.",
          });
        }
      }
      try {
        const created = await prisma.employee.create({
          data: {
            tenantId: auth.tenantId,
            name,
            email: body.email?.trim() || null,
            phone: body.phone?.trim() || null,
            userId: body.userId ?? null,
          },
          select: { id: true, name: true, active: true },
        });
        return reply.code(201).send({ employee: created });
      } catch (err) {
        if (String(err).includes("employees_tenant_id_user_id_key")) {
          return reply.code(409).send({
            error: "USER_ALREADY_EMPLOYEE",
            message: "Ese usuario ya está dado de alta como empleado.",
          });
        }
        throw err;
      }
    },
  );

  app.patch(
    "/admin/fichaje/employees/:id",
    {
      ...guard,
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
            name: { type: "string", minLength: 1, maxLength: 120 },
            email: { type: "string", maxLength: 200 },
            phone: { type: "string", maxLength: 40 },
            // La baja y el alta son el mismo interruptor. NO hay borrado:
            // los registros de quien se va se conservan 4 años.
            active: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        email?: string;
        phone?: string;
        active?: boolean;
      };
      const prisma = getPrisma();
      const employee = await prisma.employee.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true, active: true },
      });
      if (!employee) {
        return reply
          .code(404)
          .send({ error: "EMPLOYEE_NOT_FOUND", message: "Ese empleado no existe" });
      }
      const data: Record<string, unknown> = {};
      if (body.name !== undefined) data.name = body.name.trim();
      if (body.email !== undefined) data.email = body.email.trim() || null;
      if (body.phone !== undefined) data.phone = body.phone.trim() || null;
      if (body.active !== undefined && body.active !== employee.active) {
        data.active = body.active;
        data.deactivatedAt = body.active ? null : new Date();
        // Dar de baja revoca el móvil: quien ya no trabaja aquí no ficha.
        // Sus registros no se tocan — eso lo garantizan los triggers.
        if (!body.active) {
          await prisma.employeeDevice.updateMany({
            where: { employeeId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      }
      const updated = await prisma.employee.update({
        where: { id },
        data,
        select: { id: true, name: true, email: true, phone: true, active: true },
      });
      return reply.code(200).send({ employee: updated });
    },
  );

  // ── el enlace del móvil ──────────────────────────────────────────────

  app.post(
    "/admin/fichaje/employees/:id/pairing-links",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const employee = await prisma.employee.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true, name: true, active: true },
      });
      if (!employee) {
        return reply
          .code(404)
          .send({ error: "EMPLOYEE_NOT_FOUND", message: "Ese empleado no existe" });
      }
      if (!employee.active) {
        return reply.code(409).send({
          error: "EMPLOYEE_INACTIVE",
          message:
            "Este empleado está de baja. Vuelve a darlo de alta antes de generarle un enlace.",
        });
      }

      const { plain, hash } = generatePairingToken();
      const expiresAt = new Date(Date.now() + PAIRING_LINK_TTL_DAYS * 86_400_000);
      await prisma.$transaction(async (tx) => {
        // Los enlaces pendientes anteriores dejan de valer. Generar uno
        // nuevo es lo que se hace cuando el primero se perdió o se mandó a
        // quien no era; si el viejo siguiera vivo, no habría arreglado nada.
        await tx.employeePairingToken.updateMany({
          where: { employeeId: id, consumedAt: null, expiresAt: { gt: new Date() } },
          data: { expiresAt: new Date() },
        });
        await tx.employeePairingToken.create({
          data: {
            tenantId: auth.tenantId,
            employeeId: id,
            tokenHash: hash,
            expiresAt,
            createdByUserId: auth.userId,
          },
        });
      });

      // El token EN CLARO se devuelve UNA vez: no se guarda, sólo su hash.
      // Si la empresa lo pierde, se genera otro (y el anterior muere).
      return reply.code(201).send({
        url: pairingLinkUrl(loadEnv().PUBLIC_ADMIN_URL, plain),
        expiresAt: expiresAt.toISOString(),
        employee: { id: employee.id, name: employee.name },
      });
    },
  );

  app.post(
    "/admin/fichaje/employees/:id/devices/revoke",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const employee = await prisma.employee.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!employee) {
        return reply
          .code(404)
          .send({ error: "EMPLOYEE_NOT_FOUND", message: "Ese empleado no existe" });
      }
      const revoked = await prisma.employeeDevice.updateMany({
        where: { employeeId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return reply
        .code(200)
        .send({ ok: true, revoked: revoked.count, alreadyRevoked: revoked.count === 0 });
    },
  );

  // ── Hoy ──────────────────────────────────────────────────────────────
  //
  // La pantalla de entrada de la sección. Contesta de un vistazo tres
  // preguntas: quién está dentro, quién no ha fichado, y qué hay que
  // mirar.

  app.get("/admin/fichaje/today", guard, async (request) => {
    const auth = request.auth!;
    const prisma = getPrisma();
    const now = new Date();
    const hoy = localDate(now);
    const { from, to } = monthRange(hoy.slice(0, 7));

    const [employees, entries] = await Promise.all([
      prisma.employee.findMany({
        where: { tenantId: auth.tenantId, active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      // El mes entero, no sólo hoy: los avisos (sin salida, corregidos,
      // enviados sin conexión) son de días pasados por definición — una
      // salida olvidada de ayer no aparece en "hoy" y es justo lo que hay
      // que ver.
      prisma.timeEntry.findMany({
        where: {
          tenantId: auth.tenantId,
          OR: [{ startedAt: { gte: from, lt: to } }, { endedAt: null }],
        },
        select: ENTRY_SELECT,
        orderBy: { startedAt: "asc" },
      }),
    ]);

    const correcciones = await prisma.timeEntryCorrection.groupBy({
      by: ["timeEntryId"],
      where: { timeEntryId: { in: entries.map((e) => e.id) } },
      _count: { _all: true },
    });
    const counts = new Map(correcciones.map((c) => [c.timeEntryId, c._count._all]));
    const nombre = new Map(employees.map((e) => [e.id, e.name]));

    const dentro = entries
      .filter((e) => e.endedAt === null && localDate(e.startedAt) === hoy)
      .map((e) => ({
        employeeId: e.employeeId,
        employeeName: nombre.get(e.employeeId) ?? "—",
        entryId: e.id,
        startedAt: e.startedAt.toISOString(),
      }));

    const deHoy = entries.filter((e) => localDate(e.startedAt) === hoy);
    const conFichaje = new Set(deHoy.map((e) => e.employeeId));

    return {
      date: hoy,
      timeZone: FICHAJE_TZ,
      serverNow: now.toISOString(),
      inside: dentro,
      // Quién NO ha fichado hoy. Sin jornada teórica todavía (eso es F2),
      // así que esto es "no ha aparecido", no "falta al trabajo".
      notClockedIn: employees
        .filter((e) => !conFichaje.has(e.id))
        .map((e) => ({ employeeId: e.id, employeeName: e.name })),
      alerts: {
        // Tramos abiertos de días ANTERIORES: la salida olvidada, vista
        // desde la empresa. No se cierran solos, ni aquí ni en el móvil.
        missingExit: entries
          .filter((e) => e.endedAt === null && localDate(e.startedAt) !== hoy)
          .map((e) => ({
            entryId: e.id,
            employeeId: e.employeeId,
            employeeName: nombre.get(e.employeeId) ?? "—",
            startedAt: e.startedAt.toISOString(),
            date: localDate(e.startedAt),
          })),
        corrected: entries
          .filter((e) => (counts.get(e.id) ?? 0) > 0)
          .map((e) => ({
            entryId: e.id,
            employeeId: e.employeeId,
            employeeName: nombre.get(e.employeeId) ?? "—",
            date: localDate(e.startedAt),
            corrections: counts.get(e.id) ?? 0,
          })),
        sentOffline: entries
          .filter((e) => entrySentOffline(e))
          .map((e) => ({
            entryId: e.id,
            employeeId: e.employeeId,
            employeeName: nombre.get(e.employeeId) ?? "—",
            date: localDate(e.startedAt),
          })),
      },
    };
  });

  // ── Registro ─────────────────────────────────────────────────────────

  /**
   * El registro del mes, por empleado. Lo usan la pantalla y los dos
   * exports, y por eso está aquí y no dentro del handler: si el PDF se
   * construyera sobre otra consulta, el día que discrepen ganaría el PDF
   * —que es el que se firma— y nadie sabría por qué.
   */
  async function construirRegistro(
    tenantId: string,
    month: string,
    employeeId: string | null,
  ): Promise<{
    employees: Array<{ id: string; name: string; active: boolean }>;
    blocks: ExportBlock[];
    totalMinutes: number;
    from: Date;
    to: Date;
  }> {
    const { from, to } = monthRange(month);
    const prisma = getPrisma();
    const [employees, rows] = await Promise.all([
      prisma.employee.findMany({
        where: { tenantId },
        select: { id: true, name: true, active: true },
        orderBy: [{ active: "desc" }, { name: "asc" }],
      }),
      prisma.timeEntry.findMany({
        where: {
          tenantId,
          startedAt: { gte: from, lt: to },
          ...(employeeId ? { employeeId } : {}),
        },
        select: ENTRY_SELECT,
        orderBy: { startedAt: "asc" },
      }),
    ]);
    const correcciones = await prisma.timeEntryCorrection.groupBy({
      by: ["timeEntryId"],
      where: { timeEntryId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });
    const counts = new Map(correcciones.map((c) => [c.timeEntryId, c._count._all]));
    const nombre = new Map(employees.map((e) => [e.id, e.name]));

    // Por EMPLEADO y no en una lista plana: el registro que firma cada
    // trabajador es el suyo.
    const porEmpleado = new Map<string, typeof rows>();
    for (const r of rows) {
      const l = porEmpleado.get(r.employeeId);
      if (l) l.push(r);
      else porEmpleado.set(r.employeeId, [r]);
    }
    const blocks: ExportBlock[] = [...porEmpleado.entries()]
      .map(([id, list]) => {
        const days = groupByDay(
          list.map((r) => toEntryView(r as TimeEntryRow, counts.get(r.id) ?? 0)),
        );
        return {
          employeeId: id,
          employeeName: nombre.get(id) ?? "—",
          days,
          totalMinutes: totalMinutes(days),
        };
      })
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

    return {
      employees,
      blocks,
      totalMinutes: blocks.reduce((a, b) => a + b.totalMinutes, 0),
      from,
      to,
    };
  }

  app.get(
    "/admin/fichaje/entries",
    {
      ...guard,
      schema: {
        querystring: {
          type: "object",
          properties: {
            month: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
            employeeId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request) => {
      const auth = request.auth!;
      const { month, employeeId } = request.query as {
        month?: string;
        employeeId?: string;
      };
      const mes = month ?? localDate(new Date()).slice(0, 7);
      const r = await construirRegistro(
        auth.tenantId,
        mes,
        employeeId ?? null,
      );
      return {
        month: mes,
        timeZone: FICHAJE_TZ,
        employeeId: employeeId ?? null,
        employees: r.employees,
        blocks: r.blocks,
        totalMinutes: r.totalMinutes,
      };
    },
  );

  // Añadir un fichaje que falta. Origen PANEL y motivo obligatorio: si el
  // registro gana una jornada que nadie tocó, tiene que decir quién la
  // metió y por qué.
  app.post(
    "/admin/fichaje/entries",
    {
      ...guard,
      schema: {
        body: {
          type: "object",
          required: ["employeeId", "startedAt", "reasonCode"],
          additionalProperties: false,
          properties: {
            employeeId: { type: "string", format: "uuid" },
            startedAt: { type: "string", format: "date-time" },
            endedAt: { type: "string", format: "date-time" },
            reasonCode: { type: "string", enum: [...CORRECTION_REASONS] },
            reasonText: { type: "string", maxLength: 300 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const body = request.body as {
        employeeId: string;
        startedAt: string;
        endedAt?: string;
        reasonCode: CorrectionReason;
        reasonText?: string;
      };
      const prisma = getPrisma();
      const now = new Date();
      const startedAt = new Date(body.startedAt);
      const endedAt = body.endedAt ? new Date(body.endedAt) : null;

      const employee = await prisma.employee.findFirst({
        where: { id: body.employeeId, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!employee) {
        return reply
          .code(404)
          .send({ error: "EMPLOYEE_NOT_FOUND", message: "Ese empleado no existe" });
      }
      if (isInFuture(startedAt, now) || (endedAt && isInFuture(endedAt, now))) {
        return reply.code(400).send({
          error: "ENTRY_IN_FUTURE",
          message: "Esa hora todavía no ha pasado.",
        });
      }
      if (endedAt && endedAt.getTime() <= startedAt.getTime()) {
        return reply.code(400).send({
          error: "END_BEFORE_START",
          message: "La salida no puede ser anterior a la entrada.",
        });
      }
      if (body.reasonCode === "OTRO" && !(body.reasonText ?? "").trim()) {
        return reply.code(400).send({
          error: "CORRECTION_REJECTED",
          message: 'Has elegido "Otro": di en una línea qué pasó.',
        });
      }
      // Sin salida, el tramo queda abierto — y como mucho hay uno por
      // empleado. Lo garantiza el índice parcial, no este `if`; esto sólo
      // da una frase en vez de un 500.
      if (!endedAt) {
        const abierto = await prisma.timeEntry.findFirst({
          where: { employeeId: body.employeeId, endedAt: null },
          select: { id: true },
        });
        if (abierto) {
          return reply.code(409).send({
            error: "ENTRY_ALREADY_OPEN",
            message:
              "Este empleado ya tiene un fichaje sin salida. Ciérralo antes de añadir otro.",
            openEntryId: abierto.id,
          });
        }
      }

      const created = await prisma.timeEntry.create({
        data: {
          tenantId: auth.tenantId,
          employeeId: body.employeeId,
          startedAt,
          startedServerAt: now,
          startSource: "PANEL",
          ...(endedAt
            ? { endedAt, endedServerAt: now, endSource: "PANEL" as const }
            : {}),
        },
        select: ENTRY_SELECT,
      });

      // El motivo del alta manual queda en la MISMA tabla que las
      // correcciones: para quien lea el registro, "esta jornada la metió
      // la empresa el día X porque Y" y "esta hora la cambió la empresa"
      // son la misma clase de hecho y se leen en el mismo sitio.
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { alias: true, email: true },
      });
      await recordTimeEntryCorrection(prisma, {
        entryId: created.id,
        field: "started_at",
        value: startedAt,
        reasonCode: body.reasonCode,
        reasonText: body.reasonText ?? null,
        authorKind: "PANEL",
        author: user?.alias ?? user?.email ?? "panel",
        userId: auth.userId,
      });

      const fresco = await prisma.timeEntry.findUniqueOrThrow({
        where: { id: created.id },
        select: ENTRY_SELECT,
      });
      return reply
        .code(201)
        .send({ entry: toEntryView(fresco as TimeEntryRow, 1) });
    },
  );

  app.post(
    "/admin/fichaje/entries/:id/corrections",
    {
      ...guard,
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
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as {
        field: CorrectableField;
        value: string;
        reasonCode: CorrectionReason;
        reasonText?: string;
      };
      const prisma = getPrisma();
      const entry = await prisma.timeEntry.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true },
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
      // La empresa NO tiene la ventana de 30 días del empleado: es quien
      // puede cruzar un fichaje viejo con lo que pasó ese día, y es a
      // quien la Inspección le pide el registro.
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { alias: true, email: true },
      });
      try {
        await recordTimeEntryCorrection(prisma, {
          entryId: entry.id,
          field: body.field,
          value,
          reasonCode: body.reasonCode,
          reasonText: body.reasonText ?? null,
          authorKind: "PANEL",
          author: user?.alias ?? user?.email ?? "panel",
          userId: auth.userId,
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
      const n = await prisma.timeEntryCorrection.count({
        where: { timeEntryId: entry.id },
      });
      return reply.code(201).send({ entry: toEntryView(fresco as TimeEntryRow, n) });
    },
  );

  // ── el export a la Inspección ────────────────────────────────────────
  //
  // Mismo contenido en los dos formatos y sobre la MISMA consulta que la
  // pantalla (`construirRegistro`). El PDF se firma; si sumara por su
  // cuenta, el día que discrepara ganaría él.

  const exportSchema = {
    querystring: {
      type: "object",
      properties: {
        month: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
        employeeId: { type: "string", format: "uuid" },
      },
    },
  } as const;

  async function datosDelExport(
    tenantId: string,
    month: string,
    employeeId: string | null,
  ) {
    const prisma = getPrisma();
    const registro = await construirRegistro(tenantId, month, employeeId);
    const [tenant, corrections] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { name: true, fiscalProfile: true },
      }),
      listTenantCorrections(prisma, {
        tenantId,
        from: registro.from,
        to: registro.to,
        employeeId,
      }),
    ]);
    // Los datos fiscales existen desde H1 y son un check DURO de la
    // activación: si faltan, el tenant no debería estar activo. Aun así
    // se cae al nombre comercial en vez de reventar — un registro sin
    // razón social es peor que ninguno, pero negarse a generarlo el día
    // de una inspección es todavía peor.
    const fp =
      tenant.fiscalProfile &&
      typeof tenant.fiscalProfile === "object" &&
      !Array.isArray(tenant.fiscalProfile)
        ? (tenant.fiscalProfile as Record<string, unknown>)
        : {};
    const str = (k: string) =>
      typeof fp[k] === "string" && (fp[k] as string).trim() !== ""
        ? (fp[k] as string).trim()
        : null;
    return {
      tenantName: tenant.name,
      legalName: str("legalName") ?? str("businessName"),
      taxId: str("taxId") ?? str("nif") ?? str("fiscalNif"),
      month,
      timeZone: FICHAJE_TZ,
      blocks: registro.blocks,
      corrections,
      generatedAt: new Date(),
    };
  }

  /** "registro-jornada-2026-09-marta-ruiz.pdf" — el nombre lo va a ver
   *  quien lo archive, y un `download.pdf` en la carpeta de descargas no
   *  se encuentra nunca. */
  function nombreFichero(
    month: string,
    blocks: ExportBlock[],
    employeeId: string | null,
    ext: string,
  ): string {
    const quien =
      employeeId && blocks.length === 1
        ? `-${blocks[0]!.employeeName
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "")}`
        : "";
    return `registro-jornada-${month}${quien}.${ext}`;
  }

  app.get(
    "/admin/fichaje/export.csv",
    { ...guard, schema: exportSchema },
    async (request, reply) => {
      const auth = request.auth!;
      const { month, employeeId } = request.query as {
        month?: string;
        employeeId?: string;
      };
      const mes = month ?? localDate(new Date()).slice(0, 7);
      const datos = await datosDelExport(
        auth.tenantId,
        mes,
        employeeId ?? null,
      );
      const csv = buildRegistroCsv(datos);
      return reply
        .code(200)
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="${nombreFichero(mes, datos.blocks, employeeId ?? null, "csv")}"`,
        )
        .send(csv);
    },
  );

  app.get(
    "/admin/fichaje/export.pdf",
    { ...guard, schema: exportSchema },
    async (request, reply) => {
      const auth = request.auth!;
      const { month, employeeId } = request.query as {
        month?: string;
        employeeId?: string;
      };
      const mes = month ?? localDate(new Date()).slice(0, 7);
      const datos = await datosDelExport(
        auth.tenantId,
        mes,
        employeeId ?? null,
      );
      const pdf = await buildRegistroPdf(datos);
      return reply
        .code(200)
        .header("Content-Type", "application/pdf")
        .header(
          "Content-Disposition",
          `attachment; filename="${nombreFichero(mes, datos.blocks, employeeId ?? null, "pdf")}"`,
        )
        .send(Buffer.from(pdf));
    },
  );

  app.get(
    "/admin/fichaje/entries/:id/corrections",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const entry = await prisma.timeEntry.findFirst({
        where: { id, tenantId: auth.tenantId },
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
