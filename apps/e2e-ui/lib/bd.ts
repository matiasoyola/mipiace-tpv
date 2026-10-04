// La mirada a la base de datos.
//
// El banco no se cree la pantalla: después de pulsar, comprueba la fila. Y en
// los «no» del capítulo 6 comprueba lo contrario — que NO hay fila nueva —,
// que es la mitad que de verdad protege a Sole: un rechazo que deja rastro en
// la BD es peor que no rechazar nada.
//
// Las columnas `tstzrange` (`appointments.timeslot`,
// `appointment_assignments.slot`) Prisma no las lee: van por SQL crudo con
// `lower()`/`upper()`, igual que hace `apps/api/src/agenda/store.ts`.

import { PrismaClient } from "@mipiacetpv/db";

import { databaseUrl } from "../seed/base-de-datos.js";
import { ID } from "../seed/escenario.js";

let cliente: PrismaClient | null = null;

export function bd(): PrismaClient {
  if (!cliente) {
    cliente = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  }
  return cliente;
}

export async function cerrarBd(): Promise<void> {
  if (cliente) {
    await cliente.$disconnect();
    cliente = null;
  }
}

export const TENANT = ID.tenant;

/** El tenant del banco, con los flags que miran los capítulos. */
export async function tenant() {
  const t = await bd().tenant.findUniqueOrThrow({
    where: { id: TENANT },
    select: {
      agendaEnabled: true,
      holdedEnabled: true,
      crmEnabled: true,
      agendaSlotMinutes: true,
    },
  });
  return t;
}

export interface CitaEnBd {
  id: string;
  clientId: string | null;
  status: string;
  ticketId: string | null;
  /** Inicio del `timeslot`, en UTC. */
  inicio: Date;
  /** Fin del `timeslot`, en UTC. */
  fin: Date;
}

/** Las citas del tenant, en orden de inicio. `timeslot` por SQL crudo. */
export async function citas(): Promise<CitaEnBd[]> {
  return bd().$queryRawUnsafe<CitaEnBd[]>(
    `SELECT id, client_id AS "clientId", status::text AS status,
            ticket_id AS "ticketId",
            lower(timeslot) AS inicio, upper(timeslot) AS fin
       FROM appointments
      WHERE tenant_id = $1
      ORDER BY lower(timeslot), created_at`,
    TENANT,
  );
}

export async function cuantasCitas(): Promise<number> {
  return bd().appointment.count({ where: { tenantId: TENANT } });
}

export interface AsignacionEnBd {
  appointmentId: string;
  staffUserId: string | null;
  active: boolean;
  inicio: Date;
  fin: Date;
}

/** Las asignaciones: donde vive el EXCLUDE y donde se ve si un hueco
 *  cancelado dejó de bloquear (`active = false`). */
export async function asignaciones(): Promise<AsignacionEnBd[]> {
  return bd().$queryRawUnsafe<AsignacionEnBd[]>(
    `SELECT appointment_id AS "appointmentId", staff_user_id AS "staffUserId",
            active, lower(slot) AS inicio, upper(slot) AS fin
       FROM appointment_assignments
      WHERE tenant_id = $1
      ORDER BY lower(slot)`,
    TENANT,
  );
}

/** Una foto de la agenda para comparar antes/después de un «no». */
export async function fotoDeLaAgenda(): Promise<string> {
  const [cs, as] = await Promise.all([citas(), asignaciones()]);
  return JSON.stringify({ citas: cs, asignaciones: as });
}

export async function servicio(sku: string) {
  return bd().product.findFirstOrThrow({
    where: { tenantId: TENANT, sku },
    select: { id: true, name: true, sku: true },
  });
}

export async function agendaDeLosServicios() {
  return bd().serviceScheduling.findMany({
    where: { tenantId: TENANT },
    select: {
      productId: true,
      durationMin: true,
      bufferBeforeMin: true,
      bufferAfterMin: true,
      staffRequired: true,
    },
  });
}

export async function perfiles() {
  return bd().staffProfile.findMany({
    where: { tenantId: TENANT },
    select: { userId: true, displayName: true, color: true, active: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function skills() {
  return bd().staffSkill.findMany({
    where: { tenantId: TENANT },
    select: { userId: true, serviceId: true },
  });
}

export async function turnos() {
  return bd().staffShift.findMany({
    where: { tenantId: TENANT },
    select: { userId: true, rrule: true, startTime: true, endTime: true },
  });
}

export async function horarioDelCentro() {
  return bd().centerHours.findMany({
    where: { tenantId: TENANT },
    select: { weekday: true, openTime: true, closeTime: true },
    orderBy: { weekday: "asc" },
  });
}

export async function diasEspeciales() {
  return bd().centerDay.findMany({
    where: { tenantId: TENANT },
    select: { date: true, closed: true, name: true, openTime: true, closeTime: true },
    orderBy: { date: "asc" },
  });
}

export async function clientas() {
  return bd().client.findMany({
    where: { tenantId: TENANT },
    select: { id: true, firstName: true, lastName: true, phone: true, externalId: true },
    orderBy: { createdAt: "asc" },
  });
}
