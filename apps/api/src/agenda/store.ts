// Capa de acceso a datos del motor de reservas (B-reservas-4). ES EL ÚNICO
// sitio con SQL crudo de `tstzrange`: Prisma no escribe/lee esas columnas.
// El motor (`engine.ts`) y las rutas dependen de la INTERFAZ `AgendaStore`,
// no de este SQL — así los tests inyectan un store en memoria que simula el
// EXCLUDE del GiST sin Postgres real (el harness del repo es fake-prisma).
//
// El anti-solape NO se hace "en el código": `insertHold`/`reschedule`
// disparan los EXCLUDE USING gist y, si Postgres los rechaza (23P01),
// lanzan `ExclusionError` → el hueco se perdió, se devuelven alternativas.

import { randomUUID } from "node:crypto";

// `rrule` es CommonJS. El named import ESM (`import { RRule } from "rrule"`)
// compila, pasa el typecheck y pasa los tests de vitest — pero Node lo
// rechaza al arrancar: "does not provide an export named 'RRule'". El
// interop CJS→ESM sólo garantiza el default, así que se desestructura de
// ahí; el alias de tipo mantiene `RRule` usable como tipo.
import rrulePkg from "rrule";
const { RRule } = rrulePkg;
type RRule = InstanceType<typeof RRule>;
import type { PrismaClient } from "@mipiacetpv/db";

import {
  wallTimeToUtc,
  utcToWallDate,
} from "./time.js";
import type {
  AppointmentStatus,
  AppointmentView,
  BlockInterval,
  Occupancy,
  PlannedAssignment,
  PlannedItem,
  ReservationSource,
  ServiceRequirement,
  TemplateSlot,
} from "./types.js";

// Se lanza cuando el GiST rechaza un INSERT (dos altas sobre el mismo
// hueco). La carrera la gana la BD; el perdedor recibe alternativas.
export class ExclusionError extends Error {
  constructor() {
    super("slot taken (gist exclusion)");
    this.name = "ExclusionError";
  }
}

function isExclusionViolation(err: unknown): boolean {
  const s = String((err as { message?: string })?.message ?? err);
  const code = (err as { code?: string; meta?: { code?: string } })?.code;
  const metaCode = (err as { meta?: { code?: string } })?.meta?.code;
  return (
    code === "23P01" ||
    metaCode === "23P01" ||
    s.includes("no_staff_overlap") ||
    s.includes("no_resource_overlap") ||
    s.includes("exclusion")
  );
}

export interface HoldInput {
  tenantId: string;
  externalId: string | null;
  clientId: string | null;
  source: ReservationSource;
  status: AppointmentStatus; // PENDING (hold) o CONFIRMED (presencial directo)
  pendingUntil: Date | null;
  notes: string | null;
  timeslotStart: Date;
  timeslotEnd: Date;
  items: PlannedItem[];
  // assignments referencian el item por índice en `items` (o null = visit).
  assignments: PlannedAssignment[];
}

export interface AgendaStore {
  // ── Entradas del motor (lecturas) ─────────────────────────────────
  getServiceRequirements(
    tenantId: string,
    serviceIds: string[],
  ): Promise<Map<string, ServiceRequirement>>;
  getSkilledStaff(tenantId: string, serviceId: string): Promise<string[]>;
  getTemplateSlots(
    tenantId: string,
    userIds: string[],
    fromDate: string,
    toDate: string,
  ): Promise<TemplateSlot[]>;
  getOccupancies(tenantId: string, from: Date, to: Date): Promise<Occupancy[]>;
  getBlocks(tenantId: string, from: Date, to: Date): Promise<BlockInterval[]>;
  getResourcesByKind(
    tenantId: string,
  ): Promise<Map<string, string[]>>; // kind -> resourceIds
  getStaffProfiles(
    tenantId: string,
  ): Promise<
    Array<{ userId: string; displayName: string; color: string | null; active: boolean }>
  >;

