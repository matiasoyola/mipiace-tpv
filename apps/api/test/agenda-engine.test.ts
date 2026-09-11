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
import { wallTimeToUtc } from "../src/agenda/time.js";
import type { ServiceRequirement, TemplateSlot } from "../src/agenda/types.js";
import { makeFakeStore } from "./helpers/agenda-fake-store.js";

// B-reservas-6a · el motor tiene reloj. Estos tests agendan el 10-08-2026 y
// hasta ahora pasaban porque el motor no sabía qué día era; con el suelo
// puesto pasarían a no ofrecer nada en cuanto esa fecha quedara atrás — que
// es hoy. El reloj se congela a las 07:00 de pared de ese día (antes de que
// abra el turno de las 09:00): ni una expectativa cambia, y el fichero deja
// de caducar.
const EL_DIA = {
  clock: { now: () => new Date(wallTimeToUtc("2026-08-10", "07:00")) },
};

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
    const engine = createCitaEngine(store, EL_DIA);
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
    const engine = createCitaEngine(store, EL_DIA);
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
    const engine = createCitaEngine(store, EL_DIA);
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
    const engine = createCitaEngine(store, EL_DIA);
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
    const engine = createCitaEngine(store, EL_DIA);
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
    const engine = createCitaEngine(store, EL_DIA);
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
    const engine = createCitaEngine(store, EL_DIA);
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
    const engine = createCitaEngine(store, EL_DIA);
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
    const engine = createCitaEngine(store, EL_DIA);
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
    const engine = createCitaEngine(store, EL_DIA);
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
    const engine = createCitaEngine(store, EL_DIA);
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
