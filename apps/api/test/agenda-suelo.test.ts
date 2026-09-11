// B-reservas-6a · EL SUELO de la agenda.
//
// Hasta este bloque el motor no sabía qué hora era: ofrecía y aceptaba
// ayer, y aceptaba las 10:07 llamando al endpoint (D-4b del cruce). Aquí se
// fija el pavimento, que NO es una política de `booking_policies` y no se
// configura:
//
//   · no se ofrece ni se reserva nada anterior al comienzo de la franja EN
//     CURSO de la retícula del centro (11:10 → las 11:00 valen, las 10:45 no);
//   · lo que `availability()` no ofrece, `hold()` no acepta — invariante 6;
//   · el inicio tiene que caer en la retícula, al crear Y al mover;
//   · y el suelo toca SÓLO el inicio: el estado de una cita pasada y su
//     cobro siguen funcionando igual (ver también `agenda-suelo.e2e.ts`).
//
// El reloj se inyecta: un motor con reloj de mentira es un motor que se
// puede probar. El "ahora" de todos estos tests son las 11:10 de pared del
// 10-08-2026, con Sole de 09:00 a 18:00.

import { describe, expect, it } from "vitest";

import { createCitaEngine } from "../src/agenda/engine.js";
import { currentGridStart, isOnGrid } from "../src/agenda/floor.js";
import { utcToWallTime, wallTimeToUtc } from "../src/agenda/time.js";
import type { ServiceRequirement, TemplateSlot } from "../src/agenda/types.js";
import { makeFakeStore } from "./helpers/agenda-fake-store.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CORTE = "33333333-3333-4333-8333-333333333333";
const SOLE = "55555555-5555-4555-8555-555555555555";

const HOY = "2026-08-10";
const AYER = "2026-08-09";
const MANANA = "2026-08-11";

function req(serviceId: string, durationMin: number): ServiceRequirement {
  return {
    serviceId,
    durationMin,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    staffRequired: 1,
    resourceNeeds: [],
  };
}

function turno(userId: string, date: string): TemplateSlot {
  return { userId, date, startTime: "09:00", endTime: "18:00" };
}

/** Instante UTC de una hora de pared del centro. */
function h(date: string, hhmm: string): Date {
  return wallTimeToUtc(date, hhmm);
}

/** Motor con el reloj clavado en `hhmm` del día `date`. */
function motorA(hhmm: string, date = HOY, dias = [HOY]) {
  const store = makeFakeStore({
    [TENANT]: {
      requirements: { [CORTE]: req(CORTE, 30) },
      skills: { [CORTE]: [SOLE] },
      templates: dias.map((d) => turno(SOLE, d)),
    },
  });
  const engine = createCitaEngine(store, {
    clock: { now: () => h(date, hhmm) },
  });
  return { store, engine };
}

function alta(start: Date) {
  return {
    tenantId: TENANT,
    externalId: null,
    clientId: null,
    items: [{ serviceId: CORTE }],
    start: start.toISOString(),
    source: "PRESENCIAL" as const,
    confirmed: true,
    pendingTtlMinutes: 10,
    notes: null,
  };
}

// ── El suelo mismo ────────────────────────────────────────────────────

describe("el suelo · dónde está", () => {
  it("a las 11:10 el suelo son las 11:00 (la franja EN CURSO)", () => {
    expect(currentGridStart(h(HOY, "11:10")).toISOString()).toBe(
      h(HOY, "11:00").toISOString(),
    );
  });

  it("a las 11:00 clavadas el suelo son las 11:00, no las 11:15", () => {
    expect(currentGridStart(h(HOY, "11:00")).toISOString()).toBe(
      h(HOY, "11:00").toISOString(),
    );
  });

  it("la retícula son los cuartos de hora, y el segundo cuenta", () => {
    expect(isOnGrid(h(HOY, "10:15"))).toBe(true);
    expect(isOnGrid(h(HOY, "10:07"))).toBe(false);
    expect(isOnGrid(new Date(h(HOY, "10:15").getTime() + 30_000))).toBe(false);
  });
});

// ── Al listar ─────────────────────────────────────────────────────────

describe("availability() no ofrece el pasado", () => {
  it("a las 11:10 el primer hueco es la franja en curso, las 11:00", async () => {
    const { engine } = motorA("11:10");
    const slots = await engine.availability({
      tenantId: TENANT,
      items: [{ serviceId: CORTE }],
      fromDate: HOY,
      toDate: HOY,
    });
    expect(slots[0]!.start).toBe(h(HOY, "11:00").toISOString());
    // Y nada de antes, ni siquiera el cuarto anterior.
    const horas = slots.map((s) => utcToWallTime(new Date(s.start)));
    expect(horas).not.toContain("10:45");
    expect(horas).not.toContain("09:00");
  });

  it("un día entero ya pasado no ofrece ni un hueco", async () => {
    const { engine } = motorA("11:10", HOY, [AYER]);
    const slots = await engine.availability({
      tenantId: TENANT,
      items: [{ serviceId: CORTE }],
      fromDate: AYER,
      toDate: AYER,
    });
    expect(slots).toEqual([]);
  });

  it("mañana se ofrece entero: el suelo es de hoy, no un horizonte", async () => {
    const { engine } = motorA("11:10", HOY, [MANANA]);
    const slots = await engine.availability({
      tenantId: TENANT,
      items: [{ serviceId: CORTE }],
      fromDate: MANANA,
      toDate: MANANA,
    });
    expect(slots[0]!.start).toBe(h(MANANA, "09:00").toISOString());
  });
});

