// personal-1 (puntos 8 y 9) · EL LÍMITE DE LA SALIDA OLVIDADA CON TURNO
// PLANIFICADO, Y EL CUADRE.
//
// Los cuatro casos del prompt van marcados con «[prompt]». Los tests de
// `esSalidaOlvidada` y los e2e de #45 siguen verdes sin tocarlos, y eso se
// comprueba en `apps/api/test/personal-1-salida-olvidada.test.ts`: aquí se
// fija el CÁLCULO; allí, que la función de la API sigue siendo el único
// sitio que decide.

import { describe, expect, it } from "vitest";

import {
  MARGEN_DE_TURNO_POR_DEFECTO,
  cuadreDelMes,
  finDelTurnoDelDia,
  limiteDeSalidaOlvidada,
  planificadoDelDia,
  planificadoVsFichado,
  type IntervaloPlanificado,
  type TramoFichado,
  type TurnoDelCuadrante,
} from "../src/index.js";

const M: TurnoDelCuadrante = {
  id: "t-m",
  code: "M",
  name: "Mañana",
  startsAt: "08:00",
  endsAt: "15:00",
  sortOrder: 1,
  coberturaMinima: null,
};
const N: TurnoDelCuadrante = {
  id: "t-n",
  code: "N",
  name: "Noche",
  startsAt: "22:00",
  endsAt: "08:00",
  sortOrder: 3,
  coberturaMinima: null,
};

/** Un instante de pared de Madrid en noviembre (UTC+1). */
function h(dia: string, hora: string): Date {
  return new Date(`2026-11-${dia}T${hora}:00+01:00`);
}

// ── El límite ─────────────────────────────────────────────────────────

describe("limiteDeSalidaOlvidada", () => {
  it("sin turno planificado es exactamente lo de #45: la duración", () => {
    const limite = limiteDeSalidaOlvidada({
      entradaAt: h("02", "08:00"),
      maxHoras: 16,
      finPlanificadoAt: null,
      margenHoras: 4,
    });
    expect(limite.toISOString()).toBe(h("03", "00:00").toISOString());
  });

  it("[prompt] con turno M de 08:00 a 15:00, el límite son las 19:00", () => {
    // Fin del turno más el margen de cuatro horas. Y son las 19:00 aunque
    // el tramo lleve once horas: el máximo del tenant (16 h) daría
    // medianoche, y el que manda es el MENOR.
    const limite = limiteDeSalidaOlvidada({
      entradaAt: h("02", "08:00"),
      maxHoras: 16,
      finPlanificadoAt: h("02", "15:00"),
      margenHoras: 4,
    });
    expect(limite.toISOString()).toBe(h("02", "19:00").toISOString());
  });

  it("[prompt] con turno N de 22:00 a 08:00, el límite son las 12:00", () => {
    // Y las 07:58 están muy por debajo: la noche se cierra de un toque,
    // como ya hacía desde #45.
    const limite = limiteDeSalidaOlvidada({
      entradaAt: h("02", "22:00"),
      maxHoras: 16,
      finPlanificadoAt: h("03", "08:00"),
      margenHoras: 4,
    });
    expect(limite.toISOString()).toBe(h("03", "12:00").toISOString());
    expect(h("03", "07:58").getTime()).toBeLessThan(limite.getTime());
  });

  it("el turno APRIETA, nunca AFLOJA: un turno largo no pasa del máximo", () => {
    // Un turno que acabara a las 20:00 del día siguiente daría, con el
    // margen, las 00:00 del tercer día: veintiocho horas. El máximo del
    // tenant lo corta en dieciséis.
    const limite = limiteDeSalidaOlvidada({
      entradaAt: h("02", "08:00"),
      maxHoras: 16,
      finPlanificadoAt: h("03", "20:00"),
      margenHoras: 4,
    });
    expect(limite.toISOString()).toBe(h("03", "00:00").toISOString());
  });

  it("y un turno que acaba ANTES de la entrada se ignora", () => {
    // Una mañana en la celda de quien entró a las 23:00 del día anterior.
    // Sin esta rama, el límite sería anterior a la propia entrada y el
    // tramo nacería «olvidado».
    const limite = limiteDeSalidaOlvidada({
      entradaAt: h("02", "23:00"),
      maxHoras: 16,
      finPlanificadoAt: h("02", "15:00"),
      margenHoras: 4,
    });
    expect(limite.toISOString()).toBe(h("03", "15:00").toISOString());
  });

  it("el margen de serie son cuatro horas", () => {
    expect(MARGEN_DE_TURNO_POR_DEFECTO).toBe(4);
  });
});

