// historia-1 (D-92, D-93) · **LAS AUSENCIAS PAUSAN, Y LA TABLA DE CASOS
// DE ORO DE LOS DÍAS DEL MES.**
//
// Dos mitades:
//
//   1. **que un residente ausente no genera ocurrencias** —y por tanto no
//      sale como «no hecho» ni entra en el denominador—, con el borde que
//      importa: la señora que se va a las 15:00 sí tenía la higiene de la
//      mañana;
//   2. **`diasDelMes`**, con los seis casos que el prompt pide: mes
//      completo, ingreso a mitad, ausencia que cruza de mes, alta a
//      mitad, dos ausencias en el mismo mes y año bisiesto.
//
// Pura: cada caso es una fila de datos. Ninguna maqueta de Prisma y
// ningún reloj.

import { describe, expect, it } from "vitest";

import {
  DE_DONDE_VOLVIO,
  NOMBRE_CORTO_DE_LA_AUSENCIA,
  NOMBRE_DE_LA_AUSENCIA,
  ausenciaEn,
  cuantosDiasTieneElMes,
  diasDelMes,
  diasDelMesDelCentro,
  estaAusente,
  fraseDeLaAusencia,
} from "../src/ausencias.js";
import type { AusenciaDelPlan, ResidenteParaLosDias } from "../src/ausencias.js";
import { queToca } from "../src/que-toca.js";
import type { AjusteDelCentro, LineaDePlan } from "../src/que-toca.js";
import type { Frecuencia } from "../src/frecuencia.js";
import type { TurnoDelCentro } from "../src/turnos.js";
import { wallTimeToUtc } from "../src/tiempo.js";

const TURNOS: TurnoDelCentro[] = [
  { id: "t-m", code: "M", name: "Mañana", startsAt: "08:00", endsAt: "15:00" },
  { id: "t-t", code: "T", name: "Tarde", startsAt: "15:00", endsAt: "22:00" },
  { id: "t-n", code: "N", name: "Noche", startsAt: "22:00", endsAt: "08:00" },
];
const SIN_AJUSTES: AjusteDelCentro[] = [];

const CARMEN = "carmen";

/** Un instante de pared del centro. */
function en(fecha: string, hora: string): Date {
  return wallTimeToUtc(fecha, hora);
}

function linea(frecuencia: Frecuencia, clientId = CARMEN): LineaDePlan {
  return {
    id: `l-${clientId}`,
    clientId,
    controlCode: "HIGIENE",
    frecuencia,
    fromAt: en("2020-01-01", "00:00"),
    toAt: null,
  };
}

function ausencia(extra: Partial<AusenciaDelPlan> = {}): AusenciaDelPlan {
  return {
    clientId: CARMEN,
    tipo: "INGRESO_HOSPITALARIO",
    desde: en("2026-10-13", "15:00"),
    hasta: null,
    ...extra,
  };
}

// ════════════════════════════════════════════════════════════════════
//  1 · ESTAR FUERA
// ════════════════════════════════════════════════════════════════════

