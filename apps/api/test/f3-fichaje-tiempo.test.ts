// F1 · el tiempo del control horario: lo que se puede probar sin base de
// datos (ADR-018).
//
// Lo que este banco fija:
//
//   1. El total sale de los INSTANTES, no de restar horas de pared. La
//      noche del cambio de hora del 25-10-2026 dura una hora MÁS de lo que
//      dicen los relojes, y quien la trabaja cobra esa hora.
//   2. La propuesta de la salida olvidada es una MEDIANA, y sin historial
//      no se propone nada. Nunca se inventa una hora.
//   3. "Enviado sin conexión" se deriva de las dos horas, con umbral de 10
//      minutos, y la hora que cuenta es la del toque.
//   4. Un reloj adelantado no crea fichajes del futuro; uno atrasado —el
//      móvil que estuvo tres días en el sótano— sí conserva su hora.
//
// Sabotajes que este fichero pone en rojo (§3 del done):
//   · guardar la hora de llegada en vez de la del toque (nº 8)
//   · calcular el total restando horas de pared
//   · proponer una hora de salida sin historial

import { describe, expect, it } from "vitest";

import {
  formatDuration,
  localDate,
  localTime,
  localToUtc,
  medianExitWallTime,
  minutesWorked,
  monthRange,
  suggestedExitAt,
} from "../src/fichaje/time.js";
import {
  entrySentOffline,
  OFFLINE_THRESHOLD_MINUTES,
  sentOffline,
} from "../src/fichaje/offline.js";
import { groupByDay, toEntryView, totalMinutes } from "../src/fichaje/view.js";
import { resolveTapTime } from "../src/fichaje/routes.js";

const d = (iso: string) => new Date(iso);