describe("finDelTurnoDelDia", () => {
  const partido: Array<Pick<IntervaloPlanificado, "finAt">> = [
    { finAt: h("02", "12:00") },
    { finAt: h("02", "21:00") },
  ];

  it("con un turno partido coge el que acaba MÁS TARDE", () => {
    // Con el que acaba antes, quien entra a las 08:00 de una jornada de
    // 08–12 y 17–21 tendría su límite a las 16:00 y se le preguntaría a
    // media tarde, estando dentro.
    expect(finDelTurnoDelDia(partido, h("02", "08:00"))?.toISOString()).toBe(
      h("02", "21:00").toISOString(),
    );
  });

  it("ignora lo que acaba antes de que entrara", () => {
    expect(finDelTurnoDelDia(partido, h("02", "13:00"))?.toISOString()).toBe(
      h("02", "21:00").toISOString(),
    );
    expect(finDelTurnoDelDia(partido, h("02", "22:00"))).toBeNull();
  });

  it("y sin nada planificado devuelve null", () => {
    expect(finDelTurnoDelDia([], h("02", "08:00"))).toBeNull();
  });
});

// ── Planificado frente a fichado ──────────────────────────────────────

describe("planificadoVsFichado", () => {
  const plan = planificadoDelDia(
    "2026-11-02",
    [
      { employeeId: "ana", turnoId: "t-m" },
      { employeeId: "bea", turnoId: "t-n" },
    ],
    [M, N],
  );

  function tramo(
    employeeId: string,
    inicio: string,
    fin: string | null,
  ): TramoFichado {
    return {
      entryId: `e-${employeeId}`,
      employeeId,
      inicioAt: h("02", inicio),
      finAt: fin == null ? null : h("02", fin),
      dia: "2026-11-02",
    };
  }

  it("quien tenía turno y no ha fichado, pasada la tolerancia", () => {
    const r = planificadoVsFichado({
      ahora: h("02", "08:16"),
      planificado: plan,
      fichado: [],
      dias: ["2026-11-02"],
      toleranciaMinutos: 15,
      margenHoras: 4,
    });
    expect(r.sinFichar.map((s) => s.employeeId)).toEqual(["ana"]);
    expect(r.sinFichar[0]!.minutosDeRetraso).toBe(16);
    expect(r.sinFichar[0]!.code).toBe("M");
  });

  it("y DENTRO de la tolerancia no se dice nada", () => {
    // Un aviso que sale cada mañana a las 08:01 y se apaga a las 08:06 es
    // un aviso que se aprende a ignorar.
    const r = planificadoVsFichado({
      ahora: h("02", "08:15"),
      planificado: plan,
      fichado: [],
      dias: ["2026-11-02"],
      toleranciaMinutos: 15,
      margenHoras: 4,
    });
    expect(r.sinFichar).toEqual([]);
  });

  it("quien fichó no sale como ausente, aunque llegara tarde", () => {
    const r = planificadoVsFichado({
      ahora: h("02", "09:00"),
      planificado: plan,
      fichado: [tramo("ana", "08:40", null)],
      dias: ["2026-11-02"],
      toleranciaMinutos: 15,
      margenHoras: 4,
    });
    expect(r.sinFichar).toEqual([]);
  });

  it("quien ha fichado SIN turno sale aparte", () => {
    const r = planificadoVsFichado({
      ahora: h("02", "09:00"),
      planificado: plan,
      fichado: [tramo("ana", "08:00", null), tramo("carmen", "08:00", null)],
      dias: ["2026-11-02"],
      toleranciaMinutos: 15,
      margenHoras: 4,
    });
    expect(r.sinTurno.map((s) => s.employeeId)).toEqual(["carmen"]);
  });

  it("[prompt] quien sigue dentro pasada su hora sale ANTES de las 16 h", () => {
    // Ana entró a las 08:00 con turno M; a las 19:01 lleva once horas
    // dentro y el máximo del tenant son dieciséis. Antes de este bloque
    // nadie se enteraba hasta medianoche.
    const r = planificadoVsFichado({
      ahora: h("02", "19:01"),
      planificado: plan,
      fichado: [tramo("ana", "08:00", null)],
      dias: ["2026-11-02"],
      toleranciaMinutos: 15,
      margenHoras: 4,
    });
    expect(r.dentroPasadaSuHora).toHaveLength(1);
    expect(r.dentroPasadaSuHora[0]!.employeeId).toBe("ana");
    expect(r.dentroPasadaSuHora[0]!.code).toBe("M");
    expect(r.dentroPasadaSuHora[0]!.finPlanificadoAt.toISOString()).toBe(
      h("02", "15:00").toISOString(),
    );
    expect(r.dentroPasadaSuHora[0]!.horasDeMas).toBe(4);
  });

  it("y a las 19:00 clavadas todavía no: el borde no es aviso", () => {
    const r = planificadoVsFichado({
      ahora: h("02", "19:00"),
      planificado: plan,
      fichado: [tramo("ana", "08:00", null)],
      dias: ["2026-11-02"],
      toleranciaMinutos: 15,
      margenHoras: 4,
    });
    expect(r.dentroPasadaSuHora).toEqual([]);
  });

  it("un tramo ya CERRADO no está dentro de nada", () => {
    const r = planificadoVsFichado({
      ahora: h("02", "23:00"),
      planificado: plan,
      fichado: [tramo("ana", "08:00", "15:05")],
      dias: ["2026-11-02"],
      toleranciaMinutos: 15,
      margenHoras: 4,
    });
    expect(r.dentroPasadaSuHora).toEqual([]);
  });

  it("y quien no tiene turno planificado no sale «pasada su hora»", () => {
    // Eso lo decide `fichaje_max_open_hours` y lo pregunta el móvil, igual
    // que desde #45. Aquí no hay nada contra qué comparar.
    const r = planificadoVsFichado({
      ahora: h("02", "23:00"),
      planificado: plan,
      fichado: [tramo("carmen", "08:00", null)],
      dias: ["2026-11-02"],
      toleranciaMinutos: 15,
      margenHoras: 4,
    });
    expect(r.dentroPasadaSuHora).toEqual([]);
  });

  it("un turno partido no son dos ausencias", () => {
    const partido = planificadoDelDia(
      "2026-11-02",
      [
        { employeeId: "ana", turnoId: "t-a" },
        { employeeId: "ana", turnoId: "t-b" },
      ],
      [
        { ...M, id: "t-a", code: "A", startsAt: "08:00", endsAt: "12:00" },
        { ...M, id: "t-b", code: "B", startsAt: "17:00", endsAt: "21:00" },
      ],
    );
    const r = planificadoVsFichado({
      ahora: h("02", "22:00"),
      planificado: partido,
      fichado: [],
      dias: ["2026-11-02"],
      toleranciaMinutos: 15,
      margenHoras: 4,
    });
    expect(r.sinFichar).toHaveLength(1);
  });
});

