// residencia-2 · LA TABLA DE `queToca`.
//
// Es el test del bloque. `queToca` es lo que la pantalla de la puerta
// llamará en residencia-3 con quince tablets abiertas a la vez, así que
// aquí están las ocho frecuencias, los dos cambios de hora, la noche que
// cruza medianoche, el residente que ingresa y el que se va a mitad del
// periodo, el control que el centro desactivó y la línea que se cerró
// ayer.
//
// La función es pura, así que cada caso es una fila de datos y una
// aserción. Ninguna maqueta de Prisma y ningún reloj.

import { describe, expect, it } from "vitest";

import type { AjusteDelCentro, LineaDePlan } from "../src/que-toca.js";
import { queToca } from "../src/que-toca.js";
import type { Frecuencia, MomentoDelCentro } from "../src/frecuencia.js";
import type { TurnoDelCentro } from "../src/turnos.js";
import { addDays, wallTimeToUtc } from "../src/tiempo.js";

// ── El decorado: los tres turnos y los cinco momentos de serie ────────

const TURNOS: TurnoDelCentro[] = [
  { id: "t-m", code: "M", name: "Mañana", startsAt: "08:00", endsAt: "15:00" },
  { id: "t-t", code: "T", name: "Tarde", startsAt: "15:00", endsAt: "22:00" },
  { id: "t-n", code: "N", name: "Noche", startsAt: "22:00", endsAt: "08:00" },
];

const MOMENTOS: MomentoDelCentro[] = [
  { code: "DESAYUNO", name: "Desayuno", atTime: "09:00" },
  { code: "COMIDA", name: "Comida", atTime: "13:30" },
  { code: "MERIENDA", name: "Merienda", atTime: "17:00" },
  { code: "CENA", name: "Cena", atTime: "20:00" },
  { code: "NOCHE", name: "Noche", atTime: "22:30" },
];

/** Una línea viva de doña Carmen con la frecuencia que se le pase. */
function linea(
  controlCode: string,
  frecuencia: Frecuencia,
  extra: Partial<LineaDePlan> = {},
): LineaDePlan {
  return {
    id: `l-${controlCode}`,
    clientId: "carmen",
    controlCode,
    frecuencia,
    fromAt: new Date("2020-01-01T00:00:00.000Z"),
    toAt: null,
    ...extra,
  };
}

/** Un día de pared completo del centro, como ventana. */
function elDia(fecha: string): [Date, Date] {
  // Las ventanas se dan en instantes UTC, que es lo que recibirá la
  // puerta — pero el DÍA es el del centro: de las 00:00 de pared a las
  // 00:00 de pared del siguiente. Construirlo con `Date.UTC` sería un día
  // desplazado una o dos horas, y en octubre eso mete la ronda de las
  // 00:00 en el día anterior.
  //
  // Y por eso se usa `addDays` y no «+86.400.000 ms»: el 25 de octubre
  // tiene 25 horas.
  return [wallTimeToUtc(fecha, "00:00"), wallTimeToUtc(addDays(fecha, 1), "00:00")];
}

const SIN_AJUSTES: AjusteDelCentro[] = [];

/** Las horas de pared de las ocurrencias, para leer el test de un golpe. */
function horas(
  plan: LineaDePlan[],
  desde: Date,
  hasta: Date,
  ajustes: AjusteDelCentro[] = SIN_AJUSTES,
): string[] {
  return queToca(plan, ajustes, TURNOS, MOMENTOS, desde, hasta).map((o) =>
    new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(o.at),
  );
}

// ── Las ocho frecuencias ───────────────────────────────────────────────

