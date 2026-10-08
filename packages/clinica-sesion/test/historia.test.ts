// clinica-6 · las funciones puras de la historia viva.
//
// Lo que se prueba aquí es lo que el prompt pide que no se pueda romper
// sin que algo se ponga rojo:
//
//   1. el **estado de una zona** (activa / mejorando / curada), y sobre
//      todo **«no explorada ≠ curada»**;
//   2. **«hoy toca»**: sin pendientes, con varios, y que el grande es el
//      MÁS ANTIGUO;
//   3. la **recomendada** de «Nueva visita», en su orden de urgencia;
//   4. una **sesión v1 legible sin tipo**, sin fingirle ninguno;
//   5. y el **«ojo hoy»**, que sale de la tabla de alertas cruzadas y no
//      de una escala de gravedad inventada.

import { describe, expect, it } from "vitest";

import {
  estadoDeLasZonas,
  exploroElPie,
  hoyToca,
  ojoDeHoy,
  tendenciaDelDolor,
  tipoRecomendado,
  ultimaVisita,
  visitaDeLaHistoria,
  visitaLegible,
  TIPOS_QUE_MIRAN_EL_PIE,
  TIPO_SUGERIDO_POR_PENDIENTE,
  type Marcas,
  type PendienteCreado,
  type TipoDeVisita,
  type VisitaDeLaHistoria,
} from "../src/index.js";

// ── Utilidades del fichero ───────────────────────────────────────────

let n = 0;

function visita(input: {
  fecha: string;
  marcas?: Record<string, { lesion: string; gravedad: string | null }>;
  tipos?: TipoDeVisita[];
  v?: number;
}): VisitaDeLaHistoria {
  return {
    entryId: `e${++n}`,
    fecha: input.fecha,
    v: input.v ?? 2,
    tipos: input.tipos ?? ["QUIROPODIA"],
    marcas: (input.marcas ?? {}) as Marcas,
    mapaVersion: 1,
    lesionesVersion: 1,
  };
}

const DUREZA_MODERADA = { lesion: "dureza", gravedad: "MODERADA" };
const DUREZA_LEVE = { lesion: "dureza", gravedad: "LEVE" };
const DUREZA_SEVERA = { lesion: "dureza", gravedad: "SEVERA" };

// ── 1 · El estado de una zona ────────────────────────────────────────

