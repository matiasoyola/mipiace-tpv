// B-reservas-6a · INVARIANTE 14 · la disponibilidad se calcula en la zona
// del CENTRO, y el test se repite bajo otra TZ del sistema.
//
// Hasta aquí `grep "process.env.TZ"` sobre `apps/api/test` daba **cero**
// (Parte 4 del cruce): `agenda-time.test.ts` cubría verano e invierno, pero
// siempre bajo la zona del Mac de quien lo corría. Un motor que se apoye sin
// querer en la hora local del proceso pasa ese test en Madrid y miente en
// cualquier otro sitio — y el servidor no tiene por qué estar en Madrid.
//
// Este fichero corre bajo `TZ=America/New_York` (−6 h respecto a Madrid en
// verano) y repite lo que el suelo y la retícula tienen de aritmética
// horaria. Si alguien mete un `getHours()` en el camino, aquí se cae.
//
// Y el cambio de hora del 25-10-2026 en Europe/Madrid: la primera semana de
// Peluquería Sole con agenda puede caer ahí. Ese domingo el reloj vuelve de
// las 03:00 CEST a las 02:00 CET y el día dura 25 horas.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCitaEngine } from "../src/agenda/engine.js";
import { currentGridStart, isOnGrid } from "../src/agenda/floor.js";
import {
  gridStarts,
  utcToWallDate,
  utcToWallTime,
  wallTimeToUtc,
} from "../src/agenda/time.js";
import type { ServiceRequirement, TemplateSlot } from "../src/agenda/types.js";
import { makeFakeStore } from "./helpers/agenda-fake-store.js";

// La zona del PROCESO, no la del centro. Se pone antes de que ningún test
// toque una fecha y se devuelve al terminar: el worker de vitest se reutiliza
// para otros ficheros.
const TZ_ORIGINAL = process.env.TZ;
process.env.TZ = "America/New_York";

beforeAll(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  if (TZ_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ORIGINAL;
});

const TENANT = "11111111-1111-4111-8111-111111111111";
const CORTE = "33333333-3333-4333-8333-333333333333";
const SOLE = "55555555-5555-4555-8555-555555555555";

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

function turno(date: string): TemplateSlot {
  return { userId: SOLE, date, startTime: "09:00", endTime: "18:00" };
}

