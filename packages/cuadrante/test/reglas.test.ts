// personal-1 · LOS TESTS DE TABLA DE `comprobarCuadrante`.
//
// Uno por regla y sus bordes. Es la pieza central del bloque y lo que
// personal-2 va a usar para validar lo que genere, así que lo que se fija
// aquí no es «que devuelva algo»: es **qué salta, qué NO salta, y cuánto
// dice que falta**.
//
// Los siete casos que el prompt pide cerrar van marcados con «[prompt]»
// para que se vean de lejos.
//
// ── UNA CORRECCIÓN AL PROMPT, Y VA ARRIBA PORQUE IMPORTA ────────────
//
// El prompt pide: «noche 22–08 seguida de mañana 08–15 (salta el descanso
// de 12 h), **noche seguida de tarde (no salta)**».
//
// La primera mitad salta y está aquí. La segunda **no puede no saltar**:
// una noche que acaba a las 08:00 y una tarde que empieza a las 15:00 del
// mismo día dejan **siete horas** de descanso, y el límite del art. 34.3
// del ET son doce. Con el parámetro a 12 salta, y tiene que saltar: son
// siete horas.
//
// Las dos lecturas alternativas se han comprobado y dan lo mismo: si la
// tarde fuera la del MISMO día que la noche empieza (T 15–22 y después N
// 22–08) el hueco es de cero horas, y también salta.
//
// El par que **no** salta es noche → tarde del día SIGUIENTE al siguiente:
// 31 horas. Está en la tabla, debajo del que sí salta, para que se vea la
// diferencia. Y si lo que un convenio permite son siete horas, el
// parámetro está ahí: `horasDescansoDiario` es dato del tenant.

import { describe, expect, it } from "vitest";

import {
  REGLAS_DE_SERIE,
  comprobarCuadrante,
  comprobarTurnosDelTenant,
  intervalosDe,
  minutosDeTurno,
  resumenDeAvisos,
  type AvisoDelCuadrante,
  type CeldaDelCuadrante,
  type Cuadrante,
  type PersonaDelCuadrante,
  type ReglasDelCuadrante,
  type TurnoDelCuadrante,
} from "../src/index.js";

// ── El decorado ───────────────────────────────────────────────────────
//
// Noviembre de 2026: treinta días, cuatro bloques de siete completos
// (1-7, 8-14, 15-21, 22-28) y los días 29 y 30 fuera de todo bloque. Es
// un mes cómodo para los bordes del descanso semanal.