// ── Al reservar ───────────────────────────────────────────────────────

describe("hold() y el suelo", () => {
  it("las 10:45 de hoy, a las 11:10, son 409 BOOKING_IN_PAST", async () => {
    const { engine } = motorA("11:10");
    const res = await engine.hold(alta(h(HOY, "10:45")));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("BOOKING_IN_PAST");
    // La frase se lee en voz alta a una clienta.
    expect(res.message).toContain("ya ha pasado");
    // Y trae los tres huecos siguientes que el motor SÍ ofrecería.
    expect(res.alternatives).toHaveLength(3);
    expect(res.alternatives[0]!.start).toBe(h(HOY, "11:00").toISOString());
    expect(res.message).toContain("11:00");
  });

  it("LA FRANJA EN CURSO SE RESERVA: las 11:00 a las 11:10, sí", async () => {
    const { engine } = motorA("11:10");
    const res = await engine.hold(alta(h(HOY, "11:00")));
    expect(res.ok).toBe(true);
  });

  it("el borde: 10:45 no, 11:00 sí, con el mismo reloj", async () => {
    const a = motorA("11:10");
    expect((await a.engine.hold(alta(h(HOY, "10:45")))).ok).toBe(false);
    const b = motorA("11:10");
    expect((await b.engine.hold(alta(h(HOY, "11:00")))).ok).toBe(true);
  });

  it("un día entero pasado también, con alternativas del día del suelo", async () => {
    const { engine } = motorA("11:10", HOY, [AYER, HOY]);
    const res = await engine.hold(alta(h(AYER, "10:00")));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("BOOKING_IN_PAST");
    // Las alternativas NO salen del día pedido (ayer no tiene ninguna):
    // salen del día del suelo. Una clienta al teléfono necesita una hora.
    expect(res.alternatives[0]!.start).toBe(h(HOY, "11:00").toISOString());
  });

  it("si hoy ya no queda nada, las alternativas son de MAÑANA", async () => {
    // DESTAPADO POR EL SABOTAJE: cambiar `toDate: nextWallDate(fromDate)`
    // por `toDate: fromDate` no ponía nada rojo. Y es el caso de la llamada
    // de las ocho y media de la tarde: "esa hora ya ha pasado" sin ninguna
    // hora detrás es medio error, que es justo lo que este bloque no quiere.
    const { engine } = motorA("19:00", HOY, [HOY, MANANA]);
    const res = await engine.hold(alta(h(HOY, "10:00")));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("BOOKING_IN_PAST");
    // El centro cierra a las 18:00: hoy no queda ni un hueco.
    expect(res.alternatives).toHaveLength(3);
    expect(res.alternatives[0]!.start).toBe(h(MANANA, "09:00").toISOString());
    expect(res.message).toContain("09:00");
  });

  it("las 10:07 de mañana son 409 BOOKING_OFF_GRID (la fuga de D-4b)", async () => {
    const { engine } = motorA("11:10", HOY, [MANANA]);
    const res = await engine.hold(alta(h(MANANA, "10:07")));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("BOOKING_OFF_GRID");
    expect(res.message).toContain("cuarto de hora");
    expect(res.alternatives).toHaveLength(3);
    expect(res.alternatives[0]!.start).toBe(h(MANANA, "10:15").toISOString());
  });

  it("y los 30 segundos de más también (10:15:30 no es la franja)", async () => {
    const { engine } = motorA("11:10", HOY, [MANANA]);
    const start = new Date(h(MANANA, "10:15").getTime() + 30_000);
    const res = await engine.hold(alta(start));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("BOOKING_OFF_GRID");
  });

  it("el pasado gana al fuera-de-retícula: 10:07 de ayer dice 'ya ha pasado'", async () => {
    const { engine } = motorA("11:10", HOY, [AYER, HOY]);
    const res = await engine.hold(alta(h(AYER, "10:07")));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // Es lo que hay que decirle a la clienta; la retícula le da igual.
    expect(res.reason).toBe("BOOKING_IN_PAST");
  });

  it("reenviar por externalId una cita YA creada no la tumba el suelo", async () => {
    // El alta offline del TPV sube con `externalId`. Si el corte de
    // idempotencia quedara DETRÁS del suelo, reenviar al reconectar una
    // cita que el servidor ya tiene fallaría sólo porque ha pasado el
    // tiempo — y el TPV la daría por perdida.
    const { store, engine } = motorA("09:05");
    const externalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const primera = await engine.hold({ ...alta(h(HOY, "09:30")), externalId });
    expect(primera.ok).toBe(true);

    // Mismo store, reloj movido a después de la cita.
    const tarde = createCitaEngine(store, {
      clock: { now: () => h(HOY, "12:00") },
    });
    const reenvio = await tarde.hold({
      ...alta(h(HOY, "09:30")),
      externalId,
    });
    expect(reenvio.ok).toBe(true);
    if (!reenvio.ok) return;
    expect(reenvio.duplicate).toBe(true);
  });
});

