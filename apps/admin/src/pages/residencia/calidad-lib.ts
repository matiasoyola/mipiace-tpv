// calidad-1 · **LOS TIPOS Y LAS PALABRAS DE LAS PANTALLAS DE CALIDAD.**
//
// Lo mismo que `relevo-lib.ts` hace con el relevo y las obligaciones: la
// forma de lo que contesta la API y cómo se dice cada enum en castellano,
// en un sitio.
//
// ── LO QUE NO ESTÁ AQUÍ ─────────────────────────────────────────────
//
// El CICLO. Qué transición es legal y qué le falta a una NC para dar el
// siguiente paso vive en `@mipiacetpv/residencia-plan` y lo ejecutan la
// pantalla y el servidor con **la misma función**. Copiar aquí una
// cadena de `if` sería la forma de conseguir que el botón esté encendido
// y la ruta conteste 409.

export type TipoDeProceso = "STRATEGIC" | "OPERATIONAL" | "SUPPORT";

export const NOMBRE_DEL_TIPO: Record<TipoDeProceso, string> = {
  STRATEGIC: "Estratégicos",
  OPERATIONAL: "Operativos",
  SUPPORT: "De soporte",
};

/** El orden de las tres filas de un mapa de procesos. */
export const FILAS_DEL_MAPA: TipoDeProceso[] = [
  "STRATEGIC",
  "OPERATIONAL",
  "SUPPORT",
];

export type BandaDeRiesgo = "BAJO" | "MEDIO" | "ALTO";

export const NOMBRE_DE_LA_BANDA: Record<BandaDeRiesgo, string> = {
  BAJO: "bajo",
  MEDIO: "medio",
  ALTO: "alto",
};

/** El color de una banda. Verde–ámbar–rojo, como el resto del admin. */
export function colorDeLaBanda(b: string): string {
  if (b === "ALTO") return "bg-red-100 text-red-800";
  if (b === "MEDIO") return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-800";
}

export type ClaseDeNc = "MAJOR" | "MINOR" | "OBSERVATION" | "IMPROVEMENT";

export const NOMBRE_DE_LA_CLASE_NC: Record<ClaseDeNc, string> = {
  MAJOR: "NC mayor",
  MINOR: "NC menor",
  OBSERVATION: "Observación",
  IMPROVEMENT: "Oportunidad de mejora",
};

/** Una NC mayor no se pinta igual que una oportunidad de mejora: lo que
 *  tiene que saltar a la vista en la lista es la gravedad. */
export function colorDeLaClase(c: string): string {
  if (c === "MAJOR") return "bg-red-100 text-red-800";
  if (c === "MINOR") return "bg-amber-100 text-amber-800";
  if (c === "OBSERVATION") return "bg-sky-100 text-sky-800";
  return "bg-slate-100 text-slate-700";
}

export type OrigenDeNc =
  | "INTERNAL_AUDIT"
  | "EXTERNAL_AUDIT"
  | "INSPECTION"
  | "INCIDENT"
  | "COMPLAINT"
  | "INDICATOR"
  | "MANAGEMENT_REVIEW"
  | "OTHER";

export const NOMBRE_DEL_ORIGEN: Record<OrigenDeNc, string> = {
  INTERNAL_AUDIT: "Auditoría interna",
  EXTERNAL_AUDIT: "Auditoría externa",
  INSPECTION: "Inspección",
  INCIDENT: "Incidencia del libro",
  COMPLAINT: "Queja",
  INDICATOR: "Indicador fuera de umbral",
  MANAGEMENT_REVIEW: "Revisión por la dirección",
  OTHER: "Otro",
};

export type EstadoDeNc =
  | "OPEN"
  | "CAUSE_ANALYSED"
  | "ACTIONS"
  | "ACTIONS_CLOSED"
  | "CLOSED";

export const NOMBRE_DEL_ESTADO: Record<EstadoDeNc, string> = {
  OPEN: "Abierta",
  CAUSE_ANALYSED: "Causa analizada",
  ACTIONS: "Con acciones en curso",
  ACTIONS_CLOSED: "Pendiente de verificar",
  CLOSED: "Cerrada",
};

/** Los cinco pasos, en orden, para pintar el ciclo como una barra. */
export const PASOS_DEL_CICLO: EstadoDeNc[] = [
  "OPEN",
  "CAUSE_ANALYSED",
  "ACTIONS",
  "ACTIONS_CLOSED",
  "CLOSED",
];

// ── Lo que contesta la API ───────────────────────────────────────────

export interface ProcesoDelMapa {
  id: string;
  code: string;
  nombre: string;
  tipo: TipoDeProceso;
  proposito: string | null;
  deReferencia: boolean;
  activo: boolean;
  orden: number;
  responsable: { id: string; nombre: string; activo: boolean };
  cuelgan: {
    riesgos: number;
    oportunidades: number;
    objetivos: number;
    noConformidades: number;
    indicadores: number;
    revisionesVencidas: number;
  };
  bandaMaxima: BandaDeRiesgo | null;
}