const M: TurnoDelCuadrante = {
  id: "t-m",
  code: "M",
  name: "Mañana",
  startsAt: "08:00",
  endsAt: "15:00",
  sortOrder: 1,
  coberturaMinima: null,
};
const T: TurnoDelCuadrante = {
  id: "t-t",
  code: "T",
  name: "Tarde",
  startsAt: "15:00",
  endsAt: "22:00",
  sortOrder: 2,
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
const TURNOS = [M, T, N];

function persona(
  employeeId: string,
  extra: Partial<PersonaDelCuadrante> = {},
): PersonaDelCuadrante {
  return {
    employeeId,
    nombre: employeeId.toUpperCase(),
    atencionDirecta: true,
    minutosContratados: null,
    altaEl: null,
    finEl: null,
    ...extra,
  };
}

function celda(
  employeeId: string,
  dia: string,
  turnoId: string | null,
  ausencia: CeldaDelCuadrante["ausencia"] = null,
): CeldaDelCuadrante {
  return { employeeId, dia, turnoId, ausencia };
}

function cuadrante(partes: Partial<Cuadrante> = {}): Cuadrante {
  return {
    mes: "2026-11",
    turnos: TURNOS,
    personas: [persona("ana")],
    celdas: [],
    ...partes,
  };
}

function reglas(partes: Partial<ReglasDelCuadrante> = {}): ReglasDelCuadrante {
  return { ...REGLAS_DE_SERIE, ...partes };
}

/** Los avisos de una regla. */
function de(avisos: AvisoDelCuadrante[], regla: string): AvisoDelCuadrante[] {
  return avisos.filter((a) => a.regla === regla);
}

// ── 0 · los intervalos, que es de lo que todo lo demás depende ───────

describe("de una celda a un tramo de tiempo de verdad", () => {
  it("una mañana de 08:00 a 15:00 dura siete horas", () => {
    expect(minutosDeTurno("2026-11-02", M)).toBe(420);
  });

  it("una noche de 22:00 a 08:00 cruza medianoche y dura diez", () => {
    expect(minutosDeTurno("2026-11-02", N)).toBe(600);
  });

  it("[prompt] la noche del CAMBIO DE HORA dura ONCE", () => {
    // El 25-10-2026 el reloj vuelve de las 03:00 CEST a las 02:00 CET, así
    // que la noche que empieza el 24 a las 22:00 y acaba el 25 a las 08:00
    // dura **once** horas. Quien la trabaja cobra la hora de más.
    //
    // El prompt la llama «la noche del 25-10-2026» y pide que cuente 11 h;
    // por el criterio de esta casa —el tramo pertenece al día en que
    // EMPIEZA, igual que en el registro de jornada— esa noche es la celda
    // del **24**. Las dos frases hablan del mismo turno.
    expect(minutosDeTurno("2026-10-24", N)).toBe(660);
    // Y la siguiente, ya en horario de invierno, vuelve a durar diez.
    expect(minutosDeTurno("2026-10-25", N)).toBe(600);
  });

  it("y la del cambio de marzo dura NUEVE", () => {
    // El 29-03-2026 el reloj salta de las 02:00 a las 03:00.
    expect(minutosDeTurno("2026-03-28", N)).toBe(540);
  });

  it("una celda de ausencia no produce intervalo", () => {
    const c = cuadrante({
      celdas: [celda("ana", "2026-11-02", null, "VACACIONES")],
    });
    expect(intervalosDe(c)).toHaveLength(0);
  });

  it("una celda que apunta a un turno que no está se ignora", () => {
    const c = cuadrante({ celdas: [celda("ana", "2026-11-02", "t-fantasma")] });
    expect(intervalosDe(c)).toHaveLength(0);
  });

  it("los intervalos salen ordenados por persona y por inicio", () => {
    const c = cuadrante({
      personas: [persona("bea"), persona("ana")],
      celdas: [
        celda("bea", "2026-11-03", "t-m"),
        celda("ana", "2026-11-04", "t-t"),
        celda("ana", "2026-11-02", "t-n"),
      ],
    });
    expect(intervalosDe(c).map((i) => `${i.employeeId}/${i.dia}`)).toEqual([
      "ana/2026-11-02",
      "ana/2026-11-04",
      "bea/2026-11-03",
    ]);
  });
});

// ── 1 · cobertura por turno ───────────────────────────────────────────

describe("regla COBERTURA", () => {
  const CON_MINIMO = [M, T, { ...N, coberturaMinima: 2 }];

  it("[prompt] un turno de noche sin la cobertura mínima salta", () => {
    const c = cuadrante({
      turnos: CON_MINIMO,
      personas: [persona("ana"), persona("bea")],
      // El día 2 va una sola; el 3 van las dos.
      celdas: [
        celda("ana", "2026-11-02", "t-n"),
        celda("ana", "2026-11-03", "t-n"),
        celda("bea", "2026-11-03", "t-n"),
      ],
    });
    const avisos = de(comprobarCuadrante(c, reglas()), "COBERTURA");
    const del2 = avisos.filter((a) => a.dia === "2026-11-02");
    const del3 = avisos.filter((a) => a.dia === "2026-11-03");
    expect(del2).toHaveLength(1);
    expect(del2[0]!.falta).toBe(1);
    expect(del2[0]!.gravedad).toBe("ROJO");
    expect(del2[0]!.mensaje).toContain("1 persona de atención directa y pide 2");
    expect(del3).toHaveLength(0);
  });

  it("el borde: con exactamente el mínimo NO salta", () => {
    const c = cuadrante({
      turnos: [{ ...N, coberturaMinima: 1 }],
      celdas: [celda("ana", "2026-11-02", "t-n")],
    });
    expect(
      de(comprobarCuadrante(c, reglas()), "COBERTURA").filter(
        (a) => a.dia === "2026-11-02",
      ),
    ).toHaveLength(0);
  });

  it("quien NO es atención directa no cubre", () => {
    // Tres administrativas no cubren el turno de noche de una residencia.
    const c = cuadrante({
      turnos: [{ ...N, coberturaMinima: 1 }],
      personas: [persona("ana", { atencionDirecta: false })],
      celdas: [celda("ana", "2026-11-02", "t-n")],
    });
    const del2 = de(comprobarCuadrante(c, reglas()), "COBERTURA").filter(
      (a) => a.dia === "2026-11-02",
    );
    expect(del2).toHaveLength(1);
    expect(del2[0]!.falta).toBe(1);
  });

  it("un turno partido de la misma persona no la cuenta dos veces", () => {
    const c = cuadrante({
      turnos: [{ ...M, coberturaMinima: 2 }, T],
      celdas: [celda("ana", "2026-11-02", "t-m"), celda("ana", "2026-11-02", "t-m")],
    });
    // (La base no deja dos filas iguales, pero la función no se apoya en
    // eso: lo cuenta con un `Set`.)
    const del2 = de(comprobarCuadrante(c, reglas()), "COBERTURA").filter(
      (a) => a.dia === "2026-11-02",
    );
    expect(del2[0]!.falta).toBe(1);
  });

  it("un turno SIN mínimo declarado no se evalúa, ningún día", () => {
    // `null` no es 0: es «no se sabe». Con 0 la regla diría «cumple» de
    // todos los turnos de todos los días, que es peor que no decir nada.
    const c = cuadrante({ turnos: TURNOS, celdas: [] });
    expect(de(comprobarCuadrante(c, reglas()), "COBERTURA")).toHaveLength(0);
  });

  it("y un mes vacío con mínimo declarado salta los treinta días", () => {
    const c = cuadrante({ turnos: [{ ...N, coberturaMinima: 2 }], celdas: [] });
    expect(de(comprobarCuadrante(c, reglas()), "COBERTURA")).toHaveLength(30);
  });
});

// ── 2 · la ratio de residencia ────────────────────────────────────────

describe("regla RATIO", () => {
  /** Nueve o diez personas con un turno de ocho horas clavadas ese día. */
  function conJornadasCompletas(cuantas: number): Cuadrante {
    const OCHO: TurnoDelCuadrante = {
      id: "t-8",
      code: "J",
      name: "Jornada",
      startsAt: "08:00",
      endsAt: "16:00",
      sortOrder: 1,
      coberturaMinima: null,
    };
    const gente = Array.from({ length: cuantas }, (_, i) => persona(`p${i}`));
    return {
      mes: "2026-11",
      turnos: [OCHO],
      personas: gente,
      celdas: gente.map((p) => celda(p.employeeId, "2026-11-02", "t-8")),
      ocupacionPorDia: { "2026-11-02": 48 },
    };
  }

  it("[prompt] 48 ocupadas y NUEVE jornadas completas: salta", () => {
    // 0,20 × 48 = 9,6 jornadas exigidas. Con nueve faltan 0,6.
    const avisos = de(
      comprobarCuadrante(
        conJornadasCompletas(9),
        reglas({ conRatioDeResidencia: true }),
      ),
      "RATIO",
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.falta).toBe(0.6);
    expect(avisos[0]!.gravedad).toBe("ROJO");
    expect(avisos[0]!.mensaje).toContain("9 jornadas completas");
    expect(avisos[0]!.mensaje).toContain("48 plazas ocupadas pide 9,6");
  });

  it("[prompt] y con DIEZ no salta", () => {
    expect(
      de(
        comprobarCuadrante(
          conJornadasCompletas(10),
          reglas({ conRatioDeResidencia: true }),
        ),
        "RATIO",
      ),
    ).toHaveLength(0);
  });

  it("en jornadas y no en personas: diez medias jornadas son cinco", () => {
    // Tres auxiliares de cuatro horas no son tres jornadas, y contarlas
    // como tres es cómo se cumple una ratio en un papel.
    const MEDIA: TurnoDelCuadrante = {
      id: "t-4",
      code: "H",
      name: "Media",
      startsAt: "08:00",
      endsAt: "12:00",
      sortOrder: 1,
      coberturaMinima: null,
    };
    const gente = Array.from({ length: 10 }, (_, i) => persona(`p${i}`));
    const c: Cuadrante = {
      mes: "2026-11",
      turnos: [MEDIA],
      personas: gente,
      celdas: gente.map((p) => celda(p.employeeId, "2026-11-02", "t-4")),
      ocupacionPorDia: { "2026-11-02": 48 },
    };
    const avisos = de(
      comprobarCuadrante(c, reglas({ conRatioDeResidencia: true })),
      "RATIO",
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.mensaje).toContain("5 jornadas completas");
    expect(avisos[0]!.falta).toBe(4.6);
  });

  it("sin el módulo de residencia NO se evalúa", () => {
    // Un colegio no tiene plazas y no tiene ratio; evaluarla le llenaría el
    // mes de rojos por una norma que no le aplica.
    expect(
      de(
        comprobarCuadrante(conJornadasCompletas(1), reglas({ conRatioDeResidencia: false })),
        "RATIO",
      ),
    ).toHaveLength(0);
  });

  it("un día sin ocupación conocida no se evalúa", () => {
    const c = { ...conJornadasCompletas(1), ocupacionPorDia: {} };
    expect(
      de(comprobarCuadrante(c, reglas({ conRatioDeResidencia: true })), "RATIO"),
    ).toHaveLength(0);
  });

  it("y la que sólo cuenta a la atención directa", () => {
    const c = conJornadasCompletas(10);
    const soloUna = {
      ...c,
      personas: c.personas.map((p, i) => ({ ...p, atencionDirecta: i === 0 })),
    };
    const avisos = de(
      comprobarCuadrante(soloUna, reglas({ conRatioDeResidencia: true })),
      "RATIO",
    );
    expect(avisos[0]!.mensaje).toContain("1 jornadas completas");
  });

  it("el día de una noche cuenta al día en que EMPIEZA", () => {
    // Mismo criterio que el registro de jornada: una noche del 2 cuenta al
    // 2, aunque ocho de sus horas sean del 3. Si no, planificado y fichado
    // no se podrían comparar.
    const c: Cuadrante = {
      mes: "2026-11",
      turnos: [N],
      personas: [persona("ana")],
      celdas: [celda("ana", "2026-11-02", "t-n")],
      ocupacionPorDia: { "2026-11-02": 5, "2026-11-03": 5 },
    };
    const avisos = de(
      comprobarCuadrante(c, reglas({ conRatioDeResidencia: true })),
      "RATIO",
    );
    // 0,2 × 5 = 1 jornada. El día 2 hay 600/480 = 1,25 → cumple. El 3, nada.
    expect(avisos.map((a) => a.dia)).toEqual(["2026-11-03"]);
  });
});

// ── 3 · descanso entre jornadas (art. 34.3 ET) ────────────────────────

describe("regla DESCANSO_DIARIO", () => {
  it("[prompt] noche 22–08 seguida de mañana 08–15: SALTA", () => {
    // Cero horas de descanso, y en un Excel no se ve: son dos casillas de
    // dos columnas distintas.
    const c = cuadrante({
      celdas: [celda("ana", "2026-11-02", "t-n"), celda("ana", "2026-11-03", "t-m")],
    });
    const avisos = de(comprobarCuadrante(c, reglas()), "DESCANSO_DIARIO");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.falta).toBe(12);
    expect(avisos[0]!.gravedad).toBe("ROJO");
    expect(avisos[0]!.mensaje).toContain("descansa 0 h entre el turno N del 2026-11-02");
    expect(avisos[0]!.mensaje).toContain("el M del 2026-11-03");
    // Y la celda que lo arregla es la SEGUNDA: la mañana.
    expect(avisos[0]!.celda).toEqual({ employeeId: "ana", dia: "2026-11-03" });
  });

  it("noche seguida de tarde del día siguiente: SALTA, y son siete horas", () => {
    // **Corrección al prompt** (ver la cabecera): el prompt dice que esto
    // no salta. Con el límite del art. 34.3 en doce horas no puede ser:
    // de las 08:00 a las 15:00 hay siete.
    const c = cuadrante({
      celdas: [celda("ana", "2026-11-02", "t-n"), celda("ana", "2026-11-03", "t-t")],
    });
    const avisos = de(comprobarCuadrante(c, reglas()), "DESCANSO_DIARIO");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.mensaje).toContain("descansa 7 h");
    expect(avisos[0]!.falta).toBe(5);
    // Y con el parámetro a siete horas —lo que un convenio podría
    // permitir— deja de saltar. Es la salida que el prompt pedía, y es un
    // dato del tenant, no una constante del código.
    expect(
      de(comprobarCuadrante(c, reglas({ horasDescansoDiario: 7 })), "DESCANSO_DIARIO"),
    ).toHaveLength(0);
  });

  it("tarde y noche del MISMO día: también salta, y son cero horas", () => {
    // La otra lectura posible de «noche seguida de tarde», comprobada para
    // que conste: tampoco puede no saltar.
    const c = cuadrante({
      celdas: [celda("ana", "2026-11-02", "t-t"), celda("ana", "2026-11-02", "t-n")],
    });
    const avisos = de(comprobarCuadrante(c, reglas()), "DESCANSO_DIARIO");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.mensaje).toContain("descansa 0 h");
  });

  it("noche y tarde con un día entero en medio: NO salta", () => {
    // Treinta y una horas. Es el par que el prompt buscaba.
    const c = cuadrante({
      celdas: [celda("ana", "2026-11-02", "t-n"), celda("ana", "2026-11-04", "t-t")],
    });
    expect(de(comprobarCuadrante(c, reglas()), "DESCANSO_DIARIO")).toHaveLength(0);
  });

  it("el borde: doce horas clavadas NO salta, y once sí", () => {
    // Una mañana que acaba a las 15:00 y una tarde de las 03:00 del día
    // siguiente serían doce clavadas. Se monta con un turno a medida.
    const DOCE: TurnoDelCuadrante = {
      id: "t-12",
      code: "D",
      name: "Doce",
      startsAt: "03:00",
      endsAt: "07:00",
      sortOrder: 9,
      coberturaMinima: null,
    };
    const ONCE: TurnoDelCuadrante = {
      id: "t-11",
      code: "U",
      name: "Once",
      startsAt: "02:00",
      endsAt: "07:00",
      sortOrder: 9,
      coberturaMinima: null,
    };
    const clavadas = cuadrante({
      turnos: [M, DOCE],
      celdas: [celda("ana", "2026-11-02", "t-m"), celda("ana", "2026-11-03", "t-12")],
    });
    expect(de(comprobarCuadrante(clavadas, reglas()), "DESCANSO_DIARIO")).toHaveLength(0);
    const una_menos = cuadrante({
      turnos: [M, ONCE],
      celdas: [celda("ana", "2026-11-02", "t-m"), celda("ana", "2026-11-03", "t-11")],
    });
    expect(de(comprobarCuadrante(una_menos, reglas()), "DESCANSO_DIARIO")).toHaveLength(1);
  });

  it("un SOLAPE no cuenta como poco descanso: tiene su propia regla", () => {
    const SOLAPADO: TurnoDelCuadrante = {
      id: "t-s",
      code: "S",
      name: "Solapado",
      startsAt: "12:00",
      endsAt: "20:00",
      sortOrder: 9,
      coberturaMinima: null,
    };
    const c = cuadrante({
      turnos: [M, SOLAPADO],
      celdas: [celda("ana", "2026-11-02", "t-m"), celda("ana", "2026-11-02", "t-s")],
    });
    const avisos = comprobarCuadrante(c, reglas());
    expect(de(avisos, "DESCANSO_DIARIO")).toHaveLength(0);
    expect(de(avisos, "DOS_SITIOS_A_LA_VEZ")).toHaveLength(1);
  });

  it("una ausencia en medio deja el hueco, y el hueco es el descanso", () => {
    const c = cuadrante({
      celdas: [
        celda("ana", "2026-11-02", "t-n"),
        celda("ana", "2026-11-03", null, "LIBRE"),
        celda("ana", "2026-11-04", "t-m"),
      ],
    });
    expect(de(comprobarCuadrante(c, reglas()), "DESCANSO_DIARIO")).toHaveLength(0);
  });
});

