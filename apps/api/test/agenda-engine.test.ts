// Tests del motor de reservas (B-reservas-4, modo CITA). El harness del repo
// es fake-prisma; el GiST es comportamiento de Postgres. Solución: un
// `AgendaStore` EN MEMORIA que simula el EXCLUDE del assignment (dos altas
// sobre el mismo profesional/recurso en intervalos solapados → ExclusionError).
// El motor depende de la INTERFAZ del store, así que estos tests ejercen la
// misma lógica que corre en producción sin necesidad de una BD real.
//
// Cubre: disponibilidad (skill ∩ turno ∩ libre), K-matching (staffRequired>1),
// zona horaria (Europe/Madrid → UTC), carrera GiST resuelta por la BD
// (simulada), aislamiento por tenant, reprogramación.

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createCitaEngine } from "../src/agenda/engine.js";
import { ExclusionError, type AgendaStore } from "../src/agenda/store.js";
import { wallTimeToUtc } from "../src/agenda/time.js";
import type {
  AppointmentView,
  BlockInterval,
  Occupancy,
  ServiceRequirement,
  TemplateSlot,
} from "../src/agenda/types.js";

interface Seed {
  requirements: Record<string, ServiceRequirement>;
  skills: Record<string, string[]>; // serviceId -> userIds
  templates: TemplateSlot[]; // por tenant implícito
  resourcesByKind?: Record<string, string[]>;
  blocks?: BlockInterval[];
}

