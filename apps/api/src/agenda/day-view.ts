// B-reservas-7a · lo que la cajera necesita para PINTAR el día.
//
// Hasta este bloque `GET /agenda` devolvía cuatro campos: el rango, el
// personal y las citas. La rejilla no sabía a qué hora abre el centro, ni si
// está cerrado, ni quién falta — así que una ausencia quitaba huecos en
// silencio y la columna se veía igual de blanca que si estuviera libre.
//
// Aquí se arma, fecha a fecha:
//
//   · el horario del CENTRO (y el nombre del día especial si lo hay);
//   · los TRAMOS ABIERTOS de cada profesional (turno ∩ centro): lo que no
//     esté ahí no es reservable, y tocarlo no abre un alta;
//   · las AUSENCIAS, con su id (para quitarlas) y su motivo (para pintarlo,
//     el «Ana libre» que Sole escribe en la celda del Excel).
//
// Es la MISMA intersección que usa el motor (`clipToCenter` sobre
// `getTemplateSlots`), no una copia: si la rejilla y el motor divergieran,
// la cajera vería hueco donde el servidor dice que no.
//
// Todo en HORA DE PARED del huso del centro: es lo que se pinta, y es lo que
// sobrevive a un día de 23 o 25 horas.

import { clipToCenter, wallDatesBetween } from "./center-hours.js";
import type { AgendaStore } from "./store.js";
import { minutesToTime, timeToMinutes, utcToWallTime } from "./time.js";
import type { OpenRange } from "./types.js";

// Una ausencia tal y como la pinta la columna: hora de pared de ESE día,
// con el id del bloqueo que la produjo y su motivo.
export interface AgendaAbsence {
  id: string | null;
  staffUserId: string | null; // null = el centro entero (bloqueo CENTER)
  startTime: string; // "HH:MM" de pared, recortado al día
  endTime: string; // "HH:MM", o "24:00" si el bloqueo se come el día entero
  reason: string | null;
}

export interface AgendaDayView {
  date: string;
  // El centro. `null` = este tenant no tiene horario configurado esa fecha
  // ⇒ sin techo, como antes de este bloque.
  open: OpenRange[] | null;
  // El día cerrado, con su nombre: "Cerrado · Virgen del Prado".
  closed: { name: string | null } | null;
  // El nombre del día especial que abre ("boda Marta"). null si no lo hay.
  specialName: string | null;
  // Por profesional: turno ∩ centro. Lo que NO esté aquí no es reservable.
  staffOpen: Record<string, OpenRange[]>;
  absences: AgendaAbsence[];
}

/**
 * Recorta un bloqueo (intervalo UTC) a la hora de pared de UN día.
 *
 * Un bloqueo de día entero va de la medianoche de pared de ese día a la del
 * siguiente — 23 h el 29-03 y 25 h el 25-10. Recortarlo restando 24 horas
 * daría una hora de más o de menos justo esos dos días del año. Se recorta
 * comparando INSTANTES y se traduce a pared al final; el "24:00" es el
 * final del día, no las 00:00 del mismo.
 */
function recortarAlDia(
  startsAt: Date,
  endsAt: Date,
  dayStart: Date,
  dayEnd: Date,
  tz: string,
): { startTime: string; endTime: string } | null {
  const s = Math.max(startsAt.getTime(), dayStart.getTime());
  const e = Math.min(endsAt.getTime(), dayEnd.getTime());
  if (s >= e) return null;
  const startTime = utcToWallTime(new Date(s), tz);
  // El final que coincide con el borde del día es "24:00": `utcToWallTime`
  // diría "00:00" y la columna pintaría una ausencia de altura cero.
  const endTime =
    e === dayEnd.getTime() ? "24:00" : utcToWallTime(new Date(e), tz);
  return { startTime, endTime };
}

/** El instante UTC de la medianoche de pared de una fecha. */
type WallMidnight = (date: string) => Date;

/**
 * Arma la vista por día del rango pedido.
 *
 * `staffUserIds` son las columnas que la rejilla va a pintar (el personal
 * con perfil de agenda). Si no hay ninguna, se devuelve igualmente el
 * horario del centro: el día cerrado se dice aunque no haya nadie.
 */