// ── 4 · nadie en dos sitios a la vez ──────────────────────────────────

describe("regla DOS_SITIOS_A_LA_VEZ", () => {
  it("dos turnos que se pisan saltan, y dice cuánto", () => {
    const SOLAPADO: TurnoDelCuadrante = {
      id: "t-s",
      code: "S",
      name: "Solapado",
      startsAt: "12:00",
      endsAt: "20:00",
      sortOrder: 9,
      coberturaMinima: null,
    };
    const c = cuadrante({
      turnos: [M, SOLAPADO],
      celdas: [celda("ana", "2026-11-02", "t-m"), celda("ana", "2026-11-02", "t-s")],
    });
    const avisos = de(comprobarCuadrante(c, reglas()), "DOS_SITIOS_A_LA_VEZ");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.exceso).toBe(3);
    expect(avisos[0]!.gravedad).toBe("ROJO");
  });

  it("TOCARSE no es pisarse: mañana y tarde del mismo día no saltan", () => {
    const c = cuadrante({
      celdas: [celda("ana", "2026-11-02", "t-m"), celda("ana", "2026-11-02", "t-t")],
    });
    expect(de(comprobarCuadrante(c, reglas()), "DOS_SITIOS_A_LA_VEZ")).toHaveLength(0);
  });

  it("y una noche que se pisa con la mañana del día siguiente", () => {
    const NOCHE_LARGA: TurnoDelCuadrante = {
      id: "t-nl",
      code: "NL",
      name: "Noche larga",
      startsAt: "22:00",
      endsAt: "10:00",
      sortOrder: 9,
      coberturaMinima: null,
    };
    const c = cuadrante({
      turnos: [M, NOCHE_LARGA],
      celdas: [celda("ana", "2026-11-02", "t-nl"), celda("ana", "2026-11-03", "t-m")],
    });
    const avisos = de(comprobarCuadrante(c, reglas()), "DOS_SITIOS_A_LA_VEZ");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.exceso).toBe(2);
  });
});

