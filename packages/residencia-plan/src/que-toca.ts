// residencia-2 · `queToca`: EL CORAZÓN DEL BLOQUE.
//
// Dado el plan de unos residentes, los ajustes del centro, sus turnos y
// sus momentos del día, devuelve **qué le toca a quién y cuándo** en una
// ventana de tiempo. La pantalla de la puerta (residencia-3) sólo tendrá
// que llamarla; el panel de dirección (residencia-5) también, y la vista
// «hoy» de la ficha del residente la llama ya en este bloque — que es la
// prueba de que el plan está bien antes de que la puerta exista.
//
// ── PURA, y por qué eso no es un lujo ─────────────────────────────────
//
// Sin base de datos y sin reloj: todo entra por parámetro, incluida la
// ventana. Tres cosas que compra:
//
//   1. Los tests son una TABLA de verdad y no una maqueta de Prisma. La
//      noche que cruza medianoche, los dos cambios de hora y el residente
//      que ingresa a mitad del periodo son filas de esa tabla.
//   2. La tablet la podrá ejecutar SIN RED en residencia-3. Una función
//      que consultara la base no serviría allí, y la puerta tiene que
//      saber qué toca con el wifi caído — es la mitad del ADR-01.
//   3. Se puede llamar para AYER sin tocar nada. «¿Qué le tocaba a doña
//      Carmen el 3 de marzo?» es la misma llamada con otra ventana.
//
// ── Lo que NO hace, y es a propósito ──────────────────────────────────
//
// No mira si algo está HECHO. No conoce `CareRecord` —que no existe
// todavía— ni le hace falta: «qué toca» y «qué se hizo» son dos preguntas,
// y cruzarlas es de residencia-3. Esta función contesta la primera, y la
// contesta igual el día que la segunda exista.
//
// Tampoco genera incumplimientos ni eventos: eso es residencia-4.

import type { Frecuencia, MomentoDelCentro } from "./frecuencia.js";
import {
  CENTER_TZ,
  addDays,
  daysBetween,
  isoWeekday,
  minutesToTime,
  utcToWallDate,
  wallTimeToUtc,
} from "./tiempo.js";
import { cruzaMedianoche, turnoDe, type TurnoDelCentro } from "./turnos.js";

/**
 * Una línea del plan de un residente, con su frecuencia MATERIALIZADA.
 *
 * La frecuencia viene en la propia línea y no se busca en el ajuste del
 * centro: así una llamada para marzo contesta con el plan de marzo. Ver el
 * comentario de `care_plan_items` en el esquema.
 */
export interface LineaDePlan {
  id: string;
  clientId: string;
  controlCode: string;
  frecuencia: Frecuencia;
  /** Desde cuándo rige. */
  fromAt: Date;
  /** Hasta cuándo. `null` = viva. */
  toAt: Date | null;
}

/**
 * Lo que el centro decide de un control, en lo que a `queToca` le importa:
 * **si está activo**. El alias, la visibilidad y los roles son de la
 * pantalla; la frecuencia del centro es el valor por defecto con el que se
 * CREAN las líneas, no el que se aplica a las que ya existen.
 */
export interface AjusteDelCentro {
  controlCode: string;
  active: boolean;
}

/**
 * Una ocurrencia: «a esta persona le toca este control en este momento».
 *
 * Es un INSTANTE o una FRANJA, y la diferencia es real:
 *
 *   · Las frecuencias que cuelgan de un turno (`EVERY_SHIFT`, `DAILY`,
 *     `WEEKDAYS`, `EVERY_N_DAYS`, `MONTHLY`) son una FRANJA: «durante la
 *     mañana». Nadie pide la hidratación cutánea a las 08:00 en punto; se
 *     pide en algún momento del turno, y la auxiliar la hace cuando puede.
 *   · Las que cuelgan de un momento o de un reloj (`MOMENTS`,
 *     `EVERY_N_HOURS`) son un INSTANTE: la medicación del desayuno es a la
 *     hora del desayuno, y un cambio postural a las 02:00 es a las 02:00.
 *
 * Pintarlas igual sería decirle a la auxiliar que la hidratación cutánea
 * se ha incumplido a las 08:01.
 */
export interface Ocurrencia {
  clientId: string;
  controlCode: string;
  /** El id de la línea del plan que la produjo. */
  planItemId: string;
  /** Cuándo empieza (el instante, o el inicio de la franja). */
  at: Date;
  /** Cuándo acaba la franja. `null` en las ocurrencias de instante. */
  until: Date | null;
  /** `true` si es una franja de turno. */
  esFranja: boolean;
  /** El turno al que se adscribe, o `null` si los turnos no cubren la hora. */
  shiftCode: string | null;
  /** El momento del día, si la frecuencia es `MOMENTS`. */
  momentCode: string | null;
  /** El día de pared del centro al que pertenece, «YYYY-MM-DD». */
  dia: string;
}