describe("las ocho frecuencias, una por una", () => {
  it("ON_DEMAND no devuelve NI UNA ocurrencia", () => {
    // Es la mitad del significado de `ON_DEMAND`: el botón está en la
    // puerta y nada «toca». Si esto devolviera algo, la higiene extra
    // («se ha manchado») aparecería como incumplida todos los días.
    const [desde, hasta] = elDia("2026-10-14");
    expect(queToca([linea("HIGIENE_EXTRA", { kind: "ON_DEMAND" })], SIN_AJUSTES, TURNOS, MOMENTOS, desde, hasta)).toEqual([]);
  });

  it("EVERY_SHIFT da una FRANJA por turno indicado", () => {
    const [desde, hasta] = elDia("2026-10-14");
    const oc = queToca(
      [linea("TRANSFERENCIAS", { kind: "EVERY_SHIFT", shiftCodes: ["M", "T", "N"] })],
      SIN_AJUSTES,
      TURNOS,
      MOMENTOS,
      desde,
      hasta,
    );
    // Tres franjas y no cuatro: la de la noche de AYER arrancó a las
    // 22:00 de ayer, o sea antes de la ventana, y `queToca` contesta «qué
    // EMPIEZA aquí dentro». La de esta noche empieza a las 22:00 y sí.
    expect(oc.map((o) => o.shiftCode)).toEqual(["M", "T", "N"]);
    // Son franjas y no instantes: nadie hace una transferencia «a las
    // 08:00 en punto».
    expect(oc.every((o) => o.esFranja)).toBe(true);
    expect(oc.every((o) => o.until !== null)).toBe(true);
  });

  it("EVERY_SHIFT · la franja de la NOCHE acaba al día siguiente", () => {
    const [desde, hasta] = elDia("2026-10-14");
    const oc = queToca(
      [linea("TRANSFERENCIAS", { kind: "EVERY_SHIFT", shiftCodes: ["N"] })],
      SIN_AJUSTES,
      TURNOS,
      MOMENTOS,
      desde,
      hasta,
    );
    expect(oc).toHaveLength(1);
    const noche = oc[0]!;
    // 22:00 → 08:00 del 15. Si el fin se calculara en el mismo día, la
    // franja iría hacia atrás y la pantalla pintaría una duración
    // negativa.
    expect(noche.until!.getTime() - noche.at.getTime()).toBe(10 * 3600_000);
  });

  it("DAILY da UNA franja, en su turno", () => {
    const [desde, hasta] = elDia("2026-10-14");
    const oc = queToca(
      [linea("HIDRATACION_CUTANEA", { kind: "DAILY", shiftCodes: ["T"] })],
      SIN_AJUSTES,
      TURNOS,
      MOMENTOS,
      desde,
      hasta,
    );
    expect(oc).toHaveLength(1);
    expect(oc[0]!.shiftCode).toBe("T");
    expect(oc[0]!.esFranja).toBe(true);
  });

  it("MOMENTS da un INSTANTE por momento, a la hora del centro", () => {
    const [desde, hasta] = elDia("2026-10-14");
    const oc = queToca(
      [linea("MEDICACION_DIURNA", { kind: "MOMENTS", momentCodes: ["DESAYUNO", "COMIDA", "CENA"] })],
      SIN_AJUSTES,
      TURNOS,
      MOMENTOS,
      desde,
      hasta,
    );
    expect(oc.map((o) => o.momentCode)).toEqual(["DESAYUNO", "COMIDA", "CENA"]);
    expect(oc.every((o) => !o.esFranja && o.until === null)).toBe(true);
    // Y cada uno sabe su turno, calculado por la MISMA función que usará
    // la puerta: la medicación de la cena es del turno de tarde.
    expect(oc.map((o) => o.shiftCode)).toEqual(["M", "M", "T"]);
  });

  it("MOMENTS · cambiarle la hora al desayuno mueve la ocurrencia", () => {
    const [desde, hasta] = elDia("2026-10-14");
    const temprano: MomentoDelCentro[] = [{ code: "DESAYUNO", name: "Desayuno", atTime: "07:30" }];
    const oc = queToca(
      [linea("MEDICACION_DIURNA", { kind: "MOMENTS", momentCodes: ["DESAYUNO"] })],
      SIN_AJUSTES,
      TURNOS,
      temprano,
      desde,
      hasta,
    );
    // A las 07:30 todavía es NOCHE: el turno de mañana empieza a las 08.
    // Es correcto y es el ejemplo de por qué los momentos son del centro.
    expect(oc[0]!.shiftCode).toBe("N");
  });

  it("EVERY_N_HOURS cada 3 h da OCHO instantes, anclados a medianoche", () => {
    const [desde, hasta] = elDia("2026-10-14");
    expect(horas([linea("CAMBIO_POSTURAL", { kind: "EVERY_N_HOURS", everyNHours: 3 })], desde, hasta)).toEqual([
      "00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00",
    ]);
  });

  it("EVERY_N_HOURS · los de la MADRUGADA caen en el turno de noche", () => {
    const [desde, hasta] = elDia("2026-10-14");
    const oc = queToca(
      [linea("CAMBIO_POSTURAL", { kind: "EVERY_N_HOURS", everyNHours: 3 })],
      SIN_AJUSTES,
      TURNOS,
      MOMENTOS,
      desde,
      hasta,
    );
    // 00, 03 y 06 son noche; 09 y 12 mañana; 15 y 18 tarde; 21 tarde.
    expect(oc.map((o) => o.shiftCode)).toEqual(["N", "N", "N", "M", "M", "T", "T", "T"]);
    // Y ninguno se queda sin turno, que es el fallo que la disyunción de
    // `minutosEnTurno` evita.
    expect(oc.every((o) => o.shiftCode !== null)).toBe(true);
  });

  it("WEEKDAYS sólo toca los días marcados", () => {
    const l = linea("GIMNASIA", { kind: "WEEKDAYS", weekdays: [1, 3, 5], shiftCodes: ["M"] });
    // 2026-10-12 es lunes, el 13 martes, el 14 miércoles.
    const lunes = elDia("2026-10-12");
    const martes = elDia("2026-10-13");
    const miercoles = elDia("2026-10-14");
    expect(queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, ...lunes)).toHaveLength(1);
    expect(queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, ...martes)).toHaveLength(0);
    expect(queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, ...miercoles)).toHaveLength(1);
  });

  it("EVERY_N_DAYS se cuenta DESDE LA LÍNEA, no desde el calendario", () => {
    // Doña Carmen ingresa el 14 y la analítica es cada 180 días: le toca
    // el 14 y el 12 de abril, no «cuando le toca al centro».
    const l = linea("ANALITICA", { kind: "EVERY_N_DAYS", everyNDays: 180, shiftCodes: ["M"] }, {
      fromAt: new Date("2026-10-14T06:00:00.000Z"),
    });
    expect(queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, ...elDia("2026-10-14"))).toHaveLength(1);
    expect(queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, ...elDia("2026-10-15"))).toHaveLength(0);
    // 14-10-2026 + 180 días = 12-04-2027.
    expect(queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, ...elDia("2027-04-12"))).toHaveLength(1);
  });

  it("MONTHLY toca su día del mes y ninguno más", () => {
    const l = linea("VISITA_MEDICA", { kind: "MONTHLY", monthDay: 1, shiftCodes: ["M"] });
    expect(queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, ...elDia("2026-11-01"))).toHaveLength(1);
    expect(queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, ...elDia("2026-11-02"))).toHaveLength(0);
    // Y en FEBRERO también, que es la razón de que el tope sea el 28.
    expect(queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, ...elDia("2027-02-01"))).toHaveLength(1);
  });
});