describe("estadoDeLasZonas", () => {
  it("una zona marcada una sola vez está ACTIVA", () => {
    const zonas = estadoDeLasZonas([
      visita({ fecha: "2026-09-07T10:00:00Z", marcas: { "L:talon": DUREZA_MODERADA } }),
    ]);
    expect(zonas).toHaveLength(1);
    expect(zonas[0]!.estado).toBe("ACTIVA");
    expect(zonas[0]!.nombre).toBe("Pie izq. · Talón");
    expect(zonas[0]!.lesionNombre).toBe("Dureza");
  });

  it("si la gravedad BAJA respecto a la anterior, está MEJORANDO", () => {
    const zonas = estadoDeLasZonas([
      visita({ fecha: "2026-09-07T10:00:00Z", marcas: { "L:talon": DUREZA_MODERADA } }),
      visita({ fecha: "2026-09-21T10:00:00Z", marcas: { "L:talon": DUREZA_LEVE } }),
    ]);
    expect(zonas[0]!.estado).toBe("MEJORANDO");
    expect(zonas[0]!.pasos).toHaveLength(2);
  });

  it("si la gravedad SUBE o se repite, sigue ACTIVA", () => {
    const igual = estadoDeLasZonas([
      visita({ fecha: "2026-09-07T10:00:00Z", marcas: { "L:talon": DUREZA_LEVE } }),
      visita({ fecha: "2026-09-21T10:00:00Z", marcas: { "L:talon": DUREZA_LEVE } }),
    ]);
    expect(igual[0]!.estado).toBe("ACTIVA");
    const peor = estadoDeLasZonas([
      visita({ fecha: "2026-09-07T10:00:00Z", marcas: { "L:talon": DUREZA_LEVE } }),
      visita({ fecha: "2026-09-21T10:00:00Z", marcas: { "L:talon": DUREZA_SEVERA } }),
    ]);
    expect(peor[0]!.estado).toBe("ACTIVA");
  });

  it("se compara con LA ANTERIOR, no con la primera de todas", () => {
    // Leve → severa → moderada. Respecto a la ANTERIOR (severa) ha
    // bajado, así que mejora; respecto a la PRIMERA (leve) ha subido.
    // Lo que la podóloga necesita saber es si va mejor que la última vez
    // que la vio, no que el primer día.
    //
    // Este caso lo pidió un sabotaje que salió verde: con dos pasos, «la
    // anterior» y «la primera» son la misma, así que ningún test de los
    // de arriba podía cazar el cambio.
    const zonas = estadoDeLasZonas([
      visita({ fecha: "2026-09-07T10:00:00Z", marcas: { "L:talon": DUREZA_LEVE } }),
      visita({ fecha: "2026-09-21T10:00:00Z", marcas: { "L:talon": DUREZA_SEVERA } }),
      visita({ fecha: "2026-10-06T10:00:00Z", marcas: { "L:talon": DUREZA_MODERADA } }),
    ]);
    expect(zonas[0]!.estado).toBe("MEJORANDO");
  });

  it("una gravedad que falta NO cuenta como bajada", () => {
    const zonas = estadoDeLasZonas([
      visita({ fecha: "2026-09-07T10:00:00Z", marcas: { "L:talon": DUREZA_SEVERA } }),
      visita({
        fecha: "2026-09-21T10:00:00Z",
        marcas: { "L:talon": { lesion: "dureza", gravedad: null } },
      }),
    ]);
    expect(zonas[0]!.estado).toBe("ACTIVA");
  });

  it("si una visita POSTERIOR que mira el pie ya no la marca, está CURADA", () => {
    const zonas = estadoDeLasZonas([
      visita({ fecha: "2026-09-07T10:00:00Z", marcas: { "L:talon": DUREZA_MODERADA } }),
      // Una quiropodia en la que ya no quedaba nada que marcar.
      visita({ fecha: "2026-10-06T10:00:00Z", tipos: ["QUIROPODIA"] }),
    ]);
    expect(zonas[0]!.estado).toBe("CURADA");
    expect(zonas[0]!.curadaEn?.fecha).toBe("2026-10-06T10:00:00Z");
  });

  it("NO EXPLORADA ≠ CURADA · una visita que no mira el pie deja el estado como estaba", () => {
    const zonas = estadoDeLasZonas([
      visita({ fecha: "2026-09-07T10:00:00Z", marcas: { "L:talon": DUREZA_MODERADA } }),
      // Biomecánica sin una sola marca: no miró el pie, no cura nada.
      visita({ fecha: "2026-10-06T10:00:00Z", tipos: ["BIOMECANICA"] }),
    ]);
    expect(zonas[0]!.estado).toBe("ACTIVA");
    expect(zonas[0]!.curadaEn).toBeNull();
  });

  it("…y tampoco la cura una consulta GENERAL vacía", () => {
    const zonas = estadoDeLasZonas([
      visita({ fecha: "2026-09-07T10:00:00Z", marcas: { "L:talon": DUREZA_LEVE } }),
      visita({ fecha: "2026-10-06T10:00:00Z", tipos: ["GENERAL"] }),
    ]);
    expect(zonas[0]!.estado).toBe("ACTIVA");
  });

  it("una zona curada y vuelta a marcar vuelve a estar ACTIVA", () => {
    const zonas = estadoDeLasZonas([
      visita({ fecha: "2026-09-07T10:00:00Z", marcas: { "L:talon": DUREZA_LEVE } }),
      visita({ fecha: "2026-09-21T10:00:00Z", tipos: ["QUIROPODIA"] }),
      visita({ fecha: "2026-10-06T10:00:00Z", marcas: { "L:talon": DUREZA_MODERADA } }),
    ]);
    expect(zonas[0]!.estado).toBe("ACTIVA");
    expect(zonas[0]!.pasos).toHaveLength(2);
  });

  it("cada zona va por su cuenta: curar el talón no cura el dedo gordo", () => {
    const zonas = estadoDeLasZonas([
      visita({
        fecha: "2026-09-07T10:00:00Z",
        marcas: { "L:talon": DUREZA_LEVE, "L:h": { lesion: "unero", gravedad: "MODERADA" } },
      }),
      visita({ fecha: "2026-10-06T10:00:00Z", marcas: { "L:h": { lesion: "unero", gravedad: "MODERADA" } } }),
    ]);
    const talon = zonas.find((z) => z.clave === "L:talon")!;
    const gordo = zonas.find((z) => z.clave === "L:h")!;
    expect(talon.estado).toBe("CURADA");
    expect(gordo.estado).toBe("ACTIVA");
  });

  it("el orden de entrada no cambia nada: se ordena por fecha", () => {
    const alReves = estadoDeLasZonas([
      visita({ fecha: "2026-09-21T10:00:00Z", marcas: { "L:talon": DUREZA_LEVE } }),
      visita({ fecha: "2026-09-07T10:00:00Z", marcas: { "L:talon": DUREZA_SEVERA } }),
    ]);
    expect(alReves[0]!.estado).toBe("MEJORANDO");
    expect(alReves[0]!.pasos.map((p) => p.gravedad)).toEqual([
      "SEVERA",
      "LEVE",
    ]);
  });

  it("las zonas salen en el orden del mapa, no en el de las marcas", () => {
    const zonas = estadoDeLasZonas([
      visita({
        fecha: "2026-09-07T10:00:00Z",
        marcas: {
          "R:talon": DUREZA_LEVE,
          "L:talon": DUREZA_LEVE,
          "L:h": DUREZA_LEVE,
        },
      }),
    ]);
    expect(zonas.map((z) => z.clave)).toEqual(["L:h", "L:talon", "R:talon"]);
  });

  it("una historia sin marcas no inventa zonas", () => {
    expect(estadoDeLasZonas([visita({ fecha: "2026-09-07T10:00:00Z" })])).toEqual(
      [],
    );
    expect(estadoDeLasZonas([])).toEqual([]);
  });
});

