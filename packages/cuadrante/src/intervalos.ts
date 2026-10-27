// personal-1 · DE UNA CELDA A UN TRAMO DE TIEMPO DE VERDAD.
//
// Una celda dice «Ana, el 24, turno N». Eso no se puede comparar con un
// descanso de 12 horas ni sumar a una jornada semanal hasta que se sabe
// **cuándo empieza y cuándo acaba de verdad**, y eso depende de dos cosas
// que este fichero es el único que sabe:
//
//   1. **La noche cruza medianoche.** El turno N de 22:00 a 08:00 del día
//      24 acaba el 25 a las 08:00. Sin esto, una noche duraría −14 horas.
//      Se decide con `cruzaMedianoche` del paquete del plan, que es la
//      misma función que usa la puerta de la residencia: no se copia.
//
//   2. **LA HORA ES DE PARED, Y LA PARED ESTÁ EN ESPAÑA.** El turno
//      empieza «a las diez de la noche» y eso no cambia el día del cambio
//      de hora. Pero LO QUE DURA sí: la noche del 24 al 25-10-2026, que es
//      cuando el reloj vuelve de las 03:00 a las 02:00, un turno de 22:00
//      a 08:00 dura ONCE horas, no diez. Quien la trabaja cobra la hora de
//      más y el cuadrante tiene que contarla.
//
//      Por eso el intervalo son INSTANTES (`wallTimeToUtc`) y no minutos
//      de pared. Restar «08:00 − 22:00 + 24 h» daría diez horas clavadas
//      todo el año, y sería exactamente el bug que `time.ts` del fichaje
//      documenta en su cabecera para los totales del registro.
//
// El criterio de qué día es un tramo es **el mismo que el del registro de
// jornada**: el día en que EMPIEZA (`toEntryView`, «el día del registro es
// el de la entrada»). Si el cuadrante lo contara de otra forma, planificado
// y fichado no se podrían comparar — que es la mitad del bloque.

import {
  CENTER_TZ,
  addDays,
  cruzaMedianoche,
  daysBetween,
  timeToMinutes,
  wallTimeToUtc,
} from "@mipiacetpv/residencia-plan";

import type {
  Cuadrante,
  IntervaloPlanificado,
  TurnoDelCuadrante,
} from "./tipos.js";

export const CUADRANTE_TZ = CENTER_TZ;

// ── La memoria de `wallTimeToUtc`, y por qué hace falta ──────────────
//
// `wallTimeToUtc` pregunta el desplazamiento del huso con
// `Intl.DateTimeFormat`, dos veces por llamada (la conjetura y el
// refinamiento del borde del cambio de hora). Un mes de Jardín de Gredos
// son 651 celdas × 2 instantes = **1 302 llamadas**, y medido salían 22 ms
// de los 24 que tardaba `comprobarCuadrante` entero. Para una pantalla que
// recalcula en cada toque, eso es el presupuesto completo gastado en
// convertir las mismas horas una y otra vez.
//
// Y son LAS MISMAS: en un mes hay 31 días y un puñado de horas de pared
// distintas, o sea unas doscientas combinaciones para 1 302 llamadas.
//
// Memoizar es seguro porque la función es pura y las reglas del huso no
// cambian en caliente: la misma fecha y la misma hora de pared dan siempre
// el mismo instante. La clave lleva el huso dentro para que un día que
// haya `Tenant.timeZone` no se mezclen dos.
//
// El tope evita que un proceso largo —el servidor, que vive semanas— se
// quede con un mapa de todas las horas de todos los meses que le hayan
// pedido. Al llegar se tira entero y se vuelve a llenar: es una caché, no
// un índice.
const TOPE_DE_LA_MEMORIA = 20_000;
const memoria = new Map<string, number>();

function instanteDePared(dia: string, hora: string, tz: string): Date {
  const clave = `${tz}|${dia}|${hora}`;
  const visto = memoria.get(clave);
  if (visto !== undefined) return new Date(visto);
  const d = wallTimeToUtc(dia, hora, tz);
  if (memoria.size >= TOPE_DE_LA_MEMORIA) memoria.clear();
  memoria.set(clave, d.getTime());
  return d;
}

/** Vacía la memoria. Sólo para los tests que miden. */
export function olvidarInstantes(): void {
  memoria.clear();
}

/**
 * El intervalo real de un turno en un día.
 *
 * Nada de `null`: un turno con `startsAt === endsAt` no existe (lo rechaza
 * la ruta, porque no se sabría si dura cero horas o veinticuatro), y aquí
 * se trataría como de 24 h — que es lo que un turno que cruza medianoche y
 * vuelve a su hora significaría.
 */
export function intervaloDeTurno(
  dia: string,
  turno: Pick<TurnoDelCuadrante, "startsAt" | "endsAt">,
  tz: string = CUADRANTE_TZ,
): { inicioAt: Date; finAt: Date } {
  const inicioAt = instanteDePared(dia, turno.startsAt, tz);
  const diaFin = cruzaMedianoche(turno) ? addDays(dia, 1) : dia;
  const finAt = instanteDePared(diaFin, turno.endsAt, tz);
  return { inicioAt, finAt };
}

/** Minutos REALES que dura ese turno ese día. 660 la noche del cambio. */
export function minutosDeTurno(
  dia: string,
  turno: Pick<TurnoDelCuadrante, "startsAt" | "endsAt">,
  tz: string = CUADRANTE_TZ,
): number {
  const { inicioAt, finAt } = intervaloDeTurno(dia, turno, tz);
  return Math.round((finAt.getTime() - inicioAt.getTime()) / 60_000);
}