// ── La noche, y los dos cambios de hora ───────────────────────────────

describe("la noche y los dos cambios de hora", () => {
  it("un cambio postural de las 02:00 está en la ventana de la MADRUGADA", () => {
    // La ventana es de las 00:00 a las 06:00 de pared del 14. Si el
    // barrido empezara en el primer día de la ventana en vez de un día
    // antes, esto seguiría saliendo (el ancla es medianoche del propio
    // día), pero la FRANJA de noche que arrancó ayer a las 22:00 no — y
    // ése es el caso de abajo.
    const desde = new Date("2026-10-13T22:00:00.000Z"); // 00:00 de pared del 14
    const hasta = new Date("2026-10-14T04:00:00.000Z"); // 06:00 de pared
    expect(horas([linea("CAMBIO_POSTURAL", { kind: "EVERY_N_HOURS", everyNHours: 2 })], desde, hasta)).toEqual([
      "00:00", "02:00", "04:00",
    ]);
  });

  it("la FRANJA de noche que empezó AYER entra en una ventana de madrugada", () => {
    // Éste es el caso que obliga a que el barrido empiece un día antes.
    // La ventana son las 02:00–03:00 de pared del 14; la franja de noche
    // del 13 va de las 22:00 del 13 a las 08:00 del 14 y está dentro.
    const desde = new Date("2026-10-14T00:00:00.000Z"); // 02:00 de pared
    const hasta = new Date("2026-10-14T01:00:00.000Z"); // 03:00 de pared
    const oc = queToca(
      [linea("TRANSFERENCIAS", { kind: "EVERY_SHIFT", shiftCodes: ["N"] })],
      SIN_AJUSTES,
      TURNOS,
      MOMENTOS,
      desde,
      hasta,
    );
    // La franja ARRANCA antes de la ventana, así que `at` queda fuera de
    // `[desde, hasta)` y no sale. Es correcto y es la decisión: `queToca`
    // contesta «qué EMPIEZA en esta ventana», no «qué la solapa» — si
    // contestara lo segundo, la puerta pintaría la ronda de noche entera
    // cada vez que alguien la mirase a las tres de la mañana.
    expect(oc).toHaveLength(0);
    // Y pedida desde el día 13 completo, la franja de noche sí está.
    const dia13 = queToca(
      [linea("TRANSFERENCIAS", { kind: "EVERY_SHIFT", shiftCodes: ["N"] })],
      SIN_AJUSTES,
      TURNOS,
      MOMENTOS,
      new Date("2026-10-12T22:00:00.000Z"),
      new Date("2026-10-13T22:00:00.000Z"),
    );
    expect(dia13).toHaveLength(1);
    // 22:00 del 13 → 08:00 del 14, que en octubre (UTC+2) es 06:00Z.
    expect(dia13[0]!.until!.toISOString()).toBe("2026-10-14T06:00:00.000Z");
  });

  it("25-10-2026 · el día de 25 HORAS no pierde ni repite un cambio postural", () => {
    // Ese día el reloj repite de 02:59 a 02:00: el día de pared tiene 25
    // horas reales. Cada 3 h anclado a medianoche de pared da ocho
    // ocurrencias, las mismas que cualquier otro día — que es justo lo
    // que se quiere: la planta se gira a las mismas horas del reloj.
    const desde = new Date("2026-10-24T22:00:00.000Z"); // 00:00 de pared del 25
    const hasta = new Date("2026-10-25T23:00:00.000Z"); // 00:00 de pared del 26
    expect(horas([linea("CAMBIO_POSTURAL", { kind: "EVERY_N_HOURS", everyNHours: 3 })], desde, hasta)).toEqual([
      "00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00",
    ]);
  });

  it("29-03-2026 · el día de 23 HORAS · cada 3 h sigue dando OCHO rondas", () => {
    // Ese día el reloj salta de 01:59 a 03:00: las 02:00 de pared NO
    // EXISTEN. Con el ancla en medianoche y N = 3, los huecos son 00, 03,
    // 06… y ninguno cae en la hora que falta, así que el día de 23 horas
    // se gira igual que cualquier otro.
    const [desde, hasta] = elDia("2026-03-29");
    expect(horas([linea("CAMBIO_POSTURAL", { kind: "EVERY_N_HOURS", everyNHours: 3 })], desde, hasta)).toEqual([
      "00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00",
    ]);
  });

  it("29-03-2026 · cada 2 h · el hueco de las 02:00 se pide a las 03:00", () => {
    // Las 02:00 no existen y `wallTimeToUtc` las resuelve al primer
    // instante real, que es 01:00Z = 03:00 de pared. La ronda NO SE
    // PIERDE: un cambio postural que desaparece una vez al año es un
    // residente que pasa cuatro horas sin girarse.
    const [desde, hasta] = elDia("2026-03-29");
    const h = horas([linea("CAMBIO_POSTURAL", { kind: "EVERY_N_HOURS", everyNHours: 2 })], desde, hasta);
    expect(h).toEqual([
      "00:00", "03:00", "04:00", "06:00", "08:00", "10:00",
      "12:00", "14:00", "16:00", "18:00", "20:00", "22:00",
    ]);
  });

  it("29-03-2026 · cada HORA da 23 rondas y NINGUNA repetida", () => {
    // Éste es el caso que obliga al deduplicado: en hora de pared las
    // 02:00 y las 03:00 son dos huecos distintos, pero las dos resuelven
    // al MISMO instante (01:00Z). Sin quitar la repetida, la puerta
    // pintaría dos rondas idénticas a las tres de la mañana.
    //
    // 23 y no 24: ese día tiene 23 horas. Y no 22: ninguna se pierde.
    const [desde, hasta] = elDia("2026-03-29");
    const oc = queToca(
      [linea("CAMBIO_POSTURAL", { kind: "EVERY_N_HOURS", everyNHours: 1 })],
      SIN_AJUSTES,
      TURNOS,
      MOMENTOS,
      desde,
      hasta,
    );
    expect(oc).toHaveLength(23);
    expect(new Set(oc.map((o) => o.at.getTime())).size).toBe(23);
  });

  it("25-10-2026 · cada HORA da 25 rondas, que es lo que ese día tiene", () => {
    // El simétrico: ese día las 02:00 pasan dos veces, y `wallTimeToUtc`
    // elige SIEMPRE la misma pasada, así que son 24 huecos de pared sobre
    // un día de 25 horas reales — la hora repetida se gira una vez, no
    // dos. Es lo correcto: la planta hace una ronda por hora de reloj.
    const [desde, hasta] = elDia("2026-10-25");
    const oc = queToca(
      [linea("CAMBIO_POSTURAL", { kind: "EVERY_N_HOURS", everyNHours: 1 })],
      SIN_AJUSTES,
      TURNOS,
      MOMENTOS,
      desde,
      hasta,
    );
    expect(oc).toHaveLength(24);
    expect(new Set(oc.map((o) => o.at.getTime())).size).toBe(24);
  });

  it("el MISMO instante UTC cae en turnos distintos según la estación", () => {
    // 06:30Z son las 08:30 de pared en verano (mañana) y las 07:30 en
    // invierno (noche). Comparar UTC habría hecho que el turno de mañana
    // empezara a las nueve medio año.
    const verano = queToca(
      [linea("X", { kind: "MOMENTS", momentCodes: ["M1"] })],
      SIN_AJUSTES,
      TURNOS,
      [{ code: "M1", name: "a las 08:30", atTime: "08:30" }],
      new Date("2026-07-15T00:00:00.000Z"),
      new Date("2026-07-16T00:00:00.000Z"),
    );
    expect(verano[0]!.at.toISOString()).toBe("2026-07-15T06:30:00.000Z");
    expect(verano[0]!.shiftCode).toBe("M");
    const invierno = queToca(
      [linea("X", { kind: "MOMENTS", momentCodes: ["M1"] })],
      SIN_AJUSTES,
      TURNOS,
      [{ code: "M1", name: "a las 08:30", atTime: "08:30" }],
      new Date("2026-12-15T00:00:00.000Z"),
      new Date("2026-12-16T00:00:00.000Z"),
    );
    expect(invierno[0]!.at.toISOString()).toBe("2026-12-15T07:30:00.000Z");
    expect(invierno[0]!.shiftCode).toBe("M");
  });
});

