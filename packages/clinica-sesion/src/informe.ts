// clinica-4 · EL INFORME, armado una sola vez.
//
// Cuatro informes (resumen de la historia, últimas sesiones, derivación e
// historia completa) y **un solo sitio donde se decide qué lleva cada
// uno**. De aquí sale el papel que se ve en pantalla, el PDF que se
// imprime y el PDF que se adjunta al email: los tres son el MISMO
// documento, y por eso no hay tres sitios donde pueda salir distinto.
//
// ── Puro, y sin un hueco donde quepa un importe ───────────────────────
//
// Regla 16 del prompt: **sin importes en ningún sitio.** Y no se consigue
// con un `if`: se consigue con el TIPO. `SeccionDeInforme` sólo sabe de
// títulos, párrafos, filas de texto y puntos de dolor; no hay campo
// `precio`, ni `total`, ni `importe`. Lo que no cabe en el tipo no se
// puede filtrar mal — la lección que clinica-3 dejó escrita con
// `CobroPendiente`.
//
// ── Y no recalcula ninguna regla clínica ──────────────────────────────
//
// Decisión 18: el informe **usa** lo que ya deciden `estadoDeLasZonas`,
// `visitaLegible` y `tendenciaDelDolor`. Aquí no se vuelve a decidir si
// una zona está curada ni si el dolor mejora: eso ya está contestado, y
// contestarlo otra vez sería tener dos verdades sobre el mismo pie —
// justo lo que clinica-5 y clinica-6 existen para no tener.
//
// ── Las secciones de cada tipo son DATO ───────────────────────────────
//
// `SECCIONES_POR_TIPO` es una tabla, no una cadena de `if`s, por la misma
// razón que la regla de niveles de clinica-5: lo que Rosario va a querer
// mover es justo qué lleva cada informe, y con una tabla se mueve
// editando una línea mientras el test lo comprueba desde fuera.

import { NOMBRE_DE_PULSO, NOMBRE_DE_TIPO_DE_PIE } from "./exploracion.js";
import {
  tendenciaDelDolor,
  type PuntoDeDolor,
  type VisitaLegible,
  type ZonaViva,
} from "./historia.js";

export const TIPOS_DE_INFORME = [
  "RESUMEN",
  "SESIONES",
  "DERIVACION",
  "COMPLETA",
] as const;

export type TipoDeInforme = (typeof TIPOS_DE_INFORME)[number];

export const NOMBRE_DE_TIPO_DE_INFORME: Record<TipoDeInforme, string> = {
  RESUMEN: "Resumen de la historia",
  SESIONES: "Últimas sesiones",
  DERIVACION: "Informe de derivación",
  COMPLETA: "Historia clínica completa",
};

export const DESCRIPCION_DE_TIPO_DE_INFORME: Record<TipoDeInforme, string> = {
  RESUMEN:
    "Alertas, lo encontrado, lo hecho y cómo va. Para entregar al paciente.",
  SESIONES: "Las 5 últimas visitas, con la gráfica del dolor.",
  DERIVACION:
    "Para otro profesional: motivo de la derivación, lo encontrado y lo hecho.",
  COMPLETA:
    "Todo lo que hay en la historia. Para cuando el paciente ejerce su derecho de acceso.",
};

/** Cuántas visitas lleva el informe de sesiones (decisión 15). */
export const SESIONES_DEL_INFORME = 5;

/** Las secciones que existen. Cada tipo elige las suyas, en este orden. */
export const SECCIONES = [
  "MOTIVO",
  "ALERTAS",
  "VALORACION",
  "EXPLORACION",
  "ENCONTRADO",
  "SESIONES",
  "DOLOR",
  "RECOMENDACIONES",
  "CONSENTIMIENTOS",
] as const;

export type SeccionId = (typeof SECCIONES)[number];

/**
 * QUÉ LLEVA CADA INFORME. La tabla, pendiente de validar con Rosario.
 *
 * `MOTIVO` sólo lo lleva la derivación porque es el único que tiene un
 * texto que escribe el sanitario; `CONSENTIMIENTOS` sólo la completa,
 * porque el consentimiento informado es contenido mínimo de la historia
 * (Ley 41/2002 art. 15.2) y lo que la completa contesta es una petición de
 * acceso a la historia entera.
 */
export const SECCIONES_POR_TIPO: Record<TipoDeInforme, readonly SeccionId[]> = {
  RESUMEN: ["ALERTAS", "ENCONTRADO", "SESIONES", "DOLOR", "RECOMENDACIONES"],
  SESIONES: ["ALERTAS", "SESIONES", "DOLOR"],
  DERIVACION: ["MOTIVO", "ALERTAS", "ENCONTRADO", "SESIONES"],
  COMPLETA: [
    "ALERTAS",
    "VALORACION",
    "EXPLORACION",
    "ENCONTRADO",
    "SESIONES",
    "DOLOR",
    "RECOMENDACIONES",
    "CONSENTIMIENTOS",
  ],
};