// ── 5 · descanso semanal (art. 37.1 ET) ───────────────────────────────

describe("regla DESCANSO_SEMANAL", () => {
  /** Turnos de mañana todos los días de un rango. */
  function todosLosDias(desde: number, hasta: number): CeldaDelCuadrante[] {
    const fuera: CeldaDelCuadrante[] = [];
    for (let d = desde; d <= hasta; d += 1) {
      fuera.push(celda("ana", `2026-11-${String(d).padStart(2, "0")}`, "t-m"));
    }
    return fuera;
  }

  it("[prompt] una semana sin día y medio libre salta", () => {
    // Mañanas los catorce primeros días: dentro del primer bloque el hueco
    // más largo son las 17 h de una tarde-noche (15:00 → 08:00).
    //
    // **Catorce y no siete**, y la razón es la mitad del cálculo: con
    // mañanas sólo del 1 al 7, el hueco que va del día 7 a las 15:00 al
    // final del mes son veintitrés días, empieza DENTRO del primer bloque
    // y por lo tanto esa persona sí tiene día y medio seguido libre en esa
    // semana. Lo tiene de verdad: no trabaja el resto del mes.
    const c = cuadrante({ celdas: todosLosDias(1, 14) });
    const avisos = de(comprobarCuadrante(c, reglas()), "DESCANSO_SEMANAL");
    const primero = avisos.filter((a) => a.dia === "2026-11-01");
    expect(primero).toHaveLength(1);
    expect(primero[0]!.gravedad).toBe("ROJO");
    expect(primero[0]!.mensaje).toContain("no tiene día y medio seguido libre");
    expect(primero[0]!.mensaje).toContain("entre el 2026-11-01 y el 2026-11-07");
    expect(primero[0]!.mensaje).toContain("descanso más largo es de 17 h");
    expect(primero[0]!.falta).toBe(19);
  });

  it("con un día libre en medio, NO salta", () => {
    // Trabaja 1-3 y 5-7: del 3 a las 15:00 al 5 a las 08:00 hay 41 h.
    const c = cuadrante({ celdas: [...todosLosDias(1, 3), ...todosLosDias(5, 7)] });
    expect(
      de(comprobarCuadrante(c, reglas()), "DESCANSO_SEMANAL").filter(
        (a) => a.dia === "2026-11-01",
      ),
    ).toHaveLength(0);
  });

  it("el borde: 36 h clavadas NO salta, y 35 sí", () => {
    // Del día 1 a las 15:00 (fin de la mañana) a las 03:00 del día 3 hay 36 h.
    const TRES: TurnoDelCuadrante = {
      id: "t-3",
      code: "X",
      name: "Tres",
      startsAt: "03:00",
      endsAt: "07:00",
      sortOrder: 9,
      coberturaMinima: null,
    };
    const CUATRO: TurnoDelCuadrante = {
      id: "t-4",
      code: "Y",
      name: "Cuatro",
      startsAt: "02:00",
      endsAt: "07:00",
      sortOrder: 9,
      coberturaMinima: null,
    };
    // Todo el bloque ocupado salvo ese hueco: mañanas los días 3-7 también.
    // Y mañanas hasta el día 14, por lo mismo que el test de arriba: si
    // dejara de trabajar el día 7, el hueco del resto del mes empezaría
    // dentro del bloque y le daría su descanso.
    const base = (turno: TurnoDelCuadrante, id: string) =>
      cuadrante({
        turnos: [M, turno],
        celdas: [
          celda("ana", "2026-11-01", "t-m"),
          celda("ana", "2026-11-03", id),
          ...todosLosDias(3, 14),
        ],
      });
    expect(
      de(comprobarCuadrante(base(TRES, "t-3"), reglas()), "DESCANSO_SEMANAL").filter(
        (a) => a.dia === "2026-11-01",
      ),
    ).toHaveLength(0);
    expect(
      de(comprobarCuadrante(base(CUATRO, "t-4"), reglas()), "DESCANSO_SEMANAL").filter(
        (a) => a.dia === "2026-11-01",
      ),
    ).toHaveLength(1);
  });

  it("un descanso que CRUZA el borde del bloque se cuenta entero", () => {
    // Trabaja todos los días salvo el 7 y el 8, que están a caballo de dos
    // bloques (1-7 y 8-14). Recortando el hueco al bloque, cada uno vería
    // menos de 36 h y los dos saldrían en rojo: eso sería decir que no
    // descansó la semana que sí descansó.
    const c = cuadrante({
      celdas: [...todosLosDias(1, 6), ...todosLosDias(9, 14)],
    });
    const avisos = de(comprobarCuadrante(c, reglas()), "DESCANSO_SEMANAL");
    expect(avisos.filter((a) => a.dia === "2026-11-01")).toHaveLength(0);
    expect(avisos.filter((a) => a.dia === "2026-11-08")).toHaveLength(0);
  });

  it("quien no trabaja ningún día del bloque no sale en rojo", () => {
    // Era el otro fallo posible del cálculo: contar sólo los huecos que
    // EMPIEZAN dentro dejaba a esta persona sin ningún hueco que ofrecer.
    const c = cuadrante({ celdas: todosLosDias(8, 14) });
    expect(
      de(comprobarCuadrante(c, reglas()), "DESCANSO_SEMANAL").filter(
        (a) => a.dia === "2026-11-01",
      ),
    ).toHaveLength(0);
  });

  it("el último bloque incompleto NO se mira", () => {
    // Noviembre tiene 30 días: los días 29 y 30 no forman un bloque de
    // siete. Un bloque de dos días no puede exigir 36 h de descanso, y su
    // descanso cae en diciembre.
    const c = cuadrante({ celdas: todosLosDias(1, 30) });
    const avisos = de(comprobarCuadrante(c, reglas()), "DESCANSO_SEMANAL");
    expect(avisos.map((a) => a.dia)).toEqual([
      "2026-11-01",
      "2026-11-08",
      "2026-11-15",
      "2026-11-22",
    ]);
  });

  it("con el cómputo a 14 días, los bloques son dos", () => {
    const c = cuadrante({ celdas: todosLosDias(1, 30) });
    const avisos = de(
      comprobarCuadrante(c, reglas({ diasComputoSemanal: 14 })),
      "DESCANSO_SEMANAL",
    );
    expect(avisos.map((a) => a.dia)).toEqual(["2026-11-01", "2026-11-15"]);
  });
});