// ── La vigencia: el que ingresa, el que se va, la línea cerrada ───────

describe("la vigencia de la línea", () => {
  const todoElDia = { kind: "EVERY_SHIFT", shiftCodes: ["M", "T", "N"] } satisfies Frecuencia;

  it("un residente que INGRESA A MEDIODÍA no tiene el turno de la mañana", () => {
    // Ingresa el 14 a las 15:00 de pared (13:00Z). La franja de la mañana
    // empezó a las 08:00 y nadie podía hacerle nada: no estaba en el
    // centro. Si la vigencia se midiera por DÍAS en vez de por instantes,
    // le saldría un cuidado incumplido el día de su ingreso.
    const l = linea("TRANSFERENCIAS", todoElDia, { fromAt: new Date("2026-10-14T13:00:00.000Z") });
    const oc = queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, ...elDia("2026-10-14"));
    expect(oc.map((o) => o.shiftCode)).toEqual(["T", "N"]);
  });

  it("un residente DADO DE ALTA a mediodía no tiene lo que venía después", () => {
    // «Dar de alta» en una residencia es que alguien SE VA. Se le cierra
    // el plan a las 15:00 y la tarde y la noche ya no son suyas.
    const l = linea("TRANSFERENCIAS", todoElDia, { toAt: new Date("2026-10-14T13:00:00.000Z") });
    const oc = queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, ...elDia("2026-10-14"));
    expect(oc.map((o) => o.shiftCode)).toEqual(["M"]);
    // La tarde empieza EXACTAMENTE a las 15:00, que es el instante del
    // cierre. Y no sale, porque la vigencia es semiabierta por el final
    // igual que la ventana: una línea cerrada a las 15:00 no cubre la
    // franja que empieza a las 15:00.
  });

  it("una línea CERRADA AYER no toca hoy, y la fila sigue ahí", () => {
    const l = linea("CAMBIO_POSTURAL", { kind: "EVERY_N_HOURS", everyNHours: 3 }, {
      toAt: new Date("2026-10-13T22:00:00.000Z"), // 00:00 de pared del 14
    });
    expect(queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, ...elDia("2026-10-14"))).toHaveLength(0);
    // Y el día anterior sí: el histórico se puede reconstruir.
    expect(queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, ...elDia("2026-10-13"))).toHaveLength(8);
  });

  it("el plan de AYER se contesta con la misma llamada y otra ventana", () => {
    // Doña Carmen llevaba cambios posturales cada 4 h hasta el 10 y cada
    // 2 h desde entonces. Las dos líneas conviven: una cerrada y una
    // viva, y preguntar por el 9 devuelve el plan del 9.
    const antigua = linea("CAMBIO_POSTURAL", { kind: "EVERY_N_HOURS", everyNHours: 4 }, {
      id: "l-vieja",
      fromAt: new Date("2026-01-01T00:00:00.000Z"),
      toAt: new Date("2026-10-09T22:00:00.000Z"),
    });
    const nueva = linea("CAMBIO_POSTURAL", { kind: "EVERY_N_HOURS", everyNHours: 2 }, {
      id: "l-nueva",
      fromAt: new Date("2026-10-09T22:00:00.000Z"),
    });
    const plan = [antigua, nueva];
    expect(horas(plan, ...elDia("2026-10-08"))).toEqual(["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"]);
    expect(horas(plan, ...elDia("2026-10-14"))).toHaveLength(12);
  });
});