/**
 * Las ocurrencias del plan en `[desde, hasta)`.
 *
 * `desde` incluido, `hasta` excluido — semiabierto, como los turnos y por
 * lo mismo: dos ventanas consecutivas no repiten la ocurrencia del borde.
 *
 * El resultado va ordenado por instante y, a igual instante, por residente
 * y control: la puerta y el parte de relevo lo pintan en ese orden y un
 * orden que dependiera del de la base cambiaría entre dos llamadas.
 */
export function queToca(
  plan: LineaDePlan[],
  ajustesCentro: AjusteDelCentro[],
  turnos: TurnoDelCentro[],
  momentos: MomentoDelCentro[],
  desde: Date,
  hasta: Date,
  tz: string = CENTER_TZ,
): Ocurrencia[] {
  // ── Los controles apagados por el centro no «tocan» ────────────────
  //
  // Y la ausencia de ajuste NO apaga nada: un control sin fila de ajuste
  // es un dato que falta, no una decisión del centro, y suprimir el
  // cuidado por un dato que falta es la clase de silencio que se descubre
  // en una auditoría. Si falta, la línea del plan manda — que es la que
  // alguien escribió a propósito.
  const apagados = new Set(
    ajustesCentro.filter((a) => !a.active).map((a) => a.controlCode),
  );
  const porCodigoDeTurno = new Map(turnos.map((t) => [t.code, t]));
  const porCodigoDeMomento = new Map(momentos.map((m) => [m.code, m]));

  // ── Por qué el barrido empieza un día ANTES ────────────────────────
  //
  // El turno de noche del día anterior llega hasta las 08:00 de hoy: una
  // ventana que empiece a las 02:00 tiene dentro una franja que arrancó
  // ayer a las 22:00. Si el barrido empezara en el primer día de la
  // ventana, la madrugada entera se quedaría sin lo que le toca — otra vez
  // el tramo en que la residencia está más sola.
  //
  // Y acaba un día DESPUÉS por el otro lado del mismo caso: una ventana
  // que acabe a las 23:00 no debe perder la franja de noche que empieza a
  // las 22:00 de ese día. El filtro final por `[desde, hasta)` descarta lo
  // que sobre, así que barrer de más es gratis y barrer de menos no se ve.
  const primerDia = addDays(utcToWallDate(desde, tz), -1);
  const ultimoDia = addDays(utcToWallDate(new Date(hasta.getTime() - 1), tz), 1);

  const fuera: Ocurrencia[] = [];

  for (let dia = primerDia; daysBetween(dia, ultimoDia) >= 0; dia = addDays(dia, 1)) {
    for (const linea of plan) {
      if (apagados.has(linea.controlCode)) continue;
      for (const oc of ocurrenciasDelDia(linea, dia, porCodigoDeTurno, porCodigoDeMomento, turnos, tz)) {
        // ── La vigencia se mide contra la ocurrencia, no contra el día ──
        //
        // Un residente que ingresa el martes a las 15:00 no tiene el turno
        // de mañana de ese martes: la línea nace a las 15:00 y la franja de
        // la mañana empezó a las 08:00. Comparar días en vez de instantes
        // le habría dado un cuidado que nadie podía hacerle porque no
        // estaba en el centro.
        if (oc.at < linea.fromAt) continue;
        if (linea.toAt !== null && oc.at >= linea.toAt) continue;
        if (oc.at < desde || oc.at >= hasta) continue;
        fuera.push(oc);
      }
    }
  }

  // ── El 29 de marzo, dos huecos del reloj caen en el MISMO instante ──
  //
  // Ese día el reloj salta de 01:59 a 03:00: las 02:00 de pared no
  // existen, y `wallTimeToUtc` las resuelve al instante real siguiente
  // —que es el mismo al que resuelven las 03:00—. Con un control cada hora
  // eso daría DOS ocurrencias en el mismo instante, o sea dos rondas
  // idénticas a las tres de la mañana en la pantalla de la puerta.
  //
  // Se quitan las repetidas, y el resultado es el correcto: un día de 23
  // horas tiene 23 rondas horarias. Ni 24 (una imposible) ni 22 (una
  // perdida).
  //
  // Va aquí y no en la generación porque la colisión sólo se ve comparando
  // instantes YA resueltos: en hora de pared las dos son distintas.
  const vistas = new Set<string>();
  const unicas = fuera.filter((o) => {
    const clave = `${o.planItemId}|${o.at.getTime()}|${o.shiftCode ?? ""}|${o.momentCode ?? ""}`;
    if (vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  });

  unicas.sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      a.clientId.localeCompare(b.clientId) ||
      a.controlCode.localeCompare(b.controlCode) ||
      (a.momentCode ?? "").localeCompare(b.momentCode ?? "") ||
      (a.shiftCode ?? "").localeCompare(b.shiftCode ?? ""),
  );
  return unicas;
}

