// B-reservas-7a · LA RETÍCULA del centro.
//
// Hasta este bloque era una constante: `SLOT_MINUTES = 15` en
// `agenda/time.ts`, repetida en el front como `SLOT_MIN` (6a §4.6).
// Peluquería Sole trabaja en franjas de 30 y le ofrecíamos inicios a y
// cuarto y menos cuarto.
//
// Ahora entra por `EngineOptions`, igual que `tz`: una sola lectura por
// petición y ninguna constante suelta. `floor.ts` ya aceptaba el paso como
// parámetro desde 6a, así que aquí no se reescribe aritmética — se deja de
// pasarle la constante.
//
// Lo que se fija con test:
//   · con 30 NO hay ningún inicio a y cuarto, ni al listar ni al reservar;
//   · un inicio a las 10:15 se rechaza con la frase de la media hora;
//   · el SUELO de 6a sigue siendo el comienzo de la franja EN CURSO, que
//     con 30 es el doble de grande: a las 11:29 valen las 11:00, a las
//     11:30 ya no (decisión del bloque, §2.1 de 6a);
//   · y todo eso aguanta el cambio de hora del 25-10.

import { describe, expect, it } from "vitest";

import { createCitaEngine, type EngineOptions } from "../src/agenda/engine.js";
import { currentGridStart, isOnGrid } from "../src/agenda/floor.js";
import { utcToWallTime, wallTimeToUtc } from "../src/agenda/time.js";
import type { ServiceRequirement, TemplateSlot } from "../src/agenda/types.js";
import { makeFakeStore } from "./helpers/agenda-fake-store.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CORTE = "33333333-3333-4333-8333-333333333333";
const SOLE = "55555555-5555-4555-8555-555555555555";
const HOY = "2026-09-08"; // martes

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

function turno(date: string, from = "09:00", to = "18:00"): TemplateSlot {
  return { userId: SOLE, date, startTime: from, endTime: to };
}

function motor(opts: EngineOptions, templates: TemplateSlot[] = [turno(HOY)]) {
  const store = makeFakeStore({
    [TENANT]: {
      requirements: { [CORTE]: req(CORTE, 30) },
      skills: { [CORTE]: [SOLE] },
      templates,
    },
  });
  return createCitaEngine(store, opts);
}

/** Reloj congelado antes de que abra el turno: el suelo no interfiere. */
const ANTES_DE_ABRIR = { now: () => wallTimeToUtc(HOY, "07:00") };

async function horasDe(
  engine: ReturnType<typeof motor>,
  date = HOY,
): Promise<string[]> {
  const slots = await engine.availability({
    tenantId: TENANT,
    items: [{ serviceId: CORTE }],
    fromDate: date,
    toDate: date,
  });
  return slots.map((s) => utcToWallTime(new Date(s.start)));
}

function alta(engine: ReturnType<typeof motor>, hhmm: string, date = HOY) {
  return engine.hold({
    tenantId: TENANT,
    externalId: null,
    clientId: null,
    items: [{ serviceId: CORTE }],
    start: wallTimeToUtc(date, hhmm).toISOString(),
    source: "PRESENCIAL",
    confirmed: true,
    pendingTtlMinutes: 10,
    notes: null,
  });
}

// ── Listar ────────────────────────────────────────────────────────────

describe("la retícula al listar", () => {
  it("sin configurar sigue siendo de 15 — el comportamiento de B4", async () => {
    const horas = await horasDe(motor({ clock: ANTES_DE_ABRIR }));
    expect(horas).toContain("09:15");
    expect(horas).toContain("09:45");
  });

  it("con 30 NO hay ningún inicio a y cuarto ni a menos cuarto", async () => {
    const horas = await horasDe(
      motor({ clock: ANTES_DE_ABRIR, slotMinutes: 30 }),
    );
    expect(horas.length).toBeGreaterThan(0);
    for (const h of horas) {
      expect(["00", "30"]).toContain(h.slice(3));
    }
    expect(horas[0]).toBe("09:00");
    expect(horas[1]).toBe("09:30");
  });

  it("con 30, un turno que empieza a y cuarto alinea hacia adelante", async () => {
    // Turno 09:15–12:00: el primer inicio de la retícula de 30 es 09:30.
    // No se inventa un hueco a las 09:15 que el centro no tiene.
    const horas = await horasDe(
      motor({ clock: ANTES_DE_ABRIR, slotMinutes: 30 }, [
        turno(HOY, "09:15", "12:00"),
      ]),
    );
    expect(horas[0]).toBe("09:30");
  });
});

