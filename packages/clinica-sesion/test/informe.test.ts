// clinica-4 · el informe, armado.
//
// Lo que este fichero guarda:
//
//   1. **Cada tipo lleva LO SUYO**, y la tabla es la que manda.
//   2. **NI UN IMPORTE**, recorriendo el documento entero buscando claves
//      de dinero con valor numérico — el mismo recorrido que clinica-3 y
//      clinica-6, aquí sobre el informe.
//   3. **Las 5 últimas visitas**, y la completa todas.
//   4. **No recalcula**: lo que llega ya decidido sale tal cual, y la
//      sección de alertas no se calla cuando no hay ninguna.
//   5. La derivación sin motivo deja la sección vacía (la ruta la rechaza).

import { describe, expect, it } from "vitest";

import {
  construirInforme,
  SECCIONES_POR_TIPO,
  SESIONES_DEL_INFORME,
  TIPOS_DE_INFORME,
  VISITAS_POR_TIPO,
  type FuentesDelInforme,
  type TipoDeInforme,
} from "../src/informe.js";
import type { VisitaLegible, ZonaViva } from "../src/historia.js";

const dia = (iso: string) => iso.slice(0, 10);

function visita(n: number, dolor: number | null = 5): VisitaLegible {
  return {
    entryId: `v${n}`,
    fecha: `2026-09-${String(n).padStart(2, "0")}T10:00:00.000Z`,
    tipos: ["QUIROPODIA"],
    tiposNombre: ["Quiropodia"],
    titulo: "Quiropodia completa",
    nivel: 2,
    nivelNombre: "Completa",
    dolor,
    evolucion: "MEJOR",
    evolucionNombre: "Mejor",
    chips: ["Corte y fresado"],
  };
}

const ZONA: ZonaViva = {
  clave: "L:h",
  pie: "L",
  zonaId: "h",
  nombre: "Pie izq. · Dedo gordo",
  estado: "MEJORANDO",
  lesion: "onicocriptosis",
  lesionNombre: "Uña encarnada",
  gravedad: "MODERADA",
  gravedadNombre: "Moderada",
  pasos: [],
  curadaEn: null,
};

function fuentes(extra: Partial<FuentesDelInforme> = {}): FuentesDelInforme {
  return {
    alertas: ["Diabetes", "Anticoagulación"],
    alertasPorValidar: false,
    valoracion: [{ pregunta: "¿Tiene azúcar?", respuesta: "Sí" }],
    exploracion: {
      fecha: "2026-09-07T10:00:00.000Z",
      autor: "Lucía Martín",
      pulsos: { L: "PRESENTE", R: "DEBIL" },
      tipoDePie: "NORMAL",
      sinSensibilidad: ["L:h"],
      puntosTotales: 22,
    },
    zonas: [ZONA],
    visitas: [visita(21), visita(14), visita(7)],
    recomendaciones: ["Calzado ancho", "Hidratar cada día"],
    consentimientos: [
      { titulo: "Consentimiento para anestesia local", fecha: "2026-09-07T10:00:00.000Z" },
    ],
    motivoDeDerivacion: null,
    dia,
    ...extra,
  };
}

/** Recorre el documento buscando claves de dinero CON VALOR NUMÉRICO. */
function clavesDeDinero(valor: unknown, ruta = "$"): string[] {
  const SOSPECHOSAS =
    /(precio|price|importe|total|amount|coste|cost|iva|tax|eur|euro|cents?)/i;
  if (Array.isArray(valor)) {
    return valor.flatMap((v, i) => clavesDeDinero(v, `${ruta}[${i}]`));
  }
  if (valor && typeof valor === "object") {
    return Object.entries(valor as Record<string, unknown>).flatMap(
      ([k, v]) => {
        const aqui =
          SOSPECHOSAS.test(k) && typeof v === "number" ? [`${ruta}.${k}`] : [];
        return [...aqui, ...clavesDeDinero(v, `${ruta}.${k}`)];
      },
    );
  }
  return [];
}

