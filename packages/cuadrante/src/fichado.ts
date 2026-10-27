// personal-1 (puntos 8 y 9) · **PLANIFICADO FRENTE A FICHADO.**
//
// Es lo que hace que el registro de jornada deje de registrar y empiece a
// informar, y es el punto 1 de `fichaje-1-done.md` §10 («sin jornada
// teórica, "quién no ha fichado hoy" significa "no ha aparecido", no
// "falta al trabajo"»).
//
// Dos cosas viven aquí, y las dos son puras:
//
//   1. **`limiteDeSalidaOlvidada`** — cuándo un tramo abierto pasa a ser
//      una salida olvidada, ahora que puede haber turno planificado. Lo
//      usa `esSalidaOlvidada` de `apps/api/src/fichaje/time.ts`, que sigue
//      siendo **el único sitio que decide**: aquí no se decide nada, se
//      calcula el instante del límite.
//
//   2. **`planificadoVsFichado`** — quién tenía turno y no ha fichado,
//      quién ha fichado sin turno y quién sigue dentro pasada su hora. Y
//      el cuadre del mes por persona.
//
// ── POR QUÉ EL LÍMITE ES EL MENOR DE LOS DOS ────────────────────────
//
// #45 dejó el criterio en «lleva abierto más que el máximo del tenant» (16
// h de serie). personal-1 añade el turno: «ha pasado el fin de su turno
// más un margen» (4 h de serie).
//
// Y el límite que manda es **el menor**, no el del turno. Es decir: el
// turno APRIETA, nunca AFLOJA. Las dos razones:
//
//   · lo que el bloque compra es enterarse ANTES. La auxiliar de noche
//     sale a las 08:00; con el máximo a secas no se sabría nada hasta las
//     14:00. Con el turno, a las 12:00;
//   · y al revés sería una puerta. Un turno mal puesto —una mañana de
//     08:00 a 15:00 en la celda de quien entró a las 23:00 del día
//     anterior— daría un límite anterior a la propia entrada, o un límite
//     de veintiocho horas. Tomando el menor, lo peor que un turno
//     equivocado puede hacer es preguntar antes de la cuenta, y eso se
//     contesta de un toque.
//
// Por eso, además, el fin del turno **se ignora si cae antes de la
// entrada**: ahí no aprieta, delira.
//
// ── Y LO QUE NO CAMBIA ──────────────────────────────────────────────
//
// Todo lo demás de ADR-018 y de #45: inalterable por trigger, correcciones
// con motivo, la propuesta de hora por mediana, el tramo pertenece al día
// en que empezó. Los tramos que YA se registraron como olvido siguen
// siendo lo que son; esto no reescribe historia, sólo decide qué se
// pregunta de aquí en adelante.

import { intervaloDeTurno } from "./intervalos.js";
import type { IntervaloPlanificado, TurnoDelCuadrante } from "./tipos.js";

/** El margen de serie sobre el fin del turno, en horas. Ver el modelo
 *  `Tenant.fichajeShiftMarginHours` y su CHECK (1–12). */
export const MARGEN_DE_TURNO_POR_DEFECTO = 4;

export interface EntradaParaElLimite {
  /** Cuándo entró. */
  entradaAt: Date;
  /** Las horas que puede llevar abierto sin turno. `fichajeMaxOpenHours`. */
  maxHoras: number;
  /**
   * El fin del turno que tenía planificado ese día, o `null` si no tenía
   * cuadrante — el colegio, quien no esté en el cuadrante del mes, el mes
   * que todavía está en borrador.
   */
  finPlanificadoAt: Date | null;
  /** El margen del tenant. */
  margenHoras: number;
}

/**
 * **El instante a partir del cual un tramo abierto es una salida
 * olvidada.** Estrictamente a partir de: el límite exacto NO es olvido,
 * igual que en #45 (con 16 h de máximo, un tramo de 16 h clavadas se
 * cierra con un toque).
 */
export function limiteDeSalidaOlvidada(e: EntradaParaElLimite): Date {
  const porDuracion = e.entradaAt.getTime() + e.maxHoras * 3_600_000;
  if (e.finPlanificadoAt == null) return new Date(porDuracion);
  const porTurno = e.finPlanificadoAt.getTime() + e.margenHoras * 3_600_000;
  // El fin del turno que cae ANTES de la entrada no aprieta: delira.
  if (e.finPlanificadoAt.getTime() <= e.entradaAt.getTime()) {
    return new Date(porDuracion);
  }
  return new Date(Math.min(porDuracion, porTurno));
}

/**
 * El fin del turno que le toca a un tramo que empezó ese día.
 *
 * Con un turno partido hay dos candidatos, y se coge **el que acaba más
 * tarde** de los que acaban después de la entrada. Es la elección
 * prudente: con el que acaba antes, quien entra a las 08:00 de una jornada
 * partida de 08–12 y 17–21 tendría su límite a las 16:00 y se le
 * preguntaría a media tarde, estando dentro.
 *
 * `null` si ese día no tenía nada planificado, o si todo lo planificado
 * acaba antes de que entrara.
 */
