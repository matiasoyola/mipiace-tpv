// residencia-5 (decisión de producto 4, residencia-3 §14.8) · **«NO
// HECHO» SE CALCULA, NO SE ESCRIBE.**
//
// residencia-3 lo dejó dicho en su decisión 8: *«"No hecho" no se apunta.
// Es la ausencia de registro; quien lo deriva es [otro bloque]. Con las
// dos fuentes, el indicador de cumplimiento tendría que decidir cuál
// manda.»* Éste es ese bloque, y aquí está la función.
//
// Una línea del plan que tocaba en una franja ya cerrada y no tiene
// registro es «no hecha». Es un CRUCE entre `queToca` y `CareRecord`,
// nunca una fila que alguien apunta.
//
// ── LO QUE ESTO COMPRA, Y NO ES TEÓRICO ─────────────────────────────
//
// 1. **Un registro tardío lo DESHACE.** La puerta de la 112 sin red sube
//    a las 15:20 el cambio postural de las 14:50; a partir de ese
//    momento, cualquier cálculo que se haga dice que se hizo. Con una
//    fila «no hecho» escrita a las 15:00 habría que ir a borrarla, y
//    borrar una fila de incumplimiento es exactamente lo que una
//    auditoría no puede permitir que se pueda hacer.
// 2. **Se puede preguntar por ayer.** «¿Qué no se hizo el 3 de marzo?» es
//    la misma llamada con otra ventana.
// 3. **El parte congelado y la verdad de ahora pueden discrepar, y las
//    dos son verdad.** En el parte de la mañana la línea dice «no se
//    hizo»; debajo, el añadido tardío dice que llegó a las 15:20. Eso es
//    la evidencia de lo que se supo en el relevo MÁS la de lo que pasó
//    de verdad, y hacen falta las dos.
//
// ── PURA, como todo este paquete ────────────────────────────────────
//
// Sin base de datos y sin reloj: el corte entra por parámetro. La tablet
// de la sala y el servidor ejecutan ESTA función, así que el parte que se
// ve sin red y el que queda congelado no se pueden contradecir.

import type { Ocurrencia } from "./que-toca.js";

/**
 * Un registro que existe, en lo que a esta función le importa.
 *
 * `occurrenceAt` es **a qué momento del plan responde** (residencia-3
 * §1): el instante que devolvió `queToca` en lo que «toca», y **NULL en
 * la observación diaria**, que se pregunta una vez por residente y turno
 * y no por ocurrencia. De ahí salen los dos modos de emparejar de
 * `cubre()`, y no es una concesión: es cómo está escrito el histórico.
 */
export interface RegistroHecho {
  clientId: string;
  controlCode: string;
  /** El día del CENTRO, «YYYY-MM-DD». */
  careDay: string;
  /** El turno al que se adscribió, o `null` (hueco en el cuadrante). */
  shiftCode: string | null;
  /** A qué momento del plan responde. `null` en la observación diaria. */
  occurrenceAt: Date | null;
  /** Cuándo se registró, según la tablet. */
  recordedAt: Date;
  /** Anulado (residencia-3 §1). Un registro anulado **no cuenta como
   *  hecho**: anularlo es decir que aquello no fue. */
  voidedAt: Date | null;
}

/**
 * Lo que hace falta saber de un control para decidir si puede ser «no
 * hecho».
 *
 * Son dos cosas y las dos vienen del catálogo (D-11), no de un `if`:
 *
 *   · la **capa**, porque `OBS` guarda `occurrenceAt` NULL;
 *   · la **naturaleza**, porque lo `ON_DEMAND` **nunca** es «no hecho»:
 *     el botón «+ Deposición» no cuelga de ninguna agenda, así que no
 *     hay nada que incumplir. `queToca` ya devuelve `[]` para ello, y
 *     esto se comprueba igual porque una función que depende de que la
 *     otra no se equivoque es una función que falla en silencio.
 */
export interface ControlParaNoHecho {
  code: string;
  layer: string;
  nature: string;
}

/** Una ocurrencia que tocaba y no se hizo. */
export interface NoHecho {
  clientId: string;
  controlCode: string;
  planItemId: string;
  /** Cuándo tocaba (el instante, o el inicio de la franja). */
  at: Date;
  /** Cuándo acabó la franja. `null` en las de instante. */
  until: Date | null;
  esFranja: boolean;
  shiftCode: string | null;
  /** El día del centro al que pertenecía. */
  dia: string;
}

/** Los parámetros de `loQueNoSeHizo`, con nombre: son cinco y dos son
 *  conjuntos, así que posicionales se confunden. */
export interface EntradaDeNoHecho {
  ocurrencias: Ocurrencia[];
  registros: RegistroHecho[];
  controles: ControlParaNoHecho[];
  /**
   * **EL CORTE.** Sólo cuenta lo que ya está cerrado a este instante:
   *
   *   · una FRANJA está cerrada cuando `until <= corte`. Una franja de
   *     mañana sigue abierta a las 11:00, y decir a las 11:00 que la
   *     hidratación cutánea «no se ha hecho» es decirle a la auxiliar que
   *     ha incumplido algo que tiene cuatro horas para hacer (la razón
   *     por la que `queToca` distingue franja de instante: residencia-2);
   *   · un INSTANTE está cerrado cuando `at < corte`.
   *
   * Quien llama elige el corte y con eso elige la pregunta: el final del
   * turno para el parte de relevo, el inicio del turno en curso para el
   * panel («lo no hecho de turnos cerrados hoy»).
   */
  corte: Date;
  /**
   * Residentes que **no cuentan**: dados de baja, ingresados en el
   * hospital, de permiso con la familia.
   *
   * Y no es una comodidad: una residente que se fue al hospital el martes
   * tiene plan vigente —nadie lo cierra por un ingreso de tres días— y
   * sin esto saldrían veintiocho cuidados «no hechos» de alguien que no
   * estaba en el centro. El plan se cierra al alta, no al ingreso
   * hospitalario.
   */
  fuera?: Set<string>;
}