  // ── Escrituras (el GiST resuelve la carrera) ──────────────────────
  insertHold(input: HoldInput): Promise<AppointmentView>;
  findByExternalId(
    tenantId: string,
    externalId: string,
  ): Promise<AppointmentView | null>;
  getAppointmentView(
    tenantId: string,
    id: string,
  ): Promise<AppointmentView | null>;
  listAppointments(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<AppointmentView[]>;
  setStatus(
    tenantId: string,
    id: string,
    status: AppointmentStatus,
  ): Promise<AppointmentView | null>;
  // Reprograma (mueve) una cita: reemplaza timeslot + assignments. El GiST
  // valida el nuevo hueco (throw ExclusionError si choca).
  reschedule(
    tenantId: string,
    id: string,
    timeslotStart: Date,
    timeslotEnd: Date,
    assignments: PlannedAssignment[],
  ): Promise<AppointmentView | null>;
  linkTicket(tenantId: string, id: string, ticketId: string): Promise<void>;
  expireHolds(now: Date): Promise<number>;
  listForClient(tenantId: string, clientId: string): Promise<AppointmentView[]>;

  // ── Bloqueos puntuales ─────────────────────────────────────────────
  listBlocks(tenantId: string, from: Date, to: Date): Promise<BlockInterval[]>;
  createBlock(input: {
    tenantId: string;
    scope: "CENTER" | "STAFF" | "RESOURCE";
    staffUserId: string | null;
    resourceId: string | null;
    startsAt: Date;
    endsAt: Date;
    reason: string | null;
  }): Promise<{ id: string }>;
  deleteBlock(tenantId: string, id: string): Promise<boolean>;
}

// ── Implementación real sobre Postgres ────────────────────────────────

export function createAgendaStore(prisma: PrismaClient): AgendaStore {
  return {
    async getServiceRequirements(tenantId, serviceIds) {
      const map = new Map<string, ServiceRequirement>();
      if (serviceIds.length === 0) return map;
      const scheds = await prisma.serviceScheduling.findMany({
        where: { tenantId, productId: { in: serviceIds } },
        select: {
          productId: true,
          durationMin: true,
          bufferBeforeMin: true,
          bufferAfterMin: true,
          staffRequired: true,
        },
      });
      const needs = await prisma.serviceResourceNeed.findMany({
        where: { tenantId, serviceId: { in: serviceIds } },
        select: { serviceId: true, resourceKind: true, qty: true },
      });
      const needsByService = new Map<
        string,
        Array<{ resourceKind: "CABIN" | "ROOM" | "DEVICE"; qty: number }>
      >();
      for (const n of needs) {
        const arr = needsByService.get(n.serviceId) ?? [];
        arr.push({ resourceKind: n.resourceKind, qty: n.qty });
        needsByService.set(n.serviceId, arr);
      }
      for (const s of scheds) {
        map.set(s.productId, {
          serviceId: s.productId,
          durationMin: s.durationMin,
          bufferBeforeMin: s.bufferBeforeMin,
          bufferAfterMin: s.bufferAfterMin,
          staffRequired: s.staffRequired,
          resourceNeeds: needsByService.get(s.productId) ?? [],
        });
      }
      return map;
    },

    async getSkilledStaff(tenantId, serviceId) {
      const rows = await prisma.staffSkill.findMany({
        where: {
          tenantId,
          serviceId,
          // Sólo profesionales con perfil de agenda ACTIVO.
          user: { staffProfile: { is: { active: true } } },
        },
        select: { userId: true },
      });
      return rows.map((r) => r.userId);
    },

    async getTemplateSlots(tenantId, userIds, fromDate, toDate) {
      if (userIds.length === 0) return [];
      const windowFrom = new Date(`${fromDate}T00:00:00.000Z`);
      const windowTo = new Date(`${toDate}T23:59:59.999Z`);
      const shifts = await prisma.staffShift.findMany({
        where: {
          tenantId,
          userId: { in: userIds },
          validFrom: { lte: windowTo },
          OR: [{ validUntil: null }, { validUntil: { gte: windowFrom } }],
        },
        select: {
          userId: true,
          rrule: true,
          startTime: true,
          endTime: true,
          validFrom: true,
          validUntil: true,
        },
      });
      const out: TemplateSlot[] = [];
      for (const s of shifts) {
        for (const d of expandRule(
          s.rrule,
          s.validFrom,
          s.validUntil,
          windowFrom,
          windowTo,
        )) {
          out.push({
            userId: s.userId,
            date: d,
            startTime: s.startTime,
            endTime: s.endTime,
          });
        }
      }
      return out;
    },

    async getOccupancies(tenantId, from, to) {
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          staff_user_id: string | null;
          resource_id: string | null;
          starts_at: Date;
          ends_at: Date;
        }>
      >(
        `SELECT staff_user_id, resource_id, lower(slot) AS starts_at, upper(slot) AS ends_at
         FROM appointment_assignments
         WHERE tenant_id = $1::uuid AND active
           AND slot && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
        tenantId,
        from.toISOString(),
        to.toISOString(),
      );
      return rows.map((r) => ({
        staffUserId: r.staff_user_id,
        resourceId: r.resource_id,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
      }));
    },

    async getBlocks(tenantId, from, to) {
      return readBlocks(prisma, tenantId, from, to);
    },

    async getResourcesByKind(tenantId) {
      const rows = await prisma.resource.findMany({
        where: { tenantId },
        select: { id: true, kind: true },
      });
      const map = new Map<string, string[]>();
      for (const r of rows) {
        const arr = map.get(r.kind) ?? [];
        arr.push(r.id);
        map.set(r.kind, arr);
      }
      return map;
    },

    async getStaffProfiles(tenantId) {
      const rows = await prisma.staffProfile.findMany({
        where: { tenantId },
        orderBy: { displayName: "asc" },
        select: { userId: true, displayName: true, color: true, active: true },
      });
      return rows;
    },

    async insertHold(input) {
      const apptId = randomUUID();
      // ids de item por índice, para mapear assignments.
      const itemIds = input.items.map(() => randomUUID());
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO appointments
               (id, tenant_id, external_id, mode, client_id, timeslot, status, source,
                party_size, voucher_id, deposit_cents, pending_until, ticket_id, notes,
                created_at, updated_at)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'APPOINTMENT'::"ReservationMode",
                $4::uuid, tstzrange($5::timestamptz, $6::timestamptz, '[)'),
                $7::"AppointmentStatus", $8::"ReservationSource",
                NULL, NULL, NULL, $9::timestamptz, NULL, $10, now(), now())`,
            apptId,
            input.tenantId,
            input.externalId,
            input.clientId,
            input.timeslotStart.toISOString(),
            input.timeslotEnd.toISOString(),
            input.status,
            input.source,
            input.pendingUntil ? input.pendingUntil.toISOString() : null,
            input.notes,
          );
          if (input.items.length > 0) {
            await tx.appointmentItem.createMany({
              data: input.items.map((it, i) => ({
                id: itemIds[i]!,
                tenantId: input.tenantId,
                appointmentId: apptId,
                serviceId: it.serviceId,
                durationMin: it.durationMin,
                bufferBeforeMin: it.bufferBeforeMin,
                bufferAfterMin: it.bufferAfterMin,
                staffRequired: it.staffRequired,
                sortOrder: it.sortOrder,
                startOffsetMin: it.startOffsetMin,
              })),
            });
          }
          for (const a of input.assignments) {
            await tx.$executeRawUnsafe(
              `INSERT INTO appointment_assignments
                 (id, tenant_id, appointment_id, appointment_item_id, reservable_type,
                  staff_user_id, resource_id, slot, active)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::"ReservableType",
                  $6::uuid, $7::uuid, tstzrange($8::timestamptz, $9::timestamptz, '[)'), true)`,
              randomUUID(),
              input.tenantId,
              apptId,
              a.appointmentItemIndex != null
                ? itemIds[a.appointmentItemIndex]
                : null,
              a.reservableType,
              a.staffUserId,
              a.resourceId,
              a.startsAt.toISOString(),
              a.endsAt.toISOString(),
            );
          }
        });
      } catch (err) {
        if (isExclusionViolation(err)) throw new ExclusionError();
        throw err;
      }
      const view = await this.getAppointmentView(input.tenantId, apptId);
      if (!view) throw new Error("appointment vanished after insert");
      return view;
    },

    async findByExternalId(tenantId, externalId) {
      const row = await prisma.appointment.findFirst({
        where: { tenantId, externalId },
        select: { id: true },
      });
      if (!row) return null;
      return this.getAppointmentView(tenantId, row.id);
    },

    async getAppointmentView(tenantId, id) {
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          client_id: string | null;
          status: AppointmentStatus;
          source: ReservationSource;
          starts_at: Date;
          ends_at: Date;
          ticket_id: string | null;
          notes: string | null;
        }>
      >(
        `SELECT id, client_id, status, source, lower(timeslot) AS starts_at,
                upper(timeslot) AS ends_at, ticket_id, notes
         FROM appointments WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        tenantId,
        id,
      );
      const row = rows[0];
      if (!row) return null;
      return hydrateView(prisma, row);
    },

    async listAppointments(tenantId, from, to) {
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          client_id: string | null;
          status: AppointmentStatus;
          source: ReservationSource;
          starts_at: Date;
          ends_at: Date;
          ticket_id: string | null;
          notes: string | null;
        }>
      >(
        `SELECT id, client_id, status, source, lower(timeslot) AS starts_at,
                upper(timeslot) AS ends_at, ticket_id, notes
         FROM appointments
         WHERE tenant_id = $1::uuid
           AND status <> 'CANCELLED'
           AND timeslot && tstzrange($2::timestamptz, $3::timestamptz, '[)')
         ORDER BY lower(timeslot) ASC`,
        tenantId,
        from.toISOString(),
        to.toISOString(),
      );
      return Promise.all(rows.map((r) => hydrateView(prisma, r)));
    },

    async setStatus(tenantId, id, status) {
      const active = status !== "CANCELLED" && status !== "NO_SHOW";
      const updated = await prisma.$executeRawUnsafe(
        `UPDATE appointments SET status = $3::"AppointmentStatus", updated_at = now()
         WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        tenantId,
        id,
        status,
      );
      if (updated === 0) return null;
      // Sincroniza `active` de los assignments en la misma operación lógica
      // (col del WHERE del EXCLUDE): un hueco cancelado deja de bloquear.
      await prisma.$executeRawUnsafe(
        `UPDATE appointment_assignments SET active = $3
         WHERE tenant_id = $1::uuid AND appointment_id = $2::uuid`,
        tenantId,
        id,
        active,
      );
      return this.getAppointmentView(tenantId, id);
    },

    async reschedule(tenantId, id, timeslotStart, timeslotEnd, assignments) {
      const owned = await prisma.appointment.findFirst({
        where: { tenantId, id },
        select: { id: true },
      });
      if (!owned) return null;
      const items = await prisma.appointmentItem.findMany({
        where: { appointmentId: id },
        orderBy: { sortOrder: "asc" },
        select: { id: true },
      });
      try {
        await prisma.$transaction(async (tx) => {
          await tx.appointmentAssignment.deleteMany({
            where: { tenantId, appointmentId: id },
          });
          await tx.$executeRawUnsafe(
            `UPDATE appointments
             SET timeslot = tstzrange($3::timestamptz, $4::timestamptz, '[)'), updated_at = now()
             WHERE tenant_id = $1::uuid AND id = $2::uuid`,
            tenantId,
            id,
            timeslotStart.toISOString(),
            timeslotEnd.toISOString(),
          );
          for (const a of assignments) {
            await tx.$executeRawUnsafe(
              `INSERT INTO appointment_assignments
                 (id, tenant_id, appointment_id, appointment_item_id, reservable_type,
                  staff_user_id, resource_id, slot, active)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::"ReservableType",
                  $6::uuid, $7::uuid, tstzrange($8::timestamptz, $9::timestamptz, '[)'), true)`,
              randomUUID(),
              tenantId,
              id,
              a.appointmentItemIndex != null
                ? items[a.appointmentItemIndex]?.id ?? null
                : null,
              a.reservableType,
              a.staffUserId,
              a.resourceId,
              a.startsAt.toISOString(),
              a.endsAt.toISOString(),
            );
          }
        });
      } catch (err) {
        if (isExclusionViolation(err)) throw new ExclusionError();
        throw err;
      }
      return this.getAppointmentView(tenantId, id);
    },

    async linkTicket(tenantId, id, ticketId) {
      await prisma.$executeRawUnsafe(
        `UPDATE appointments SET ticket_id = $3::uuid, updated_at = now()
         WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        tenantId,
        id,
        ticketId,
      );
    },

    async expireHolds(now) {
      // Los PENDING vencidos se cancelan y sus assignments se inactivan
      // (liberan el hueco). Devuelve cuántos se liberaron.
      const ids = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM appointments
         WHERE status = 'PENDING' AND pending_until IS NOT NULL
           AND pending_until < $1::timestamptz`,
        now.toISOString(),
      );
      if (ids.length === 0) return 0;
      const idList = ids.map((r) => r.id);
      await prisma.$executeRawUnsafe(
        `UPDATE appointments SET status = 'CANCELLED', updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        idList,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE appointment_assignments SET active = false
         WHERE appointment_id = ANY($1::uuid[])`,
        idList,
      );
      return idList.length;
    },

    async listForClient(tenantId, clientId) {
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          client_id: string | null;
          status: AppointmentStatus;
          source: ReservationSource;
          starts_at: Date;
          ends_at: Date;
          ticket_id: string | null;
          notes: string | null;
        }>
      >(
        `SELECT id, client_id, status, source, lower(timeslot) AS starts_at,
                upper(timeslot) AS ends_at, ticket_id, notes
         FROM appointments
         WHERE tenant_id = $1::uuid AND client_id = $2::uuid
         ORDER BY lower(timeslot) DESC LIMIT 200`,
        tenantId,
        clientId,
      );
      return Promise.all(rows.map((r) => hydrateView(prisma, r)));
    },

    async listBlocks(tenantId, from, to) {
      return readBlocks(prisma, tenantId, from, to);
    },

    async createBlock(input) {
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO booking_blocks
           (id, tenant_id, scope, staff_user_id, resource_id, slot, reason, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::"BlockScope", $4::uuid, $5::uuid,
           tstzrange($6::timestamptz, $7::timestamptz, '[)'), $8, now(), now())`,
        id,
        input.tenantId,
        input.scope,
        input.staffUserId,
        input.resourceId,
        input.startsAt.toISOString(),
        input.endsAt.toISOString(),
        input.reason,
      );
      return { id };
    },

    async deleteBlock(tenantId, id) {
      const n = await prisma.$executeRawUnsafe(
        `DELETE FROM booking_blocks WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        tenantId,
        id,
      );
      return n > 0;
    },
  };
}

