// residencia-2 · LA HORA DE PARED, en un paquete puro.
//
// ── Por qué esto es una COPIA, y de qué ───────────────────────────────
//
// El original es `apps/api/src/agenda/time.ts`, que B-reservas-4 escribió
// y del que la agenda es dueña. Este paquete **no puede importarlo**: un
// paquete de `packages/` no depende de una app, y hacerlo al revés
// —mover las primitivas aquí y que la agenda las importe— pondría a un
// paquete llamado `residencia-plan` como dueño del huso horario del motor
// de citas, que es una propiedad que no le toca.
//
// Así que se copian las cinco funciones que `queToca` necesita, sin tocar
// una línea del original, y se fija el acuerdo con tests en los dos días
// del cambio de hora. Es el mismo criterio con el que residencia-1
// duplicó `turnoDe` en la tablet (§7 de su done): dos copias de cinco
// líneas, las dos testeadas, en vez de una dependencia que invierte la
// propiedad.
//
// Lo que sí NO se duplica: `turnoDe`. Ésa vive aquí (`turnos.ts`) y
// `apps/api/src/residencia/turnos.ts` la re-exporta — una copia menos, no
// una más.
//
// ── Y por qué no se usa una librería de husos ─────────────────────────
//
// `Intl.DateTimeFormat` con `timeZone` ya conoce las reglas DST de
// `Europe/Madrid` (CET/CEST) y viene en el runtime. Una dependencia de
// zonas horarias sería 400 kB que hay que mantener al día con el BOE
// europeo para contestar lo que el motor ya contesta.

/** El huso del centro. Todos los centros de hoy están en España. */
export const CENTER_TZ = "Europe/Madrid";

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

/**
 * `fecha(YYYY-MM-DD)` + `hora de pared (HH:MM)` en `tz` → instante UTC.
 *
 * El refinamiento de una pasada es lo que lo hace correcto en el borde del
 * cambio de hora: la conjetura usa el offset del instante equivocado, y si
 * el del resultado difiere se recomputa. Sin él, el 25 de octubre a las
 * 02:30 saldría desplazado una hora.
 *
 * Y la consecuencia que importa para el plan: la hora de pared que NO
 * EXISTE (el 29 de marzo a las 02:30, cuando el reloj salta de 01:59 a
 * 03:00) resuelve al instante siguiente real y no a `Invalid Date`. Un
 * cambio postural de las 02:30 de esa madrugada se pide, no desaparece.
 */
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
  const off2 = tzOffsetMs(tz, new Date(result));
  if (off2 !== off) result = guess - off2;
  return new Date(result);
}

/** Instante UTC → fecha de pared «YYYY-MM-DD» en `tz`. */
export function utcToWallDate(date: Date, tz: string = CENTER_TZ): string {
  const parts = offsetFormatter(tz).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

/** Instante UTC → hora de pared «HH:MM» en `tz`. */
export function utcToWallTime(date: Date, tz: string = CENTER_TZ): string {
  const parts = offsetFormatter(tz).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const hh = map.hour === "24" ? "00" : map.hour;
  return `${hh}:${map.minute}`;
}

/** «HH:MM» → minutos desde medianoche. */
export function timeToMinutes(timeStr: string): number {
  const [hh, mm] = timeStr.split(":").map(Number);
  return hh! * 60 + mm!;
}

/** Minutos desde medianoche → «HH:MM». */
export function minutesToTime(min: number): string {
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * El día de la semana ISO (1 = lunes … 7 = domingo) de la fecha de pared
 * `YYYY-MM-DD`.
 *
 * Se calcula sobre la FECHA y no sobre el instante: «los lunes» es una
 * propiedad del día del calendario del centro, y preguntárselo a un
 * instante UTC haría que los domingos a medianoche la gimnasia cayera en
 * sábado media España del año.
 */
export function isoWeekday(dateStr: string): number {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, mo! - 1, d!)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/**
 * La fecha de pared `YYYY-MM-DD` desplazada `dias` días de calendario.
 *
 * Aritmética de CALENDARIO y no de milisegundos: sumar 86.400.000 ms al
 * instante del 25 de octubre da las 23:00 del 25, no el 26. El plan razona
 * en días del centro, no en duraciones.
 */
export function addDays(dateStr: string, dias: number): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y!, mo! - 1, d! + dias));
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Días de calendario entre dos fechas de pared (`b − a`). */
export function daysBetween(a: string, b: string): number {
  const [ay, amo, ad] = a.split("-").map(Number);
  const [by, bmo, bd] = b.split("-").map(Number);
  const ta = Date.UTC(ay!, amo! - 1, ad!);
  const tb = Date.UTC(by!, bmo! - 1, bd!);
  return Math.round((tb - ta) / 86_400_000);
}