describe("exploroElPie", () => {
  it("una visita con marcas siempre miró el pie", () => {
    expect(
      exploroElPie(
        visita({
          fecha: "2026-09-07T10:00:00Z",
          tipos: ["BIOMECANICA"],
          marcas: { "L:h": DUREZA_LEVE },
        }),
      ),
    ).toBe(true);
  });

  it("una v1 siempre miró el pie: la sesión de clinica-3 ERA el mapa", () => {
    expect(
      exploroElPie(visita({ fecha: "2026-09-07T10:00:00Z", v: 1, tipos: [] })),
    ).toBe(true);
  });

  it("los tres tipos de la lista miran el pie, y los otros dos no", () => {
    for (const tipo of TIPOS_QUE_MIRAN_EL_PIE) {
      expect(
        exploroElPie(visita({ fecha: "2026-09-07T10:00:00Z", tipos: [tipo] })),
      ).toBe(true);
    }
    for (const tipo of ["BIOMECANICA", "GENERAL"] as TipoDeVisita[]) {
      expect(
        exploroElPie(visita({ fecha: "2026-09-07T10:00:00Z", tipos: [tipo] })),
      ).toBe(false);
    }
  });
});

// ── 2 · «Hoy toca» ───────────────────────────────────────────────────

function pendiente(id: string, desde: string, zona: string | null = null): PendienteCreado {
  return { id, zona, nota: null, desde };
}

describe("hoyToca", () => {
  it("sin pendientes, no hay nada que hacer hoy", () => {
    expect(hoyToca([])).toBeNull();
  });

  it("con uno, sale él y su tipo de visita", () => {
    const h = hoyToca([pendiente("revisar_una", "2026-10-06T10:00:00Z", "L:h")])!;
    expect(h.principal.titulo).toBe("Revisar la uña operada");
    expect(h.principal.zona).toBe("Pie izq. · Dedo gordo");
    expect(h.otros).toBe(0);
    expect(h.tipo).toBe("CIRUGIA");
  });

  it("con varios, EL MÁS ANTIGUO es el grande y el resto se cuentan", () => {
    const h = hoyToca([
      pendiente("control_riesgo", "2026-10-06T10:00:00Z"),
      pendiente("revisar_una", "2026-09-07T10:00:00Z", "L:h"),
      pendiente("revisar_plantillas", "2026-09-21T10:00:00Z"),
    ])!;
    expect(h.principal.titulo).toBe("Revisar la uña operada");
    expect(h.otros).toBe(2);
  });

  it("«Otro» no propone tipo: una nota no dice de qué clase es la visita", () => {
    const h = hoyToca([pendiente("otro", "2026-10-06T10:00:00Z")])!;
    expect(h.tipo).toBeNull();
    expect(TIPO_SUGERIDO_POR_PENDIENTE["otro"]).toBeUndefined();
  });
});

// ── 3 · La recomendada de «Nueva visita» ─────────────────────────────