function motor(ahora: Date, dias: string[]) {
  const store = makeFakeStore({
    [TENANT]: {
      requirements: { [CORTE]: req(CORTE, 30) },
      skills: { [CORTE]: [SOLE] },
      templates: dias.map(turno),
    },
  });
  return {
    store,
    engine: createCitaEngine(store, { clock: { now: () => ahora } }),
  };
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

describe("bajo TZ=America/New_York · el proceso no manda", () => {
  it("la TZ del proceso es de verdad otra (si no, este fichero no prueba nada)", () => {
    expect(process.env.TZ).toBe("America/New_York");
    // Y la zona local del proceso NO es la del centro: 09:00 de pared en
    // Madrid pintado con la hora local del Mac daría las 03:00.
    const madrid9 = wallTimeToUtc("2026-08-10", "09:00");
    expect(madrid9.getHours()).not.toBe(9);
  });

  it("09:00 de pared en Madrid siguen siendo 07:00Z en verano", () => {
    expect(wallTimeToUtc("2026-08-10", "09:00").toISOString()).toBe(
      "2026-08-10T07:00:00.000Z",
    );
  });

  it("09:00 de pared en Madrid siguen siendo 08:00Z en invierno", () => {
    expect(wallTimeToUtc("2026-01-15", "09:00").toISOString()).toBe(
      "2026-01-15T08:00:00.000Z",
    );
  });

  it("ida y vuelta UTC → pared del centro, sin pasar por la del proceso", () => {
    const utc = wallTimeToUtc("2026-08-10", "13:30");
    expect(utcToWallDate(utc)).toBe("2026-08-10");
    expect(utcToWallTime(utc)).toBe("13:30");
  });

  it("la retícula de 15 min no la mueve la zona del proceso", () => {
    expect(gridStarts(540, 600, 30)).toEqual([540, 555, 570]);
    expect(isOnGrid(wallTimeToUtc("2026-08-10", "10:15"))).toBe(true);
    expect(isOnGrid(wallTimeToUtc("2026-08-10", "10:07"))).toBe(false);
  });

  it("el suelo se calcula en la pared del CENTRO: 11:10 en Madrid → 11:00", () => {
    const ahora = wallTimeToUtc("2026-08-10", "11:10");
    expect(currentGridStart(ahora).toISOString()).toBe(
      wallTimeToUtc("2026-08-10", "11:00").toISOString(),
    );
    // En Nueva York eso son las 05:10, y el suelo NO son las 05:00 de allí.
    expect(utcToWallTime(currentGridStart(ahora))).toBe("11:00");
  });

  it("y si el CENTRO estuviera en Nueva York, el motor iría a su hora", async () => {
    // DESTAPADO POR EL SABOTAJE: devolver `const tz = CENTER_TZ` dentro del
    // motor no ponía NADA rojo. La `tz` inyectable era una promesa sin
    // testigo — y es justo la pieza que el día que `Tenant` tenga columna de
    // huso se enchufa en una línea.
    const store = makeFakeStore({
      [TENANT]: {
        requirements: { [CORTE]: req(CORTE, 30) },
        skills: { [CORTE]: [SOLE] },
        templates: [
          { userId: SOLE, date: "2026-08-10", startTime: "09:00", endTime: "18:00" },
        ],
      },
    });
    const NY = "America/New_York";
    // 20:10Z. En Nueva York (EDT, UTC−4) son las 16:10 —dentro del turno de
    // 09:00 a 18:00—; en Madrid (CEST, UTC+2) son las 22:10, con el centro
    // cerrado hace cuatro horas. El instante está elegido para que las dos
    // zonas NO puedan dar la misma respuesta: con la tz de Madrid clavada,
    // este día no ofrece ni un hueco.
    const engine = createCitaEngine(store, {
      tz: NY,
      clock: { now: () => new Date("2026-08-10T20:10:00.000Z") },
    });
    const slots = await engine.availability({
      tenantId: TENANT,
      items: [{ serviceId: CORTE }],
      fromDate: "2026-08-10",
      toDate: "2026-08-10",
    });
    // El suelo son las 16:00 de NUEVA YORK = 20:00Z.
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]!.start).toBe("2026-08-10T20:00:00.000Z");
    expect(utcToWallTime(new Date(slots[0]!.start), NY)).toBe("16:00");

    // Y al reservar manda la misma tz: las 16:00 de Nueva York ENTRAN. Con
    // Madrid clavada serían las 22:00, fuera del turno → NO_SLOT.
    const res = await engine.hold({
      tenantId: TENANT,
      externalId: null,
      clientId: null,
      items: [{ serviceId: CORTE }],
      start: "2026-08-10T20:00:00.000Z",
      source: "PRESENCIAL",
      confirmed: true,
      pendingTtlMinutes: 10,
      notes: null,
    });
    expect(res.ok).toBe(true);
  });

  it("y la agenda entera se comporta igual: 11:00 sí, 10:45 no", async () => {
    const ahora = wallTimeToUtc("2026-08-10", "11:10");
    const a = motor(ahora, ["2026-08-10"]);
    const slots = await a.engine.availability({
      tenantId: TENANT,
      items: [{ serviceId: CORTE }],
      fromDate: "2026-08-10",
      toDate: "2026-08-10",
    });
    expect(slots[0]!.start).toBe(
      wallTimeToUtc("2026-08-10", "11:00").toISOString(),
    );

    const b = motor(ahora, ["2026-08-10"]);
    const pasado = await b.engine.hold(
      alta(wallTimeToUtc("2026-08-10", "10:45")),
    );
    expect(pasado.ok).toBe(false);
    if (!pasado.ok) expect(pasado.reason).toBe("BOOKING_IN_PAST");

    const c = motor(ahora, ["2026-08-10"]);
    expect((await c.engine.hold(alta(wallTimeToUtc("2026-08-10", "11:00")))).ok)
      .toBe(true);
  });
});

// ── El cambio de hora del 25-10-2026 en Europe/Madrid ─────────────────