describe("clinica-4 · qué lleva cada informe", () => {
  it("los cuatro tipos y sus secciones son la TABLA", () => {
    for (const t of TIPOS_DE_INFORME) {
      const inf = construirInforme(t, fuentes());
      expect(
        inf.secciones.map((s) => s.id),
        t,
      ).toEqual([...SECCIONES_POR_TIPO[t]]);
    }
  });

  it("el resumen no lleva la valoración entera ni los consentimientos", () => {
    // Es para el paciente, no es una copia de la historia: lo que lleva es
    // lo que le sirve. La copia entera es la COMPLETA.
    const ids = construirInforme("RESUMEN", fuentes()).secciones.map(
      (s) => s.id,
    );
    expect(ids).not.toContain("VALORACION");
    expect(ids).not.toContain("CONSENTIMIENTOS");
  });

  it("la COMPLETA lleva las ocho, incluidos los consentimientos", () => {
    const ids = construirInforme("COMPLETA", fuentes()).secciones.map(
      (s) => s.id,
    );
    expect(ids).toContain("VALORACION");
    expect(ids).toContain("EXPLORACION");
    expect(ids).toContain("CONSENTIMIENTOS");
  });

  it("sólo la DERIVACIÓN lleva el motivo", () => {
    for (const t of TIPOS_DE_INFORME) {
      const tiene = SECCIONES_POR_TIPO[t].includes("MOTIVO");
      expect(tiene, t).toBe(t === "DERIVACION");
    }
  });
});

describe("clinica-4 · cuántas visitas entran", () => {
  it("las 5 últimas en tres de los cuatro", () => {
    const muchas = Array.from({ length: 9 }, (_, i) => visita(i + 1));
    for (const t of ["RESUMEN", "SESIONES", "DERIVACION"] as TipoDeInforme[]) {
      const inf = construirInforme(t, fuentes({ visitas: muchas }));
      const sesiones = inf.secciones.find((s) => s.id === "SESIONES")!;
      expect(sesiones.filas.length, t).toBe(SESIONES_DEL_INFORME);
    }
  });

  it("y TODAS en la historia completa (derecho de acceso)", () => {
    const muchas = Array.from({ length: 9 }, (_, i) => visita(i + 1));
    const inf = construirInforme("COMPLETA", fuentes({ visitas: muchas }));
    const sesiones = inf.secciones.find((s) => s.id === "SESIONES")!;
    expect(sesiones.filas.length).toBe(9);
    expect(VISITAS_POR_TIPO.COMPLETA).toBeNull();
  });

  it("sin visitas, lo dice en vez de dejar la sección en blanco", () => {
    const inf = construirInforme("SESIONES", fuentes({ visitas: [] }));
    const sesiones = inf.secciones.find((s) => s.id === "SESIONES")!;
    expect(sesiones.filas).toEqual([]);
    expect(sesiones.parrafos.join(" ")).toContain("Todavía no tiene");
  });
});

describe("clinica-4 · NI UN IMPORTE en el informe", () => {
  it("ninguno de los cuatro tipos lleva una clave de dinero", () => {
    for (const t of TIPOS_DE_INFORME) {
      const inf = construirInforme(t, fuentes());
      expect(clavesDeDinero(inf), t).toEqual([]);
    }
  });

  it("y tampoco si las fuentes traen precios colados", () => {
    // Las visitas vienen de `visitaLegible`, que no lleva precio desde
    // clinica-5. Esto es la segunda capa: aunque alguien ensanchara la
    // visita con un `precio`, el informe no lo copia porque no hay dónde.
    const sucias = [
      { ...visita(7), precio: 30, total: 35 } as unknown as VisitaLegible,
    ];
    const inf = construirInforme("RESUMEN", fuentes({ visitas: sucias }));
    expect(clavesDeDinero(inf)).toEqual([]);
    expect(JSON.stringify(inf)).not.toContain("30");
  });
});

