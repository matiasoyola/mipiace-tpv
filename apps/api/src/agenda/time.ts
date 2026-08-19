// Zona horaria del motor de agenda (B-reservas-4). B4 es el DUEÑO de la tz:
// B3 dejó explícitamente las franjas de turno como hora de pared "HH:MM"
// por día, sin conversión. Aquí componemos `fecha(local) + hora de pared`
// en Europe/Madrid → instante UTC, que es lo que se guarda en los
// `tstzrange`. La conversión inversa (UTC → hora de pared del centro) se
// usa sólo para pintar/agrupar por día.
//
// Sin dependencias de tz: usamos `Intl.DateTimeFormat` con `timeZone`, que
// conoce las reglas DST de Europe/Madrid (CET/CEST). Robusto en el borde
// de cambio de hora con un refinamiento de una pasada.

export const CENTER_TZ = "Europe/Madrid";

// Rejilla de disponibilidad: 15 minutos (ADR-R8 §4).
export const SLOT_MINUTES = 15;

const OFFSET_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(tz: string): Intl.DateTimeFormat {
  let f = OFFSET_FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    OFFSET_FORMATTERS.set(tz, f);
  }
  return f;
}

// Offset del huso `tz` (en ms) en el instante `date`: (hora de pared del
// huso, expresada como UTC) − (instante UTC real). Positivo al este de UTC.
function tzOffsetMs(tz: string, date: Date): number {
  const parts = offsetFormatter(tz).formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(
    map.year!,
    map.month! - 1,
    map.day!,
    hour!,
    map.minute!,
    map.second!,
  );
  return asUtc - date.getTime();
}

// `fecha(YYYY-MM-DD) + hora de pared (HH:MM) en `tz`` → instante UTC.
export function wallTimeToUtc(
  dateStr: string,
  timeStr: string,
  tz: string = CENTER_TZ,
): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, hh!, mm!);
  const off = tzOffsetMs(tz, new Date(guess));
  let result = guess - off;
  // Refinamiento en el borde DST: si el offset del instante calculado
  // difiere del de la conjetura, recomputa una vez.
  const off2 = tzOffsetMs(tz, new Date(result));
  if (off2 !== off) result = guess - off2;
  return new Date(result);
}

// Instante UTC → fecha de pared "YYYY-MM-DD" en `tz` (para agrupar por día).
export function utcToWallDate(date: Date, tz: string = CENTER_TZ): string {
  const parts = offsetFormatter(tz).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

// Instante UTC → hora de pared "HH:MM" en `tz` (para pintar en la columna).
export function utcToWallTime(date: Date, tz: string = CENTER_TZ): string {
  const parts = offsetFormatter(tz).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const hh = map.hour === "24" ? "00" : map.hour;
  return `${hh}:${map.minute}`;
}

// "HH:MM" → minutos desde medianoche.
export function timeToMinutes(timeStr: string): number {
  const [hh, mm] = timeStr.split(":").map(Number);
  return hh! * 60 + mm!;
}

// minutos desde medianoche → "HH:MM".
export function minutesToTime(min: number): string {
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// Genera los inicios de slot (en minutos-desde-medianoche) de la rejilla de
// 15 min entre [fromMin, toMin) tales que un servicio de `spanMin` cabe
// completo antes de `toMin`.
export function gridStarts(
  fromMin: number,
  toMin: number,
  spanMin: number,
  step: number = SLOT_MINUTES,
): number[] {
  const out: number[] = [];
  // Alinear el primer inicio a la rejilla.
  let start = Math.ceil(fromMin / step) * step;
  for (; start + spanMin <= toMin; start += step) out.push(start);
  return out;
}

// ¿Se solapan [aStart, aEnd) y [bStart, bEnd)? (semiabiertos).
export function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
