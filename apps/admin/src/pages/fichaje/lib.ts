// F1 · lo que comparten las tres pantallas del control horario.
//
// Las formas del servidor y las funciones de lectura que se repiten. El
// cálculo NO se rehace aquí: los totales vienen del servidor, que es el
// mismo cálculo que va al PDF que se firma. Si la pantalla sumara por su
// cuenta, el día que discrepen ganaría el PDF y nadie sabría por qué.

export const REASONS = [
  { code: "OLVIDO", label: "Se le olvidó fichar" },
  { code: "ERROR_HORA", label: "La hora no era ésa" },
  { code: "OTRO", label: "Otro" },
] as const;

export type ReasonCode = (typeof REASONS)[number]["code"];

export function reasonLabel(code: string): string {
  return REASONS.find((r) => r.code === code)?.label ?? code;
}

export interface EmployeeRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  deactivatedAt: string | null;
  device: { id: string; pairedAt: string; lastSeenAt: string | null } | null;
  pendingLink: { expiresAt: string } | null;
}

export interface EntryRow {
  id: string;
  startedAt: string;
  endedAt: string | null;
  startedLocal: string;
  endedLocal: string | null;
  date: string;
  minutes: number | null;
  startSource: "MOBILE" | "PANEL";
  endSource: "MOBILE" | "PANEL" | null;
  open: boolean;
  corrected: boolean;
  offline: boolean;
}

export interface DayRow {
  date: string;
  entries: EntryRow[];
  totalMinutes: number;
}

export interface BlockRow {
  employeeId: string;
  employeeName: string;
  days: DayRow[];
  totalMinutes: number;
}

export interface RegistroResponse {
  month: string;
  timeZone: string;
  employeeId: string | null;
  employees: Array<{ id: string; name: string; active: boolean }>;
  blocks: BlockRow[];
  totalMinutes: number;
}

export interface TodayResponse {
  date: string;
  timeZone: string;
  serverNow: string;
  inside: Array<{
    employeeId: string;
    employeeName: string;
    entryId: string;
    startedAt: string;
  }>;
  notClockedIn: Array<{ employeeId: string; employeeName: string }>;
  /** personal-1 (punto 9) · planificado frente a fichado. `null` cuando el
   *  mes no tiene cuadrante publicado: la pantalla dice «publica el
   *  cuadrante para poder comparar» en vez de pintar tres listas vacías,
   *  que se leen como «todo en orden». */
  planned: {
    toleranceMinutes: number;
    marginHours: number;
    withoutClockIn: Array<{
      employeeId: string;
      employeeName: string;
      dia: string;
      turnoId: string;
      code: string;
      inicioAt: string;
      minutosDeRetraso: number;
    }>;
    withoutShift: Array<{
      entryId: string;
      employeeId: string;
      employeeName: string;
      dia: string;
      inicioAt: string;
    }>;
    pastTheirHour: Array<{
      entryId: string;
      employeeId: string;
      employeeName: string;
      dia: string;
      inicioAt: string;
      turnoId: string;
      code: string;
      finPlanificadoAt: string;
      horasDeMas: number;
    }>;
  } | null;
  alerts: {
    missingExit: Array<{
      entryId: string;
      employeeId: string;
      employeeName: string;
      startedAt: string;
      date: string;
    }>;
    corrected: Array<{
      entryId: string;
      employeeId: string;
      employeeName: string;
      date: string;
      corrections: number;
    }>;
    sentOffline: Array<{
      entryId: string;
      employeeId: string;
      employeeName: string;
      date: string;
    }>;
  };
}

export interface CorrectionRow {
  id: string;
  field: "started_at" | "ended_at";
  oldValue: string | null;
  newValue: string | null;
  reasonCode: string;
  reasonText: string | null;
  authorKind: "EMPLOYEE" | "PANEL";
  author: string;
  kind: "ALTA" | "CAMBIO";
  createdAt: string;
}