// Store en memoria multi-tenant. Enforce del EXCLUDE: un staff/resource no
// puede tener dos assignments activos solapados (por tenant).
function makeFakeStore(
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
    async getTemplateSlots(tenantId, userIds, _from, _to) {
      const set = new Set(userIds);
      return (seedByTenant[tenantId]?.templates ?? []).filter((t) =>
        set.has(t.userId),
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

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CORTE = "33333333-3333-4333-8333-333333333333";
const TINTE = "44444444-4444-4444-8444-444444444444";
const SOLE = "55555555-5555-4555-8555-555555555555";
const ANA = "66666666-6666-4666-8666-666666666666";

function req(
  serviceId: string,
  durationMin: number,
  staffRequired = 1,
  needs: ServiceRequirement["resourceNeeds"] = [],
): ServiceRequirement {
  return {
    serviceId,
    durationMin,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    staffRequired,
    resourceNeeds: needs,
  };
}

function fullDayTemplate(userId: string, date: string): TemplateSlot {
  return { userId, date, startTime: "09:00", endTime: "18:00" };
}

describe("disponibilidad (cita)", () => {
  it("devuelve huecos para un servicio con Sole disponible", async () => {
    const store = makeFakeStore({
      [TENANT]: {
        requirements: { [CORTE]: req(CORTE, 30) },
        skills: { [CORTE]: [SOLE] },
        templates: [fullDayTemplate(SOLE, "2026-08-10")],
      },
    });
    const engine = createCitaEngine(store);
    const slots = await engine.availability({
      tenantId: TENANT,
      items: [{ serviceId: CORTE }],
      fromDate: "2026-08-10",
      toDate: "2026-08-10",
    });
    // 09:00–18:00 = 9h, servicio 30min, rejilla 15min → muchos huecos.
    expect(slots.length).toBeGreaterThan(20);
    // Primer hueco a las 09:00 hora local de Madrid (verano = UTC+2 → 07:00Z).
    expect(slots[0]!.start).toBe(
      wallTimeToUtc("2026-08-10", "09:00").toISOString(),
    );
  });

  it("ignora un servicio sin scheduling (no agendable)", async () => {
    const store = makeFakeStore({
      [TENANT]: {
        requirements: {},
        skills: { [CORTE]: [SOLE] },
        templates: [fullDayTemplate(SOLE, "2026-08-10")],
      },
    });
    const engine = createCitaEngine(store);
    const slots = await engine.availability({
      tenantId: TENANT,
      items: [{ serviceId: CORTE }],
      fromDate: "2026-08-10",
      toDate: "2026-08-10",
    });
    expect(slots).toEqual([]);
  });

  it("multi-servicio encadenable: corte+tinte con Sole (duración total)", async () => {
    const store = makeFakeStore({
      [TENANT]: {
        requirements: { [CORTE]: req(CORTE, 30), [TINTE]: req(TINTE, 45) },
        skills: { [CORTE]: [SOLE], [TINTE]: [SOLE] },
        templates: [fullDayTemplate(SOLE, "2026-08-10")],
      },
    });
    const engine = createCitaEngine(store);
    const slots = await engine.availability({
      tenantId: TENANT,
      items: [{ serviceId: CORTE }, { serviceId: TINTE }],
      fromDate: "2026-08-10",
      toDate: "2026-08-10",
    });
    expect(slots.length).toBeGreaterThan(0);
    // Visit = 75 min. El hueco de las 09:00 termina 10:15.
    expect(slots[0]!.start).toBe(
      wallTimeToUtc("2026-08-10", "09:00").toISOString(),
    );
    expect(slots[0]!.end).toBe(
      wallTimeToUtc("2026-08-10", "10:15").toISOString(),
    );
  });
});

describe("K-matching (staffRequired > 1)", () => {
  it("no hay hueco si sólo 1 profesional y el servicio requiere 2", async () => {
    const store = makeFakeStore({
      [TENANT]: {
        requirements: { [CORTE]: req(CORTE, 30, 2) },
        skills: { [CORTE]: [SOLE] }, // sólo 1
        templates: [fullDayTemplate(SOLE, "2026-08-10")],
      },
    });
    const engine = createCitaEngine(store);
    const slots = await engine.availability({
      tenantId: TENANT,
      items: [{ serviceId: CORTE }],
      fromDate: "2026-08-10",
      toDate: "2026-08-10",
    });
    expect(slots).toEqual([]);
  });

  it("sí hay hueco con 2 profesionales compatibles simultáneos", async () => {
    const store = makeFakeStore({
      [TENANT]: {
        requirements: { [CORTE]: req(CORTE, 30, 2) },
        skills: { [CORTE]: [SOLE, ANA] },
        templates: [
          fullDayTemplate(SOLE, "2026-08-10"),
          fullDayTemplate(ANA, "2026-08-10"),
        ],
      },
    });
    const engine = createCitaEngine(store);
    const slots = await engine.availability({
      tenantId: TENANT,
      items: [{ serviceId: CORTE }],
      fromDate: "2026-08-10",
      toDate: "2026-08-10",
    });
    expect(slots.length).toBeGreaterThan(0);
  });
});

describe("carrera GiST resuelta por la BD (simulada)", () => {
  it("secuencial: la 2ª alta ve el hueco ocupado y recibe alternativas", async () => {
    const store = makeFakeStore({
      [TENANT]: {
        requirements: { [CORTE]: req(CORTE, 30) },
        skills: { [CORTE]: [SOLE] }, // un único profesional → hueco único
        templates: [fullDayTemplate(SOLE, "2026-08-10")],
      },
    });
    const engine = createCitaEngine(store);
    const start = wallTimeToUtc("2026-08-10", "09:00").toISOString();
    const base = {
      tenantId: TENANT,
      externalId: null,
      clientId: null,
      items: [{ serviceId: CORTE }],
      start,
      source: "PRESENCIAL" as const,
      confirmed: true,
      pendingTtlMinutes: 10,
      notes: null,
    };
    const first = await engine.hold(base);
    const second = await engine.hold(base);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      // Hueco perdido (NO_SLOT en secuencial): siguiente hueco libre (09:15).
      expect(second.alternatives.length).toBeGreaterThan(0);
      expect(second.alternatives[0]!.start).not.toBe(start);
    }
  });

  it("carrera real: ambas pasan el pre-check, el EXCLUDE del INSERT gana → TAKEN", async () => {
    // staleReads: los dos lectores ven el hueco libre (ventana de carrera);
    // el checkExclusion del insert (= GiST) rechaza al segundo.
    const store = makeFakeStore(
      {
        [TENANT]: {
          requirements: { [CORTE]: req(CORTE, 30) },
          skills: { [CORTE]: [SOLE] },
          templates: [fullDayTemplate(SOLE, "2026-08-10")],
        },
      },
      { staleReads: true },
    );
    const engine = createCitaEngine(store);
    const start = wallTimeToUtc("2026-08-10", "09:00").toISOString();
    const base = {
      tenantId: TENANT,
      externalId: null,
      clientId: null,
      items: [{ serviceId: CORTE }],
      start,
      source: "PRESENCIAL" as const,
      confirmed: true,
      pendingTtlMinutes: 10,
      notes: null,
    };
    const first = await engine.hold(base);
    const second = await engine.hold(base);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("TAKEN");
      expect(second.alternatives.length).toBeGreaterThan(0);
    }
  });

  it("libera el hueco al cancelar y permite re-reservar", async () => {
    const store = makeFakeStore({
      [TENANT]: {
        requirements: { [CORTE]: req(CORTE, 30) },
        skills: { [CORTE]: [SOLE] },
        templates: [fullDayTemplate(SOLE, "2026-08-10")],
      },
    });
    const engine = createCitaEngine(store);
    const start = wallTimeToUtc("2026-08-10", "09:00").toISOString();
    const base = {
      tenantId: TENANT,
      externalId: null,
      clientId: null,
      items: [{ serviceId: CORTE }],
      start,
      source: "PRESENCIAL" as const,
      confirmed: true,
      pendingTtlMinutes: 10,
      notes: null,
    };
    const first = await engine.hold(base);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await engine.cancel(TENANT, first.appointment.id);
    // Tras cancelar, el hueco vuelve a estar libre.
    const retry = await engine.hold(base);
    expect(retry.ok).toBe(true);
  });
});

describe("aislamiento por tenant", () => {
  it("una cita de OTHER no aparece ni bloquea en TENANT", async () => {
    const store = makeFakeStore({
      [TENANT]: {
        requirements: { [CORTE]: req(CORTE, 30) },
        skills: { [CORTE]: [SOLE] },
        templates: [fullDayTemplate(SOLE, "2026-08-10")],
      },
      [OTHER]: {
        requirements: { [CORTE]: req(CORTE, 30) },
        skills: { [CORTE]: [SOLE] },
        templates: [fullDayTemplate(SOLE, "2026-08-10")],
      },
    });
    const engine = createCitaEngine(store);
    const start = wallTimeToUtc("2026-08-10", "09:00").toISOString();
    // OTHER reserva el hueco de las 09:00 con "el mismo" userId.
    const otherHold = await engine.hold({
      tenantId: OTHER,
      externalId: null,
      clientId: null,
      items: [{ serviceId: CORTE }],
      start,
      source: "PRESENCIAL",
      confirmed: true,
      pendingTtlMinutes: 10,
      notes: null,
    });
    expect(otherHold.ok).toBe(true);
    // TENANT puede reservar el mismo hueco: los EXCLUDE son por tenant.
    const tenantHold = await engine.hold({
      tenantId: TENANT,
      externalId: null,
      clientId: null,
      items: [{ serviceId: CORTE }],
      start,
      source: "PRESENCIAL",
      confirmed: true,
      pendingTtlMinutes: 10,
      notes: null,
    });
    expect(tenantHold.ok).toBe(true);
    // GET /agenda de TENANT no ve la cita de OTHER.
    const from = wallTimeToUtc("2026-08-10", "00:00");
    const to = wallTimeToUtc("2026-08-10", "23:59");
    const list = await store.listAppointments(TENANT, from, to);
    expect(list.length).toBe(1);
  });
});

describe("idempotencia del alta offline (externalId)", () => {
  it("un reintento con el mismo externalId devuelve la cita ya creada", async () => {
    const store = makeFakeStore({
      [TENANT]: {
        requirements: { [CORTE]: req(CORTE, 30) },
        skills: { [CORTE]: [SOLE] },
        templates: [fullDayTemplate(SOLE, "2026-08-10")],
      },
    });
    const engine = createCitaEngine(store);
    const externalId = randomUUID();
    const base = {
      tenantId: TENANT,
      externalId,
      clientId: null,
      items: [{ serviceId: CORTE }],
      start: wallTimeToUtc("2026-08-10", "09:00").toISOString(),
      source: "PRESENCIAL" as const,
      confirmed: true,
      pendingTtlMinutes: 10,
      notes: null,
    };
    const first = await engine.hold(base);
    const retry = await engine.hold(base);
    expect(first.ok && retry.ok).toBe(true);
    if (first.ok && retry.ok) {
      expect(retry.duplicate).toBe(true);
      expect(retry.appointment.id).toBe(first.appointment.id);
    }
  });
});

describe("reprogramar (mover slot)", () => {
  it("mueve una cita a otro hueco libre", async () => {
    const store = makeFakeStore({
      [TENANT]: {
        requirements: { [CORTE]: req(CORTE, 30) },
        skills: { [CORTE]: [SOLE] },
        templates: [fullDayTemplate(SOLE, "2026-08-10")],
      },
    });
    const engine = createCitaEngine(store);
    const hold = await engine.hold({
      tenantId: TENANT,
      externalId: null,
      clientId: null,
      items: [{ serviceId: CORTE }],
      start: wallTimeToUtc("2026-08-10", "09:00").toISOString(),
      source: "PRESENCIAL",
      confirmed: true,
      pendingTtlMinutes: 10,
      notes: null,
    });
    expect(hold.ok).toBe(true);
    if (!hold.ok) return;
    const newStart = wallTimeToUtc("2026-08-10", "11:00").toISOString();
    const moved = await engine.reschedule(TENANT, hold.appointment.id, newStart);
    expect(moved.ok).toBe(true);
    if (moved.ok) expect(moved.appointment.start).toBe(newStart);
  });
});