export interface RolDeCuidado {
  id: string;
  nombre: string;
  category: string;
}

export interface RespuestaDelMapa {
  procesos: ProcesoDelMapa[];
  roles: RolDeCuidado[];
}

export interface RiesgoDelProceso {
  id: string;
  tipo: "RISK" | "OPPORTUNITY";
  deSerie: boolean;
  descripcion: string;
  probabilidad: number;
  impacto: number;
  nivel: number;
  banda: BandaDeRiesgo;
  accionPrevista: string | null;
  reviewAt: string;
  vencida: boolean;
  revisadoEn: string | null;
  isoClause: string | null;
  activo: boolean;
}

export interface ObjetivoDelProceso {
  id: string;
  anio: number;
  nombre: string;
  meta: string;
  estado: "OPEN" | "MET" | "NOT_MET" | "CANCELLED";
  indicatorCode: string | null;
  nota: string | null;
  isoClause: string | null;
}

export interface RespuestaDelProceso {
  proceso: {
    id: string;
    code: string;
    nombre: string;
    tipo: TipoDeProceso;
    proposito: string | null;
    deReferencia: boolean;
    activo: boolean;
    orden: number;
    responsable: { id: string; name: string };
  };
  riesgos: RiesgoDelProceso[];
  objetivos: ObjetivoDelProceso[];
  noConformidades: Array<{
    id: string;
    referencia: string;
    clase: ClaseDeNc;
    origen: OrigenDeNc;
    estado: EstadoDeNc;
    detectedOn: string;
    descripcion: string | null;
  }>;
  indicadores: string[];
}

export interface NcDeLaLista {
  id: string;
  referencia: string;
  clase: ClaseDeNc;
  origen: OrigenDeNc;
  estado: EstadoDeNc;
  detectedOn: string;
  isoClause: string | null;
  proceso: { id: string; name: string };
  cerradaEn: string | null;
  acciones: number;
  verificaciones: number;
  accionesVencidas: number;
  descripcion: string | null;
}

export interface EvidenciaDeAccion {
  id: string;
  tieneFichero: boolean;
  bytes: number | null;
  nota: string | null;
  at: string;
  por: string;
}

export interface AccionDeNc {
  id: string;
  que: string | null;
  responsable: string;
  dueOn: string;
  vencida: boolean;
  abiertaEn: string;
  cerradaEn: string | null;
  cerradaPor: string | null;
  notaDeCierre: string | null;
  evidencias: EvidenciaDeAccion[];
}

export interface VerificacionDeNc {
  id: string;
  resultado: "EFFECTIVE" | "NOT_EFFECTIVE";
  nota: string | null;
  at: string;
  por: string;
  como: string;
}

export interface RespuestaDeNc {
  noConformidad: {
    id: string;
    referencia: string;
    clase: ClaseDeNc;
    origen: OrigenDeNc;
    estado: EstadoDeNc;
    isoClause: string | null;
    detectedOn: string;
    proceso: { id: string; name: string; type: TipoDeProceso };
    descripcion: string | null;
    causa: string | null;
    origenDetalle: {
      incidencia: {
        id: string;
        incidentType: string;
        subject: string;
        openedAt: string;
      } | null;
      indicador: string | null;
      mes: string | null;
      nota: string | null;
    };
    informe: { bytes: number | null } | null;
    abiertaEn: string;
    abiertaPor: string;
    abiertaComo: string;
    cerradaEn: string | null;
    cerradaPor: string | null;
  };
  acciones: AccionDeNc[];
  verificaciones: VerificacionDeNc[];
  ciclo: {
    ciclo: {
      estado: EstadoDeNc;
      clase: ClaseDeNc;
      tieneCausa: boolean;
      acciones: number;
      accionesAbiertas: number;
      verificadaEficaz: boolean;
    };
    siguiente: Array<{ destino: EstadoDeNc; falta: string | null }>;
  };
}

/** La tabla genérica de «de qué registros sale este indicador». */
export interface TablaDeRegistros {
  code: string;
  mes: string;
  titulo: string;
  nota: string;
  columnas: string[];
  filas: string[][];
  total: number;
}

/** El bloque de calidad del panel de dirección. */
export interface CalidadDelPanel {
  noConformidades: {
    abiertas: number;
    porEstado: Array<{ estado: EstadoDeNc; cuantas: number }>;
  };
  accionesVencidas: Array<{
    id: string;
    ncId: string;
    referencia: string;
    responsable: string;
    dueOn: string;
  }>;
  revisionesVencidas: Array<{
    id: string;
    procesoId: string;
    proceso: string;
    descripcion: string;
    nivel: number;
    banda: BandaDeRiesgo;
    reviewAt: string;
  }>;
  propuestas: Array<{
    code: string;
    nombre: string;
    meses: [string, string];
    mesDeReferencia: string;
    procesoId: string | null;
  }>;
  mapaCargado: boolean;
}