describe("tipoRecomendado", () => {
  it("manda el pendiente, aunque sea diabética", () => {
    expect(
      tipoRecomendado({
        pendientes: [pendiente("revisar_una", "2026-09-07T10:00:00Z", "L:h")],
        alertaIds: ["diab"],
        ultimosTipos: ["QUIROPODIA"],
      }),
    ).toEqual({ tipo: "CIRUGIA", motivo: "Lo que toca hoy" });
  });

  it("sin pendiente, pie de riesgo si tiene diabetes", () => {
    expect(
      tipoRecomendado({
        pendientes: [],
        alertaIds: ["antic", "diab"],
        ultimosTipos: ["QUIROPODIA"],
      })?.tipo,
    ).toBe("PIE_RIESGO");
  });

  it("sin pendiente y sin diabetes, el de la última visita", () => {
    expect(
      tipoRecomendado({
        pendientes: [],
        alertaIds: ["antic"],
        ultimosTipos: ["BIOMECANICA"],
      }),
    ).toEqual({ tipo: "BIOMECANICA", motivo: "Como la última visita" });
  });

  it("un paciente sin nada no recomienda nada", () => {
    expect(
      tipoRecomendado({ pendientes: [], alertaIds: [], ultimosTipos: [] }),
    ).toBeNull();
  });

  it("un pendiente SIN tipo no tapa a la diabetes", () => {
    expect(
      tipoRecomendado({
        pendientes: [pendiente("otro", "2026-09-07T10:00:00Z")],
        alertaIds: ["diab"],
        ultimosTipos: [],
      })?.tipo,
    ).toBe("PIE_RIESGO");
  });
});

// ── 4 · Una visita, en palabras ──────────────────────────────────────

describe("visitaLegible", () => {
  const META = { entryId: "e", fecha: "2026-10-06T10:00:00Z" };

  it("UNA SESIÓN v1 se lee como «Sesión», sin tipo y sin fingirlo", () => {
    const v = visitaLegible(
      {
        v: 1,
        mapaVersion: 1,
        lesionesVersion: 1,
        consejosVersion: 1,
        marcas: {},
        tratamientos: ["s1"],
        tratamientosNombre: { s1: "Deslaminado" },
        dolor: 7,
        evolucion: "MEJOR",
        consejos: [],
        proximaCita: null,
        nota: null,
        firma: { autorNombre: "Lucía", colegiado: null, firmadaEn: "x" },
      },
      META,
    );
    expect(v.titulo).toBe("Sesión");
    expect(v.tipos).toEqual([]);
    expect(v.nivel).toBeNull();
    expect(v.chips).toEqual(["Deslaminado"]);
    expect(v.dolor).toBe(7);
    expect(v.evolucionNombre).toBe("Mejor");
  });

  it("una quiropodia v2 lleva su nivel en el título y sus actos en los chips", () => {
    const v = visitaLegible(
      {
        v: 2,
        tipos: ["QUIROPODIA"],
        bloques: {
          QUIROPODIA: {
            actos: ["corte", "durezas"],
            nivelPropuesto: 1,
            nivelElegido: 2,
            productoDelNivel: null,
            servicios: [],
          },
        },
        dolor: 4,
        tratamientosNombre: {},
      } as never,
      META,
    );
    expect(v.titulo).toBe("Quiropodia completa");
    expect(v.nivel).toBe(2);
    expect(v.chips.length).toBeGreaterThan(0);
  });

  it("dos tipos salen los dos, y el chip NO repite el nombre del tipo", () => {
    const v = visitaLegible(
      {
        v: 2,
        tipos: ["QUIROPODIA", "CIRUGIA"],
        bloques: {
          QUIROPODIA: {
            actos: [],
            nivelPropuesto: 1,
            nivelElegido: 1,
            productoDelNivel: null,
            servicios: [],
          },
          CIRUGIA: { herida: "BIEN", puntos: "RETIRADOS", servicios: [] },
        },
        dolor: 3,
        // Un servicio del catálogo que se llama EXACTAMENTE como uno de
        // los tipos marcados («Quiropodia»), que es como se llama de
        // verdad en el catálogo de una podóloga. Y otro que no.
        tratamientosNombre: { s1: "Quiropodia", s2: "Matricectomía parcial" },
      } as never,
      META,
    );
    expect(v.titulo).toBe("Quiropodia básica + Cirugía · revisión");
    expect(v.chips).toContain("Evoluciona bien");
    expect(v.chips).toContain("Matricectomía parcial");
    // «Quiropodia» ya está en la columna del tipo: no se repite de chip.
    expect(v.chips).not.toContain("Quiropodia");
    expect(v.chips).not.toContain("Cirugía · revisión");
  });

  it("un cuerpo roto no revienta la historia", () => {
    const v = visitaLegible(null, META);
    expect(v.titulo).toBe("Sesión");
    expect(v.chips).toEqual([]);
    expect(v.dolor).toBeNull();
  });

  it("ultimaVisita es la más reciente por fecha, no la primera de la lista", () => {
    const a = visitaLegible(null, { entryId: "a", fecha: "2026-09-07T10:00:00Z" });
    const b = visitaLegible(null, { entryId: "b", fecha: "2026-10-06T10:00:00Z" });
    expect(ultimaVisita([a, b])?.entryId).toBe("b");
    expect(ultimaVisita([b, a])?.entryId).toBe("b");
    expect(ultimaVisita([])).toBeNull();
  });
});

