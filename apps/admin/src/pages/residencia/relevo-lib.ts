// residencia-5 · LOS TIPOS Y LAS FRASES DEL PANEL Y DEL RELEVO.
//
// Aparte de las pantallas por lo mismo que `incidencias-lib.ts`
// (residencia-4): cuatro pantallas comparten estos tipos y estas frases, y
// cuatro copias de «Sigue abierta de antes» se separan a la cuarta.

export interface LineaDelParte {
  clase: string;
  texto: string;
  hora: string | null;
  nivel: string | null;
  incidentId: string | null;
  careRecordId: string | null;
  aviso: {
    canal: string;
    estado: string;
    acusadoPor: string | null;
    acusadoEn: string | null;
  } | null;
}

export interface ZonaDelParte {
  floorId: string | null;
  nombre: string;
  lineas: number;
  residentes: Array<{
    clientId: string;
    nombre: string;
    habitacion: string | null;
    lineas: LineaDelParte[];
  }>;
  sueltas: LineaDelParte[];
}

export interface ParteDeRelevo {
  centro: { id: string; nombre: string };
  turno: { id: string; code: string; name: string; startsAt: string; endsAt: string };
  careDay: string;
  desde: string;
  hasta: string;
  corte: string;
  generadoEn: string;
  sinNovedades: boolean;
  lineas: number;
  zonas: ZonaDelParte[];
}

export interface AcuseDelRelevo {
  nombre: string;
  rol: string;
  at: string;
  llegoEn?: string;
  alcanceTotal: boolean;
  tablet?: string | null;
  zonas: string[];
}

export interface AnadidoTardio {
  id: string;
  kind: string;
  clientId: string | null;
  floorId: string | null;
  resumen: string | null;
  ocurrioEn: string;
  llegoEn: string;
  incidentId: string | null;
  careRecordId: string | null;
}

export interface RelevoDeLaLista {
  id: string;
  careDay: string;
  turno: { id: string; code: string; name: string };
  lineas: number;
  sinNovedades: boolean;
  congeladoEn: string;
  confirmadoEn: string | null;
  confirmaciones: number;
  zonas: number;
  tardios: number;
}

export interface RelevoDetalle {
  id: string;
  careDay: string;
  turno: { id: string; code: string; name: string };
  lineas: number;
  sinNovedades: boolean;
  generadoEn: string;
  congeladoEn: string;
  confirmadoEn: string | null;
  zonas: Array<{ floorId: string | null; nombre: string; lineas: number }>;
  confirmado: boolean;
  zonasPorConfirmar: Array<string | null>;
  acuses: AcuseDelRelevo[];
  tardios: AnadidoTardio[];
  parte: ParteDeRelevo | null;
  ilegible: boolean;
}

/** Cómo se lee cada clase de línea. **La misma lista que la tablet** y
 *  que la API; un test fija que las tres coinciden. */
export const NOMBRE_DE_LA_CLASE: Record<string, string> = {
  INCIDENCIA_NUEVA: "Incidencia nueva",
  INCIDENCIA_ABIERTA: "Sigue abierta de antes",
  ALGO_NO_VA_BIEN: "Algo no va bien",
  CONSTANTE_FUERA_DE_RANGO: "Constante fuera de rango",
  NO_HECHO: "No se hizo",
  CAMBIO_DE_PLAN: "Cambio en el plan de cuidados",
  EXCEPCION_NUEVA: "Umbral propio nuevo",
  REGISTRO_SIN_TURNO: "Registro sin turno",
  AVISO_QUE_NO_SALIO: "Aviso que no salió a tiempo",
  SIN_PLAN_DE_CUIDADOS: "Sin plan de cuidados",
  // historia-1 (D-92) · el residente ausente.
  AUSENTE: "Ausente",
};

/** Y de qué es un añadido tardío. En castellano, no el enum: la lección
 *  5 del bucle visual de residencia-4 («el enum no es la pantalla»). */
export const NOMBRE_DEL_TARDIO: Record<string, string> = {
  CARE_RECORD: "Registro de cuidados",
  INCIDENT: "Incidencia",
  GUARD_ALERT: "Aviso de guardia",
};

// ── Las obligaciones ─────────────────────────────────────────────────

export type FamiliaDeObligacion =
  | "PERSONAL"
  | "DINERO"
  | "COMPRAS"
  | "CUMPLIMIENTO"
  | "CALIDAD";

export type PeriodicidadDeObligacion =
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "ANNUAL"
  | "FIVE_YEARLY"
  | "VALIDITY";

export type ConsecuenciaDeObligacion = "LEGAL" | "ISO" | "INTERNO";

export const NOMBRE_DE_LA_FAMILIA: Record<FamiliaDeObligacion, string> = {
  PERSONAL: "Personal",
  DINERO: "Dinero",
  COMPRAS: "Compras",
  CUMPLIMIENTO: "Cumplimiento",
  CALIDAD: "Calidad",
};

export const NOMBRE_DE_LA_PERIODICIDAD: Record<PeriodicidadDeObligacion, string> = {
  DAILY: "Diaria",
  WEEKLY: "Semanal",
  MONTHLY: "Mensual",
  QUARTERLY: "Trimestral",
  ANNUAL: "Anual",
  FIVE_YEARLY: "Quinquenal",
  VALIDITY: "Por vigencia",
};

export const NOMBRE_DE_LA_CONSECUENCIA: Record<ConsecuenciaDeObligacion, string> = {
  LEGAL: "Legal",
  ISO: "ISO",
  INTERNO: "Interno",
};

/** El color de la consecuencia. Lo legal en rojo: es lo que ordena el
 *  panel y lo que la dirección tiene que ver primero. */
