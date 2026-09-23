// F1 · las formas que viajan entre la API del fichaje y la pantalla.
//
// Un solo sitio, porque las mismas las usan la pantalla del empleado y —en
// su versión de panel— las tres del "Control horario". Si cada una se
// escribiera su interfaz, el día que la API cambie sólo se enteraría una.

export const CORRECTION_REASONS = [
  { code: "OLVIDO", label: "Se me olvidó fichar" },
  { code: "ERROR_HORA", label: "La hora no era ésa" },
  { code: "OTRO", label: "Otro" },
] as const;

export type ReasonCode = (typeof CORRECTION_REASONS)[number]["code"];

export function reasonLabel(code: string): string {
  return CORRECTION_REASONS.find((r) => r.code === code)?.label ?? code;
}

export interface EntryView {
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

export interface DayView {
  date: string;
  entries: EntryView[];
  totalMinutes: number;
}

export interface MonthView {
  month: string;
  days: DayView[];
  totalMinutes: number;
}

export interface CorrectionView {
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

export interface MeResponse {
  employee: { id: string; name: string };
  tenant: { id: string; name: string };
  timeZone: string;
  serverNow: string;
  today: string;
  openEntry: { id: string; startedAt: string; date: string } | null;
  pendingExit: {
    entryId: string;
    startedAt: string;
    date: string;
    suggestedEndAt: string | null;
  } | null;
  month: MonthView;
}
