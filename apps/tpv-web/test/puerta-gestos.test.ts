// residencia-3 · DE UN TOQUE A UNAS FILAS, como tabla de verdad.
//
// Es la obligación que residencia-2 §11.5 dejó escrita: **el toque rápido
// tiene que ESCRIBIR el `CareRecord` de cada dimensión activa con su
// valor, no saltarse la fila**. Aquí se comprueba contando filas.
//
// Y la mitad menos obvia: «no como siempre» escribe `1 + (N−1)`. Las que
// nadie tocó se registran igual y con su valor de normalidad, porque la
// pantalla 4 promete «lo demás se guarda como siempre» — y una dimensión
// sin registrar no significa «estaba bien», significa «nadie la miró».

import { describe, expect, it } from "vitest";

import {
  ALGO_NO_VA_BIEN,
  algoNoVaBien,
  comoSiempre,
  dimensionesDeLaObservacion,
  noComoSiempre,
  observacionDelTurno,
  registroADemanda,
  registroDeConstante,
  registroDeOcurrencia,
  TIPOS_DE_ALGO_NO_VA_BIEN,
  yaHecho,
  type ContextoDelGesto,
} from "../src/residencia/puerta-gestos.js";
import type { ControlDeLaPuerta } from "../src/residencia/puerta-tipos.js";

const CTX: ContextoDelGesto = {
  clientId: "carmen",
  recordedAt: new Date("2026-10-15T08:20:00.000Z"),
  centerShiftId: "turno-manana",
  careDay: "2026-10-15",
};

function obs(code: string): ControlDeLaPuerta {
  return {
    id: `id-${code}`,
    code,
    name: code,
    version: 1,
    layer: "OBS",
    nature: "SCHEDULED",
    valueDomain: "ORDINAL",
    groupCode: null,
    opciones: [
      { code: "COMO_SIEMPRE", label: "Como siempre", isAsUsual: true },
      { code: "MAL", label: "Mal", isAsUsual: false },
      { code: "PEOR", label: "Peor", isAsUsual: false },
    ],
  };
}

/** Las siete de serie, más los dos controles que NO entran en el atajo. */
const CONTROLES: ControlDeLaPuerta[] = [
  obs("ANIMO"),
  obs("COGNICION"),
  obs("DOLOR"),
  obs("DESCANSO_NOCTURNO"),
  obs("PIEL"),
  obs("INGESTA_DIA"),
  obs("MOVILIDAD"),
  // `EXEC` + `ORDINAL`: una comida. «Todo» no es «como siempre».
  {
    ...obs("COMIDA"),
    layer: "EXEC",
    opciones: [
      { code: "TODO", label: "Todo", isAsUsual: false },
      { code: "MITAD", label: "La mitad", isAsUsual: false },
    ],
  },
  // `OBS` + `TEXT_SHORT` y SIN opciones: el botón transversal.
  {
    ...obs(ALGO_NO_VA_BIEN),
    valueDomain: "TEXT_SHORT",
    nature: "ON_DEMAND",
    opciones: [],
  },
];

const TODO_ACTIVO = () => true;

describe("qué dimensiones entran en el «como siempre»", () => {
  it("LAS SIETE `OBS` con su valor de normalidad, y ni una más", () => {
    const d = dimensionesDeLaObservacion(CONTROLES, TODO_ACTIVO);
    expect(d.map((x) => x.code)).toEqual([
      "ANIMO",
      "COGNICION",
      "DOLOR",
      "DESCANSO_NOCTURNO",
      "PIEL",
      "INGESTA_DIA",
      "MOVILIDAD",
    ]);
    expect(d.every((x) => x.comoSiempre === "COMO_SIEMPRE")).toBe(true);
  });

  it("LAS COMIDAS NO: «todo» no es «como siempre», es «hoy se lo comió todo»", () => {
    // Si entraran, la ingesta del centro saldría «todo» cada día y el
    // indicador de nutrición no valdría nada (residencia-2 §2).
    const d = dimensionesDeLaObservacion(CONTROLES, TODO_ACTIVO);
    expect(d.map((x) => x.code)).not.toContain("COMIDA");
  });

  it("Y «ALGO NO VA BIEN» TAMPOCO, porque no declara ninguna normalidad", () => {
    // «Como siempre» no puede significar «no me ha parecido que pase
    // nada»: entonces el día que SÍ pasa algo no se distinguiría de los
    // otros 84.
    const d = dimensionesDeLaObservacion(CONTROLES, TODO_ACTIVO);
    expect(d.map((x) => x.code)).not.toContain(ALGO_NO_VA_BIEN);
  });

  it("un control DESACTIVADO en el centro se queda fuera", () => {
    const d = dimensionesDeLaObservacion(
      CONTROLES,
      (code) => code !== "PIEL",
    );
    expect(d.map((x) => x.code)).not.toContain("PIEL");
    expect(d).toHaveLength(6);
  });
});