// ── El cuadre del mes ─────────────────────────────────────────────────

describe("cuadreDelMes", () => {
  it("planificado, fichado y diferencia por persona", () => {
    const plan = planificadoDelDia(
      "2026-11-02",
      [{ employeeId: "ana", turnoId: "t-m" }],
      [M],
    );
    const r = cuadreDelMes({
      employeeIds: ["ana", "bea"],
      planificado: plan,
      fichado: [
        {
          entryId: "e1",
          employeeId: "ana",
          inicioAt: h("02", "08:00"),
          finAt: h("02", "15:30"),
          dia: "2026-11-02",
        },
      ],
    });
    expect(r[0]).toEqual({
      employeeId: "ana",
      minutosPlanificados: 420,
      minutosFichados: 450,
      diferencia: 30,
      conTramoAbierto: false,
    });
    // Y quien no tiene ni lo uno ni lo otro sale a cero, no se cae de la
    // lista: el mes de alguien sin un solo fichaje es un dato.
    expect(r[1]).toEqual({
      employeeId: "bea",
      minutosPlanificados: 0,
      minutosFichados: 0,
      diferencia: 0,
      conTramoAbierto: false,
    });
  });

  it("un tramo ABIERTO no se cuenta, y se dice que hay", () => {
    // Un total que lo incluyera estaría inventando la hora de salida, que
    // es lo que ADR-018 §5 se niega a hacer. Y uno que lo ignorara en
    // silencio dejaría a alguien con ocho horas de menos sin explicación.
    const r = cuadreDelMes({
      employeeIds: ["ana"],
      planificado: [],
      fichado: [
        {
          entryId: "e1",
          employeeId: "ana",
          inicioAt: h("02", "08:00"),
          finAt: null,
          dia: "2026-11-02",
        },
      ],
    });
    expect(r[0]!.minutosFichados).toBe(0);
    expect(r[0]!.conTramoAbierto).toBe(true);
  });

  it("[prompt] la noche del cambio de hora cuenta ONCE horas en el cuadre", () => {
    // Planificado y fichado tienen que contar lo mismo, y los dos sobre
    // los INSTANTES. La noche que empieza el 24-10-2026 a las 22:00 y
    // acaba el 25 a las 08:00 dura once horas: el reloj vuelve de las
    // 03:00 a las 02:00 en medio.
    const plan = planificadoDelDia(
      "2026-10-24",
      [{ employeeId: "ana", turnoId: "t-n" }],
      [N],
    );
    const r = cuadreDelMes({
      employeeIds: ["ana"],
      planificado: plan,
      fichado: [
        {
          entryId: "e1",
          employeeId: "ana",
          inicioAt: new Date("2026-10-24T22:00:00+02:00"),
          // Las 08:00 del 25 ya son UTC+1.
          finAt: new Date("2026-10-25T08:00:00+01:00"),
          dia: "2026-10-24",
        },
      ],
    });
    expect(r[0]!.minutosPlanificados).toBe(660);
    expect(r[0]!.minutosFichados).toBe(660);
    expect(r[0]!.diferencia).toBe(0);
  });
});