export function colorDeLaConsecuencia(c: string): string {
  switch (c) {
    case "LEGAL":
      return "bg-red-100 text-red-800";
    case "ISO":
      return "bg-amber-100 text-amber-900";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export interface Obligacion {
  id: string;
  name: string;
  family: FamiliaDeObligacion;
  notes: string | null;
  periodicity: PeriodicidadDeObligacion;
  weekday: number | null;
  monthDay: number | null;
  month: number | null;
  anchorYear: number | null;
  validUntil: string | null;
  periodicityToVerify: boolean;
  consequence: ConsecuenciaDeObligacion;
  startsOn: string;
  active: boolean;
  responsibleCareRole: { id: string; name: string } | null;
  responsibleUser: { id: string; alias: string | null; email: string } | null;
  responsibleLabel: string | null;
  responsable: string;
  periodicidadEnPalabras: string;
}

export interface OcurrenciaPintada {
  id: string;
  dutyId: string;
  nombre: string;
  family: string;
  consequence: string;
  dueOn: string;
  diasRestantes: number;
  vencida: boolean;
  hecha: boolean;
  hechaEn: string | null;
  hechaPor: string | null;
  tieneEvidencia: boolean;
  periodicityToVerify: boolean;
  responsable: string;
}

// ── Los indicadores ──────────────────────────────────────────────────

export interface ValorDeIndicador {
  code: string;
  nombre: string;
  deDonde: string;
  unidad: "PORCENTAJE" | "RECUENTO";
  comparacion: "AT_LEAST" | "AT_MOST";
  valor: number | null;
  umbral: number;
  umbralDelCentro: boolean;
  dentro: boolean | null;
}

/** Cómo se escribe un valor. «Sin dato» NO es cero (ver
 *  `indicadores.ts` del paquete puro). */
export function valorEnPalabras(v: ValorDeIndicador): string {
  if (v.valor == null) return "Sin dato este mes";
  return v.unidad === "PORCENTAJE"
    ? `${String(v.valor).replace(".", ",")} %`
    : String(v.valor);
}

export function umbralEnPalabras(v: ValorDeIndicador): string {
  const n = String(v.umbral).replace(".", ",");
  const unidad = v.unidad === "PORCENTAJE" ? " %" : "";
  return v.comparacion === "AT_LEAST" ? `≥ ${n}${unidad}` : `≤ ${n}${unidad}`;
}

// ── El panel ─────────────────────────────────────────────────────────

export interface Panel {
  abierto: {
    porNivel: Array<{ nivel: string; cuantas: number }>;
    avisosSinAcuse: number;
    sinConstanciaDeFamilia: number;
    esperandoCierreDeOtro: number;
    total: number;
  };
  relevos: {
    ultimo: {
      id: string;
      careDay: string;
      turno: string;
      congeladoEn: string;
      lineas: number;
      sinNovedades: boolean;
      confirmado: boolean;
      confirmadoPor: Array<{
        nombre: string;
        rol: string;
        at: string;
        alcanceTotal: boolean;
      }>;
      zonasPorConfirmar: number;
    } | null;
    sinConfirmar: Array<{
      id: string;
      careDay: string;
      turno: string;
      congeladoEn: string;
      lineas: number;
      zonasPorConfirmar: number;
    }>;
  };
  obligaciones: {
    hoy: OcurrenciaPintada[];
    vencidas: OcurrenciaPintada[];
    proximas: OcurrenciaPintada[];
  };
  turno: {
    turno: { id: string; code: string; name: string } | null;
    careDay: string;
    plantas: Array<{
      floorId: string | null;
      nombre: string;
      tocan: number;
      hechas: number;
    }>;
    noHechoDeTurnosCerrados: number;
  };
  /** residencia-6 · lo que está mal puesto y se arregla configurando:
   *  PIN que se quedaron cortos (D-68) y residentes sin plan de cuidados
   *  vigente (punto 4 del bloque). Opcional porque el panel de una API
   *  anterior a este bloque no lo trae. */
  porArreglar?: {
    pinesPorRenovar: Array<{
      userId: string;
      nombre: string;
      roles: string[];
    }>;
    residentesSinPlan: Array<{
      clientId: string;
      nombre: string;
      habitacion: string | null;
    }>;
    /** historia-1 (D-92) · las vueltas del hospital que la DUE no ha
     *  confirmado. Opcional por lo mismo que `porArreglar` entero. */
    vueltasPorRevisar?: Array<{
      clientId: string;
      absenceId: string;
      nombre: string;
      habitacion: string | null;
      deDonde: string;
      volvioEn: string;
      diasEsperando: number;
    }>;
    /** historia-1 (D-94) · los ingresos con el expediente a medias. */
    ingresosConPendientes?: Array<{
      clientId: string;
      nombre: string;
      ingreso: string;
      pendientes: number;
      vencidos: number;
      queFalta: string[];
    }>;
  };
  indicadores: ValorDeIndicador[];
  mes: string;
  /** primer-acceso (punto 4) · el centro no tiene todavía ni un
   *  residente. Opcional porque el panel de una API anterior a este
   *  bloque no lo trae — y `undefined` se comporta como «no está vacío»,
   *  que es el panel de siempre. */
  centroVacio?: boolean;
  generadoEn: string;
}

/** «HH:MM» de un ISO, en hora local del navegador. */
export function hora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

/** «dd-mm-aaaa» de un «YYYY-MM-DD», que es como se lee en España. */
export function dia(fecha: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;
  return `${fecha.slice(8, 10)}-${fecha.slice(5, 7)}-${fecha.slice(0, 4)}`;
}