// ── Reservar ──────────────────────────────────────────────────────────

describe("la retícula al reservar", () => {
  it("con 30, las 10:15 se rechazan con BOOKING_OFF_GRID", async () => {
    const res = await alta(
      motor({ clock: ANTES_DE_ABRIR, slotMinutes: 30 }),
      "10:15",
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("BOOKING_OFF_GRID");
  });

  it("y la frase que lee la cajera dice MEDIA HORA, no cuarto de hora", async () => {
    const res = await alta(
      motor({ clock: ANTES_DE_ABRIR, slotMinutes: 30 }),
      "10:15",
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("cada media hora");
      expect(res.message).not.toContain("cuarto de hora");
    }
  });

  it("las alternativas de ese rechazo TAMBIÉN caen en la retícula de 30", async () => {
    const res = await alta(
      motor({ clock: ANTES_DE_ABRIR, slotMinutes: 30 }),
      "10:15",
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.alternatives.length).toBeGreaterThan(0);
      for (const s of res.alternatives) {
        expect(["00", "30"]).toContain(
          utcToWallTime(new Date(s.start)).slice(3),
        );
      }
    }
  });

  it("las 10:30 sí entran", async () => {
    const res = await alta(
      motor({ clock: ANTES_DE_ABRIR, slotMinutes: 30 }),
      "10:30",
    );
    expect(res.ok).toBe(true);
  });

  it("el alta SIN RED que redondeó con otro paso la rechaza el servidor al volver", async () => {
    // El front viejo (APK sin actualizar) redondea a 15 y encola las 10:15.
    // Al reconectar, el servidor del centro que ya está a 30 la rechaza.
    // Es exactamente el filo del "Al desplegar": la retícula se cambia
    // DESPUÉS de instalar la APK nueva.
    const engine = motor({ clock: ANTES_DE_ABRIR, slotMinutes: 30 });
    const res = await engine.hold({
      tenantId: TENANT,
      externalId: null,
      clientId: null,
      items: [{ serviceId: CORTE }],
      start: wallTimeToUtc(HOY, "10:15").toISOString(),
      source: "PRESENCIAL",
      confirmed: true,
      pendingTtlMinutes: 10,
      notes: null,
      // Sellado por el outbox al encolar, dentro de la cota de 2 h.
      occurredAt: wallTimeToUtc(HOY, "07:00"),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("BOOKING_OFF_GRID");
  });

  it("MOVER una cita exige la retícula nueva igual que crearla", async () => {
    // Con 15 se crea a las 10:15; el centro pasa a 30 y moverla a las 11:15
    // ya no vale. La cita creada NO se toca — sólo el movimiento se juzga.
    const store = makeFakeStore({
      [TENANT]: {
        requirements: { [CORTE]: req(CORTE, 30) },
        skills: { [CORTE]: [SOLE] },
        templates: [turno(HOY)],
      },
    });
    const conQuince = createCitaEngine(store, { clock: ANTES_DE_ABRIR });
    const creada = await conQuince.hold({
      tenantId: TENANT,
      externalId: null,
      clientId: null,
      items: [{ serviceId: CORTE }],
      start: wallTimeToUtc(HOY, "10:15").toISOString(),
      source: "PRESENCIAL",
      confirmed: true,
      pendingTtlMinutes: 10,
      notes: null,
    });
    expect(creada.ok).toBe(true);
    if (!creada.ok) return;

    const conTreinta = createCitaEngine(store, {
      clock: ANTES_DE_ABRIR,
      slotMinutes: 30,
    });
    const movida = await conTreinta.reschedule(
      TENANT,
      creada.appointment.id,
      wallTimeToUtc(HOY, "11:15").toISOString(),
    );
    expect(movida.ok).toBe(false);
    if (!movida.ok) expect(movida.reason).toBe("BOOKING_OFF_GRID");

    // Y la cita sigue viva donde estaba: cambiar la retícula no mueve nada.
    const sigue = await conTreinta.reschedule(
      TENANT,
      creada.appointment.id,
      wallTimeToUtc(HOY, "11:30").toISOString(),
    );
    expect(sigue.ok).toBe(true);
  });
});

// ── El suelo de 6a con la retícula de 30 ──────────────────────────────
//
// La decisión de 6a §2.1 (la franja EN CURSO se reserva) se queda igual.
// Con 30 el precio es el mismo pero el doble de grande: se puede reservar
// hasta 29 minutos hacia atrás dentro de la franja viva. Es cómo lleva
// Sole su Excel, y por eso lleva un test en CADA borde.

describe("el suelo con retícula de 30", () => {
  it("a las 11:29 todavía se pueden dar las 11:00", async () => {
    const engine = motor({
      clock: { now: () => wallTimeToUtc(HOY, "11:29") },
      slotMinutes: 30,
    });
    const res = await alta(engine, "11:00");
    expect(res.ok).toBe(true);
  });

  it("a las 11:30 las 11:00 ya no", async () => {
    const engine = motor({
      clock: { now: () => wallTimeToUtc(HOY, "11:30") },
      slotMinutes: 30,
    });
    const res = await alta(engine, "11:00");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("BOOKING_IN_PAST");
  });

  it("el borde exacto: 11:29:59 sí, 11:30:00 no", () => {
    const antes = new Date(wallTimeToUtc(HOY, "11:29").getTime() + 59_000);
    const justo = wallTimeToUtc(HOY, "11:30");
    expect(currentGridStart(antes, "Europe/Madrid", 30).toISOString()).toBe(
      wallTimeToUtc(HOY, "11:00").toISOString(),
    );
    expect(currentGridStart(justo, "Europe/Madrid", 30).toISOString()).toBe(
      justo.toISOString(),
    );
  });

  it("a las 11:29 el primer hueco que se OFRECE son las 11:00", async () => {
    // Listar y reservar dicen lo mismo: es el invariante 6.
    const engine = motor({
      clock: { now: () => wallTimeToUtc(HOY, "11:29") },
      slotMinutes: 30,
    });
    const horas = await horasDe(engine);
    expect(horas[0]).toBe("11:00");
  });
});

// ── El cambio de hora, con retícula de 30 ─────────────────────────────

describe("el cambio de hora del 25-10-2026 con retícula de 30", () => {
  const CAMBIO = "2026-10-25"; // domingo de 25 horas en Europe/Madrid

  it("el suelo dentro de la hora REPETIDA nunca queda por delante de ahora", () => {
    // Las 02:00–03:00 se viven dos veces: esa hora de pared es ambigua y
    // `wallTimeToUtc` resuelve a la SEGUNDA pasada. Sin la caída al epoch
    // de `currentGridStart`, el suelo caería DESPUÉS de ahora y rechazaría
    // una cita perfectamente legal.
    const primeraPasada = new Date(
      wallTimeToUtc(CAMBIO, "01:40").getTime() + 20 * 60_000,
    ); // 02:00 de la PRIMERA pasada
    const suelo = currentGridStart(primeraPasada, "Europe/Madrid", 30);
    expect(suelo.getTime()).toBeLessThanOrEqual(primeraPasada.getTime());
  });

  it("los inicios del día siguen cayendo a en punto y a y media", async () => {
    const engine = motor(
      {
        clock: { now: () => wallTimeToUtc(CAMBIO, "07:00") },
        slotMinutes: 30,
      },
      [turno(CAMBIO, "09:00", "14:00")],
    );
    const horas = await horasDe(engine, CAMBIO);
    expect(horas.length).toBeGreaterThan(0);
    for (const h of horas) expect(["00", "30"]).toContain(h.slice(3));
  });

  it("isOnGrid con 30 no acepta ni los segundos ni los cuartos", () => {
    expect(isOnGrid(wallTimeToUtc(CAMBIO, "10:30"), "Europe/Madrid", 30)).toBe(
      true,
    );
    expect(isOnGrid(wallTimeToUtc(CAMBIO, "10:15"), "Europe/Madrid", 30)).toBe(
      false,
    );
    const conSegundos = new Date(
      wallTimeToUtc(CAMBIO, "10:30").getTime() + 30_000,
    );
    expect(isOnGrid(conSegundos, "Europe/Madrid", 30)).toBe(false);
  });
});
