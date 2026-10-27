// F1 · el tiempo del control horario (ADR-018).
//
// Todo se guarda en UTC (`timestamptz`) y se pinta y se exporta en hora
// local. La conversión NO se reimplementa: se reutiliza `agenda/time.ts`,
// que ya conoce las reglas DST de Europe/Madrid vía `Intl.DateTimeFormat`
// y que resolvió el borde del cambio de hora con un refinamiento de una
// pasada (B-reservas-4).
//
// EL TOTAL SE CALCULA SOBRE LOS INSTANTES UTC, NUNCA RESTANDO HORAS DE
// PARED. El 25-10-2026 a las 03:00 CEST el reloj vuelve a las 02:00 CET:
// un tramo de 22:00 a 06:00 de esa noche dura NUEVE horas, no ocho, y
// restar "06:00 − 22:00" daría ocho. Quien trabaja esa noche cobra la
// hora de más, y el registro que se le enseña a la Inspección tiene que
// decirlo.

import {
  MARGEN_DE_TURNO_POR_DEFECTO,
  limiteDeSalidaOlvidada,
} from "@mipiacetpv/cuadrante";

import {
  CENTER_TZ,
  utcToWallDate,
  utcToWallTime,
  wallTimeToUtc,
} from "../agenda/time.js";

export const FICHAJE_TZ = CENTER_TZ;

/** Instante UTC → día local "YYYY-MM-DD". Es como se agrupa el registro. */
export function localDate(d: Date): string {
  return utcToWallDate(d, FICHAJE_TZ);
}

/** Instante UTC → hora local "HH:MM". Es como se pinta y se exporta. */
export function localTime(d: Date): string {
  return utcToWallTime(d, FICHAJE_TZ);
}

/** Día local + hora de pared → instante UTC. */
export function localToUtc(dateStr: string, timeStr: string): Date {
  return wallTimeToUtc(dateStr, timeStr, FICHAJE_TZ);
}

/**
 * Minutos trabajados en un tramo. Sobre los instantes, que es lo único
 * que sobrevive al cambio de hora (ver la cabecera).
 */
export function minutesWorked(startedAt: Date, endedAt: Date): number {
  return Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000);
}