describe("«COMO SIEMPRE» · un toque, N filas CON VALOR", () => {
  const dimensiones = dimensionesDeLaObservacion(CONTROLES, TODO_ACTIVO);

  it("escribe UNA FILA POR DIMENSIÓN, no cero y no una", () => {
    // Es la obligación de residencia-2 §11.5: «como siempre» no es la
    // ausencia de registro, es un registro con valor. Sin estas filas no
    // hay denominador y no se distingue «hoy está normal» de «hoy nadie lo
    // miró».
    const filas = comoSiempre(CTX, dimensiones);
    expect(filas).toHaveLength(7);
    expect(filas.map((f) => f.controlCode).sort()).toEqual(
      dimensiones.map((d) => d.code).sort(),
    );
  });

  it("y cada una con SU valor de normalidad", () => {
    for (const f of comoSiempre(CTX, dimensiones)) {
      expect(f.valor).toEqual({ tipo: "ORDINAL", opcion: "COMO_SIEMPRE" });
    }
  });

  it("todas con el MISMO instante y el mismo turno: un toque es un instante", () => {
    const filas = comoSiempre(CTX, dimensiones);
    expect(new Set(filas.map((f) => f.recordedAt)).size).toBe(1);
    expect(new Set(filas.map((f) => f.centerShiftId)).size).toBe(1);
    expect(filas[0]!.careDay).toBe("2026-10-15");
  });

  it("y SIN ocurrencia: la observación se pregunta una vez por turno", () => {
    // De aquí sale que repetir el toque en el mismo turno corrija en vez de
    // duplicar — lo decide el servidor con el índice único.
    expect(comoSiempre(CTX, dimensiones).every((f) => f.occurrenceAt === null)).toBe(
      true,
    );
  });

  it("cada fila lleva SU uuid: es la idempotencia y es el AAD", () => {
    const filas = comoSiempre(CTX, dimensiones);
    expect(new Set(filas.map((f) => f.id)).size).toBe(7);
  });
});

describe("«NO COMO SIEMPRE» · 1 + (N−1)", () => {
  const dimensiones = dimensionesDeLaObservacion(CONTROLES, TODO_ACTIVO);

  it("con UNA cambiada escribe SIETE: la cambiada y las seis como siempre", () => {
    const filas = noComoSiempre(CTX, dimensiones, { ANIMO: "MAL" });
    expect(filas).toHaveLength(7);
    const animo = filas.find((f) => f.controlCode === "ANIMO")!;
    expect(animo.valor).toEqual({ tipo: "ORDINAL", opcion: "MAL" });
    const resto = filas.filter((f) => f.controlCode !== "ANIMO");
    expect(resto).toHaveLength(6);
    for (const f of resto) {
      expect(f.valor).toEqual({ tipo: "ORDINAL", opcion: "COMO_SIEMPRE" });
    }
  });

  it("con DOS cambiadas, dos con su valor y cinco como siempre", () => {
    const filas = noComoSiempre(CTX, dimensiones, {
      ANIMO: "MAL",
      PIEL: "PEOR",
    });
    const cambiadas = filas.filter(
      (f) => (f.valor as { opcion: string }).opcion !== "COMO_SIEMPRE",
    );
    expect(cambiadas.map((f) => f.controlCode).sort()).toEqual(["ANIMO", "PIEL"]);
    expect(filas).toHaveLength(7);
  });

  it("sin tocar nada escribe las siete como siempre: es el mismo gesto", () => {
    const filas = noComoSiempre(CTX, dimensiones, {});
    expect(filas).toHaveLength(7);
    expect(
      filas.every(
        (f) => (f.valor as { opcion: string }).opcion === "COMO_SIEMPRE",
      ),
    ).toBe(true);
  });

  it("UNA OPCIÓN QUE NO EXISTE no rompe el gesto: esa dimensión va como siempre", () => {
    // Lo que no se puede perder son las otras seis filas.
    const filas = noComoSiempre(CTX, dimensiones, { ANIMO: "EUFORICO" });
    expect(filas).toHaveLength(7);
    expect(filas.find((f) => f.controlCode === "ANIMO")!.valor).toEqual({
      tipo: "ORDINAL",
      opcion: "COMO_SIEMPRE",
    });
  });
});

