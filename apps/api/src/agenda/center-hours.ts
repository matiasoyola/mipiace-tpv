// B-reservas-7a · EL TECHO de la agenda: el horario del centro.
//
// Hasta este bloque la disponibilidad salía SÓLO de los turnos del personal
// (`store.getTemplateSlots`, que expande `staff_shifts`). Si nadie definía
// turno, el centro no abría; si alguien lo definía de par en par, el centro
// abría de par en par. Y un festivo había que bloquearlo a mano, día a día.
//
// Aquí vive la ARITMÉTICA PURA de resolver, para una fecha, qué tramos tiene
// abiertos el centro y de recortar con ellos la plantilla de un profesional.
// Sin SQL y sin Prisma: el store trae las filas, esto decide. Así la regla se
// prueba sin base de datos y el motor no tiene que saber de dónde salen los
// datos.
//
// TODO EN HORA DE PARED del huso del centro, como `staff_shifts`: minutos
// desde medianoche, nunca sobre el epoch. Es la aritmética que sobrevive al
// cambio de hora.

import { minutesToTime, timeToMinutes } from "./time.js";
import type { CenterDayHours, OpenRange, TemplateSlot } from "./types.js";

// Las filas tal cual salen de la BD, con las fechas ya en "YYYY-MM-DD" (el
// store las normaliza: `@db.Date` llega como Date a medianoche UTC y
// compararla como Date contra una fecha de pared es la clase de error que
// aparece un 25 de octubre).
export interface CenterHoursRow {
  weekday: number; // ISO-8601: 1 = lunes … 7 = domingo
  openTime: string; // "HH:MM" de pared
  closeTime: string;
  validFrom: string; // "YYYY-MM-DD"
  validUntil: string | null;
}

export interface CenterDayRow {
  date: string; // "YYYY-MM-DD"
  closed: boolean;
  name: string;
  openTime: string | null;
  closeTime: string | null;
}

/**
 * Día de la semana ISO-8601 (1 = lunes … 7 = domingo) de una fecha de pared.
 *
 * Se calcula sobre el MEDIODÍA UTC de esa fecha, no sobre su medianoche: el
 * día de la semana de "2026-10-25" es el mismo en cualquier huso, y anclar
 * al mediodía lo deja fuera del alcance de cualquier offset (hasta el ±14 h
 * de Kiribati). La zona del proceso no entra en el cálculo.
 */
export function isoWeekday(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00.000Z`).getUTCDay(); // 0 = domingo
  return d === 0 ? 7 : d;
}

/** Las fechas de pared de `[fromDate, toDate]`, ambas incluidas. Por texto,
 *  no sumando 24 h: el día del cambio de hora dura 23 o 25. */
export function wallDatesBetween(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  const d = new Date(`${fromDate}T12:00:00.000Z`);
  const end = new Date(`${toDate}T12:00:00.000Z`);
  // Cota de seguridad: un rango invertido o absurdo no cuelga el proceso.
  for (let i = 0; d.getTime() <= end.getTime() && i < 400; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** ¿Rige esta fila de la semana tipo en esta fecha? */
function vigente(row: CenterHoursRow, date: string): boolean {
  if (row.validFrom > date) return false;
  if (row.validUntil !== null && row.validUntil < date) return false;
  return true;
}

/**
 * El horario del centro, fecha a fecha, en `[fromDate, toDate]`.
 *
 * El orden de resolución, que es el que dicta el bloque y el que tiene un
 * test por línea:
 *
 *   1. ¿Hay un DÍA ESPECIAL para esa fecha? → **SUSTITUYE** al horario
 *      semanal, no se suma. Cerrado ⇒ cero tramos (invariante 13). Con
 *      horario ⇒ ese único rango, aunque la semana tipo cierre ese día.
 *   2. ¿No? ¿Tiene el tenant ALGUNA fila de semana tipo VIGENTE esa fecha?
 *      → los tramos de ese día de la semana, que pueden ser **ninguno**:
 *      con semana tipo puesta, un día sin fila está CERRADO aunque alguien
 *      tenga turno.
 *   3. ¿Ninguna fila vigente? → **sin techo** (`open: null`). Es la
 *      compatibilidad: un tenant que no configura nada se comporta
 *      exactamente como antes de este bloque.
 *
 * La vigencia se mira POR FECHA, no por tenant. Un horario con `validFrom`
 * el 01-10 deja septiembre **sin techo** (como hoy), no cerrado: configurar
 * el futuro no puede cerrar el pasado a espaldas de nadie.
 */
export function resolveCenterSchedule(
  weekRows: CenterHoursRow[],
  dayRows: CenterDayRow[],
  fromDate: string,
  toDate: string,
): Map<string, CenterDayHours> {
  const byDate = new Map<string, CenterDayRow>();
  for (const d of dayRows) byDate.set(d.date, d);

  const out = new Map<string, CenterDayHours>();
  for (const date of wallDatesBetween(fromDate, toDate)) {
    const especial = byDate.get(date);
    if (especial) {
      if (especial.closed) {
        out.set(date, {
          date,
          open: [],
          specialName: especial.name,
          closed: true,
        });
      } else {
        out.set(date, {
          date,
          open: [
            { startTime: especial.openTime!, endTime: especial.closeTime! },
          ],
          specialName: especial.name,
          closed: false,
        });
      }
      continue;
    }
    const vigentes = weekRows.filter((r) => vigente(r, date));
    if (vigentes.length === 0) {
      // Sin techo: este tenant no tiene horario configurado para esta fecha.
      out.set(date, { date, open: null, specialName: null, closed: false });
      continue;
    }
    const wd = isoWeekday(date);
    const tramos = vigentes
      .filter((r) => r.weekday === wd)
      .map((r) => ({ startTime: r.openTime, endTime: r.closeTime }))
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    out.set(date, {
      date,
      open: tramos,
      specialName: null,
      closed: tramos.length === 0,
    });
  }
  return out;
}

/**
 * Recorta las franjas de plantilla de un profesional con el horario del
 * centro de esa fecha: `turno ∩ horario_del_centro(fecha)`.
 *
 * Devuelve CERO franjas si el centro está cerrado ese día, y las franjas
 * TAL CUAL si el centro no tiene techo configurado. Una franja de turno que
 * cruza dos tramos (horario partido) sale partida en dos, que es lo
 * correcto: la hora de comer del centro no es reservable aunque la
 * profesional tenga turno seguido.
 */
export function clipToCenter(
  slots: TemplateSlot[],
  hours: CenterDayHours | undefined,
): TemplateSlot[] {
  // Sin fila para esa fecha (rango que el store no cargó) o sin techo: tal
  // cual, que es el comportamiento de siempre.
  if (!hours || hours.open === null) return slots;
  if (hours.open.length === 0) return [];
  const out: TemplateSlot[] = [];
  for (const s of slots) {
    const sStart = timeToMinutes(s.startTime);
    const sEnd = timeToMinutes(s.endTime);
    for (const range of hours.open) {
      const start = Math.max(sStart, timeToMinutes(range.startTime));
      const end = Math.min(sEnd, timeToMinutes(range.endTime));
      if (start >= end) continue; // no se tocan
      out.push({
        userId: s.userId,
        date: s.date,
        startTime: minutesToTime(start),
        endTime: minutesToTime(end),
      });
    }
  }
  return out;
}
