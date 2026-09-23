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