// ── El invariante 6 · listar ↔ reservar ───────────────────────────────

describe("invariante 6 · lo que no se lista, no se reserva", () => {
  it("un inicio que availability() no ofrecía FALLA en hold()", async () => {
    const { engine } = motorA("11:10");
    const slots = await engine.availability({
      tenantId: TENANT,
      items: [{ serviceId: CORTE }],
      fromDate: HOY,
      toDate: HOY,
    });
    const ofrecidos = new Set(slots.map((s) => s.start));

    // Las dos fugas conocidas, medidas contra la lista REAL, no contra
    // una constante escrita a mano.
    for (const candidato of [h(HOY, "10:45"), h(HOY, "11:07")]) {
      expect(ofrecidos.has(candidato.toISOString())).toBe(false);
      const res = await engine.hold(alta(candidato));
      expect(res.ok).toBe(false);
    }
  });

  it("y un inicio que SÍ ofrecía se reserva", async () => {
    const { engine } = motorA("11:10");
    const slots = await engine.availability({
      tenantId: TENANT,
      items: [{ serviceId: CORTE }],
      fromDate: HOY,
      toDate: HOY,
    });
    const res = await engine.hold(alta(new Date(slots[0]!.start)));
    expect(res.ok).toBe(true);
  });
});

// ── Al mover ──────────────────────────────────────────────────────────

describe("reschedule() y el suelo", () => {
  async function citaDeLas0930() {
    const { store, engine } = motorA("09:05");
    const res = await engine.hold(alta(h(HOY, "09:30")));
    if (!res.ok) throw new Error("la siembra tenía que entrar");
    return { store, id: res.appointment.id };
  }

  it("mover al pasado es 409 BOOKING_IN_PAST", async () => {
    const { store, id } = await citaDeLas0930();
    const tarde = createCitaEngine(store, {
      clock: { now: () => h(HOY, "11:10") },
    });
    const res = await tarde.reschedule(
      TENANT,
      id,
      h(HOY, "10:45").toISOString(),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("BOOKING_IN_PAST");
    expect(res.alternatives.length).toBeGreaterThan(0);
  });

  it("mover a las 10:07 es 409 BOOKING_OFF_GRID (la misma fuga, otra puerta)", async () => {
    const { store, id } = await citaDeLas0930();
    const antes = createCitaEngine(store, {
      clock: { now: () => h(HOY, "09:05") },
    });
    const res = await antes.reschedule(
      TENANT,
      id,
      h(HOY, "10:07").toISOString(),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("BOOKING_OFF_GRID");
  });

  it("mover una cita PASADA hacia adelante sí se puede", async () => {
    // Sólo el INICIO está bajo el suelo, y el inicio nuevo es futuro.
    const { store, id } = await citaDeLas0930();
    const tarde = createCitaEngine(store, {
      clock: { now: () => h(HOY, "11:10") },
    });
    const res = await tarde.reschedule(
      TENANT,
      id,
      h(HOY, "12:00").toISOString(),
    );
    expect(res.ok).toBe(true);
  });
});

// ── Lo que el suelo NO puede tocar ────────────────────────────────────

describe("el suelo no toca ni el estado ni el cobro de una cita pasada", () => {
  it("una cita de las 09:30 se finaliza a las 11:10", async () => {
    const { store, engine } = motorA("09:05");
    const alta0930 = await engine.hold(alta(h(HOY, "09:30")));
    if (!alta0930.ok) throw new Error("la siembra tenía que entrar");

    const tarde = createCitaEngine(store, {
      clock: { now: () => h(HOY, "11:10") },
    });
    // Cobrar una cita que ya pasó es LO NORMAL en un mostrador.
    const enSala = await tarde.setInService(TENANT, alta0930.appointment.id);
    expect(enSala?.status).toBe("IN_SERVICE");
    const hecha = await tarde.complete(TENANT, alta0930.appointment.id);
    expect(hecha?.status).toBe("COMPLETED");
  });

  it("y se puede cancelar o marcar no-show después de su hora", async () => {
    const { store, engine } = motorA("09:05");
    const a = await engine.hold(alta(h(HOY, "09:30")));
    if (!a.ok) throw new Error("la siembra tenía que entrar");
    const tarde = createCitaEngine(store, {
      clock: { now: () => h(HOY, "13:00") },
    });
    expect((await tarde.noShow(TENANT, a.appointment.id))?.status).toBe(
      "NO_SHOW",
    );
    expect((await tarde.cancel(TENANT, a.appointment.id))?.status).toBe(
      "CANCELLED",
    );
  });
});