/** "8h 07m". Nunca decimales: un registro de jornada se lee en reloj. */
export function duracion(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function horaLocal(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

export function diaLargo(fecha: string, timeZone: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  const s = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function diaCorto(fecha: string, timeZone: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    timeZone,
  }).format(d);
}

export function mesLargo(month: string): string {
  const d = new Date(`${month}-15T12:00:00Z`);
  const s = new Intl.DateTimeFormat("es-ES", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Mes actual como "YYYY-MM" en la zona del registro. */
export function mesActual(timeZone = "Europe/Madrid"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone })
    .format(new Date())
    .slice(0, 7);
}

export function mesVecino(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 15));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Día local + "HH:MM" → instante ISO, con el refinamiento de una pasada
 *  en el borde del cambio de hora (mismo método que `agenda/time.ts`). */
export function componerLocal(
  fecha: string,
  hora: string,
  timeZone: string,
): string {
  const [hh, mm] = hora.split(":").map(Number);
  const [y, mo, d] = fecha.split("-").map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, hh!, mm!);
  const off = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(t));
    const map: Record<string, number> = {};
    for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
    const hour = map.hour === 24 ? 0 : map.hour!;
    return (
      Date.UTC(map.year!, map.month! - 1, map.day!, hour, map.minute!, map.second!) - t
    );
  };
  let r = guess - off(guess);
  const off2 = off(r);
  if (off2 !== off(guess)) r = guess - off2;
  return new Date(r).toISOString();
}

// ══ personal-1 · la ficha de personal y el cuadrante ═══════════════════
//
// Los tipos de las respuestas nuevas y las funciones de lectura que las
// tres pantallas comparten. **El cálculo no se rehace aquí**, con una
// excepción declarada: `comprobarCuadrante` se ejecuta también en el
// navegador (viene del paquete puro) para pintar los avisos en el mismo
// toque, sin esperar al servidor. Es la MISMA función, no una copia.

export type PesoDelDato = "IMPRESCINDIBLE" | "RECOMENDABLE";

export interface DatoQueFalta {
  campo: string;
  etiqueta: string;
  peso: PesoDelDato;
}

export interface EstadoDeFicha {
  faltan: DatoQueFalta[];
  incompleta: boolean;
  conImprescindibles: boolean;
}

export interface CategoriaRow {
  id: string;
  code: string;
  name: string;
  countsAsDirectCare: boolean;
  isStandard?: boolean;
  active?: boolean;
  employees?: number;
}

export interface PersonalRow {
  id: string;
  name: string;
  lastName: string | null;
  nombreCompleto: string;
  categoryId: string | null;
  categoria: string | null;
  atencionDirecta: boolean;
  weeklyMinutes: number | null;
  contractKind: string | null;
  hiredOn: string | null;
  contractEndsOn: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  tieneDni: boolean;
  tieneAfiliacion: boolean;
  faltan: EstadoDeFicha;
}

export interface PersonalResponse {
  personal: PersonalRow[];
  categorias: CategoriaRow[];
  resumen: {
    total: number;
    incompletas: number;
    datosPendientes: number;
    conImprescindibles: number;
    contratosQueAcaban: Array<{
      employeeId: string;
      nombre: string;
      contractEndsOn: string;
      dias: number;
    }>;
  };
}

export interface FichaResponse {
  ficha: {
    id: string;
    name: string;
    lastName: string | null;
    dni: string | null;
    afiliacion: string | null;
    categoryId: string | null;
    weeklyMinutes: number | null;
    contractKind: string | null;
    hiredOn: string | null;
    contractEndsOn: string | null;
    phone: string | null;
    email: string | null;
    userId: string | null;
    active: boolean;
    faltan: DatoQueFalta[];
    estado: EstadoDeFicha;
  };
  /** Lo que la ficha ENSEÑA de las otras dos «personas». No lo mueve. */
  vinculo: {
    userId: string;
    nombre: string | null;
    rol: string | null;
    rolesDeCuidado: Array<{ code: string; name: string; desde: string }>;
    perfilDeAgenda: { displayName: string; active: boolean } | null;
  } | null;
}

export interface TurnoRow {
  id: string;
  code: string;
  name: string;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
  coberturaMinima: number | null;
}

export interface AvisoDeTurnosRow {
  problema: "SOLAPE" | "HUECO" | "SIN_COBERTURA";
  codigos: string[];
  mensaje: string;
}