// ── 6 · horas planificadas frente a jornada contratada ────────────────

describe("reglas HORAS_SEMANA y HORAS_MES", () => {
  const A_40 = persona("ana", { minutosContratados: 40 * 60 });

  it("[prompt] horas de MÁS sobre la jornada contratada, por semana", () => {
    // Seis mañanas de siete horas son 42 h contra 40 contratadas.
    const celdas: CeldaDelCuadrante[] = [];
    for (let d = 1; d <= 6; d += 1) {
      celdas.push(celda("ana", `2026-11-0${d}`, "t-m"));
    }
    const c = cuadrante({ personas: [A_40], celdas });
    const avisos = de(comprobarCuadrante(c, reglas()), "HORAS_SEMANA");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.exceso).toBe(2);
    expect(avisos[0]!.gravedad).toBe("AMBAR");
    expect(avisos[0]!.mensaje).toContain("42 h planificadas");
    expect(avisos[0]!.mensaje).toContain("40 h a la semana");
    expect(avisos[0]!.mensaje).toContain("2 h de más");
  });

  it("el borde: cuarenta clavadas NO salta", () => {
    const OCHO: TurnoDelCuadrante = {
      id: "t-8",
      code: "J",
      name: "Jornada",
      startsAt: "08:00",
      endsAt: "16:00",
      sortOrder: 1,
      coberturaMinima: null,
    };
    const celdas: CeldaDelCuadrante[] = [];
    for (let d = 1; d <= 5; d += 1) {
      celdas.push(celda("ana", `2026-11-0${d}`, "t-8"));
    }
    const c = cuadrante({ turnos: [OCHO], personas: [A_40], celdas });
    expect(de(comprobarCuadrante(c, reglas()), "HORAS_SEMANA")).toHaveLength(0);
  });

  it("una semana CORTA no salta: se compensa en el mes", () => {
    const c = cuadrante({
      personas: [A_40],
      celdas: [celda("ana", "2026-11-02", "t-m")],
    });
    expect(de(comprobarCuadrante(c, reglas()), "HORAS_SEMANA")).toHaveLength(0);
  });

  it("y el MES sí salta en las dos direcciones", () => {
    // 40 h × 30/7 = 171,4 h al mes. Con una sola mañana faltan 164,4.
    const corto = cuadrante({
      personas: [A_40],
      celdas: [celda("ana", "2026-11-02", "t-m")],
    });
    const avisos = de(comprobarCuadrante(corto, reglas()), "HORAS_MES");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.falta).toBeCloseTo(164.4, 1);
    expect(avisos[0]!.exceso).toBeUndefined();
    expect(avisos[0]!.dia).toBeNull();
    expect(avisos[0]!.mensaje).toContain("de menos");
  });

  it("con la tolerancia de una jornada completa el mes NO salta", () => {
    // 171,4 h al mes. Veinticuatro mañanas de siete son 168: faltan 3,4 h,
    // menos de una jornada completa (8 h). Sin la tolerancia, un mes no son
    // cuatro semanas exactas y esto saltaría SIEMPRE.
    const celdas: CeldaDelCuadrante[] = [];
    for (let d = 1; d <= 24; d += 1) {
      celdas.push(celda("ana", `2026-11-${String(d).padStart(2, "0")}`, "t-m"));
    }
    const c = cuadrante({ personas: [A_40], celdas });
    expect(de(comprobarCuadrante(c, reglas()), "HORAS_MES")).toHaveLength(0);
  });

  it("quien no tiene jornada contratada declarada NO se evalúa", () => {
    // No hay contra qué comparar, y eso lo canta `datosQueFaltanDePersonal`
    // como imprescindible que falta. Inventarle 40 h sería inventar el aviso.
    const celdas: CeldaDelCuadrante[] = [];
    for (let d = 1; d <= 7; d += 1) {
      celdas.push(celda("ana", `2026-11-0${d}`, "t-m"));
    }
    const c = cuadrante({ personas: [persona("ana")], celdas });
    const avisos = comprobarCuadrante(c, reglas());
    expect(de(avisos, "HORAS_SEMANA")).toHaveLength(0);
    expect(de(avisos, "HORAS_MES")).toHaveLength(0);
  });

  it("las ausencias no suman horas", () => {
    const celdas: CeldaDelCuadrante[] = [];
    for (let d = 1; d <= 7; d += 1) {
      celdas.push(celda("ana", `2026-11-0${d}`, null, "VACACIONES"));
    }
    const c = cuadrante({ personas: [A_40], celdas });
    expect(de(comprobarCuadrante(c, reglas()), "HORAS_SEMANA")).toHaveLength(0);
  });
});

