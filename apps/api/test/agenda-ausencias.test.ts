// B-reservas-7a · LAS AUSENCIAS y lo que la cajera ve en la rejilla.
//
// Sole escribe las ausencias en la celda del Excel: «Ana libre» el miércoles
// entero y en rojo, «ISA NO» de 9:00 a 10:30. Hasta este bloque la agenda
// podía quitar esos huecos —un `BookingBlock scope=STAFF` ya lo hacía— pero
// NO los pintaba: la columna se veía igual de blanca que si estuviera libre,
// y el hueco desaparecía sin decir por qué.
//
// Por debajo NO hay entidad nueva de ausencias: es el `BookingBlock STAFF`
// de siempre, por la API que ya existe y que ya podía llamar el cajero. Lo
// que cambia es que ahora su `id` y su `reason` llegan a la pantalla.
//
// Y el día entero son 23 o 25 horas los dos domingos del cambio de hora. Ese
// borde tiene aquí su test, porque restar 24 horas es la forma normal de
// equivocarse.

import { describe, expect, it } from "vitest";

import { buildAgendaDays } from "../src/agenda/day-view.js";
import { CENTER_TZ, wallTimeToUtc } from "../src/agenda/time.js";
import type {
  BlockInterval,
  ServiceRequirement,
  TemplateSlot,
} from "../src/agenda/types.js";
import type { CenterDayRow, CenterHoursRow } from "../src/agenda/center-hours.js";
import { makeFakeStore } from "./helpers/agenda-fake-store.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CORTE = "33333333-3333-4333-8333-333333333333";
const ANA = "66666666-6666-4666-8666-666666666666";
const ISA = "77777777-7777-4777-8777-777777777777";

const MARTES = "2026-09-08";

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

const midnight = (d: string): Date => wallTimeToUtc(d, "00:00", CENTER_TZ);

function vista(
  opts: {
    templates?: TemplateSlot[];
    blocks?: BlockInterval[];
    centerHours?: CenterHoursRow[];
    centerDays?: CenterDayRow[];
    staff?: string[];
    date?: string;
    hasta?: string;
  } = {},
) {
  const store = makeFakeStore({
    [TENANT]: {
      requirements: { [CORTE]: req(CORTE, 30) },
      skills: { [CORTE]: [ANA, ISA] },
      templates: opts.templates ?? [
        { userId: ANA, date: MARTES, startTime: "09:00", endTime: "18:00" },
        { userId: ISA, date: MARTES, startTime: "09:00", endTime: "18:00" },
      ],
      blocks: opts.blocks,
      centerHours: opts.centerHours,
      centerDays: opts.centerDays,
    },
  });
  const date = opts.date ?? MARTES;
  return buildAgendaDays(
    store,
    TENANT,
    date,
    opts.hasta ?? date,
    opts.staff ?? [ANA, ISA],
    CENTER_TZ,
    midnight,
  );
}

const semana = (): CenterHoursRow[] =>
  [2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    openTime: "09:00",
    closeTime: "20:00",
    validFrom: "2026-01-01",
    validUntil: null,
  }));

// ── Los tramos abiertos de cada columna ───────────────────────────────

describe("los tramos abiertos por profesional", () => {
  it("sin horario de centro son el turno tal cual", async () => {
    const [dia] = await vista();
    expect(dia!.open).toBeNull();
    expect(dia!.staffOpen[ANA]).toEqual([
      { startTime: "09:00", endTime: "18:00" },
    ]);
  });

  it("con horario de centro son turno ∩ centro", async () => {
    const [dia] = await vista({
      centerHours: semana(),
      templates: [
        { userId: ANA, date: MARTES, startTime: "09:00", endTime: "22:30" },
        { userId: ISA, date: MARTES, startTime: "09:00", endTime: "18:00" },
      ],
    });
    expect(dia!.open).toEqual([{ startTime: "09:00", endTime: "20:00" }]);
    expect(dia!.staffOpen[ANA]).toEqual([
      { startTime: "09:00", endTime: "20:00" },
    ]);
    expect(dia!.staffOpen[ISA]).toEqual([
      { startTime: "09:00", endTime: "18:00" },
    ]);
  });

  it("quien no tiene turno ese día tiene CERO tramos, no está ausente", async () => {
    // Son dos causas distintas: "Ana no tiene turno" e "Ana no está" se
    // arreglan de formas distintas y la rejilla las dice distinto.
    const [dia] = await vista({
      templates: [
        { userId: ANA, date: MARTES, startTime: "09:00", endTime: "18:00" },
      ],
    });
    expect(dia!.staffOpen[ISA]).toEqual([]);
    expect(dia!.absences).toEqual([]);
  });

  it("dos turnos pegados se funden en un tramo, sin costura falsa", async () => {
    const [dia] = await vista({
      templates: [
        { userId: ANA, date: MARTES, startTime: "09:00", endTime: "14:00" },
        { userId: ANA, date: MARTES, startTime: "14:00", endTime: "20:00" },
      ],
      staff: [ANA],
    });
    expect(dia!.staffOpen[ANA]).toEqual([
      { startTime: "09:00", endTime: "20:00" },
    ]);
  });

  it("el horario partido del centro deja DOS tramos", async () => {
    const [dia] = await vista({
      centerHours: [
        {
          weekday: 2,
          openTime: "10:00",
          closeTime: "14:00",
          validFrom: "2026-01-01",
          validUntil: null,
        },
        {
          weekday: 2,
          openTime: "17:00",
          closeTime: "20:30",
          validFrom: "2026-01-01",
          validUntil: null,
        },
      ],
      staff: [ANA],
      templates: [
        { userId: ANA, date: MARTES, startTime: "09:00", endTime: "22:00" },
      ],
    });
    expect(dia!.staffOpen[ANA]).toEqual([
      { startTime: "10:00", endTime: "14:00" },
      { startTime: "17:00", endTime: "20:30" },
    ]);
  });
});

