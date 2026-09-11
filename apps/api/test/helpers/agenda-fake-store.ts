// Store en memoria del motor de agenda, compartido por los tests del motor
// (B-reservas-4) y los del suelo (B-reservas-6a).
//
// El harness del repo es fake-prisma y el GiST es comportamiento de
// Postgres. Solución: un `AgendaStore` en memoria que SIMULA el EXCLUDE del
// assignment (dos altas sobre el mismo profesional/recurso en intervalos
// solapados → ExclusionError). El motor depende de la INTERFAZ del store,
// así que estos tests ejercen la misma lógica que corre en producción sin
// una BD real.
//
// Lo que este fichero NO puede probar es que Postgres rechace de verdad:
// eso vive en `apps/api/test-e2e/agenda-suelo.e2e.ts`, contra una base real.
//
// Movido aquí tal cual desde `agenda-engine.test.ts` (B-reservas-6a): ni una
// línea de comportamiento cambiada.

import { randomUUID } from "node:crypto";

import {
  resolveCenterSchedule,
  type CenterDayRow,
  type CenterHoursRow,
} from "../../src/agenda/center-hours.js";
import { ExclusionError, type AgendaStore } from "../../src/agenda/store.js";
import type {
  AppointmentView,
  BlockInterval,
  Occupancy,
  ServiceRequirement,
  TemplateSlot,
} from "../../src/agenda/types.js";

export interface Seed {
  requirements: Record<string, ServiceRequirement>;
  skills: Record<string, string[]>; // serviceId -> userIds
  templates: TemplateSlot[]; // por tenant implícito
  resourcesByKind?: Record<string, string[]>;
  blocks?: BlockInterval[];
  // B-reservas-7a · el TECHO. Ausentes = el tenant no tiene horario
  // configurado ⇒ sin techo, que es como se comportaba antes del bloque.
  // Por eso los tests de B4, B-5 y 6a no se tocan: no siembran esto.
  centerHours?: CenterHoursRow[];
  centerDays?: CenterDayRow[];
}