describe("el domingo del cambio de hora (25-10-2026, Europe/Madrid)", () => {
  const DOMINGO = "2026-10-25";
  const SABADO = "2026-10-24";

  it("el sábado 09:00 son 07:00Z (CEST) y el domingo 08:00Z (CET)", () => {
    expect(wallTimeToUtc(SABADO, "09:00").toISOString()).toBe(
      "2026-10-24T07:00:00.000Z",
    );
    expect(wallTimeToUtc(DOMINGO, "09:00").toISOString()).toBe(
      "2026-10-25T08:00:00.000Z",
    );
  });

  it("el salto es a las 03:00 CEST → 02:00 CET, y ahí está la hora repetida", () => {
    // 00:30Z todavía es CEST (02:30 de la primera pasada).
    expect(utcToWallTime(new Date("2026-10-25T00:30:00.000Z"))).toBe("02:30");
    // 01:30Z ya es CET (02:30 de la segunda pasada). La MISMA hora de pared.
    expect(utcToWallTime(new Date("2026-10-25T01:30:00.000Z"))).toBe("02:30");
  });

  it("el suelo NUNCA queda por delante de ahora, ni en la hora repetida", () => {
    // Sin la guarda de `currentGridStart`, la hora de pared ambigua
    // resolvería a la SEGUNDA pasada (01:30Z) estando en la primera
    // (00:30Z): un suelo en el futuro rechazando una cita legal.
    for (const iso of [
      "2026-10-25T00:30:00.000Z",
      "2026-10-25T00:47:00.000Z",
      "2026-10-25T01:30:00.000Z",
      "2026-10-25T08:10:00.000Z",
    ]) {
      const ahora = new Date(iso);
      const suelo = currentGridStart(ahora);
      expect(suelo.getTime()).toBeLessThanOrEqual(ahora.getTime());
      // Y nunca se aleja más de una franja de más (la guarda del epoch).
      expect(ahora.getTime() - suelo.getTime()).toBeLessThan(15 * 60_000);
    }
  });

  it("a las 09:10 de ese domingo el suelo son las 09:00 de pared (08:00Z)", () => {
    const ahora = new Date("2026-10-25T08:10:00.000Z");
    expect(currentGridStart(ahora).toISOString()).toBe(
      "2026-10-25T08:00:00.000Z",
    );
    expect(utcToWallTime(currentGridStart(ahora))).toBe("09:00");
  });

  it("ese día la agenda ofrece desde las 09:00 de pared y ni un minuto antes", async () => {
    const ahora = new Date("2026-10-25T08:10:00.000Z"); // 09:10 CET
    const { engine } = motor(ahora, [DOMINGO]);
    const slots = await engine.availability({
      tenantId: TENANT,
      items: [{ serviceId: CORTE }],
      fromDate: DOMINGO,
      toDate: DOMINGO,
    });
    expect(slots[0]!.start).toBe("2026-10-25T08:00:00.000Z");
    expect(utcToWallTime(new Date(slots[0]!.start))).toBe("09:00");
    // 09:00–18:00 con servicio de 30 min y retícula de 15 → 35 inicios.
    expect(slots).toHaveLength(35);
  });

  it("y una cita del sábado NO se puede crear el domingo (cruza el cambio)", async () => {
    const ahora = new Date("2026-10-25T08:10:00.000Z");
    const { engine } = motor(ahora, [SABADO, DOMINGO]);
    const res = await engine.hold(alta(wallTimeToUtc(SABADO, "17:00")));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("BOOKING_IN_PAST");
    // Las alternativas son del domingo, ya en CET.
    expect(res.alternatives[0]!.start).toBe("2026-10-25T08:00:00.000Z");
  });

  it("reservar a las 09:00 de ese domingo entra, con su instante CET", async () => {
    const ahora = new Date("2026-10-25T08:00:00.000Z");
    const { engine } = motor(ahora, [DOMINGO]);
    const res = await engine.hold(alta(wallTimeToUtc(DOMINGO, "09:00")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.appointment.start).toBe("2026-10-25T08:00:00.000Z");
    expect(res.appointment.end).toBe("2026-10-25T08:30:00.000Z");
  });
});