describe("`estaAusente` mide el intervalo `[desde, hasta)`", () => {
  const a = [ausencia({ hasta: en("2026-10-16", "18:00") })];

  it("antes de irse, no", () => {
    expect(estaAusente(a, CARMEN, en("2026-10-13", "14:59"))).toBe(false);
  });

  it("el instante exacto de la salida, SÍ", () => {
    expect(estaAusente(a, CARMEN, en("2026-10-13", "15:00"))).toBe(true);
  });

  it("en medio, sí", () => {
    expect(estaAusente(a, CARMEN, en("2026-10-15", "09:00"))).toBe(true);
  });

  it("el instante exacto de la vuelta ya es DENTRO", () => {
    // Semiabierto, como los turnos y como la ventana de `queToca`: el
    // cuidado de las 18:00 de quien volvió a las 18:00 se le pide.
    expect(estaAusente(a, CARMEN, en("2026-10-16", "18:00"))).toBe(false);
  });

  it("una ausencia ABIERTA no acaba nunca", () => {
    const abierta = [ausencia({ hasta: null })];
    expect(estaAusente(abierta, CARMEN, en("2027-06-01", "12:00"))).toBe(true);
  });

  it("la ausencia de OTRO residente no me afecta", () => {
    expect(estaAusente(a, "luis", en("2026-10-15", "09:00"))).toBe(false);
  });

  it("`ausenciaEn` devuelve la MÁS RECIENTE de las que cubren el instante", () => {
    const dos = [
      ausencia({ tipo: "VACACIONES_FAMILIA", desde: en("2026-10-10", "10:00"), hasta: en("2026-10-20", "10:00") }),
      ausencia({ tipo: "URGENCIAS", desde: en("2026-10-13", "15:00"), hasta: null }),
    ];
    // El índice parcial impide dos ABIERTAS, pero una cerrada larga y una
    // abierta dentro sí pueden coexistir. Manda la que empezó después.
    expect(ausenciaEn(dos, CARMEN, en("2026-10-15", "09:00"))?.tipo).toBe("URGENCIAS");
  });

  it("y `null` cuando está en el centro", () => {
    expect(ausenciaEn([], CARMEN, en("2026-10-15", "09:00"))).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
//  2 · `queToca` NO GENERA LO DE QUIEN NO ESTÁ (D-92)
// ════════════════════════════════════════════════════════════════════

describe("un residente ausente no produce ocurrencias", () => {
  const diaria = linea({ kind: "DAILY", shiftCodes: ["M", "T", "N"] });
  const desde = en("2026-10-14", "00:00");
  const hasta = en("2026-10-15", "00:00");

  it("sin ausencias, le tocan los tres turnos del día", () => {
    expect(queToca([diaria], SIN_AJUSTES, TURNOS, [], desde, hasta, [])).toHaveLength(3);
  });

  it("con una ausencia que cubre el día entero, NINGUNO", () => {
    const a = [ausencia({ desde: en("2026-10-13", "08:00"), hasta: en("2026-10-20", "08:00") })];
    expect(queToca([diaria], SIN_AJUSTES, TURNOS, [], desde, hasta, a)).toEqual([]);
  });

  it("**se mide contra la OCURRENCIA, no contra el día**", () => {
    // La señora se va a las 15:00. La franja de la MAÑANA empezó a las
    // 08:00 y sí le tocaba; la de tarde y la de noche, no. Comparando
    // días se le perdonaría el turno entero —o se le reprocharía—, y las
    // dos cosas son mentira en el parte de ese turno.
    const a = [ausencia({ desde: en("2026-10-14", "15:00"), hasta: null })];
    const oc = queToca([diaria], SIN_AJUSTES, TURNOS, [], desde, hasta, a);
    expect(oc.map((o) => o.shiftCode)).toEqual(["M"]);
  });

  it("y al volver vuelve a tocarle, en la misma llamada", () => {
    const a = [
      ausencia({ desde: en("2026-10-14", "07:00"), hasta: en("2026-10-14", "15:00") }),
    ];
    const oc = queToca([diaria], SIN_AJUSTES, TURNOS, [], desde, hasta, a);
    // La mañana cae dentro de la ausencia (08:00 < 15:00): fuera. La
    // tarde empieza justo a las 15:00, que ya es dentro del centro.
    expect(oc.map((o) => o.shiftCode)).toEqual(["T", "N"]);
  });

  it("la ausencia de uno no pausa al otro", () => {
    const plan = [diaria, linea({ kind: "DAILY", shiftCodes: ["M"] }, "luis")];
    const a = [ausencia({ desde: en("2026-10-13", "08:00"), hasta: null })];
    const oc = queToca(plan, SIN_AJUSTES, TURNOS, [], desde, hasta, a);
    expect(oc.map((o) => o.clientId)).toEqual(["luis"]);
  });

  it("una CONSULTA EXTERNA de dos horas pausa sólo esas dos horas", () => {
    const cadaHora = linea({ kind: "EVERY_N_HOURS", everyNHours: 1 });
    const a = [
      ausencia({
        tipo: "CONSULTA_EXTERNA",
        desde: en("2026-10-14", "10:00"),
        hasta: en("2026-10-14", "12:00"),
      }),
    ];
    const oc = queToca([cadaHora], SIN_AJUSTES, TURNOS, [], desde, hasta, a);
    // 24 rondas menos las de 10:00 y 11:00. La de 12:00 ya es dentro.
    expect(oc).toHaveLength(22);
    const horas = oc.map((o) => o.at.getTime());
    expect(horas).not.toContain(en("2026-10-14", "10:00").getTime());
    expect(horas).not.toContain(en("2026-10-14", "11:00").getTime());
    expect(horas).toContain(en("2026-10-14", "12:00").getTime());
  });
});

// ════════════════════════════════════════════════════════════════════
//  3 · LA FRASE
// ════════════════════════════════════════════════════════════════════

describe("la frase de la ausencia", () => {
  const ahora = en("2026-10-16", "14:30");

  it("desde hoy", () => {
    expect(
      fraseDeLaAusencia(ausencia({ desde: en("2026-10-16", "09:00") }), ahora),
    ).toBe("Ausente: ingresado en el hospital desde hoy");
  });

  it("desde ayer", () => {
    expect(
      fraseDeLaAusencia(ausencia({ desde: en("2026-10-15", "09:00") }), ahora),
    ).toBe("Ausente: ingresado en el hospital desde ayer");
  });

  it("**desde el martes** cuando cae en esta semana", () => {
    // El 13 de octubre de 2026 es martes. En un relevo lo que sitúa a
    // alguien es «desde el martes», no «desde el 13/10».
    expect(
      fraseDeLaAusencia(ausencia({ desde: en("2026-10-13", "15:00") }), ahora),
    ).toBe("Ausente: ingresado en el hospital desde el martes");
  });

  it("y la FECHA cuando hace más de una semana", () => {
    // «Desde el martes» de hace tres semanas es engañoso.
    expect(
      fraseDeLaAusencia(ausencia({ desde: en("2026-09-28", "15:00") }), ahora),
    ).toBe("Ausente: ingresado en el hospital desde el 28 de septiembre");
  });

  it("cada tipo tiene su nombre largo y su nombre corto", () => {
    expect(NOMBRE_DE_LA_AUSENCIA.VACACIONES_FAMILIA).toBe("de salida con la familia");
    expect(NOMBRE_CORTO_DE_LA_AUSENCIA.SALIDA_NO_CONTROLADA).toBe("No localizado");
    // Y «de dónde volvió» es una tercera frase: el panel dice «volvió del
    // hospital», no «volvió de ingresado en el hospital».
    expect(DE_DONDE_VOLVIO.INGRESO_HOSPITALARIO).toBe("del hospital");
    // Los cinco tipos tienen las dos. Sin esto, un tipo nuevo saldría
    // como `undefined` en la tarjeta de la puerta.
    for (const tipo of [
      "INGRESO_HOSPITALARIO",
      "URGENCIAS",
      "VACACIONES_FAMILIA",
      "CONSULTA_EXTERNA",
      "SALIDA_NO_CONTROLADA",
    ] as const) {
      expect(NOMBRE_DE_LA_AUSENCIA[tipo]).toBeTruthy();
      expect(NOMBRE_CORTO_DE_LA_AUSENCIA[tipo]).toBeTruthy();
      expect(DE_DONDE_VOLVIO[tipo]).toBeTruthy();
    }
  });
});

// ════════════════════════════════════════════════════════════════════
//  4 · **LA TABLA DE CASOS DE ORO DE `diasDelMes`** (D-93)
// ════════════════════════════════════════════════════════════════════
//
// La regla de serie es **dónde PERNOCTA el residente**, medida a las
// 00:00 del día siguiente. Sus dos consecuencias, que están en todos los
// casos de abajo: **el día del ingreso cuenta** y **el día del alta no**.

const SIEMPRE: ResidenteParaLosDias = {
  clientId: CARMEN,
  ingreso: "2020-01-01",
  alta: null,
};

describe("`diasDelMes` · la tabla de casos de oro", () => {
  it("1 · MES COMPLETO sin ausencias: 31 ordinarios de 31", () => {
    const d = diasDelMes(SIEMPRE, [], "2026-10");
    expect(d).toEqual({
      mes: "2026-10",
      clientId: CARMEN,
      ordinarios: 31,
      hospital: 0,
      vacaciones: 0,
      otros: 0,
      presencia: 31,
    });
  });

  it("2 · INGRESO A MITAD: el día del ingreso CUENTA", () => {
    // Ingresa el 20 de octubre: del 20 al 31 son 12 noches.
    const d = diasDelMes({ clientId: CARMEN, ingreso: "2026-10-20", alta: null }, [], "2026-10");
    expect(d.presencia).toBe(12);
    expect(d.ordinarios).toBe(12);
  });

  it("3 · AUSENCIA QUE CRUZA DE MES: cada mes cuenta lo suyo", () => {
    // Al hospital el 28 de octubre a las 10:00, vuelve el 3 de noviembre
    // a las 18:00.
    //
    //   · octubre: pernocta fuera las noches del 28, 29, 30 y 31 → 4 de
    //     hospital y 27 ordinarios (31 − 4);
    //   · noviembre: pernocta fuera las noches del 1 y el 2; la del 3 ya
    //     duerme aquí (volvió a las 18:00) → 2 de hospital y 28
    //     ordinarios.
    const a = [
      ausencia({ desde: en("2026-10-28", "10:00"), hasta: en("2026-11-03", "18:00") }),
    ];
    const oct = diasDelMes(SIEMPRE, a, "2026-10");
    expect(oct).toMatchObject({ ordinarios: 27, hospital: 4, vacaciones: 0, otros: 0, presencia: 31 });
    const nov = diasDelMes(SIEMPRE, a, "2026-11");
    expect(nov).toMatchObject({ ordinarios: 28, hospital: 2, vacaciones: 0, otros: 0, presencia: 30 });
    // Y la suma de los dos meses es la estancia entera: ni un día
    // contado dos veces ni uno perdido en la frontera.
    expect(oct.presencia + nov.presencia).toBe(61);
  });

  it("4 · ALTA A MITAD: el día del alta NO cuenta", () => {
    // Se va el 10 de octubre. Las noches del 1 al 9 son suyas: 9.
    const d = diasDelMes({ clientId: CARMEN, ingreso: "2020-01-01", alta: "2026-10-10" }, [], "2026-10");
    expect(d.presencia).toBe(9);
    expect(d.ordinarios).toBe(9);
  });

  it("5 · DOS AUSENCIAS EN EL MISMO MES, de clases distintas", () => {
    // Urgencias del 5 al 7 (noches 5 y 6 fuera) y con la hija del 20 al
    // 25 (noches 20 a 24 fuera).
    const a = [
      ausencia({ tipo: "URGENCIAS", desde: en("2026-10-05", "22:00"), hasta: en("2026-10-07", "11:00") }),
      ausencia({
        tipo: "VACACIONES_FAMILIA",
        desde: en("2026-10-20", "11:00"),
        hasta: en("2026-10-25", "19:00"),
      }),
    ];
    const d = diasDelMes(SIEMPRE, a, "2026-10");
    expect(d).toMatchObject({ hospital: 2, vacaciones: 5, otros: 0, presencia: 31 });
    expect(d.ordinarios).toBe(31 - 2 - 5);
  });

  it("6 · AÑO BISIESTO: febrero de 2028 tiene 29", () => {
    expect(diasDelMes(SIEMPRE, [], "2028-02").presencia).toBe(29);
    // Y el que un `% 4` a mano se come: 2100 no es bisiesto.
    expect(diasDelMes(SIEMPRE, [], "2100-02").presencia).toBe(28);
    expect(cuantosDiasTieneElMes(2028, 2)).toBe(29);
  });
});

describe("`diasDelMes` · los bordes que salieron al escribirlo", () => {
  it("una ausencia ABIERTA se cuenta hasta el final del mes", () => {
    const a = [ausencia({ desde: en("2026-10-28", "10:00"), hasta: null })];
    const d = diasDelMes(SIEMPRE, a, "2026-10");
    expect(d.hospital).toBe(4);
    // Y el mes siguiente entero, porque nadie la ha cerrado. Dar por
    // vuelto a quien no ha vuelto sería contarlo como presente en la
    // factura.
    expect(diasDelMes(SIEMPRE, a, "2026-11").hospital).toBe(30);
  });

  it("una CONSULTA EXTERNA de ida y vuelta el mismo día cuenta ORDINARIA", () => {
    const a = [
      ausencia({
        tipo: "CONSULTA_EXTERNA",
        desde: en("2026-10-14", "09:00"),
        hasta: en("2026-10-14", "14:00"),
      }),
    ];
    const d = diasDelMes(SIEMPRE, a, "2026-10");
    // Durmió aquí: es un día del centro. Lo que la ausencia pausó fueron
    // los cuidados de esas cinco horas, que es otra pregunta.
    expect(d).toMatchObject({ ordinarios: 31, hospital: 0, vacaciones: 0, otros: 0 });
  });

  it("una SALIDA NO CONTROLADA que cruza la noche va a `otros`, no a vacaciones", () => {
    // Meterla en «vacaciones» sería ponerla en la factura de la Junta
    // como una salida con la familia.
    const a = [
      ausencia({
        tipo: "SALIDA_NO_CONTROLADA",
        desde: en("2026-10-14", "19:00"),
        hasta: en("2026-10-15", "08:00"),
      }),
    ];
    const d = diasDelMes(SIEMPRE, a, "2026-10");
    expect(d).toMatchObject({ otros: 1, vacaciones: 0, hospital: 0, ordinarios: 30 });
  });

  it("un residente que ingresa DESPUÉS del mes pedido no tiene ni un día", () => {
    const d = diasDelMes({ clientId: CARMEN, ingreso: "2026-11-02", alta: null }, [], "2026-10");
    expect(d.presencia).toBe(0);
  });

  it("y uno que se fue ANTES del mes pedido, tampoco", () => {
    const d = diasDelMes(
      { clientId: CARMEN, ingreso: "2020-01-01", alta: "2026-09-30" },
      [],
      "2026-10",
    );
    expect(d.presencia).toBe(0);
  });

  it("el cambio de hora de octubre no se come ni añade un día", () => {
    // El 25 de octubre de 2026 el reloj retrasa una hora: ese día tiene
    // 25 horas. La cuenta es de NOCHES y no de duraciones, así que
    // octubre sigue teniendo 31.
    expect(diasDelMes(SIEMPRE, [], "2026-10").presencia).toBe(31);
    // Y marzo, que tiene un día de 23 horas, 31 también.
    expect(diasDelMes(SIEMPRE, [], "2027-03").presencia).toBe(31);
  });

  it("las ausencias de OTRO residente no entran en mi cuenta", () => {
    const a = [ausencia({ clientId: "luis", desde: en("2026-10-01", "00:00"), hasta: null })];
    expect(diasDelMes(SIEMPRE, a, "2026-10").ordinarios).toBe(31);
  });
});

describe("el resumen del CENTRO", () => {
  it("suma los cuatro números y ordena estable", () => {
    const residentes: ResidenteParaLosDias[] = [
      { clientId: "zoe", ingreso: "2020-01-01", alta: null },
      { clientId: "ana", ingreso: "2026-10-20", alta: null },
    ];
    const a = [
      ausencia({ clientId: "zoe", desde: en("2026-10-28", "10:00"), hasta: null }),
    ];
    const r = diasDelMesDelCentro(residentes, a, "2026-10");
    expect(r.residentes.map((x) => x.clientId)).toEqual(["ana", "zoe"]);
    expect(r.total).toEqual({
      ordinarios: 12 + 27,
      hospital: 4,
      vacaciones: 0,
      otros: 0,
      presencia: 12 + 31,
    });
  });

  it("un centro sin residentes da ceros y no revienta", () => {
    const r = diasDelMesDelCentro([], [], "2026-10");
    expect(r.residentes).toEqual([]);
    expect(r.total.presencia).toBe(0);
  });
});
