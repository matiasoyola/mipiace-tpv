// B-reservas-7a · EL TECHO: el horario del centro.
//
// Hasta este bloque la disponibilidad salía SÓLO de los turnos del personal
// (`store.getTemplateSlots` → `staff_shifts`). Si nadie definía turno el
// centro no abría; si alguien lo definía de par en par, el centro abría de
// par en par. Y un festivo había que bloquearlo a mano, día a día, con un
// `BookingBlock scope=CENTER` (§1.4 del cruce; invariante 13 en ❌).
//
// La ventana de un profesional en una fecha pasa a ser:
//
//   turno ∩ horario_del_centro(fecha)
//     ∖ bloqueos CENTER|STAFF   ← ya lo hacía staffFree()
//     ∖ citas activas           ← ya lo hacían occByStaff y el GiST
//
// Y `horario_del_centro(fecha)` es el DÍA ESPECIAL si lo hay y, si no, la
// semana tipo. Cada línea de esa semántica tiene aquí su test.
//
// El centro de estos tests es GENÉRICO: abre de martes a sábado de 9:00 a
// 20:00 y cierra el domingo. No es el de nadie.

import { describe, expect, it } from "vitest";

import {
  clipToCenter,
  isoWeekday,
  resolveCenterSchedule,
  wallDatesBetween,
  type CenterDayRow,
  type CenterHoursRow,
} from "../src/agenda/center-hours.js";
import { createCitaEngine } from "../src/agenda/engine.js";
import { utcToWallTime, wallTimeToUtc } from "../src/agenda/time.js";
import type { ServiceRequirement, TemplateSlot } from "../src/agenda/types.js";
import { makeFakeStore } from "./helpers/agenda-fake-store.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CORTE = "33333333-3333-4333-8333-333333333333";
const SOLE = "55555555-5555-4555-8555-555555555555";

// Semana del 07-09-2026: lunes 7, martes 8 … domingo 13.
const LUNES = "2026-09-07";
const MARTES = "2026-09-08";
const SABADO = "2026-09-12";
const DOMINGO = "2026-09-13";

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

/** El turno de la profesional: de 9:00 a 22:30, MÁS ancho que el centro.
 *  Ése es justo el caso que hoy abre la agenda de par en par. */
function turnoLargo(date: string): TemplateSlot {
  return { userId: SOLE, date, startTime: "09:00", endTime: "22:30" };
}

/** La semana tipo del centro genérico: martes a sábado, 9:00–20:00. */
function semanaMartesASabado(): CenterHoursRow[] {
  return [2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    openTime: "09:00",
    closeTime: "20:00",
    validFrom: "2026-01-01",
    validUntil: null,
  }));
}

/** Motor con reloj congelado ANTES de que abra el centro ese día, para que
 *  el suelo de 6a no tenga nada que ver con lo que aquí se mide. */
function motor(
  date: string,
  centerHours?: CenterHoursRow[],
  centerDays?: CenterDayRow[],
  templates: TemplateSlot[] = [turnoLargo(date)],
) {
  const store = makeFakeStore({
    [TENANT]: {
      requirements: { [CORTE]: req(CORTE, 30) },
      skills: { [CORTE]: [SOLE] },
      templates,
      centerHours,
      centerDays,
    },
  });
  return createCitaEngine(store, {
    clock: { now: () => wallTimeToUtc(date, "07:00") },
  });
}

async function horasDe(engine: ReturnType<typeof motor>, date: string) {
  const slots = await engine.availability({
    tenantId: TENANT,
    items: [{ serviceId: CORTE }],
    fromDate: date,
    toDate: date,
  });
  return slots.map((s) => utcToWallTime(new Date(s.start)));
}

// ── La aritmética pura, antes del motor ───────────────────────────────

describe("isoWeekday", () => {
  it("lunes es 1 y domingo es 7", () => {
    expect(isoWeekday(LUNES)).toBe(1);
    expect(isoWeekday(MARTES)).toBe(2);
    expect(isoWeekday(SABADO)).toBe(6);
    expect(isoWeekday(DOMINGO)).toBe(7);
  });

  it("el día del cambio de hora también", () => {
    // 25-10-2026: el domingo de 25 horas.
    expect(isoWeekday("2026-10-25")).toBe(7);
    // 29-03-2026: el domingo de 23 horas.
    expect(isoWeekday("2026-03-29")).toBe(7);
  });
});

describe("wallDatesBetween", () => {
  it("cuenta por texto, no sumando 24 h", () => {
    // Si sumara 24 h, el día del cambio de hora saldría repetido o saltado.
    const dias = wallDatesBetween("2026-10-24", "2026-10-26");
    expect(dias).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
  });
});

// ── La semántica del techo, línea por línea ───────────────────────────