export interface AvisoRow {
  regla: string;
  gravedad: "ROJO" | "AMBAR";
  employeeId: string | null;
  dia: string | null;
  turnoId: string | null;
  mensaje: string;
  falta?: number;
  exceso?: number;
  celda: { employeeId: string; dia: string } | null;
}

export interface CeldaRow {
  employeeId: string;
  dia: string;
  turnoId: string | null;
  ausencia: string | null;
}

export interface CuadranteResponse {
  month: string;
  dias: string[];
  cabecera: {
    id: string;
    month: string;
    state: "BORRADOR" | "PUBLICADO";
    origin: "MANUAL" | "GENERADO";
    publishedAt: string | null;
    publishedBy: string | null;
    warningsAtPublish: number | null;
  } | null;
  turnos: TurnoRow[];
  personas: Array<{
    employeeId: string;
    nombre: string;
    atencionDirecta: boolean;
    minutosContratados: number | null;
    altaEl: string | null;
    finEl: string | null;
    active: boolean;
    categoria: string | null;
  }>;
  celdas: CeldaRow[];
  ausencias: string[];
  reglas: {
    ratioAtencionDirecta: number;
    minutosDeJornadaCompleta: number;
    horasDescansoDiario: number;
    horasDescansoSemanal: number;
    diasComputoSemanal: number;
    conRatioDeResidencia: boolean;
  };
  avisos: AvisoRow[];
  resumen: {
    total: number;
    rojos: number;
    ambares: number;
    porRegla: Record<string, number>;
  };
  ocupacionPorDia: Record<string, number> | null;
}

export interface CambioDelCuadranteRow {
  id: string;
  employeeId: string;
  employeeName: string;
  dia: string;
  antes: string | null;
  despues: string | null;
  motivo: string;
  autor: string;
  cuando: string;
}

/** Cómo se lee cada ausencia en la rejilla. */
export const AUSENCIAS_LABEL: Record<string, string> = {
  LIBRE: "Libre",
  VACACIONES: "Vacaciones",
  IT: "Baja (IT)",
  ASUNTOS_PROPIOS: "Asuntos propios",
  PERMISO: "Permiso",
};

/** Y su abreviatura, que es lo que cabe en una celda de 31 columnas. */
export const AUSENCIAS_CORTO: Record<string, string> = {
  LIBRE: "L",
  VACACIONES: "V",
  IT: "IT",
  ASUNTOS_PROPIOS: "AP",
  PERMISO: "P",
};

/** Cómo se lee cada regla en el resumen de arriba. */
export const REGLAS_LABEL: Record<string, string> = {
  COBERTURA: "Cobertura del turno",
  RATIO: "Ratio de atención directa",
  DESCANSO_DIARIO: "Descanso entre jornadas",
  DESCANSO_SEMANAL: "Descanso semanal",
  HORAS_SEMANA: "Horas de la semana",
  HORAS_MES: "Horas del mes",
  DOS_SITIOS_A_LA_VEZ: "Dos turnos a la vez",
  FUERA_DE_CONTRATO: "Fuera de contrato",
};

/** 2 250 → «37,5 h». Y `null` → «—», que es «no se sabe». */
export function jornada(minutos: number | null): string {
  if (minutos == null) return "—";
  return `${String(Math.round((minutos / 60) * 10) / 10).replace(".", ",")} h`;
}

/** «+2h 30m» / «−1h 05m». El signo delante, y el menos matemático. */
export function diferencia(minutos: number): string {
  if (minutos === 0) return duracion(0);
  return `${minutos > 0 ? "+" : "−"}${duracion(Math.abs(minutos))}`;
}

/** El día del mes, «1»…«31». Es lo que va en la cabecera de la rejilla. */
export function numeroDeDia(dia: string): string {
  return String(Number(dia.slice(8, 10)));
}

/** «L», «M», «X»… la inicial del día de la semana, para la segunda fila
 *  de la cabecera. Sin ella, 31 números no dicen dónde cae el fin de
 *  semana — que es lo primero que se mira en un cuadrante. */
export function inicialDeDiaSemana(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  return ["D", "L", "M", "X", "J", "V", "S"][d.getUTCDay()]!;
}

/** `true` si es sábado o domingo. La rejilla los pinta más grises. */
export function esFinDeSemana(dia: string): boolean {
  const d = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}