// Hidrata la vista de una cita cargando items + assignments (columnas
// normales, sin tstzrange).
async function hydrateView(
  prisma: PrismaClient,
  row: {
    id: string;
    client_id: string | null;
    status: AppointmentStatus;
    source: ReservationSource;
    starts_at: Date;
    ends_at: Date;
    ticket_id: string | null;
    notes: string | null;
  },
): Promise<AppointmentView> {
  const [items, assignments] = await Promise.all([
    prisma.appointmentItem.findMany({
      where: { appointmentId: row.id },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        serviceId: true,
        durationMin: true,
        sortOrder: true,
        startOffsetMin: true,
      },
    }),
    prisma.appointmentAssignment.findMany({
      where: { appointmentId: row.id },
      select: { reservableType: true, staffUserId: true, resourceId: true },
    }),
  ]);
  return {
    id: row.id,
    clientId: row.client_id,
    status: row.status,
    source: row.source,
    start: row.starts_at.toISOString(),
    end: row.ends_at.toISOString(),
    ticketId: row.ticket_id,
    notes: row.notes,
    items,
    assignments: assignments.map((a) => ({
      reservableType: a.reservableType as "STAFF" | "RESOURCE" | "TABLE",
      staffUserId: a.staffUserId,
      resourceId: a.resourceId,
    })),
  };
}