/**
 * Todos los intervalos planificados del cuadrante, ordenados por persona
 * y por inicio.
 *
 * Las celdas de **ausencia no producen intervalo**: una ausencia es un día
 * sin tramo, y es así como las dos reglas de descanso la ven (el hueco que
 * deja es el descanso). Que no sume horas lo dice
 * `AUSENCIAS_QUE_NO_SUMAN_HORAS`.
 *
 * Y una celda que apunta a un turno **que no está en la lista** se ignora
 * en silencio. No es un caso que pueda pasar —la FK es `RESTRICT`— y
 * reventar aquí dejaría la pantalla del cuadrante en blanco por un dato
 * que la base ya garantiza.
 */
export function intervalosDe(
  cuadrante: Cuadrante,
  tz: string = CUADRANTE_TZ,
): IntervaloPlanificado[] {
  const porId = new Map(cuadrante.turnos.map((t) => [t.id, t]));
  const fuera: IntervaloPlanificado[] = [];
  for (const celda of cuadrante.celdas) {
    if (celda.turnoId == null) continue;
    const turno = porId.get(celda.turnoId);
    if (!turno) continue;
    const { inicioAt, finAt } = intervaloDeTurno(celda.dia, turno, tz);
    fuera.push({
      employeeId: celda.employeeId,
      dia: celda.dia,
      turnoId: turno.id,
      code: turno.code,
      inicioAt,
      finAt,
    });
  }
  return fuera.sort(
    (a, b) =>
      a.employeeId.localeCompare(b.employeeId) ||
      a.inicioAt.getTime() - b.inicioAt.getTime(),
  );
}

/** Los intervalos agrupados por persona, cada grupo ya ordenado. */
export function porPersona(
  intervalos: IntervaloPlanificado[],
): Map<string, IntervaloPlanificado[]> {
  const mapa = new Map<string, IntervaloPlanificado[]>();
  for (const i of intervalos) {
    const l = mapa.get(i.employeeId);
    if (l) l.push(i);
    else mapa.set(i.employeeId, [i]);
  }
  return mapa;
}

// ── El calendario del mes ─────────────────────────────────────────────

/** Cuántos días tiene «YYYY-MM». El 29 de febrero incluido. */
export function diasDelMes(mes: string): number {
  const [y, m] = mes.split("-").map(Number);
  // El día 0 del mes siguiente es el último del mes. Y en UTC, para que
  // ningún huso lo mueva de mes.
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** Los días de «YYYY-MM» como «YYYY-MM-DD», en orden. */
export function diasDe(mes: string): string[] {
  const n = diasDelMes(mes);
  const fuera: string[] = [];
  for (let d = 1; d <= n; d += 1) {
    fuera.push(`${mes}-${String(d).padStart(2, "0")}`);
  }
  return fuera;
}

/** El primer instante del mes y el primero del mes siguiente. */
export function rangoDelMes(
  mes: string,
  tz: string = CUADRANTE_TZ,
): { desdeAt: Date; hastaAt: Date } {
  const dias = diasDe(mes);
  return {
    desdeAt: instanteDePared(dias[0]!, "00:00", tz),
    hastaAt: instanteDePared(addDays(dias[dias.length - 1]!, 1), "00:00", tz),
  };
}

/** Un bloque de días consecutivos, con sus dos instantes. */
export interface BloqueDeDias {
  /** Su primer día, para el mensaje del aviso. */
  desde: string;
  /** Y su último. */
  hasta: string;
  desdeAt: Date;
  hastaAt: Date;
  dias: string[];
}

/**
 * El mes partido en bloques de `n` días **desde el día 1**.
 *
 * Desde el día 1 y no desde el lunes ISO, y es una decisión: el art. 37.1
 * del ET habla de «períodos de hasta catorce días», no de semanas de
 * calendario, y anclar en el lunes obligaría a mirar un bloque que empieza
 * en el mes anterior —cuyo cuadrante es otro documento, publicado
 * aparte— para poder decir algo del día 1.
 *
 * **El último bloque incompleto se descarta.** Un bloque de tres días no
 * puede exigir treinta y seis horas de descanso, y el descanso de esos
 * tres días cae dentro del mes siguiente. Si se contara, todos los meses
 * acabarían en rojo.
 */
export function bloquesDe(
  mes: string,
  n: number,
  tz: string = CUADRANTE_TZ,
): BloqueDeDias[] {
  const dias = diasDe(mes);
  const fuera: BloqueDeDias[] = [];
  for (let i = 0; i + n <= dias.length; i += n) {
    const trozo = dias.slice(i, i + n);
    fuera.push({
      desde: trozo[0]!,
      hasta: trozo[trozo.length - 1]!,
      desdeAt: instanteDePared(trozo[0]!, "00:00", tz),
      hastaAt: instanteDePared(addDays(trozo[trozo.length - 1]!, 1), "00:00", tz),
      dias: trozo,
    });
  }
  return fuera;
}

// ── Utilidades que el resto de los ficheros comparten ────────────────

/** `true` si los dos intervalos se PISAN. Tocarse no es pisarse. */
export function sePisan(
  a: { inicioAt: Date; finAt: Date },
  b: { inicioAt: Date; finAt: Date },
): boolean {
  return (
    a.inicioAt.getTime() < b.finAt.getTime() &&
    b.inicioAt.getTime() < a.finAt.getTime()
  );
}

/** Horas con un decimal, como se leen en un aviso. «7,5 h», no «7.5». */
export function horas(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}

/** Y los minutos a horas con un decimal, para las frases de jornada. */
export function horasDeMinutos(min: number): number {
  return Math.round((min / 60) * 10) / 10;
}

/** «7,5» — el separador decimal de aquí. */
export function cifra(n: number): string {
  return String(Math.round(n * 10) / 10).replace(".", ",");
}

export { addDays, daysBetween, timeToMinutes };