describe("visitaDeLaHistoria", () => {
  it("de un cuerpo v1 saca v=1 y ningún tipo", () => {
    const v = visitaDeLaHistoria({ v: 1, marcas: { "L:h": DUREZA_LEVE } } as never, {
      entryId: "e",
      fecha: "2026-09-07T10:00:00Z",
    });
    expect(v.v).toBe(1);
    expect(v.tipos).toEqual([]);
    expect(Object.keys(v.marcas)).toEqual(["L:h"]);
  });

  it("un cuerpo nulo da una visita vacía y no una excepción", () => {
    const v = visitaDeLaHistoria(null, { entryId: "e", fecha: "x" });
    expect(v.marcas).toEqual({});
    expect(v.v).toBe(1);
  });
});

// ── 5 · «Ojo hoy» ────────────────────────────────────────────────────

describe("ojoDeHoy", () => {
  it("sin alertas no hay nada que vigilar", () => {
    expect(ojoDeHoy([])).toBeNull();
  });

  it("gana la que CRUZA con lo que se hace, en el orden de la tabla", () => {
    const o = ojoDeHoy([
      { preguntaId: "sens", texto: "Sensibilidad reducida" },
      { preguntaId: "antic", texto: "Anticoagulación" },
    ])!;
    expect(o.alertaId).toBe("antic");
    expect(o.titulo).toBe("Anticoagulación");
    expect(o.linea).toContain("sangrado");
  });

  it("una alerta sin regla cruzada se enseña SIN inventarle consecuencia", () => {
    const o = ojoDeHoy([{ preguntaId: "marca", texto: "Marcapasos" }])!;
    expect(o.alertaId).toBe("marca");
    expect(o.linea).toBeNull();
  });
});

// ── La tendencia del dolor ───────────────────────────────────────────

describe("tendenciaDelDolor", () => {
  it("sin puntos no dice nada", () => {
    const t = tendenciaDelDolor([]);
    expect(t.ultimo).toBeNull();
    expect(t.texto).toBeNull();
  });

  it("con uno, es la primera medida y no una tendencia", () => {
    expect(tendenciaDelDolor([{ fecha: "a", dolor: 7 }]).texto).toBe(
      "Primera medida",
    );
  });

  it("«mejora en cada visita» pide TRES y que baje siempre", () => {
    expect(
      tendenciaDelDolor([
        { fecha: "a", dolor: 7 },
        { fecha: "b", dolor: 5 },
        { fecha: "c", dolor: 3 },
      ]).texto,
    ).toBe("Mejora en cada visita");
    // Con dos puntos hay comparación, no tendencia.
    expect(
      tendenciaDelDolor([
        { fecha: "a", dolor: 7 },
        { fecha: "b", dolor: 3 },
      ]).texto,
    ).toBe("Mejor que la última vez");
  });

  it("un repunte rompe la racha", () => {
    expect(
      tendenciaDelDolor([
        { fecha: "a", dolor: 7 },
        { fecha: "b", dolor: 3 },
        { fecha: "c", dolor: 5 },
      ]).texto,
    ).toBe("Peor que la última vez");
  });

  it("igual es igual", () => {
    expect(
      tendenciaDelDolor([
        { fecha: "a", dolor: 4 },
        { fecha: "b", dolor: 4 },
      ]).texto,
    ).toBe("Igual que la última vez");
  });
});