// Store en memoria multi-tenant. Enforce del EXCLUDE: un staff/resource no
// puede tener dos assignments activos solapados (por tenant).
export function makeFakeStore(
  seedByTenant: Record<string, Seed>,
  // staleReads simula la ventana de carrera: los lectores ven el hueco libre
  // (getOccupancies vacío) aunque otro ya lo haya insertado; el EXCLUDE del
  // insert (checkExclusion) es quien resuelve — igual que el GiST real.
  opts: { staleReads?: boolean } = {},
): AgendaStore {
  interface StoredAssignment {
    tenantId: string;
    appointmentId: string;
    itemIndex: number | null;
    reservableType: "STAFF" | "RESOURCE" | "TABLE";
    staffUserId: string | null;
    resourceId: string | null;
    startsAt: Date;
    endsAt: Date;
    active: boolean;
  }
  interface StoredAppt {
    id: string;
    tenantId: string;
    externalId: string | null;
    clientId: string | null;
    status: AppointmentView["status"];
    source: AppointmentView["source"];
    start: Date;
    end: Date;
    ticketId: string | null;
    notes: string | null;
    items: AppointmentView["items"];
  }
  const appts: StoredAppt[] = [];
  const assigns: StoredAssignment[] = [];

  function overlapMs(a1: Date, a2: Date, b1: Date, b2: Date): boolean {
    return a1.getTime() < b2.getTime() && b1.getTime() < a2.getTime();
  }
  function checkExclusion(candidate: StoredAssignment): void {
    for (const a of assigns) {
      if (!a.active || a.tenantId !== candidate.tenantId) continue;
      if (
        candidate.staffUserId &&
        a.staffUserId === candidate.staffUserId &&
        overlapMs(candidate.startsAt, candidate.endsAt, a.startsAt, a.endsAt)
      ) {
        throw new ExclusionError();
      }
      if (
        candidate.resourceId &&
        a.resourceId === candidate.resourceId &&
        overlapMs(candidate.startsAt, candidate.endsAt, a.startsAt, a.endsAt)
      ) {
        throw new ExclusionError();
      }
    }
  }
  function toView(a: StoredAppt): AppointmentView {
    return {
      id: a.id,
      clientId: a.clientId,
      status: a.status,
      source: a.source,
      start: a.start.toISOString(),
      end: a.end.toISOString(),
      ticketId: a.ticketId,
      notes: a.notes,
      items: a.items,
      assignments: assigns
        .filter((x) => x.appointmentId === a.id)
        .map((x) => ({
          reservableType: x.reservableType,
          staffUserId: x.staffUserId,
          resourceId: x.resourceId,
        })),
    };
  }

  return {
    async getServiceRequirements(tenantId, serviceIds) {
      const seed = seedByTenant[tenantId];
      const map = new Map<string, ServiceRequirement>();
      if (!seed) return map;
      for (const sid of serviceIds) {
        const r = seed.requirements[sid];
        if (r) map.set(sid, r);
      }
      return map;
    },
    async getSkilledStaff(tenantId, serviceId) {
      return seedByTenant[tenantId]?.skills[serviceId] ?? [];
    },
    async getTemplateSlots(tenantId, userIds, from, to) {
      // B-reservas-6a · ANTES esto ignoraba la ventana `from`/`to` y
      // devolvía TODAS las plantillas sembradas. El store real
      // (`store.ts::getTemplateSlots`) sí la respeta, así que el falso
      // mentía a favor: una ventana mal calculada por el motor pasaba los
      // tests igual. Lo destapó un sabotaje —estrechar la ventana de las
      // alternativas al día pedido— que no ponía NADA rojo.
      const set = new Set(userIds);
      return (seedByTenant[tenantId]?.templates ?? []).filter(
        (t) => set.has(t.userId) && t.date >= from && t.date <= to,
      );
    },
    async getOccupancies(tenantId, from, to) {
      if (opts.staleReads) return [];
      const out: Occupancy[] = [];
      for (const a of assigns) {
        if (!a.active || a.tenantId !== tenantId) continue;
        if (!overlapMs(a.startsAt, a.endsAt, from, to)) continue;
        out.push({
          staffUserId: a.staffUserId,
          resourceId: a.resourceId,
          startsAt: a.startsAt,
          endsAt: a.endsAt,
        });
      }
      return out;
    },
    async getCenterSchedule(tenantId, fromDate, toDate) {
      // Misma resolución PURA que usa el store real: el falso trae las
      // filas sembradas y `center-hours.ts` decide. Si el falso tuviera su
      // propia lógica, mentiría a favor igual que mentía con la ventana de
      // `getTemplateSlots` antes de 6a.
      const seed = seedByTenant[tenantId];
      return resolveCenterSchedule(
        seed?.centerHours ?? [],
        seed?.centerDays ?? [],
        fromDate,
        toDate,
      );
    },
    async getBlocks(tenantId) {
      return seedByTenant[tenantId]?.blocks ?? [];
    },
    async getResourcesByKind(tenantId) {
      const map = new Map<string, string[]>();
      const r = seedByTenant[tenantId]?.resourcesByKind ?? {};
      for (const [k, v] of Object.entries(r)) map.set(k, v);
      return map;
    },
    async getStaffProfiles() {
      return [];
    },
    async insertHold(input) {
      const id = randomUUID();
      const candidates: StoredAssignment[] = input.assignments.map((a) => ({
        tenantId: input.tenantId,
        appointmentId: id,
        itemIndex: a.appointmentItemIndex,
        reservableType: a.reservableType,
        staffUserId: a.staffUserId,
        resourceId: a.resourceId,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        active: input.status !== "CANCELLED" && input.status !== "NO_SHOW",
      }));
      // El "GiST": valida cada candidato contra lo ya activo.
      for (const c of candidates) checkExclusion(c);
      appts.push({
        id,
        tenantId: input.tenantId,
        externalId: input.externalId,
        clientId: input.clientId,
        status: input.status,
        source: input.source,
        start: input.timeslotStart,
        end: input.timeslotEnd,
        ticketId: null,
        notes: input.notes,
        items: input.items.map((it, i) => ({
          id: `${id}-item-${i}`,
          serviceId: it.serviceId,
          durationMin: it.durationMin,
          sortOrder: it.sortOrder,
          startOffsetMin: it.startOffsetMin,
        })),
      });
      assigns.push(...candidates);
      return toView(appts.find((a) => a.id === id)!);
    },
    async findByExternalId(tenantId, externalId) {
      const a = appts.find(
        (x) => x.tenantId === tenantId && x.externalId === externalId,
      );
      return a ? toView(a) : null;
    },
    async getAppointmentView(tenantId, id) {
      const a = appts.find((x) => x.tenantId === tenantId && x.id === id);
      return a ? toView(a) : null;
    },
    async listAppointments(tenantId, from, to) {
      return appts
        .filter(
          (a) =>
            a.tenantId === tenantId &&
            a.status !== "CANCELLED" &&
            overlapMs(a.start, a.end, from, to),
        )
        .map(toView);
    },
    async setStatus(tenantId, id, status) {
      const a = appts.find((x) => x.tenantId === tenantId && x.id === id);
      if (!a) return null;
      a.status = status;
      const active = status !== "CANCELLED" && status !== "NO_SHOW";
      for (const x of assigns) if (x.appointmentId === id) x.active = active;
      return toView(a);
    },
    async reschedule(tenantId, id, start, end, assignments) {
      const a = appts.find((x) => x.tenantId === tenantId && x.id === id);
      if (!a) return null;
      // Quita los viejos, valida los nuevos (GiST), inserta.
      for (let i = assigns.length - 1; i >= 0; i--) {
        if (assigns[i]!.appointmentId === id) assigns.splice(i, 1);
      }
      const candidates: StoredAssignment[] = assignments.map((x) => ({
        tenantId,
        appointmentId: id,
        itemIndex: x.appointmentItemIndex,
        reservableType: x.reservableType,
        staffUserId: x.staffUserId,
        resourceId: x.resourceId,
        startsAt: x.startsAt,
        endsAt: x.endsAt,
        active: true,
      }));
      for (const c of candidates) checkExclusion(c);
      assigns.push(...candidates);
      a.start = start;
      a.end = end;
      return toView(a);
    },
    async linkTicket(tenantId, id, ticketId) {
      const a = appts.find((x) => x.tenantId === tenantId && x.id === id);
      if (a) a.ticketId = ticketId;
    },
    async expireHolds() {
      return 0;
    },
    async listForClient(tenantId, clientId) {
      return appts
        .filter((a) => a.tenantId === tenantId && a.clientId === clientId)
        .map(toView);
    },
    async listBlocks() {
      return [];
    },
    async createBlock() {
      return { id: randomUUID() };
    },
    async deleteBlock() {
      return true;
    },
  };
}