// ── El día cerrado dice su nombre ─────────────────────────────────────

describe("el día cerrado", () => {
  it("un festivo cierra el día Y trae su nombre", async () => {
    const [dia] = await vista({
      centerHours: semana(),
      centerDays: [
        {
          date: MARTES,
          closed: true,
          name: "Virgen del Prado",
          openTime: null,
          closeTime: null,
        },
      ],
    });
    expect(dia!.closed).toEqual({ name: "Virgen del Prado" });
    expect(dia!.open).toEqual([]);
    // Y nadie tiene tramo abierto, aunque los dos tengan turno.
    expect(dia!.staffOpen[ANA]).toEqual([]);
    expect(dia!.staffOpen[ISA]).toEqual([]);
  });

  it("el domingo sin fila cierra, pero SIN nombre (no es un día especial)", async () => {
    const DOMINGO = "2026-09-13";
    const [dia] = await vista({
      date: DOMINGO,
      centerHours: semana(),
      templates: [
        { userId: ANA, date: DOMINGO, startTime: "09:00", endTime: "18:00" },
      ],
      staff: [ANA],
    });
    expect(dia!.closed).toEqual({ name: null });
    expect(dia!.staffOpen[ANA]).toEqual([]);
  });

  it("un tenant sin configurar NO tiene día cerrado nunca", async () => {
    const [dia] = await vista();
    expect(dia!.closed).toBeNull();
  });

  it("el día especial que ABRE trae su nombre y no está cerrado", async () => {
    const SABADO = "2026-09-12";
    const [dia] = await vista({
      date: SABADO,
      centerHours: semana(),
      centerDays: [
        {
          date: SABADO,
          closed: false,
          name: "boda Marta",
          openTime: "08:30",
          closeTime: "14:00",
        },
      ],
      templates: [
        { userId: ANA, date: SABADO, startTime: "08:30", endTime: "14:00" },
      ],
      staff: [ANA],
    });
    expect(dia!.closed).toBeNull();
    expect(dia!.specialName).toBe("boda Marta");
    expect(dia!.open).toEqual([{ startTime: "08:30", endTime: "14:00" }]);
  });
});

// ── Las ausencias, con su id y su motivo ──────────────────────────────