/**
 * Las ocurrencias que tocaban, ya cerradas, y no tienen registro.
 *
 * Ordenadas por instante y, a igual instante, por residente y control:
 * el mismo orden que `queToca`, porque el parte las pinta seguidas.
 */
export function loQueNoSeHizo(entrada: EntradaDeNoHecho): NoHecho[] {
  const { ocurrencias, registros, controles, corte } = entrada;
  const fuera = entrada.fuera ?? new Set<string>();

  const porCodigo = new Map(controles.map((c) => [c.code, c]));

  // Los registros vivos, indexados por las dos claves con las que se
  // puede emparejar. Un `find` por ocurrencia sería cuadrático, y el
  // parte de un turno de 49 plazas cruza ~1.500 ocurrencias contra
  // ~1.200 registros.
  const porOcurrencia = new Set<string>();
  const porTurno = new Set<string>();
  for (const r of registros) {
    if (r.voidedAt != null) continue;
    if (r.occurrenceAt != null) {
      porOcurrencia.add(`${r.clientId}|${r.controlCode}|${r.occurrenceAt.getTime()}`);
    } else {
      porTurno.add(`${r.clientId}|${r.controlCode}|${r.careDay}|${r.shiftCode ?? ""}`);
    }
  }

  const fueraDePlazo: NoHecho[] = [];
  for (const oc of ocurrencias) {
    if (fuera.has(oc.clientId)) continue;

    const control = porCodigo.get(oc.controlCode);
    // Un control que no está en el catálogo que nos han pasado no se
    // juzga. Es el caso de una línea de plan de un control que el centro
    // retiró: la línea sigue viva y `queToca` la devuelve, pero decidir
    // que se incumplió un control que ya no existe es inventarse un
    // incumplimiento. Sale en la pantalla del plan en ámbar
    // (residencia-2), que es donde se arregla.
    if (control == null) continue;
    // **Lo `ON_DEMAND` nunca es «no hecho».**
    if (control.nature === "ON_DEMAND") continue;

    if (!estaCerrada(oc, corte)) continue;

    const claveDeOcurrencia = `${oc.clientId}|${oc.controlCode}|${oc.at.getTime()}`;
    if (porOcurrencia.has(claveDeOcurrencia)) continue;
    // La observación diaria: una por residente y turno, con
    // `occurrenceAt` NULL. Emparejar por instante aquí marcaría como «no
    // hecha» una observación que SÍ está registrada, que es el peor
    // error posible de esta función — llenar el parte de incumplimientos
    // falsos es la forma de que nadie lo lea.
    if (control.layer === "OBS") {
      const claveDeTurno = `${oc.clientId}|${oc.controlCode}|${oc.dia}|${oc.shiftCode ?? ""}`;
      if (porTurno.has(claveDeTurno)) continue;
    }

    fueraDePlazo.push({
      clientId: oc.clientId,
      controlCode: oc.controlCode,
      planItemId: oc.planItemId,
      at: oc.at,
      until: oc.until,
      esFranja: oc.esFranja,
      shiftCode: oc.shiftCode,
      dia: oc.dia,
    });
  }

  fueraDePlazo.sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      a.clientId.localeCompare(b.clientId) ||
      a.controlCode.localeCompare(b.controlCode),
  );
  return fueraDePlazo;
}

/**
 * ¿Ha pasado ya el plazo de esta ocurrencia?
 *
 * Una franja se cierra cuando acaba; un instante, en cuanto pasa. La
 * franja sin `until` —que `queToca` no produce, pero el tipo admite— se
 * trata como instante: es el lado conservador, porque el otro sería no
 * contarla nunca.
 */
function estaCerrada(oc: Ocurrencia, corte: Date): boolean {
  if (oc.esFranja && oc.until != null) return oc.until.getTime() <= corte.getTime();
  return oc.at.getTime() < corte.getTime();
}

/**
 * Cuánto del plan va hecho, por residente. Es la cuarta fila del panel
 * («el turno en curso: cuánto del plan va hecho por planta»).
 *
 * Aquí el corte NO es el del «no hecho»: se cuenta sobre **todo lo que
 * toca en la ventana**, cerrado o no, porque la pregunta es «¿cuánto
 * llevamos?» y no «¿qué se ha incumplido?». A mitad de la mañana la
 * respuesta correcta es «18 de 40», no «cero incumplimientos».
 */
export function cuantoVaHecho(entrada: {
  ocurrencias: Ocurrencia[];
  registros: RegistroHecho[];
  controles: ControlParaNoHecho[];
  fuera?: Set<string>;
}): { tocan: number; hechas: number } {
  const noHechas = loQueNoSeHizo({
    ...entrada,
    // Un corte en el infinito: todo cuenta como cerrado, así que lo que
    // sale son las que no tienen registro, cerradas o no.
    corte: new Date(8_640_000_000_000_000),
  });
  const fuera = entrada.fuera ?? new Set<string>();
  const porCodigo = new Map(entrada.controles.map((c) => [c.code, c]));
  const tocan = entrada.ocurrencias.filter((o) => {
    if (fuera.has(o.clientId)) return false;
    const c = porCodigo.get(o.controlCode);
    return c != null && c.nature !== "ON_DEMAND";
  }).length;
  return { tocan, hechas: tocan - noHechas.length };
}