export function finDelTurnoDelDia(
  planificado: Array<Pick<IntervaloPlanificado, "finAt">>,
  entradaAt: Date,
): Date | null {
  let mejor: Date | null = null;
  for (const i of planificado) {
    if (i.finAt.getTime() <= entradaAt.getTime()) continue;
    if (mejor == null || i.finAt.getTime() > mejor.getTime()) mejor = i.finAt;
  }
  return mejor;
}

// ── Planificado frente a fichado ──────────────────────────────────────

/** Un tramo fichado, lo mínimo que hace falta. */
export interface TramoFichado {
  entryId: string;
  employeeId: string;
  inicioAt: Date;
  /** `null` = sigue dentro. */
  finAt: Date | null;
  /** El día local de la ENTRADA, que es el día al que el tramo pertenece. */
  dia: string;
}

export interface SinFichar {
  employeeId: string;
  dia: string;
  turnoId: string;
  code: string;
  /** Cuándo tenía que haber entrado. */
  inicioAt: Date;
  /** Cuántos minutos lleva de retraso, a la hora de la consulta. */
  minutosDeRetraso: number;
}

export interface FichadoSinTurno {
  entryId: string;
  employeeId: string;
  dia: string;
  inicioAt: Date;
}

export interface DentroPasadaSuHora {
  entryId: string;
  employeeId: string;
  dia: string;
  inicioAt: Date;
  turnoId: string;
  code: string;
  /** Cuándo tenía que haber salido. */
  finPlanificadoAt: Date;
  /** Cuánto lleva de más, en horas con un decimal. */
  horasDeMas: number;
}

export interface PlanificadoVsFichadoDeHoy {
  sinFichar: SinFichar[];
  sinTurno: FichadoSinTurno[];
  dentroPasadaSuHora: DentroPasadaSuHora[];
}

/**
 * Las tres preguntas de «Hoy» que hasta ahora no se podían contestar.
 *
 *   · **quién tenía turno y no ha fichado** pasada la tolerancia (15 min
 *     de serie). Antes de la tolerancia no se dice nada: alguien que entra
 *     cinco minutos tarde no es una ausencia, y un aviso que sale cada
 *     mañana a las 08:01 y se apaga a las 08:06 es un aviso que se aprende
 *     a ignorar.
 *   · **quién ha fichado sin turno**. No es necesariamente un error —se
 *     cubre una baja, se viene a echar una mano— pero es lo que después no
 *     cuadra en la nómina si nadie lo apunta.
 *   · **quién sigue dentro pasada su hora**, con el mismo margen del
 *     tenant que decide la salida olvidada. Sale ANTES de las 16 h, que es
 *     lo que este bloque compra.
 *
 * Y no toca el reloj: `ahora` entra por parámetro, como todo lo puro de
 * esta casa.
 */
export function planificadoVsFichado(input: {
  ahora: Date;
  /** Lo planificado de los días que se miran. */
  planificado: IntervaloPlanificado[];
  /** Lo fichado de esos mismos días. */
  fichado: TramoFichado[];
  /** Los días que se miran. En «Hoy» es uno. */
  dias: string[];
  toleranciaMinutos: number;
  margenHoras: number;
}): PlanificadoVsFichadoDeHoy {
  const { ahora, toleranciaMinutos, margenHoras } = input;
  const dias = new Set(input.dias);
  const planificado = input.planificado.filter((i) => dias.has(i.dia));
  const fichado = input.fichado.filter((t) => dias.has(t.dia));

  // Quién ha fichado algo cada día. Un turno partido no pide dos fichajes:
  // lo que se pregunta es si esa persona apareció.
  const fichoEseDia = new Set(fichado.map((t) => `${t.employeeId}|${t.dia}`));

  const sinFichar: SinFichar[] = [];
  const yaAvisado = new Set<string>();
  for (const i of planificado) {
    if (fichoEseDia.has(`${i.employeeId}|${i.dia}`)) continue;
    const limite = i.inicioAt.getTime() + toleranciaMinutos * 60_000;
    if (ahora.getTime() <= limite) continue;
    // Un turno partido no son dos ausencias: una por persona y día.
    const clave = `${i.employeeId}|${i.dia}`;
    if (yaAvisado.has(clave)) continue;
    yaAvisado.add(clave);
    sinFichar.push({
      employeeId: i.employeeId,
      dia: i.dia,
      turnoId: i.turnoId,
      code: i.code,
      inicioAt: i.inicioAt,
      minutosDeRetraso: Math.round(
        (ahora.getTime() - i.inicioAt.getTime()) / 60_000,
      ),
    });
  }

  const teniaTurno = new Set(planificado.map((i) => `${i.employeeId}|${i.dia}`));
  const sinTurno: FichadoSinTurno[] = fichado
    .filter((t) => !teniaTurno.has(`${t.employeeId}|${t.dia}`))
    .map((t) => ({
      entryId: t.entryId,
      employeeId: t.employeeId,
      dia: t.dia,
      inicioAt: t.inicioAt,
    }));

  const dentroPasadaSuHora: DentroPasadaSuHora[] = [];
  for (const t of fichado) {
    if (t.finAt != null) continue;
    const suyos = planificado.filter(
      (i) => i.employeeId === t.employeeId && i.dia === t.dia,
    );
    const fin = finDelTurnoDelDia(suyos, t.inicioAt);
    if (fin == null) continue;
    const limite = fin.getTime() + margenHoras * 3_600_000;
    if (ahora.getTime() <= limite) continue;
    const cual = suyos.find((i) => i.finAt.getTime() === fin.getTime())!;
    dentroPasadaSuHora.push({
      entryId: t.entryId,
      employeeId: t.employeeId,
      dia: t.dia,
      inicioAt: t.inicioAt,
      turnoId: cual.turnoId,
      code: cual.code,
      finPlanificadoAt: fin,
      horasDeMas:
        Math.round(((ahora.getTime() - fin.getTime()) / 3_600_000) * 10) / 10,
    });
  }

  return { sinFichar, sinTurno, dentroPasadaSuHora };
}