describe("lo que TOCA y lo que está A DEMANDA", () => {
  it("«Hecho» lleva la ocurrencia de `queToca`", () => {
    const f = registroDeOcurrencia(CTX, {
      controlCode: "CAMBIO_POSTURAL",
      planItemId: "linea-1",
      occurrenceAt: "2026-10-15T08:00:00.000Z",
    });
    expect(f.valor).toEqual({ tipo: "BOOL", hecho: true });
    expect(f.occurrenceAt).toBe("2026-10-15T08:00:00.000Z");
    expect(f.planItemId).toBe("linea-1");
  });

  it("y las cuatro opciones de una comida son el mismo gesto con opción", () => {
    const f = registroDeOcurrencia(CTX, {
      controlCode: "COMIDA",
      planItemId: "linea-2",
      occurrenceAt: "2026-10-15T13:30:00.000Z",
      opcion: "MITAD",
    });
    expect(f.valor).toEqual({ tipo: "ORDINAL", opcion: "MITAD" });
  });

  it("lo `ON_DEMAND` no cuelga de nada: ni línea ni ocurrencia", () => {
    const f = registroADemanda(CTX, "DEPOSICION");
    expect(f.planItemId).toBeNull();
    expect(f.occurrenceAt).toBeNull();
    expect(f.valor).toEqual({ tipo: "BOOL", hecho: true });
  });
});

describe("«ALGO NO VA BIEN» · los dos campos son opcionales (D-13)", () => {
  it("a secas es un registro COMPLETO", () => {
    const f = algoNoVaBien(CTX);
    expect(f.controlCode).toBe(ALGO_NO_VA_BIEN);
    expect(f.valor).toEqual({ tipo: "NOTA" });
    expect(f.nota).toBeNull();
    expect(f.voz).toBeNull();
  });

  it("con texto, con voz, o con los dos", () => {
    expect(algoNoVaBien(CTX, { texto: "le huele raro el pie" }).nota).toBe(
      "le huele raro el pie",
    );
    expect(algoNoVaBien(CTX, { vozBase64: "GkXf" }).voz).toEqual({
      webmBase64: "GkXf",
    });
    const dos = algoNoVaBien(CTX, { texto: "x", vozBase64: "GkXf" });
    expect(dos.nota).toBe("x");
    expect(dos.voz).not.toBeNull();
  });

  it("un texto de SOLO ESPACIOS es no haber escrito nada", () => {
    // Si no, la nota llegaría con un espacio dentro, se cifraría y la DUE
    // vería una nota vacía que parece decir algo.
    expect(algoNoVaBien(CTX, { texto: "   " }).nota).toBeNull();
  });
});