describe("clinica-4 · lo que ya está decidido sale tal cual", () => {
  it("las zonas se escriben con su estado, sin recalcularlo", () => {
    const inf = construirInforme("RESUMEN", fuentes());
    const enc = inf.secciones.find((s) => s.id === "ENCONTRADO")!;
    expect(enc.parrafos[0]).toBe(
      "Pie izq. · Dedo gordo: Uña encarnada (moderada) · mejorando",
    );
  });

  it("una zona CURADA se escribe curada", () => {
    const inf = construirInforme(
      "RESUMEN",
      fuentes({ zonas: [{ ...ZONA, estado: "CURADA" }] }),
    );
    const enc = inf.secciones.find((s) => s.id === "ENCONTRADO")!;
    expect(enc.parrafos[0]).toContain("curada");
  });

  it("la tendencia del dolor es la del paquete, no una propia", () => {
    const inf = construirInforme(
      "SESIONES",
      fuentes({
        visitas: [visita(21, 3), visita(14, 5), visita(7, 7)],
      }),
    );
    const dolor = inf.secciones.find((s) => s.id === "DOLOR")!;
    // Tres visitas bajando: «Mejora en cada visita» (y los puntos, de la
    // más antigua a la más reciente, como se lee una gráfica).
    expect(dolor.parrafos).toEqual(["Mejora en cada visita"]);
    expect(dolor.grafica.map((p) => p.dolor)).toEqual([7, 5, 3]);
  });

  it("SIN alertas la sección NO se calla", () => {
    // Un informe clínico sin el apartado de alertas se lee como «no me
    // acordé de mirarlo», y quien lo recibe es quien va a pinchar.
    const inf = construirInforme("RESUMEN", fuentes({ alertas: [] }));
    const al = inf.secciones.find((s) => s.id === "ALERTAS")!;
    expect(al.parrafos).toEqual(["Ninguna recogida en la valoración."]);
  });

  it("y si la valoración no está validada, el papel lo dice", () => {
    const inf = construirInforme(
      "RESUMEN",
      fuentes({ alertasPorValidar: true }),
    );
    const al = inf.secciones.find((s) => s.id === "ALERTAS")!;
    expect(al.parrafos.join(" ")).toContain("todavía no está validada");
  });

  it("sin exploración, la completa lo dice", () => {
    const inf = construirInforme("COMPLETA", fuentes({ exploracion: null }));
    const ex = inf.secciones.find((s) => s.id === "EXPLORACION")!;
    expect(ex.parrafos).toEqual(["Sin exploración registrada."]);
  });
});

describe("clinica-4 · la derivación", () => {
  it("lleva el motivo que escribe el sanitario", () => {
    const inf = construirInforme(
      "DERIVACION",
      fuentes({ motivoDeDerivacion: "  Úlcera que no cierra en 6 semanas. " }),
    );
    const m = inf.secciones.find((s) => s.id === "MOTIVO")!;
    expect(m.parrafos).toEqual(["Úlcera que no cierra en 6 semanas."]);
  });

  it("sin motivo deja la sección vacía (la ruta la rechaza antes)", () => {
    const inf = construirInforme(
      "DERIVACION",
      fuentes({ motivoDeDerivacion: "   " }),
    );
    expect(inf.secciones.find((s) => s.id === "MOTIVO")!.parrafos).toEqual([]);
  });

  it("y es el único que lleva aviso de pie", () => {
    for (const t of TIPOS_DE_INFORME) {
      const inf = construirInforme(t, fuentes());
      expect(inf.piePropio != null, t).toBe(t === "DERIVACION");
    }
    const inf = construirInforme("DERIVACION", fuentes());
    expect(inf.piePropio).toContain("datos de salud");
  });
});