/** "8h 07m" — como se lee un total de jornada. Nunca "8.12 h". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** "Martes, 22 de septiembre" — como se lee un día en el PDF que se firma. */
export function diaLargo(fecha: string, tz: string = FICHAJE_TZ): string {
  // Anclado a mediodía UTC: ningún huso lo mueve de día al formatearlo.
  const d = new Date(`${fecha}T12:00:00Z`);
  const s = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: tz,
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Septiembre de 2026". */
export function mesLargo(month: string): string {
  const d = new Date(`${month}-15T12:00:00Z`);
  const s = new Intl.DateTimeFormat("es-ES", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Primer instante UTC del mes local "YYYY-MM", y el primero del siguiente. */
export function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  const from = localToUtc(`${month}-01`, "00:00");
  const nextY = m === 12 ? y! + 1 : y!;
  const nextM = m === 12 ? 1 : m! + 1;
  const to = localToUtc(
    `${nextY}-${String(nextM).padStart(2, "0")}-01`,
    "00:00",
  );
  return { from, to };
}

/**
 * La hora que se le PROPONE a quien olvidó fichar la salida: la mediana
 * de sus salidas de los últimos 30 días, como hora de pared.
 *
 * Mediana y no media: una noche que se fue a las 23:00 no debe arrastrar
 * la propuesta de los otros veintinueve días. Con un número par de
 * salidas se toma la inferior — proponer de menos es más honesto que
 * proponer de más cuando se está rellenando un registro de jornada.
 *
 * Sin historial no se propone nada. Inventarse una hora con una muestra
 * de cero sería exactamente lo que este bloque NO hace.
 */
export function medianExitWallTime(exits: Date[]): string | null {
  if (exits.length === 0) return null;
  const minutes = exits
    .map((d) => {
      const [hh, mm] = localTime(d).split(":").map(Number);
      return hh! * 60 + mm!;
    })
    .sort((a, b) => a - b);
  const mid = minutes[Math.floor((minutes.length - 1) / 2)]!;
  const h = Math.floor(mid / 60);
  const m = mid % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * La propuesta completa, ya como instante: la mediana aplicada al día
 * local en que empezó el tramo abierto.
 *
 * `null` cuando no hay historial, y también cuando la propuesta caería
 * ANTES de la entrada (alguien que entró a las 22:00 y cuya mediana de
 * salida son las 17:30). Ahí no hay nada sensato que proponer y se
 * pregunta a secas: el selector, sin hora puesta.
 */
export function suggestedExitAt(startedAt: Date, exits: Date[]): Date | null {
  const wall = medianExitWallTime(exits);
  if (!wall) return null;
  const candidate = localToUtc(localDate(startedAt), wall);
  if (candidate.getTime() <= startedAt.getTime()) return null;
  return candidate;
}

// ── la salida olvidada ────────────────────────────────────────────────
//
// hotfix-fichaje-medianoche · EL ÚNICO SITIO QUE DECIDE si un tramo
// abierto es una salida olvidada. Lo usan las tres superficies: el cierre
// (`POST /entries/:id/close`), la pantalla del empleado (`GET /me`) y el
// panel de la empresa (`GET /admin/fichaje/today`). Comparar `localDate`
// para esto en cualquier otro sitio es el bug que este hotfix arregla.
//
// Lo decide la DURACIÓN, no el calendario. El criterio de antes —«el día
// local de la entrada no es el de ahora»— dejaba sin poder fichar la
// salida a quien entra a las 20:00 y sale a la 01:00: se le trataba como
// un olvido de ayer y tenía que corregirlo con motivo. En una residencia
// eso es cada turno de noche (22:00-08:00); en un bar, cada cierre pasada
// la medianoche.
//
// Y se mide sobre los INSTANTES, como todo en este fichero: un tramo que
// cruza el cambio de hora dura lo que dura, no lo que digan los relojes.

/** Horas que puede llevar abierto un tramo antes de ser una salida
 *  olvidada, cuando el tenant no dice otra cosa. Ver `Tenant.fichajeMaxOpenHours`. */
export const MAX_OPEN_HOURS_DEFAULT = 16;

/** El rango que acepta la columna. Mismo que el CHECK de la base
 *  (`tenants_fichaje_max_open_hours_check`) y que el schema de la ruta del
 *  super-admin: si los tres no coinciden, gana la base y nadie sabe por qué. */
export const MAX_OPEN_HOURS_MIN = 8;
export const MAX_OPEN_HOURS_MAX = 24;

/** Un entero fuera de rango —o lo que llegue de una fila vieja— se trata
 *  como el default. Nunca se recorta al borde: un 0 silenciosamente
 *  convertido en 8 es peor que un 0 silenciosamente convertido en 16. */
export function normalizeMaxOpenHours(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MAX_OPEN_HOURS_DEFAULT;
  }
  if (value < MAX_OPEN_HOURS_MIN || value > MAX_OPEN_HOURS_MAX) {
    return MAX_OPEN_HOURS_DEFAULT;
  }
  return value;
}

export interface OpenEntry {
  startedAt: Date;
  endedAt?: Date | null;
}

// ── personal-1 · Y AHORA TAMBIÉN EL TURNO PLANIFICADO ────────────────
//
// #45 dejó esto decidido por DURACIÓN, con el máximo del tenant. Lo que
// personal-1 añade es que, **cuando la persona tiene turno en el
// cuadrante**, el límite sea además «el fin de su turno más un margen».
//
// El caso: la auxiliar de noche sale a las 08:00. Si a las 13:00 sigue
// «dentro», con el máximo a secas nadie se enteraba hasta las 14:00. Con
// el turno, a las 12:00.
//
// **SE AMPLÍA ESTA MISMA FUNCIÓN, no se añade un segundo criterio en otra
// ruta.** Es la lección entera de #45: el bug que aquel hotfix arregló
// existía porque tres superficies comparaban `localDate` cada una por su
// cuenta. Las tres siguen llamando aquí, y el cuarto argumento es
// opcional: sin cuadrante, el comportamiento es **exactamente** el de
// hoy — ni una rama nueva se ejecuta.
//
// Por qué el límite es el MENOR de los dos y no el del turno, por qué un
// fin de turno anterior a la entrada se ignora, y por qué el turno aprieta
// y nunca afloja: está argumentado en la cabecera de `fichado.ts` del
// paquete, que es donde vive el cálculo. Aquí se decide; allí se calcula.

/** El turno planificado de ese día, si lo hay. */
export interface TurnoPlanificado {
  /** Cuándo acaba el turno que le tocaba, como instante. */
  finAt: Date;
  /** El margen del tenant (`Tenant.fichajeShiftMarginHours`). */
  margenHoras: number;
}

/**
 * ¿Este tramo es una salida OLVIDADA?
 *
 * `true` sólo cuando sigue abierto Y ha pasado su límite. El límite exacto
 * NO es olvido: con 16 h de máximo, un tramo de 16 h clavadas todavía se
 * cierra con un toque; a los 16 h y un minuto, se pregunta.
 *
 * Un tramo ya cerrado nunca es una salida olvidada, aunque durara treinta
 * horas: eso es una jornada larga, y ya tiene su hora de salida.
 *
 * **Con `planificado`**, el límite es el menor de los dos: el máximo del
 * tenant y el fin del turno más el margen. **Sin él**, exactamente lo de
 * #45.
 */
export function esSalidaOlvidada(
  entry: OpenEntry,
  now: Date,
  maxHoras: number = MAX_OPEN_HOURS_DEFAULT,
  planificado: TurnoPlanificado | null = null,
): boolean {
  if (entry.endedAt != null) return false;
  const limite = limiteDeSalidaOlvidada({
    entradaAt: entry.startedAt,
    maxHoras: normalizeMaxOpenHours(maxHoras),
    finPlanificadoAt: planificado?.finAt ?? null,
    margenHoras: planificado?.margenHoras ?? MARGEN_DE_TURNO_POR_DEFECTO,
  });
  return now.getTime() > limite.getTime();
}

/** El instante del límite, para que el panel pueda decir «a las 12:00». */
export function limiteDelTramo(
  entry: OpenEntry,
  maxHoras: number = MAX_OPEN_HOURS_DEFAULT,
  planificado: TurnoPlanificado | null = null,
): Date {
  return limiteDeSalidaOlvidada({
    entradaAt: entry.startedAt,
    maxHoras: normalizeMaxOpenHours(maxHoras),
    finPlanificadoAt: planificado?.finAt ?? null,
    margenHoras: planificado?.margenHoras ?? MARGEN_DE_TURNO_POR_DEFECTO,
  });
}