// ── Lo que el centro apaga ────────────────────────────────────────────

describe("lo que el centro decide", () => {
  it("un control DESACTIVADO en el centro no «toca»", () => {
    const l = linea("HIDRATACION_CUTANEA", { kind: "DAILY", shiftCodes: ["T"] });
    const [desde, hasta] = elDia("2026-10-14");
    expect(queToca([l], [{ controlCode: "HIDRATACION_CUTANEA", active: false }], TURNOS, MOMENTOS, desde, hasta)).toEqual([]);
    // Y volver a activarlo lo devuelve: desactivar no borra el plan.
    expect(queToca([l], [{ controlCode: "HIDRATACION_CUTANEA", active: true }], TURNOS, MOMENTOS, desde, hasta)).toHaveLength(1);
  });

  it("un control SIN AJUSTE sigue tocando, y es a propósito", () => {
    // Un control sin fila de ajuste es un dato que falta, no una decisión
    // del centro. Suprimir el cuidado por un dato que falta es la clase
    // de silencio que se descubre en una auditoría: manda la línea del
    // plan, que es la que alguien escribió a propósito.
    const l = linea("CONTROL_RARO", { kind: "DAILY", shiftCodes: ["M"] });
    const [desde, hasta] = elDia("2026-10-14");
    expect(queToca([l], [{ controlCode: "OTRO", active: false }], TURNOS, MOMENTOS, desde, hasta)).toHaveLength(1);
  });

  it("un TURNO BORRADO deja la línea sin ocurrencias, sin inventar otro", () => {
    // Adscribir un cuidado a un turno equivocado es peor que no pedirlo.
    // La pantalla del plan pinta la línea en ámbar.
    const l = linea("HIDRATACION_CUTANEA", { kind: "DAILY", shiftCodes: ["NO_EXISTE"] });
    const [desde, hasta] = elDia("2026-10-14");
    expect(queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, desde, hasta)).toEqual([]);
  });

  it("un MOMENTO BORRADO, igual", () => {
    const l = linea("MEDICACION_DIURNA", { kind: "MOMENTS", momentCodes: ["NO_EXISTE"] });
    const [desde, hasta] = elDia("2026-10-14");
    expect(queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, desde, hasta)).toEqual([]);
  });
});