export async function buildAgendaDays(
  store: AgendaStore,
  tenantId: string,
  fromDate: string,
  toDate: string,
  staffUserIds: string[],
  tz: string,
  wallMidnight: WallMidnight,
): Promise<AgendaDayView[]> {
  const dates = wallDatesBetween(fromDate, toDate);
  if (dates.length === 0) return [];
  const ultimo = dates[dates.length - 1]!;
  const rangoDesde = wallMidnight(dates[0]!);
  // El final del rango es la medianoche de pared del día SIGUIENTE al
  // último: así el bloqueo de día entero del último día entra completo.
  const rangoHasta = wallMidnight(siguiente(ultimo));

  const [schedule, templates, blocks] = await Promise.all([
    store.getCenterSchedule(tenantId, fromDate, toDate),
    staffUserIds.length > 0
      ? store.getTemplateSlots(tenantId, staffUserIds, fromDate, toDate)
      : Promise.resolve([]),
    store.getBlocks(tenantId, rangoDesde, rangoHasta),
  ]);

  // Plantillas por usuario y día, para recortarlas con el mismo
  // `clipToCenter` que usa el motor.
  const porUsuarioYDia = new Map<string, typeof templates>();
  for (const t of templates) {
    const k = `${t.userId}|${t.date}`;
    const arr = porUsuarioYDia.get(k) ?? [];
    arr.push(t);
    porUsuarioYDia.set(k, arr);
  }

  const out: AgendaDayView[] = [];
  for (const date of dates) {
    const hours = schedule.get(date);
    const dayStart = wallMidnight(date);
    const dayEnd = wallMidnight(siguiente(date));

    const staffOpen: Record<string, OpenRange[]> = {};
    for (const userId of staffUserIds) {
      const slots = porUsuarioYDia.get(`${userId}|${date}`) ?? [];
      const recortadas = clipToCenter(slots, hours);
      staffOpen[userId] = fusionar(
        recortadas.map((s) => ({
          startTime: s.startTime,
          endTime: s.endTime,
        })),
      );
    }

    const absences: AgendaAbsence[] = [];
    for (const b of blocks) {
      // Los bloqueos de recurso no son ausencias de nadie: no se pintan en
      // una columna de profesional.
      if (b.scope === "RESOURCE" || b.scope === "TABLE") continue;
      const tramo = recortarAlDia(b.startsAt, b.endsAt, dayStart, dayEnd, tz);
      if (!tramo) continue;
      absences.push({
        id: b.id ?? null,
        staffUserId: b.scope === "STAFF" ? b.staffUserId : null,
        startTime: tramo.startTime,
        endTime: tramo.endTime,
        reason: b.reason ?? null,
      });
    }
    absences.sort(
      (a, z) => timeToMinutes(a.startTime) - timeToMinutes(z.startTime),
    );

    out.push({
      date,
      open: hours?.open ?? null,
      closed:
        hours && hours.closed
          ? { name: hours.specialName }
          : null,
      specialName: hours?.specialName ?? null,
      staffOpen,
      absences,
    });
  }
  return out;
}

/** "YYYY-MM-DD" → el día siguiente, por texto (el día del cambio de hora
 *  dura 23 o 25). Mismo criterio que `floor.ts::nextWallDate`. */
function siguiente(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Funde tramos contiguos o solapados. Dos turnos pegados (9–14 y 14–20) se
 * pintan como uno: si no, la columna enseña una costura a las 14:00 que no
 * significa nada y que la cajera lee como "aquí no se puede".
 */
function fusionar(ranges: OpenRange[]): OpenRange[] {
  if (ranges.length <= 1) return ranges;
  const orden = [...ranges].sort(
    (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
  );
  const out: Array<[number, number]> = [];
  for (const r of orden) {
    const s = timeToMinutes(r.startTime);
    const e = timeToMinutes(r.endTime);
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out.map(([s, e]) => ({
    startTime: minutesToTime(s),
    endTime: minutesToTime(e),
  }));
}