// ── 7 · nadie de alta fuera de su contrato ────────────────────────────

describe("regla FUERA_DE_CONTRATO", () => {
  it("[prompt] una persona planificada antes de su alta salta", () => {
    const c = cuadrante({
      personas: [persona("ana", { altaEl: "2026-11-10" })],
      celdas: [celda("ana", "2026-11-09", "t-m")],
    });
    const avisos = de(comprobarCuadrante(c, reglas()), "FUERA_DE_CONTRATO");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.gravedad).toBe("ROJO");
    expect(avisos[0]!.mensaje).toContain("no entra hasta el 2026-11-10");
    expect(avisos[0]!.celda).toEqual({ employeeId: "ana", dia: "2026-11-09" });
  });

  it("el borde: el DÍA del alta no salta", () => {
    const c = cuadrante({
      personas: [persona("ana", { altaEl: "2026-11-10" })],
      celdas: [celda("ana", "2026-11-10", "t-m")],
    });
    expect(de(comprobarCuadrante(c, reglas()), "FUERA_DE_CONTRATO")).toHaveLength(0);
  });

  it("y después del fin del contrato: salta el día siguiente, no el mismo", () => {
    const c = cuadrante({
      personas: [persona("ana", { finEl: "2026-11-15" })],
      celdas: [celda("ana", "2026-11-15", "t-m"), celda("ana", "2026-11-16", "t-m")],
    });
    const avisos = de(comprobarCuadrante(c, reglas()), "FUERA_DE_CONTRATO");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.dia).toBe("2026-11-16");
    expect(avisos[0]!.mensaje).toContain("su contrato acaba el 2026-11-15");
  });

  it("una AUSENCIA fuera del contrato no salta", () => {
    // Un «libre» fuera del contrato es ruido: no compromete a nadie a nada,
    // y avisar de él llenaría de rojo el mes de quien entra el día 10.
    const c = cuadrante({
      personas: [persona("ana", { altaEl: "2026-11-10" })],
      celdas: [celda("ana", "2026-11-05", null, "LIBRE")],
    });
    expect(de(comprobarCuadrante(c, reglas()), "FUERA_DE_CONTRATO")).toHaveLength(0);
  });

  it("sin fechas declaradas no se evalúa", () => {
    const c = cuadrante({ celdas: [celda("ana", "2026-11-05", "t-m")] });
    expect(de(comprobarCuadrante(c, reglas()), "FUERA_DE_CONTRATO")).toHaveLength(0);
  });
});