/** Las ocurrencias que una línea produce en un día de pared concreto. */
function ocurrenciasDelDia(
  linea: LineaDePlan,
  dia: string,
  porCodigoDeTurno: Map<string, TurnoDelCentro>,
  porCodigoDeMomento: Map<string, MomentoDelCentro>,
  turnos: TurnoDelCentro[],
  tz: string,
): Ocurrencia[] {
  const f = linea.frecuencia;
  const base = {
    clientId: linea.clientId,
    controlCode: linea.controlCode,
    planItemId: linea.id,
    dia,
  };

  /** La franja de un turno en este día, como ocurrencia. */
  const franja = (shiftCode: string): Ocurrencia | null => {
    const turno = porCodigoDeTurno.get(shiftCode);
    // Un turno que el centro borró deja la línea sin agenda. No se
    // inventa otro: adscribir un cuidado a un turno equivocado es peor
    // que no pedirlo, y la pantalla del plan pinta la línea en ámbar.
    if (!turno) return null;
    const at = wallTimeToUtc(dia, turno.startsAt, tz);
    // La noche acaba al día SIGUIENTE. Sin esto, la franja de la noche
    // iría de las 22:00 a las 08:00 del mismo día, o sea hacia atrás, y
    // la pantalla pintaría una duración negativa.
    const diaFin = cruzaMedianoche(turno) ? addDays(dia, 1) : dia;
    return {
      ...base,
      at,
      until: wallTimeToUtc(diaFin, turno.endsAt, tz),
      esFranja: true,
      shiftCode: turno.code,
      momentCode: null,
    };
  };

  switch (f.kind) {
    // Nada «toca»: el botón está en la puerta y nadie lo echa en falta.
    case "ON_DEMAND":
      return [];

    case "EVERY_SHIFT":
    case "DAILY":
      return (f.shiftCodes ?? []).map(franja).filter((o): o is Ocurrencia => o !== null);

    case "MOMENTS":
      return (f.momentCodes ?? [])
        .map((code): Ocurrencia | null => {
          const momento = porCodigoDeMomento.get(code);
          // Un momento que el centro borró deja la línea sin agenda, igual
          // que un turno borrado y por lo mismo.
          if (!momento) return null;
          const at = wallTimeToUtc(dia, momento.atTime, tz);
          return {
            ...base,
            at,
            until: null,
            esFranja: false,
            // El turno lo decide la MISMA función que usa la puerta, y no
            // una tabla aparte: así «la medicación de la cena es del turno
            // de tarde» no puede contradecir al relevo.
            shiftCode: turnoDe(at, turnos, tz)?.code ?? null,
            momentCode: momento.code,
          };
        })
        .filter((o): o is Ocurrencia => o !== null);

    // ── `EVERY_N_HOURS`: anclado a MEDIANOCHE del día del centro ──────
    //
    // Cada 3 h son 00:00, 03:00, 06:00… y no «cada tres horas desde que
    // se le abrió la línea». La razón es de planta: una auxiliar de noche
    // lleva ocho residentes, y si cada uno tuviera su propio ancla
    // tendría dieciséis avisos a dieciséis horas distintas en vez de
    // ocho rondas. Ancladas a medianoche, la planta entera se gira a la
    // misma hora y el parte de relevo se lee de un golpe.
    //
    // Consecuencia dicha: si N no divide a 24 (un 5 o un 7, que el CHECK
    // admite) el último hueco del día es más corto. Se acepta porque la
    // pantalla sólo ofrece divisores (2, 3, 4, 6, 8, 12) y porque la
    // alternativa —arrastrar el desfase de un día a otro— haría que la
    // ronda de las 02:00 fuera a las 03:00 la semana que viene.
    case "EVERY_N_HOURS": {
      const n = f.everyNHours ?? 0;
      if (n < 1) return [];
      const fuera: Ocurrencia[] = [];
      for (let min = 0; min < 24 * 60; min += n * 60) {
        const at = wallTimeToUtc(dia, minutesToTime(min), tz);
        fuera.push({
          ...base,
          at,
          until: null,
          esFranja: false,
          shiftCode: turnoDe(at, turnos, tz)?.code ?? null,
          momentCode: null,
        });
      }
      return fuera;
    }

    case "WEEKDAYS": {
      if (!(f.weekdays ?? []).includes(isoWeekday(dia))) return [];
      const o = franja((f.shiftCodes ?? [])[0] ?? "");
      return o ? [o] : [];
    }

    // ── `EVERY_N_DAYS`: anclado al INICIO DE LA LÍNEA ─────────────────
    //
    // Al revés que `EVERY_N_HOURS`, y a propósito: «una analítica cada
    // seis meses» se cuenta desde la última, que es desde que se abrió la
    // línea. Anclarlo a una fecha del calendario haría que a un residente
    // que ingresa en marzo se le pidiera la analítica en abril porque «es
    // cuando le toca al centro».
    case "EVERY_N_DAYS": {
      const n = f.everyNDays ?? 0;
      if (n < 1) return [];
      const ancla = utcToWallDate(linea.fromAt, tz);
      const d = daysBetween(ancla, dia);
      if (d < 0 || d % n !== 0) return [];
      const o = franja((f.shiftCodes ?? [])[0] ?? "");
      return o ? [o] : [];
    }

    case "MONTHLY": {
      const diaDelMes = Number(dia.slice(8, 10));
      if (diaDelMes !== f.monthDay) return [];
      const o = franja((f.shiftCodes ?? [])[0] ?? "");
      return o ? [o] : [];
    }
  }
}