describe("leer lo que YA ESTÁ", () => {
  const dimensiones = dimensionesDeLaObservacion(CONTROLES, TODO_ACTIVO);

  it("sin nada registrado no hay franja verde", () => {
    expect(observacionDelTurno([], dimensiones)).toBeNull();
  });

  it("con una dimensión BASTA: el gesto escribe las N de una vez", () => {
    // Buscar las siete sería pedir que las siete hayan llegado, y con la
    // cola a medias un gesto entero parecería no haber ocurrido.
    const ya = observacionDelTurno(
      [
        {
          controlCode: "ANIMO",
          vigente: true,
          firmadoPor: "Ana",
          recordedAt: "2026-10-15T08:20:00Z",
          valor: { tipo: "ORDINAL", opcion: "COMO_SIEMPRE" },
        },
      ],
      dimensiones,
    );
    expect(ya?.firmadoPor).toBe("Ana");
    expect(ya?.todoComoSiempre).toBe(true);
  });

  it("una desviada hace que la franja diga «NO como siempre»", () => {
    const ya = observacionDelTurno(
      [
        {
          controlCode: "ANIMO",
          vigente: true,
          firmadoPor: "Ana",
          recordedAt: "2026-10-15T08:20:00Z",
          valor: { tipo: "ORDINAL", opcion: "MAL" },
        },
      ],
      dimensiones,
    );
    expect(ya?.todoComoSiempre).toBe(false);
  });

  it("y la frase la dice el MÁS RECIENTE: si la DUE corrigió, manda ella", () => {
    const ya = observacionDelTurno(
      [
        {
          controlCode: "ANIMO",
          vigente: true,
          firmadoPor: "Ana",
          recordedAt: "2026-10-15T08:20:00Z",
          valor: { tipo: "ORDINAL", opcion: "COMO_SIEMPRE" },
        },
        {
          controlCode: "PIEL",
          vigente: true,
          firmadoPor: "Rosa (DUE)",
          recordedAt: "2026-10-15T11:00:00Z",
          valor: { tipo: "ORDINAL", opcion: "PEOR" },
        },
      ],
      dimensiones,
    );
    expect(ya?.firmadoPor).toBe("Rosa (DUE)");
    expect(ya?.todoComoSiempre).toBe(false);
  });

  it("lo NO VIGENTE no cuenta: una corregida o anulada no es la franja", () => {
    expect(
      observacionDelTurno(
        [
          {
            controlCode: "ANIMO",
            vigente: false,
            firmadoPor: "Ana",
            recordedAt: "2026-10-15T08:20:00Z",
            valor: { tipo: "ORDINAL", opcion: "COMO_SIEMPRE" },
          },
        ],
        dimensiones,
      ),
    ).toBeNull();
  });

  it("`yaHecho` cruza por (control, ocurrencia) y COMPARA INSTANTES", () => {
    // El `at` de `queToca` y el `occurrence_at` que vuelve de Postgres son
    // el mismo momento escrito distinto. Compararlos como texto habría
    // pintado como «no hecho» algo que sí está, y eso lleva a mover a
    // alguien que acaban de mover.
    const registros = [
      {
        id: "r1",
        controlCode: "CAMBIO_POSTURAL",
        vigente: true,
        occurrenceAt: "2026-10-15T08:00:00Z",
      },
    ];
    expect(
      yaHecho(registros, {
        controlCode: "CAMBIO_POSTURAL",
        at: "2026-10-15T08:00:00.000Z",
      })?.id,
    ).toBe("r1");
  });

  it("y la ronda SIGUIENTE del mismo control sale como «por hacer»", () => {
    const registros = [
      {
        id: "r1",
        controlCode: "CAMBIO_POSTURAL",
        vigente: true,
        occurrenceAt: "2026-10-15T08:00:00.000Z",
      },
    ];
    expect(
      yaHecho(registros, {
        controlCode: "CAMBIO_POSTURAL",
        at: "2026-10-15T11:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("una fila ANULADA devuelve el botón a su sitio", () => {
    const registros = [
      {
        id: "r1",
        controlCode: "CAMBIO_POSTURAL",
        vigente: false,
        occurrenceAt: "2026-10-15T08:00:00.000Z",
      },
    ];
    expect(
      yaHecho(registros, {
        controlCode: "CAMBIO_POSTURAL",
        at: "2026-10-15T08:00:00.000Z",
      }),
    ).toBeNull();
  });
});

// ══ residencia-4 · LOS GESTOS NUEVOS ══════════════════════════════
describe("residencia-4 · una CONSTANTE", () => {
  it("manda el número con PUNTO decimal, que es el del JSON", () => {
    const r = registroDeConstante(CTX, {
      controlCode: "TEMPERATURA",
      numero: 38.4,
    });
    expect(r.valor).toEqual({ tipo: "NUMERIC", numero: 38.4 });
    expect(r.controlCode).toBe("TEMPERATURA");
  });

  it("a demanda va SIN ocurrencia y sin línea de plan", () => {
    // Es el 90 % de las veces: la DUE la pide cuando ve a alguien raro,
    // y eso no está en ningún plan.
    const r = registroDeConstante(CTX, {
      controlCode: "TEMPERATURA",
      numero: 36.5,
    });
    expect(r.occurrenceAt).toBeNull();
    expect(r.planItemId).toBeNull();
  });

  it("y respondiendo a una línea del plan lleva su OCURRENCIA", () => {
    const r = registroDeConstante(CTX, {
      controlCode: "PESO",
      numero: 62.5,
      planItemId: "linea-1",
      occurrenceAt: "2026-10-15T08:00:00.000Z",
    });
    expect(r.planItemId).toBe("linea-1");
    expect(r.occurrenceAt).toBe("2026-10-15T08:00:00.000Z");
  });

  it("el aviso viaja DENTRO del registro, y sólo cuando se pulsa", () => {
    const sin = registroDeConstante(CTX, { controlCode: "TEMPERATURA", numero: 36.5 });
    expect(sin.avisarEnfermera).toBeUndefined();
    const con = registroDeConstante(CTX, {
      controlCode: "TEMPERATURA",
      numero: 36.5,
      avisarEnfermera: true,
    });
    expect(con.avisarEnfermera).toBe(true);
  });

  it("y un toque es UN instante: la hora es la del gesto, no la del envío", () => {
    const r = registroDeConstante(CTX, { controlCode: "TEMPERATURA", numero: 38 });
    expect(r.recordedAt).toBe(CTX.recordedAt.toISOString());
    expect(r.careDay).toBe(CTX.careDay);
    expect(r.centerShiftId).toBe(CTX.centerShiftId);
  });
});

describe("residencia-4 · «algo no va bien» con TIPO", () => {
  it("sin tipo no mete ni `evento` ni `matiz`: a secas sigue siendo completo", () => {
    const r = algoNoVaBien(CTX, { texto: "le huele raro el pie" });
    expect(r.valor).toEqual({ tipo: "NOTA" });
  });

  it("con tipo y matiz, los dos van DENTRO del valor (que va cifrado)", () => {
    // Y no en una columna en claro: que doña Carmen se haya caído es
    // salud. Lo que queda en claro es el `incident_type` de la
    // incidencia, y eso está declarado en la migración.
    const r = algoNoVaBien(CTX, { evento: "CAIDA", matiz: "CON_GOLPE" });
    expect(r.valor).toEqual({
      tipo: "NOTA",
      evento: "CAIDA",
      matiz: "CON_GOLPE",
    });
  });

  it("los CINCO tipos son los que la plantilla gradúa, y ni uno más", () => {
    // Una lista larga es un formulario, y un formulario es lo que hace
    // que la auxiliar no registre (regla 1 de la capa, D-13).
    expect(TIPOS_DE_ALGO_NO_VA_BIEN.map((t) => t.evento)).toEqual([
      "CAIDA",
      "VOMITO",
      "NO_LOCALIZADO",
      "EMERGENCIA_VITAL",
      "AVERIA",
    ]);
  });

  it("y sólo DOS preguntan algo, con UNA pregunta de dos botones", () => {
    const conPregunta = TIPOS_DE_ALGO_NO_VA_BIEN.filter((t) => t.pregunta);
    expect(conPregunta.map((t) => t.evento)).toEqual(["CAIDA", "AVERIA"]);
    for (const t of conPregunta) {
      expect(t.pregunta!.opciones).toHaveLength(2);
    }
  });
});