describe("el techo del centro · semántica", () => {
  it("un tenant SIN ninguna fila de center_hours NO tiene techo", async () => {
    const horas = await horasDe(motor(MARTES), MARTES);
    // El turno va hasta las 22:30 y el servicio dura 30: el último inicio
    // es a las 22:00. Exactamente lo que hacía master.
    expect(horas[0]).toBe("09:00");
    expect(horas[horas.length - 1]).toBe("22:00");
  });

  it("el horario del centro RECORTA el turno del profesional", async () => {
    // Centro 9:00–20:00, turno 9:00–22:30 → nada después de las 20:00.
    const horas = await horasDe(
      motor(MARTES, semanaMartesASabado()),
      MARTES,
    );
    expect(horas[0]).toBe("09:00");
    expect(horas[horas.length - 1]).toBe("19:30");
    expect(horas).not.toContain("20:00");
    expect(horas).not.toContain("22:00");
  });

  it("con semana tipo puesta, un día SIN fila está CERRADO aunque haya turno", async () => {
    // El domingo. La profesional tiene turno de 9:00 a 22:30 y aun así no
    // hay ni un hueco: el centro no abre.
    const horas = await horasDe(
      motor(DOMINGO, semanaMartesASabado(), undefined, [turnoLargo(DOMINGO)]),
      DOMINGO,
    );
    expect(horas).toEqual([]);
  });

  it("un día especial CERRADO da cero huecos · invariante 13", async () => {
    const festivo: CenterDayRow[] = [
      {
        date: MARTES,
        closed: true,
        name: "Virgen del Prado",
        openTime: null,
        closeTime: null,
      },
    ];
    const horas = await horasDe(
      motor(MARTES, semanaMartesASabado(), festivo),
      MARTES,
    );
    expect(horas).toEqual([]);
  });

  it("un festivo cierra AUNQUE el tenant no tenga semana tipo", async () => {
    // Un centro que sólo configura festivos y no la semana: el festivo
    // tiene que cerrar igual. Si no, "marcar el festivo" no haría nada.
    const festivo: CenterDayRow[] = [
      {
        date: MARTES,
        closed: true,
        name: "Virgen del Prado",
        openTime: null,
        closeTime: null,
      },
    ];
    const horas = await horasDe(motor(MARTES, undefined, festivo), MARTES);
    expect(horas).toEqual([]);
  });

  it("un día especial CON horario abre aunque la semana tipo cierre ese día", async () => {
    // El domingo, que la semana tipo cierra, con un día especial 10:00–13:00.
    const especial: CenterDayRow[] = [
      {
        date: DOMINGO,
        closed: false,
        name: "mercadillo",
        openTime: "10:00",
        closeTime: "13:00",
      },
    ];
    const horas = await horasDe(
      motor(DOMINGO, semanaMartesASabado(), especial),
      DOMINGO,
    );
    expect(horas[0]).toBe("10:00");
    expect(horas[horas.length - 1]).toBe("12:30");
  });

  it("el sábado de boda abre a las 8:30, antes que la semana tipo", async () => {
    // El caso que un BookingBlock NO puede expresar: un bloqueo sólo sabe
    // cerrar. Con refuerzo: la profesional entra a las 8:30 ese día.
    const boda: CenterDayRow[] = [
      {
        date: SABADO,
        closed: false,
        name: "boda Marta",
        openTime: "08:30",
        closeTime: "14:00",
      },
    ];
    const refuerzo: TemplateSlot[] = [
      { userId: SOLE, date: SABADO, startTime: "08:30", endTime: "14:00" },
    ];
    const horas = await horasDe(
      motor(SABADO, semanaMartesASabado(), boda, refuerzo),
      SABADO,
    );
    expect(horas[0]).toBe("08:30");
    expect(horas[horas.length - 1]).toBe("13:30");
  });

  it("un día especial SUSTITUYE al horario semanal, no se suma", async () => {
    // Semana: 9:00–20:00. Día especial: 8:30–14:00. Si se SUMARA, seguiría
    // ofreciendo las 15:00. Sustituye ⇒ no.
    const boda: CenterDayRow[] = [
      {
        date: SABADO,
        closed: false,
        name: "boda Marta",
        openTime: "08:30",
        closeTime: "14:00",
      },
    ];
    const horas = await horasDe(
      motor(SABADO, semanaMartesASabado(), boda, [
        { userId: SOLE, date: SABADO, startTime: "08:30", endTime: "22:30" },
      ]),
      SABADO,
    );
    expect(horas).toContain("08:30");
    expect(horas).not.toContain("15:00");
    expect(horas[horas.length - 1]).toBe("13:30");
  });

  it("un horario que empieza en el futuro deja el pasado SIN TECHO, no cerrado", async () => {
    // Configurar el futuro no puede cerrar el pasado a espaldas de nadie:
    // antes de `validFrom` el tenant se comporta como si no hubiera nada.
    const futuro: CenterHoursRow[] = semanaMartesASabado().map((r) => ({
      ...r,
      validFrom: "2026-10-01",
    }));
    const horas = await horasDe(motor(MARTES, futuro), MARTES);
    expect(horas[horas.length - 1]).toBe("22:00"); // el turno entero
  });

  it("el horario partido deja fuera la hora de comer", async () => {
    const partido: CenterHoursRow[] = [
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
    ];
    const horas = await horasDe(motor(MARTES, partido), MARTES);
    expect(horas).toContain("13:30");
    expect(horas).not.toContain("14:00");
    expect(horas).not.toContain("16:30");
    expect(horas).toContain("17:00");
    expect(horas[horas.length - 1]).toBe("20:00");
  });
});