describe("F1 · el cambio de hora", () => {
  // 25-10-2026: a las 03:00 CEST el reloj vuelve a las 02:00 CET.
  it("una noche de 22:00 a 06:00 el 24→25-10-2026 dura NUEVE horas", () => {
    const entrada = localToUtc("2026-10-24", "22:00"); // CEST, UTC+2 → 20:00Z
    const salida = localToUtc("2026-10-25", "06:00"); // CET,  UTC+1 → 05:00Z
    expect(entrada.toISOString()).toBe("2026-10-24T20:00:00.000Z");
    expect(salida.toISOString()).toBe("2026-10-25T05:00:00.000Z");
    // Las horas de pared dicen ocho. Los instantes dicen nueve, y los
    // instantes son los que se cobran.
    expect(minutesWorked(entrada, salida)).toBe(9 * 60);
    expect(formatDuration(minutesWorked(entrada, salida))).toBe("9h 00m");
  });

  // 29-03-2026: a las 02:00 CET el reloj salta a las 03:00 CEST.
  it("la noche de marzo, al revés: de 22:00 a 06:00 dura SIETE horas", () => {
    const entrada = localToUtc("2026-03-28", "22:00"); // CET,  UTC+1 → 21:00Z
    const salida = localToUtc("2026-03-29", "06:00"); // CEST, UTC+2 → 04:00Z
    expect(minutesWorked(entrada, salida)).toBe(7 * 60);
  });

  it("las horas se pintan en hora local a los dos lados del cambio", () => {
    expect(localTime(d("2026-10-24T20:00:00Z"))).toBe("22:00");
    expect(localTime(d("2026-10-25T05:00:00Z"))).toBe("06:00");
    // La hora que se repite: las 02:30 de pared ocurren DOS veces esa
    // madrugada, una en CEST y otra en CET. Son dos instantes distintos y
    // el registro los distingue porque guarda instantes, no relojes.
    expect(localTime(d("2026-10-25T00:30:00Z"))).toBe("02:30"); // CEST (UTC+2)
    expect(localTime(d("2026-10-25T01:30:00Z"))).toBe("02:30"); // CET  (UTC+1)
    // Y entre las dos hay una hora de trabajo de verdad.
    expect(
      minutesWorked(d("2026-10-25T00:30:00Z"), d("2026-10-25T01:30:00Z")),
    ).toBe(60);
  });

  it("un tramo de noche pertenece al día en que se EMPEZÓ", () => {
    const view = toEntryView(
      {
        id: "e1",
        employeeId: "x",
        startedAt: d("2026-10-24T20:00:00Z"),
        endedAt: d("2026-10-25T05:00:00Z"),
        startedDeviceAt: null,
        startedServerAt: d("2026-10-24T20:00:00Z"),
        endedDeviceAt: null,
        endedServerAt: d("2026-10-25T05:00:00Z"),
        startSource: "MOBILE",
        endSource: "MOBILE",
      },
      0,
    );
    expect(view.date).toBe("2026-10-24");
    expect(view.minutes).toBe(540);
  });

  it("el mes local empieza y acaba donde tiene que acabar", () => {
    const { from, to } = monthRange("2026-10");
    // Octubre empieza en CEST (UTC+2) y noviembre ya está en CET (UTC+1).
    expect(from.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(localDate(from)).toBe("2026-10-01");
  });

  it("diciembre cierra año sin salirse del mes", () => {
    const { from, to } = monthRange("2026-12");
    expect(localDate(from)).toBe("2026-12-01");
    expect(localDate(new Date(to.getTime() - 60_000))).toBe("2026-12-31");
  });
});

describe("F1 · la propuesta de la salida olvidada", () => {
  it("es la mediana, no la media: una noche suelta no arrastra la propuesta", () => {
    const salidas = [
      d("2026-09-01T15:00:00Z"), // 17:00
      d("2026-09-02T15:05:00Z"), // 17:05
      d("2026-09-03T15:02:00Z"), // 17:02
      d("2026-09-04T21:00:00Z"), // 23:00 — la noche del inventario
    ];
    // La media serían casi las 18:30. La mediana son las 17:02.
    expect(medianExitWallTime(salidas)).toBe("17:02");
  });

  it("SIN historial no se propone nada", () => {
    expect(medianExitWallTime([])).toBeNull();
    expect(suggestedExitAt(d("2026-09-22T06:00:00Z"), [])).toBeNull();
  });

  it("la propuesta cae en el día del tramo abierto", () => {
    const entrada = localToUtc("2026-09-22", "08:00");
    const sugerida = suggestedExitAt(entrada, [
      localToUtc("2026-09-01", "17:30"),
      localToUtc("2026-09-02", "17:30"),
      localToUtc("2026-09-03", "17:30"),
    ]);
    expect(sugerida).not.toBeNull();
    expect(localDate(sugerida!)).toBe("2026-09-22");
    expect(localTime(sugerida!)).toBe("17:30");
  });

  // Alguien que entró a las 22:00 y cuya mediana de salida son las 17:30.
  // No hay nada sensato que proponer: se pregunta a secas.
  it("no propone una salida ANTERIOR a la entrada", () => {
    const entrada = localToUtc("2026-09-22", "22:00");
    const sugerida = suggestedExitAt(entrada, [
      localToUtc("2026-09-01", "17:30"),
      localToUtc("2026-09-02", "17:30"),
    ]);
    expect(sugerida).toBeNull();
  });

  it("con un número par de salidas toma la inferior", () => {
    expect(
      medianExitWallTime([
        localToUtc("2026-09-01", "17:00"),
        localToUtc("2026-09-02", "18:00"),
      ]),
    ).toBe("17:00");
  });
});

describe("F1 · enviado sin conexión", () => {
  it("el umbral son 10 minutos", () => {
    expect(OFFLINE_THRESHOLD_MINUTES).toBe(10);
    const toque = d("2026-09-22T06:00:00Z");
    expect(sentOffline(toque, d("2026-09-22T06:09:59Z"))).toBe(false);
    expect(sentOffline(toque, d("2026-09-22T06:10:01Z"))).toBe(true);
  });

  it("sin hora de dispositivo (lo metió el panel) no hay marca", () => {
    expect(sentOffline(null, d("2026-09-22T06:00:00Z"))).toBe(false);
  });

  it("basta con que uno de los dos extremos llegara tarde", () => {
    expect(
      entrySentOffline({
        startedDeviceAt: d("2026-09-22T06:00:00Z"),
        startedServerAt: d("2026-09-22T06:00:02Z"),
        endedDeviceAt: d("2026-09-22T14:00:00Z"),
        endedServerAt: d("2026-09-22T17:30:00Z"),
      }),
    ).toBe(true);
  });
});

describe("F1 · la hora que cuenta es la del toque", () => {
  const serverNow = d("2026-09-22T10:00:00Z");

  it("un fichaje que llega tres días tarde conserva SU hora", () => {
    const toque = d("2026-09-19T06:02:00Z");
    expect(resolveTapTime(toque, serverNow).toISOString()).toBe(
      "2026-09-19T06:02:00.000Z",
    );
  });

  it("un reloj un poco adelantado se respeta (margen de 5 min)", () => {
    const toque = d("2026-09-22T10:03:00Z");
    expect(resolveTapTime(toque, serverNow).toISOString()).toBe(
      "2026-09-22T10:03:00.000Z",
    );
  });

  it("un reloj MUY adelantado no crea un fichaje del futuro", () => {
    const toque = d("2027-01-01T00:00:00Z");
    expect(resolveTapTime(toque, serverNow)).toEqual(serverNow);
  });
});

describe("F1 · cómo se lee el registro", () => {
  function entry(id: string, start: string, end: string | null) {
    return toEntryView(
      {
        id,
        employeeId: "x",
        startedAt: d(start),
        endedAt: end ? d(end) : null,
        startedDeviceAt: null,
        startedServerAt: d(start),
        endedDeviceAt: null,
        endedServerAt: end ? d(end) : null,
        startSource: "MOBILE",
        endSource: end ? "MOBILE" : null,
      },
      0,
    );
  }

  it("agrupa por día y suma los tramos", () => {
    const days = groupByDay([
      entry("a", "2026-09-22T06:00:00Z", "2026-09-22T10:00:00Z"),
      entry("b", "2026-09-22T12:00:00Z", "2026-09-22T15:00:00Z"),
      entry("c", "2026-09-23T06:00:00Z", "2026-09-23T10:00:00Z"),
    ]);
    expect(days.map((x) => x.date)).toEqual(["2026-09-22", "2026-09-23"]);
    expect(days[0]!.totalMinutes).toBe(7 * 60);
    expect(totalMinutes(days)).toBe(11 * 60);
  });

  it("un tramo en curso NO suma: no se cuenta lo que no ha pasado", () => {
    const days = groupByDay([entry("a", "2026-09-22T06:00:00Z", null)]);
    expect(days[0]!.entries[0]!.open).toBe(true);
    expect(days[0]!.entries[0]!.minutes).toBeNull();
    expect(days[0]!.totalMinutes).toBe(0);
  });

  it("los días sin fichajes no aparecen", () => {
    const days = groupByDay([
      entry("a", "2026-09-22T06:00:00Z", "2026-09-22T10:00:00Z"),
      entry("c", "2026-09-25T06:00:00Z", "2026-09-25T10:00:00Z"),
    ]);
    expect(days).toHaveLength(2);
  });

  it("marca el corregido", () => {
    const view = toEntryView(
      {
        id: "a",
        employeeId: "x",
        startedAt: d("2026-09-22T06:00:00Z"),
        endedAt: d("2026-09-22T14:00:00Z"),
        startedDeviceAt: null,
        startedServerAt: d("2026-09-22T06:00:00Z"),
        endedDeviceAt: null,
        endedServerAt: d("2026-09-22T14:00:00Z"),
        startSource: "MOBILE",
        endSource: "PANEL",
      },
      2,
    );
    expect(view.corrected).toBe(true);
  });
});