// ── El cuadre del mes ─────────────────────────────────────────────────

export interface CuadreDelMes {
  employeeId: string;
  /** Minutos que el cuadrante le puso. */
  minutosPlanificados: number;
  /** Minutos que fichó. Los tramos abiertos **no se cuentan**. */
  minutosFichados: number;
  /** Fichado − planificado. Negativo = fichó menos de lo previsto. */
  diferencia: number;
  /** Si tiene algún tramo abierto, porque entonces la cifra está a medias. */
  conTramoAbierto: boolean;
}

/**
 * Horas planificadas, horas fichadas y diferencia, por persona y mes.
 *
 * **Los tramos abiertos no se cuentan y se dice que hay.** Es la misma
 * decisión que `toEntryView` tomó con los minutos de un tramo en curso
 * (`null`, no cero): un total que incluyera un tramo abierto estaría
 * inventando la hora de salida, que es exactamente lo que ADR-018 §5 se
 * niega a hacer. Y uno que lo ignorara en silencio dejaría a alguien con
 * ocho horas de menos sin explicación.
 *
 * Los minutos fichados se cuentan sobre los INSTANTES, como todo el
 * registro: la noche del cambio de hora dura lo que duró.
 */
export function cuadreDelMes(input: {
  employeeIds: string[];
  planificado: IntervaloPlanificado[];
  fichado: TramoFichado[];
}): CuadreDelMes[] {
  const plan = new Map<string, number>();
  for (const i of input.planificado) {
    plan.set(
      i.employeeId,
      (plan.get(i.employeeId) ?? 0) +
        Math.round((i.finAt.getTime() - i.inicioAt.getTime()) / 60_000),
    );
  }
  const fich = new Map<string, number>();
  const abierto = new Set<string>();
  for (const t of input.fichado) {
    if (t.finAt == null) {
      abierto.add(t.employeeId);
      continue;
    }
    fich.set(
      t.employeeId,
      (fich.get(t.employeeId) ?? 0) +
        Math.round((t.finAt.getTime() - t.inicioAt.getTime()) / 60_000),
    );
  }
  return input.employeeIds.map((employeeId) => {
    const p = plan.get(employeeId) ?? 0;
    const f = fich.get(employeeId) ?? 0;
    return {
      employeeId,
      minutosPlanificados: p,
      minutosFichados: f,
      diferencia: f - p,
      conTramoAbierto: abierto.has(employeeId),
    };
  });
}

/**
 * Lo planificado de un día para una persona, ya como intervalos.
 *
 * Un atajo para las rutas del fichaje, que tienen las celdas de un día y
 * no un cuadrante entero: así `routes.ts` no tiene que armar un `Cuadrante`
 * de pega para saber a qué hora acaba el turno de quien está cerrando.
 */
export function planificadoDelDia(
  dia: string,
  celdas: Array<{ employeeId: string; turnoId: string | null }>,
  turnos: TurnoDelCuadrante[],
): IntervaloPlanificado[] {
  const porId = new Map(turnos.map((t) => [t.id, t]));
  const fuera: IntervaloPlanificado[] = [];
  for (const c of celdas) {
    if (c.turnoId == null) continue;
    const turno = porId.get(c.turnoId);
    if (!turno) continue;
    const { inicioAt, finAt } = intervaloDeTurno(dia, turno);
    fuera.push({
      employeeId: c.employeeId,
      dia,
      turnoId: turno.id,
      code: turno.code,
      inicioAt,
      finAt,
    });
  }
  return fuera;
}