describe("las ausencias", () => {
  const isaNo: BlockInterval = {
    id: "block-isa",
    scope: "STAFF",
    staffUserId: ISA,
    resourceId: null,
    reason: "ISA NO",
    startsAt: wallTimeToUtc(MARTES, "09:00"),
    endsAt: wallTimeToUtc(MARTES, "10:30"),
  };

  it("llegan con id, con motivo y en hora de PARED", async () => {
    const [dia] = await vista({ blocks: [isaNo] });
    expect(dia!.absences).toEqual([
      {
        id: "block-isa",
        staffUserId: ISA,
        startTime: "09:00",
        endTime: "10:30",
        reason: "ISA NO",
      },
    ]);
  });

  it("una ausencia SIN motivo llega igual, con reason null", async () => {
    const [dia] = await vista({
      blocks: [{ ...isaNo, id: "sin-motivo", reason: null }],
    });
    expect(dia!.absences[0]!.reason).toBeNull();
  });

  it("y esos huecos desaparecen de verdad de la disponibilidad", async () => {
    // La ausencia se pinta Y quita huecos: son las dos mitades del mismo
    // dato. Aquí se comprueba la segunda contra el motor.
    const { createCitaEngine } = await import("../src/agenda/engine.js");
    const store = makeFakeStore({
      [TENANT]: {
        requirements: { [CORTE]: req(CORTE, 30) },
        skills: { [CORTE]: [ISA] },
        templates: [
          { userId: ISA, date: MARTES, startTime: "09:00", endTime: "18:00" },
        ],
        blocks: [isaNo],
      },
    });
    const engine = createCitaEngine(store, {
      clock: { now: () => wallTimeToUtc(MARTES, "07:00") },
    });
    const slots = await engine.availability({
      tenantId: TENANT,
      items: [{ serviceId: CORTE }],
      staffUserId: ISA,
      fromDate: MARTES,
      toDate: MARTES,
    });
    const { utcToWallTime } = await import("../src/agenda/time.js");
    const horas = slots.map((s) => utcToWallTime(new Date(s.start)));
    expect(horas).not.toContain("09:00");
    expect(horas).not.toContain("10:00");
    expect(horas[0]).toBe("10:30");
  });

  it("un bloqueo de CENTRO se pinta sin dueño (staffUserId null)", async () => {
    const [dia] = await vista({
      blocks: [
        {
          id: "block-centro",
          scope: "CENTER",
          staffUserId: null,
          resourceId: null,
          reason: "formación",
          startsAt: wallTimeToUtc(MARTES, "15:00"),
          endsAt: wallTimeToUtc(MARTES, "17:00"),
        },
      ],
    });
    expect(dia!.absences[0]!.staffUserId).toBeNull();
    expect(dia!.absences[0]!.reason).toBe("formación");
  });

  it("un bloqueo de RECURSO no es ausencia de nadie y no se pinta", async () => {
    const [dia] = await vista({
      blocks: [
        {
          id: "block-cabina",
          scope: "RESOURCE",
          staffUserId: null,
          resourceId: "cabina-1",
          reason: "avería",
          startsAt: wallTimeToUtc(MARTES, "15:00"),
          endsAt: wallTimeToUtc(MARTES, "17:00"),
        },
      ],
    });
    expect(dia!.absences).toEqual([]);
  });

  it("se ordenan por hora de inicio", async () => {
    const [dia] = await vista({
      blocks: [
        { ...isaNo, id: "b", startsAt: wallTimeToUtc(MARTES, "16:00"), endsAt: wallTimeToUtc(MARTES, "17:00") },
        isaNo,
      ],
    });
    expect(dia!.absences.map((a) => a.startTime)).toEqual(["09:00", "16:00"]);
  });
});

// ── El día entero, los dos domingos del cambio de hora ────────────────
//
// Una ausencia de día entero va de la medianoche de pared de ese día a la
// del siguiente. El 25-10-2026 son 25 horas y el 29-03-2026 son 23. Restar
// 24 h daría una hora de más o de menos justo esos dos días del año.

describe("la ausencia de DÍA ENTERO en el cambio de hora", () => {
  function diaEntero(date: string): BlockInterval {
    const siguiente = new Date(`${date}T12:00:00.000Z`);
    siguiente.setUTCDate(siguiente.getUTCDate() + 1);
    return {
      id: "todo-el-dia",
      scope: "STAFF",
      staffUserId: ANA,
      resourceId: null,
      reason: "Ana libre",
      startsAt: wallTimeToUtc(date, "00:00"),
      endsAt: wallTimeToUtc(siguiente.toISOString().slice(0, 10), "00:00"),
    };
  }

  it("el 25-10 dura 25 horas y cubre el día entero", async () => {
    const CAMBIO = "2026-10-25";
    const b = diaEntero(CAMBIO);
    expect(b.endsAt.getTime() - b.startsAt.getTime()).toBe(25 * 3_600_000);
    const [dia] = await vista({
      date: CAMBIO,
      blocks: [b],
      templates: [
        { userId: ANA, date: CAMBIO, startTime: "09:00", endTime: "18:00" },
      ],
      staff: [ANA],
    });
    expect(dia!.absences[0]).toMatchObject({
      startTime: "00:00",
      endTime: "24:00",
      reason: "Ana libre",
    });
  });

  it("el 29-03 dura 23 horas y cubre el día entero igual", async () => {
    const CAMBIO = "2026-03-29";
    const b = diaEntero(CAMBIO);
    expect(b.endsAt.getTime() - b.startsAt.getTime()).toBe(23 * 3_600_000);
    const [dia] = await vista({
      date: CAMBIO,
      blocks: [b],
      templates: [
        { userId: ANA, date: CAMBIO, startTime: "09:00", endTime: "18:00" },
      ],
      staff: [ANA],
    });
    expect(dia!.absences[0]).toMatchObject({
      startTime: "00:00",
      endTime: "24:00",
    });
  });

  it("una ausencia que cruza la medianoche se recorta a CADA día", async () => {
    const [d1, d2] = await vista({
      date: MARTES,
      hasta: "2026-09-09",
      blocks: [
        {
          id: "cruza",
          scope: "STAFF",
          staffUserId: ANA,
          resourceId: null,
          reason: "viaje",
          startsAt: wallTimeToUtc(MARTES, "22:00"),
          endsAt: wallTimeToUtc("2026-09-09", "02:00"),
        },
      ],
      templates: [
        { userId: ANA, date: MARTES, startTime: "09:00", endTime: "18:00" },
      ],
      staff: [ANA],
    });
    expect(d1!.absences[0]).toMatchObject({
      startTime: "22:00",
      endTime: "24:00",
    });
    expect(d2!.absences[0]).toMatchObject({
      startTime: "00:00",
      endTime: "02:00",
    });
  });
});