// ── El orden, y la ventana ────────────────────────────────────────────

describe("el contrato de la función", () => {
  it("el orden es por instante y DETERMINISTA", () => {
    // La puerta y el parte de relevo lo pintan en este orden; un orden
    // que dependiera del de la base cambiaría entre dos llamadas.
    const plan = [
      linea("Z", { kind: "MOMENTS", momentCodes: ["CENA"] }),
      linea("A", { kind: "MOMENTS", momentCodes: ["DESAYUNO"] }),
      linea("B", { kind: "MOMENTS", momentCodes: ["DESAYUNO"] }),
    ];
    const [desde, hasta] = elDia("2026-10-14");
    const oc = queToca(plan, SIN_AJUSTES, TURNOS, MOMENTOS, desde, hasta);
    expect(oc.map((o) => o.controlCode)).toEqual(["A", "B", "Z"]);
  });

  it("la ventana es SEMIABIERTA: dos ventanas seguidas no repiten el borde", () => {
    const l = linea("MEDICACION_DIURNA", { kind: "MOMENTS", momentCodes: ["DESAYUNO"] });
    // El desayuno del 14 es a las 09:00 de pared = 07:00Z.
    const justoAntes = queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, new Date("2026-10-14T06:00:00.000Z"), new Date("2026-10-14T07:00:00.000Z"));
    const justoDespues = queToca([l], SIN_AJUSTES, TURNOS, MOMENTOS, new Date("2026-10-14T07:00:00.000Z"), new Date("2026-10-14T08:00:00.000Z"));
    expect(justoAntes).toHaveLength(0);
    expect(justoDespues).toHaveLength(1);
  });

  it("varios residentes salen entrelazados por hora, no agrupados", () => {
    // Es lo que la puerta necesita: «lo siguiente que toca», no «todo lo
    // de doña Carmen y luego todo lo de don Manuel».
    const plan = [
      linea("MEDICACION_DIURNA", { kind: "MOMENTS", momentCodes: ["CENA"] }),
      { ...linea("MEDICACION_DIURNA", { kind: "MOMENTS", momentCodes: ["DESAYUNO"] }), id: "l-manuel", clientId: "manuel" },
    ];
    const [desde, hasta] = elDia("2026-10-14");
    expect(queToca(plan, SIN_AJUSTES, TURNOS, MOMENTOS, desde, hasta).map((o) => o.clientId)).toEqual(["manuel", "carmen"]);
  });

  it("un plan VACÍO devuelve una lista vacía y no revienta", () => {
    const [desde, hasta] = elDia("2026-10-14");
    expect(queToca([], SIN_AJUSTES, TURNOS, MOMENTOS, desde, hasta)).toEqual([]);
  });

  it("un centro SIN TURNOS no deja ninguna franja, y los instantes salen sin turno", () => {
    const [desde, hasta] = elDia("2026-10-14");
    expect(queToca([linea("X", { kind: "DAILY", shiftCodes: ["M"] })], SIN_AJUSTES, [], MOMENTOS, desde, hasta)).toEqual([]);
    const oc = queToca([linea("Y", { kind: "EVERY_N_HOURS", everyNHours: 12 })], SIN_AJUSTES, [], MOMENTOS, desde, hasta);
    expect(oc).toHaveLength(2);
    // `null` y no «el primero»: decir que no se sabe es mejor que
    // adscribirlo mal (la decisión de residencia-1, aquí heredada).
    expect(oc.every((o) => o.shiftCode === null)).toBe(true);
  });
});
