// F1 · cómo se lee un registro de jornada (ADR-018).
//
// Una sola forma para las cuatro superficies que lo pintan: "Mis
// fichajes" en el móvil, "Hoy" y "Registro" en el panel, y el export a la
// Inspección. Si cada una lo calculara a su manera, el PDF que se firma y
// la pantalla que se mira podrían no coincidir — y el que vale es el PDF.
//
// Los totales salen SIEMPRE de los instantes UTC (`minutesWorked`), nunca
// de restar horas de pared. Ver la cabecera de `time.ts`.

import { entrySentOffline } from "./offline.js";
import { localDate, localTime, minutesWorked } from "./time.js";

export interface TimeEntryRow {
  id: string;
  employeeId: string;
  startedAt: Date;
  endedAt: Date | null;
  startedDeviceAt: Date | null;
  startedServerAt: Date | null;
  endedDeviceAt: Date | null;
  endedServerAt: Date | null;
  startSource: string;
  endSource: string | null;
}

export interface EntryView {
  id: string;
  startedAt: string;
  endedAt: string | null;
  /** Hora de pared, que es lo que se lee. El ISO va al lado para el front. */
  startedLocal: string;
  endedLocal: string | null;
  date: string;
  /** `null` mientras el tramo está en curso: no se cuenta lo que no ha pasado. */
  minutes: number | null;
  startSource: string;
  endSource: string | null;
  /** Tramo abierto. En el panel se pinta como "sin salida". */
  open: boolean;
  /** Lleva al menos una corrección. Al tocarlo se ve el historial. */
  corrected: boolean;
  /** Las dos horas difieren más de 10 min: llegó por la cola offline. */
  offline: boolean;
}

export interface DayView {
  date: string;
  entries: EntryView[];
  totalMinutes: number;
}

export function toEntryView(
  row: TimeEntryRow,
  correctionCount: number,
): EntryView {
  return {
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    startedLocal: localTime(row.startedAt),
    endedLocal: row.endedAt ? localTime(row.endedAt) : null,
    // El día del registro es el de la ENTRADA. Un turno de noche que
    // termina a las 6 de la mañana pertenece al día en que se empezó: es
    // como lo cuenta quien lo trabaja y como se firma en papel.
    date: localDate(row.startedAt),
    minutes: row.endedAt ? minutesWorked(row.startedAt, row.endedAt) : null,
    startSource: row.startSource,
    endSource: row.endSource,
    open: row.endedAt === null,
    corrected: correctionCount > 0,
    offline: entrySentOffline(row),
  };
}

/** Agrupa por día local y suma. Los días sin fichajes no aparecen: un
 *  registro de jornada enseña lo que pasó, no una rejilla de huecos. */
export function groupByDay(entries: EntryView[]): DayView[] {
  const byDate = new Map<string, EntryView[]>();
  for (const e of entries) {
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({
      date,
      entries: list.sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
      totalMinutes: list.reduce((acc, e) => acc + (e.minutes ?? 0), 0),
    }));
}

export function totalMinutes(days: DayView[]): number {
  return days.reduce((acc, d) => acc + d.totalMinutes, 0);
}