// ── El orden y el resumen ─────────────────────────────────────────────

describe("el orden de los avisos y su resumen", () => {
  it("lo rojo primero, después por día, y el mes al final de su grupo", () => {
    const c = cuadrante({
      turnos: [{ ...N, coberturaMinima: 2 }, M],
      personas: [persona("ana", { minutosContratados: 60, altaEl: "2026-11-20" })],
      celdas: [
        celda("ana", "2026-11-05", "t-n"),
        celda("ana", "2026-11-06", "t-m"),
      ],
    });
    const avisos = comprobarCuadrante(c, reglas());
    // El primero es rojo y del día más temprano.
    expect(avisos[0]!.gravedad).toBe("ROJO");
    // Y lo último es ámbar; dentro del ámbar, el aviso sin día va al final.
    const ambar = avisos.filter((a) => a.gravedad === "AMBAR");
    expect(ambar.length).toBeGreaterThan(0);
    expect(ambar[ambar.length - 1]!.dia).toBeNull();
    // Y es determinista: dos pasadas, la misma lista.
    expect(comprobarCuadrante(c, reglas())).toEqual(avisos);
  });

  it("el resumen cuenta por gravedad y por regla", () => {
    const c = cuadrante({
      celdas: [celda("ana", "2026-11-02", "t-n"), celda("ana", "2026-11-03", "t-m")],
    });
    const r = resumenDeAvisos(comprobarCuadrante(c, reglas()));
    expect(r.total).toBe(1);
    expect(r.rojos).toBe(1);
    expect(r.ambares).toBe(0);
    expect(r.porRegla).toEqual({ DESCANSO_DIARIO: 1 });
  });

  it("un cuadrante limpio no devuelve nada", () => {
    // Cinco jornadas de ocho horas en cada una de las cuatro semanas
    // completas, más los días 29 y 30 —que no son de ningún bloque de
    // siete—. Son 176 h contra las 171,4 h que le corresponden al mes, y
    // 4,6 h de diferencia caben en la tolerancia de una jornada completa.
    //
    // Que haya que afinarlo así es el punto: un mes no son cuatro semanas
    // exactas, y por eso la regla del mes tiene tolerancia y la de la
    // semana no.
    const c = cuadrante({
      personas: [persona("ana", { minutosContratados: 40 * 60 })],
      celdas: (() => {
        const OCHO = "t-8";
        const fuera: CeldaDelCuadrante[] = [];
        for (const inicio of [1, 8, 15, 22]) {
          for (let i = 0; i < 5; i += 1) {
            fuera.push(
              celda("ana", `2026-11-${String(inicio + i).padStart(2, "0")}`, OCHO),
            );
          }
        }
        fuera.push(celda("ana", "2026-11-29", OCHO));
        fuera.push(celda("ana", "2026-11-30", OCHO));
        return fuera;
      })(),
      turnos: [
        {
          id: "t-8",
          code: "J",
          name: "Jornada",
          startsAt: "08:00",
          endsAt: "16:00",
          sortOrder: 1,
          coberturaMinima: null,
        },
      ],
    });
    expect(comprobarCuadrante(c, reglas())).toEqual([]);
  });
});