/** Cuántas visitas entran, por tipo. `null` = todas las que haya. */
export const VISITAS_POR_TIPO: Record<TipoDeInforme, number | null> = {
  RESUMEN: SESIONES_DEL_INFORME,
  SESIONES: SESIONES_DEL_INFORME,
  DERIVACION: SESIONES_DEL_INFORME,
  COMPLETA: null,
};

export interface SeccionDeInforme {
  id: SeccionId;
  titulo: string;
  /** Párrafos de texto. Vacío si la sección es sólo tabla o gráfica. */
  parrafos: readonly string[];
  /** Filas de tabla, ya en palabras. Sin una sola columna de dinero. */
  filas: readonly (readonly string[])[];
  /** Los puntos de la gráfica del dolor. Vacío salvo en `DOLOR`. */
  grafica: readonly PuntoDeDolor[];
}

export interface InformeClinico {
  tipo: TipoDeInforme;
  titulo: string;
  /** Lo que el informe dice de sí mismo bajo el título. */
  subtitulo: string;
  secciones: readonly SeccionDeInforme[];
  /**
   * El aviso del pie, cuando el informe lo necesita.
   *
   * La derivación lleva uno: un informe que viaja a otro profesional tiene
   * que decir que lleva datos de salud y de quién es la historia.
   */
  piePropio: string | null;
}

/** Lo que hace falta para armarlo. Todo ya decidido en otro sitio. */
export interface FuentesDelInforme {
  /** Las alertas de la valoración (clinica-2), en palabras. */
  alertas: readonly string[];
  /** `true` mientras la valoración no esté validada: el informe lo dice. */
  alertasPorValidar: boolean;
  /** Las respuestas de la valoración, ya legibles: pregunta y respuesta. */
  valoracion: readonly { pregunta: string; respuesta: string }[];
  /** La última exploración (clinica-3), o `null`. */
  exploracion: {
    fecha: string;
    autor: string;
    pulsos: { L: string; R: string };
    tipoDePie: string;
    sinSensibilidad: readonly string[];
    puntosTotales: number;
  } | null;
  /** El estado de cada zona, YA calculado por `estadoDeLasZonas`. */
  zonas: readonly ZonaViva[];
  /** Las visitas, YA legibles, de la más reciente a la más antigua. */
  visitas: readonly VisitaLegible[];
  /** Los consejos para casa de la última visita que dejó alguno. */
  recomendaciones: readonly string[];
  /** Los consentimientos firmados y vigentes, en palabras. */
  consentimientos: readonly { titulo: string; fecha: string }[];
  /** El texto que escribe el sanitario al elegir «Derivación». */
  motivoDeDerivacion: string | null;
  /** Cómo se escribe una fecha. Lo pone quien llama: el formateo con
   *  zona horaria no es de un paquete puro. */
  dia: (iso: string) => string;
}

function seccionVacia(id: SeccionId, titulo: string): SeccionDeInforme {
  return { id, titulo, parrafos: [], filas: [], grafica: [] };
}

/** «Pie izq. · Dedo gordo: uña encarnada (moderada) · activa». */
function lineaDeZona(z: ZonaViva): string {
  const gravedad = z.gravedadNombre ? ` (${z.gravedadNombre.toLowerCase()})` : "";
  const estado =
    z.estado === "CURADA"
      ? "curada"
      : z.estado === "MEJORANDO"
        ? "mejorando"
        : "activa";
  return `${z.nombre}: ${z.lesionNombre}${gravedad} · ${estado}`;
}