// Lee bloqueos (puntuales por `slot` + recurrentes por `rrule`) que solapan
// [from, to], expandidos a intervalos UTC.
async function readBlocks(
  prisma: PrismaClient,
  tenantId: string,
  from: Date,
  to: Date,
): Promise<BlockInterval[]> {
  const out: BlockInterval[] = [];
  // Puntuales.
  const punctual = await prisma.$queryRawUnsafe<
    Array<{
      scope: "CENTER" | "STAFF" | "RESOURCE" | "TABLE";
      staff_user_id: string | null;
      resource_id: string | null;
      starts_at: Date;
      ends_at: Date;
    }>
  >(
    `SELECT scope, staff_user_id, resource_id, lower(slot) AS starts_at, upper(slot) AS ends_at
     FROM booking_blocks
     WHERE tenant_id = $1::uuid AND slot IS NOT NULL
       AND slot && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
    tenantId,
    from.toISOString(),
    to.toISOString(),
  );
  for (const b of punctual) {
    out.push({
      scope: b.scope,
      staffUserId: b.staff_user_id,
      resourceId: b.resource_id,
      startsAt: b.starts_at,
      endsAt: b.ends_at,
    });
  }
  // Recurrentes (reutiliza el expander rrule.js de B3).
  const recurring = await prisma.bookingBlock.findMany({
    where: {
      tenantId,
      rrule: { not: null },
      validFrom: { lte: to },
      OR: [{ validUntil: null }, { validUntil: { gte: from } }],
    },
    select: {
      scope: true,
      staffUserId: true,
      resourceId: true,
      rrule: true,
      startTime: true,
      endTime: true,
      validFrom: true,
      validUntil: true,
    },
  });
  const fromDate = utcToWallDate(from);
  const toDate = utcToWallDate(to);
  for (const b of recurring) {
    if (!b.rrule || !b.startTime || !b.endTime || !b.validFrom) continue;
    for (const d of expandRule(
      b.rrule,
      b.validFrom,
      b.validUntil,
      new Date(`${fromDate}T00:00:00.000Z`),
      new Date(`${toDate}T23:59:59.999Z`),
    )) {
      out.push({
        scope: b.scope,
        staffUserId: b.staffUserId,
        resourceId: b.resourceId,
        startsAt: wallTimeToUtc(d, b.startTime),
        endsAt: wallTimeToUtc(d, b.endTime),
      });
    }
  }
  return out;
}

// Expande una rrule RFC 5545 (mismo criterio que B3): dtstart = validFrom,
// intersecado con la ventana de validez y la ventana pedida. Devuelve fechas
// "YYYY-MM-DD".
function expandRule(
  rruleStr: string,
  validFrom: Date,
  validUntil: Date | null,
  windowFrom: Date,
  windowTo: Date,
): string[] {
  const start = new Date(Math.max(windowFrom.getTime(), validFrom.getTime()));
  const end = validUntil
    ? new Date(Math.min(windowTo.getTime(), validUntil.getTime()))
    : windowTo;
  if (start.getTime() > end.getTime()) return [];
  let rule: RRule;
  try {
    const options = RRule.parseString(rruleStr);
    if (options.freq === undefined) return [];
    rule = new RRule({ ...options, dtstart: validFrom });
  } catch {
    return [];
  }
  return rule.between(start, end, true).map((d) => d.toISOString().slice(0, 10));
}