// ── El recorte, sin motor ─────────────────────────────────────────────

describe("clipToCenter", () => {
  const t: TemplateSlot[] = [
    { userId: SOLE, date: MARTES, startTime: "09:00", endTime: "22:30" },
  ];

  it("sin techo devuelve la plantilla TAL CUAL", () => {
    const hours = resolveCenterSchedule([], [], MARTES, MARTES).get(MARTES);
    expect(hours!.open).toBeNull();
    expect(clipToCenter(t, hours)).toEqual(t);
  });

  it("cerrado devuelve CERO franjas", () => {
    const hours = resolveCenterSchedule(
      [],
      [
        {
          date: MARTES,
          closed: true,
          name: "festivo",
          openTime: null,
          closeTime: null,
        },
      ],
      MARTES,
      MARTES,
    ).get(MARTES);
    expect(clipToCenter(t, hours)).toEqual([]);
  });

  it("una franja que cruza dos tramos sale PARTIDA en dos", () => {
    const hours = resolveCenterSchedule(
      [
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
      [],
      MARTES,
      MARTES,
    ).get(MARTES);
    const out = clipToCenter(t, hours);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ startTime: "10:00", endTime: "14:00" });
    expect(out[1]).toMatchObject({ startTime: "17:00", endTime: "20:30" });
  });

  it("un turno que no toca el horario del centro desaparece", () => {
    const hours = resolveCenterSchedule(
      [
        {
          weekday: 2,
          openTime: "09:00",
          closeTime: "14:00",
          validFrom: "2026-01-01",
          validUntil: null,
        },
      ],
      [],
      MARTES,
      MARTES,
    ).get(MARTES);
    const tarde: TemplateSlot[] = [
      { userId: SOLE, date: MARTES, startTime: "17:00", endTime: "20:00" },
    ];
    expect(clipToCenter(tarde, hours)).toEqual([]);
  });
});

// ── Reservar respeta el mismo techo que listar (invariante 6) ─────────

describe("el techo vale igual al listar que al reservar", () => {
  it("hold() a las 20:30 con el centro cerrado a las 20:00 → NO_SLOT", async () => {
    const engine = motor(MARTES, semanaMartesASabado());
    const res = await engine.hold({
      tenantId: TENANT,
      externalId: null,
      clientId: null,
      items: [{ serviceId: CORTE }],
      start: wallTimeToUtc(MARTES, "20:30").toISOString(),
      source: "PRESENCIAL",
      confirmed: true,
      pendingTtlMinutes: 10,
      notes: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("NO_SLOT");
  });

  it("hold() el día del festivo → NO_SLOT, y no queda ninguna alternativa ese día", async () => {
    const engine = motor(MARTES, semanaMartesASabado(), [
      {
        date: MARTES,
        closed: true,
        name: "Virgen del Prado",
        openTime: null,
        closeTime: null,
      },
    ]);
    const res = await engine.hold({
      tenantId: TENANT,
      externalId: null,
      clientId: null,
      items: [{ serviceId: CORTE }],
      start: wallTimeToUtc(MARTES, "10:00").toISOString(),
      source: "PRESENCIAL",
      confirmed: true,
      pendingTtlMinutes: 10,
      notes: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("NO_SLOT");
      expect(res.alternatives).toEqual([]);
    }
  });

  it("el día especial que abre TAMBIÉN deja reservar a las 8:30", async () => {
    const engine = motor(
      SABADO,
      semanaMartesASabado(),
      [
        {
          date: SABADO,
          closed: false,
          name: "boda Marta",
          openTime: "08:30",
          closeTime: "14:00",
        },
      ],
      [{ userId: SOLE, date: SABADO, startTime: "08:30", endTime: "14:00" }],
    );
    const res = await engine.hold({
      tenantId: TENANT,
      externalId: null,
      clientId: null,
      items: [{ serviceId: CORTE }],
      start: wallTimeToUtc(SABADO, "08:30").toISOString(),
      source: "PRESENCIAL",
      confirmed: true,
      pendingTtlMinutes: 10,
      notes: null,
    });
    expect(res.ok).toBe(true);
  });
});