function construirSeccion(
  id: SeccionId,
  f: FuentesDelInforme,
  visitas: readonly VisitaLegible[],
): SeccionDeInforme {
  switch (id) {
    case "MOTIVO": {
      const s = seccionVacia(id, "Motivo de la derivación");
      return {
        ...s,
        parrafos: f.motivoDeDerivacion?.trim()
          ? [f.motivoDeDerivacion.trim()]
          : [],
      };
    }
    case "ALERTAS": {
      const s = seccionVacia(id, "Alertas");
      // Sin alertas se dice que no hay, y no se calla la sección: un
      // informe clínico sin el apartado de alertas se lee como «no me
      // acordé de mirarlo», y quien lo recibe es quien va a pinchar.
      if (f.alertas.length === 0) {
        return { ...s, parrafos: ["Ninguna recogida en la valoración."] };
      }
      const parrafos = [f.alertas.join(" · ")];
      if (f.alertasPorValidar) {
        parrafos.push(
          "La valoración todavía no está validada por el sanitario: estas alertas son lo que contestó el paciente.",
        );
      }
      return { ...s, parrafos };
    }
    case "VALORACION": {
      const s = seccionVacia(id, "Valoración inicial");
      if (f.valoracion.length === 0) {
        return { ...s, parrafos: ["Sin valoración inicial en la historia."] };
      }
      return { ...s, filas: f.valoracion.map((v) => [v.pregunta, v.respuesta]) };
    }
    case "EXPLORACION": {
      const s = seccionVacia(id, "Exploración del pie");
      const e = f.exploracion;
      if (!e) return { ...s, parrafos: ["Sin exploración registrada."] };
      const sienten = e.puntosTotales - e.sinSensibilidad.length;
      return {
        ...s,
        parrafos: [
          `Hecha el ${f.dia(e.fecha)} por ${e.autor}.`,
          `Tipo de pie: ${NOMBRE_DE_TIPO_DE_PIE[e.tipoDePie as keyof typeof NOMBRE_DE_TIPO_DE_PIE] ?? e.tipoDePie}.`,
          `Pulsos pedios: pie izquierdo ${(NOMBRE_DE_PULSO[e.pulsos.L as keyof typeof NOMBRE_DE_PULSO] ?? e.pulsos.L).toLowerCase()}, pie derecho ${(NOMBRE_DE_PULSO[e.pulsos.R as keyof typeof NOMBRE_DE_PULSO] ?? e.pulsos.R).toLowerCase()}.`,
          `Monofilamento: siente en ${sienten} de ${e.puntosTotales} puntos.`,
        ],
      };
    }
    case "ENCONTRADO": {
      const s = seccionVacia(id, "Lo encontrado");
      if (f.zonas.length === 0) {
        return { ...s, parrafos: ["Nunca se le ha marcado nada en el pie."] };
      }
      return { ...s, parrafos: f.zonas.map(lineaDeZona) };
    }
    case "SESIONES": {
      const s = seccionVacia(id, "Visitas");
      if (visitas.length === 0) {
        return { ...s, parrafos: ["Todavía no tiene ninguna visita cerrada."] };
      }
      return {
        ...s,
        filas: visitas.map((v) => [
          f.dia(v.fecha),
          v.titulo,
          v.chips.join(", "),
          v.dolor == null ? "—" : `Dolor ${v.dolor}`,
        ]),
      };
    }
    case "DOLOR": {
      const s = seccionVacia(id, "Dolor");
      // Los puntos van de la más antigua a la más reciente, que es como
      // se lee una gráfica. `visitas` llega al revés.
      const puntos = [...visitas]
        .reverse()
        .filter((v) => v.dolor != null)
        .map((v) => ({ fecha: v.fecha, dolor: v.dolor as number }));
      const t = tendenciaDelDolor(puntos);
      return {
        ...s,
        parrafos: t.texto ? [t.texto] : ["Sin medidas de dolor todavía."],
        grafica: puntos,
      };
    }
    case "RECOMENDACIONES": {
      const s = seccionVacia(id, "Recomendaciones");
      if (f.recomendaciones.length === 0) {
        return { ...s, parrafos: ["Sin consejos apuntados en la última visita."] };
      }
      return { ...s, parrafos: f.recomendaciones };
    }
    case "CONSENTIMIENTOS": {
      const s = seccionVacia(id, "Consentimientos firmados");
      if (f.consentimientos.length === 0) {
        return { ...s, parrafos: ["Ninguno firmado en el sistema."] };
      }
      return {
        ...s,
        filas: f.consentimientos.map((c) => [f.dia(c.fecha), c.titulo]),
      };
    }
  }
}

/**
 * EL INFORME, armado.
 *
 * El tipo decide qué secciones lleva y cuántas visitas entran; el resto es
 * traducir a palabras lo que ya está decidido.
 */
export function construirInforme(
  tipo: TipoDeInforme,
  fuentes: FuentesDelInforme,
): InformeClinico {
  const tope = VISITAS_POR_TIPO[tipo];
  const visitas =
    tope == null ? fuentes.visitas : fuentes.visitas.slice(0, tope);
  return {
    tipo,
    titulo: NOMBRE_DE_TIPO_DE_INFORME[tipo],
    subtitulo:
      tipo === "COMPLETA"
        ? "Copia de la historia clínica, entregada a petición del paciente (art. 18 Ley 41/2002)."
        : tipo === "SESIONES"
          ? `Las ${Math.min(visitas.length, SESIONES_DEL_INFORME)} últimas visitas.`
          : tipo === "DERIVACION"
            ? "Informe para otro profesional sanitario."
            : "Resumen de la historia clínica.",
    secciones: SECCIONES_POR_TIPO[tipo].map((id) =>
      construirSeccion(id, fuentes, visitas),
    ),
    piePropio:
      tipo === "DERIVACION"
        ? "Este informe contiene datos de salud. Se entrega al profesional que continúa la atención, a petición del paciente."
        : null,
  };
}