// ── La configuración de los turnos del centro ─────────────────────────

describe("comprobarTurnosDelTenant", () => {
  it("los tres de serie no dejan hueco ni se solapan", () => {
    const avisos = comprobarTurnosDelTenant([
      { ...M, coberturaMinima: 1 },
      { ...T, coberturaMinima: 1 },
      { ...N, coberturaMinima: 1 },
    ]);
    expect(avisos).toEqual([]);
  });

  it("dos turnos que se solapan lo dicen, y nombran los dos", () => {
    const avisos = comprobarTurnosDelTenant([
      { ...M, coberturaMinima: 1 },
      { ...T, startsAt: "14:00", coberturaMinima: 1 },
      { ...N, coberturaMinima: 1 },
    ]);
    const solape = avisos.find((a) => a.problema === "SOLAPE");
    expect(solape).toBeDefined();
    expect(solape!.codigos).toEqual(["M", "T"]);
    expect(solape!.mensaje).toContain("se solapan");
  });

  it("un hueco lo dice con los minutos", () => {
    const avisos = comprobarTurnosDelTenant([
      { ...M, coberturaMinima: 1 },
      { ...T, coberturaMinima: 1 },
    ]);
    const hueco = avisos.find((a) => a.problema === "HUECO");
    expect(hueco).toBeDefined();
    // De las 22:00 a las 08:00 son 600 minutos.
    expect(hueco!.mensaje).toContain("600 minutos");
  });

  it("y un turno sin cobertura declarada lo pide", () => {
    const avisos = comprobarTurnosDelTenant([
      { ...M, coberturaMinima: 1 },
      { ...T, coberturaMinima: null },
      { ...N, coberturaMinima: null },
    ]);
    const sin = avisos.find((a) => a.problema === "SIN_COBERTURA");
    expect(sin!.codigos).toEqual(["N", "T"]);
  });

  it("sin turnos no dice nada: eso lo impide la ruta", () => {
    expect(comprobarTurnosDelTenant([])).toEqual([]);
  });
});
