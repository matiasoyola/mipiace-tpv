// historia-1 (D-92, D-93) · **LAS AUSENCIAS PAUSAN, Y LOS DÍAS SE
// CUENTAN.**
//
// Dos preguntas que hoy sólo saben contestar las personas:
//
//   1. **«¿Está doña Carmen en el centro ahora mismo?»** — de ella
//      dependen `queToca` (y por tanto «lo que no se hizo», el parte y el
//      denominador de todos los indicadores), la pantalla de la puerta y
//      el parte de relevo.
//   2. **«¿Cuántos días de octubre estuvo aquí, cuántos en el hospital y
//      cuántos con su hija?»** — es exactamente el dato que hoy alguien
//      teclea a mano en `meses/AAAA-MM.json` para facturar las plazas
//      concertadas de la JCCM (`05-plazas-facturacion.md`).
//
// ── POR QUÉ LA REGLA VIVE DENTRO DE `queToca` Y NO AL LADO ──────────
//
// Porque la alternativa es una segunda lista de «residentes que no
// cuentan» que cada consulta nueva tiene que acordarse de pedir. Ya hay
// una —el `fuera` de `loQueNoSeHizo`, que es para quien no tiene cama— y
// dos listas con dos criterios es la forma de que un indicador nuevo use
// la que no toca y cuente veintiocho cuidados «no hechos» de alguien que
// estaba ingresado.
//
// Con la regla dentro de `queToca`, un residente ausente **no produce
// ocurrencias**, y todo lo que se construye sobre ellas lo hereda solo:
// el parte, el panel, los indicadores de AENOR y los que calidad-1 añada
// mientras este bloque se escribe.
//
// ── Y POR QUÉ EL PARÁMETRO ES OBLIGATORIO ──────────────────────────
//
// `queToca` ya tenía seis parámetros y añadir el séptimo **sin valor por
// defecto** es deliberado: un `ausencias = []` opcional habría dejado que
// una llamada nueva —la de calidad-1, la de medicación— se olvidara de
// pasarlas y volviera en silencio al comportamiento de ayer. Con el
// parámetro obligatorio, el compilador obliga a cada sitio a contestar
// «¿qué ausencias?», y la respuesta `[]` es legítima (la pantalla del
// plan de un residente que mira el futuro) pero está ESCRITA.

import { addDays, daysBetween, CENTER_TZ, utcToWallDate, wallTimeToUtc } from "./tiempo.js";

/** Los cinco tipos de ausencia (D-92). */
export type TipoDeAusencia =
  | "INGRESO_HOSPITALARIO"
  | "URGENCIAS"
  | "VACACIONES_FAMILIA"
  | "CONSULTA_EXTERNA"
  | "SALIDA_NO_CONTROLADA";

/**
 * Una ausencia, en lo que al plan y a los días les importa.
 *
 * `hasta` NULL = **sigue fuera**. Y sigue fuera aunque `expected_end_at`
 * ya haya pasado: lo esperado es informativo y lo que manda es que nadie
 * ha cerrado la ausencia. Dar por vuelto a quien no ha vuelto empezaría a
 * generarle cuidados que nadie puede hacer y a contarlo como presente en
 * la factura, que son las dos formas de equivocarse aquí.
 */
export interface AusenciaDelPlan {
  clientId: string;
  tipo: TipoDeAusencia;
  /** Cuándo se fue. */
  desde: Date;
  /** Cuándo volvió. `null` = sigue fuera. */
  hasta: Date | null;
}

/**
 * ¿Está este residente fuera en este instante?
 *
 * El intervalo es **`[desde, hasta)`** —semiabierto, como los turnos y
 * como la ventana de `queToca`— y por lo mismo: el instante exacto de la
 * vuelta ya es «dentro», así que el cuidado de las 18:00 de quien volvió
 * a las 18:00 se le pide.
 */
export function estaAusente(
  ausencias: AusenciaDelPlan[],
  clientId: string,
  instante: Date,
): boolean {
  const t = instante.getTime();
  for (const a of ausencias) {
    if (a.clientId !== clientId) continue;
    if (t < a.desde.getTime()) continue;
    if (a.hasta != null && t >= a.hasta.getTime()) continue;
    return true;
  }
  return false;
}

/** La ausencia que cubre este instante, o `null`. La necesita el parte,
 *  que tiene que decir de qué clase es y desde cuándo. */
export function ausenciaEn(
  ausencias: AusenciaDelPlan[],
  clientId: string,
  instante: Date,
): AusenciaDelPlan | null {
  const t = instante.getTime();
  // La más RECIENTE de las que cubren el instante. Con una sola viva por
  // residente (índice parcial `resident_absences_una_viva_key`) no puede
  // haber dos abiertas, pero sí una cerrada y otra abierta que se toquen
  // en el borde, y entonces la que manda es la que empezó después.
  let mejor: AusenciaDelPlan | null = null;
  for (const a of ausencias) {
    if (a.clientId !== clientId) continue;
    if (t < a.desde.getTime()) continue;
    if (a.hasta != null && t >= a.hasta.getTime()) continue;
    if (mejor == null || a.desde.getTime() > mejor.desde.getTime()) mejor = a;
  }
  return mejor;
}

/** Cómo se lee cada tipo en el parte, en la puerta y en el admin. Vive
 *  aquí y no en tres fronts por lo mismo que `NOMBRE_DE_LA_CLASE` del
 *  relevo: tres copias se separan a la tercera. */
export const NOMBRE_DE_LA_AUSENCIA: Record<TipoDeAusencia, string> = {
  INGRESO_HOSPITALARIO: "ingresado en el hospital",
  URGENCIAS: "en urgencias",
  VACACIONES_FAMILIA: "de salida con la familia",
  CONSULTA_EXTERNA: "en una consulta externa",
  SALIDA_NO_CONTROLADA: "salida no controlada",
};

/**
 * **DE DÓNDE VOLVIÓ**, que es otra frase y no la misma al revés.
 *
 * El panel de la DUE dice «Isabel · volvió **del hospital**, pendiente de
 * revisar». Con `NOMBRE_DE_LA_AUSENCIA` saldría «volvió de ingresado en
 * el hospital», que es el participio de la otra frase pegado con una
 * preposición — y en una lista que alguien lee cuarenta veces al mes eso
 * se nota.
 *
 * Tres diccionarios y no uno, por lo mismo que las dos texturas de la
 * dieta: cada frase concuerda con lo que la rodea, y una sola forma leería
 * mal en dos de las tres pantallas.
 */
export const DE_DONDE_VOLVIO: Record<TipoDeAusencia, string> = {
  INGRESO_HOSPITALARIO: "del hospital",
  URGENCIAS: "de urgencias",
  VACACIONES_FAMILIA: "de su salida con la familia",
  CONSULTA_EXTERNA: "de la consulta",
  SALIDA_NO_CONTROLADA: "de una salida no controlada",
};

/** Y la versión corta, la que cabe en la tarjeta de la puerta. */
export const NOMBRE_CORTO_DE_LA_AUSENCIA: Record<TipoDeAusencia, string> = {
  INGRESO_HOSPITALARIO: "En el hospital",
  URGENCIAS: "En urgencias",
  VACACIONES_FAMILIA: "Con la familia",
  CONSULTA_EXTERNA: "En consulta",
  SALIDA_NO_CONTROLADA: "No localizado",
};

/**
 * **«Ausente: en el hospital desde el martes».**
 *
 * La frase del parte de relevo y de la puerta, armada aquí y no en el
 * front por lo mismo que los dos diccionarios de arriba.
 *
 * El día de la semana y no la fecha, y es a propósito: en un relevo lo
 * que sitúa a alguien es «desde el martes», no «desde el 20/10». La
 * fecha sale cuando hace más de una semana, porque «desde el martes»
 * de hace tres semanas es engañoso.
 */
export function fraseDeLaAusencia(
  ausencia: AusenciaDelPlan,
  ahora: Date,
  tz: string = CENTER_TZ,
): string {
  const diaDeLaAusencia = utcToWallDate(ausencia.desde, tz);
  const hoy = utcToWallDate(ahora, tz);
  const dias = daysBetween(diaDeLaAusencia, hoy);
  const nombre = NOMBRE_DE_LA_AUSENCIA[ausencia.tipo];
  if (dias === 0) return `Ausente: ${nombre} desde hoy`;
  if (dias === 1) return `Ausente: ${nombre} desde ayer`;
  if (dias > 1 && dias <= 6) {
    return `Ausente: ${nombre} desde el ${DIA_DE_LA_SEMANA[diaDeLaSemana(diaDeLaAusencia)]}`;
  }
  // Más de una semana (o una fecha futura, que no debería pasar y se
  // enseña igual en vez de callarse): la fecha.
  return `Ausente: ${nombre} desde el ${diaYMes(diaDeLaAusencia)}`;
}

const DIA_DE_LA_SEMANA = [
  "",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
];

function diaDeLaSemana(fecha: string): number {
  const [y, mo, d] = fecha.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, mo! - 1, d!)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

const MESES = [
  "",
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function diaYMes(fecha: string): string {
  const dia = Number(fecha.slice(8, 10));
  const mes = Number(fecha.slice(5, 7));
  return `${dia} de ${MESES[mes]}`;
}

// ════════════════════════════════════════════════════════════════════
//  LOS DÍAS DEL MES (D-93)
// ════════════════════════════════════════════════════════════════════
//
// Lo que hoy se teclea a mano para facturar las concertadas. Tres
// números y un total, por residente y mes.
//
// ── LA REGLA DE LOS DÍAS FRONTERA ES DATO, NO CÓDIGO ───────────────
//
// El día que un residente sale y el día que vuelve: ¿los cobra el centro
// o no? Eso **es normativa de cada comunidad autónoma**, no una decisión
// de producto, y acertarla a ojo es facturar mal veinte plazas todos los
// meses.
//
// De serie, esta función **cuenta dónde PERNOCTA el residente**, que es
// la regla de la hostelería y la más común en los conciertos: un día es
// del centro si el residente durmió en el centro esa noche. Sus dos
// consecuencias, dichas:
//
//   · **el día del ingreso CUENTA** (durmió aquí);
//   · **el día del alta NO cuenta** (ya no durmió aquí).
//
// Queda escrito como duda abierta en el `-done` para contrastarlo con la
// Junta antes de facturacion-1. Lo que esta función no hace es
// configurarlo: cuando se sepa la regla de la JCCM, entrará como un
// parámetro del centro (`CenterAdmissionSetting` es el sitio) y esta
// firma ganará un argumento. Inventarse el parámetro hoy, sin saber qué
// valores puede tomar, sería escribir una opción que nadie puede elegir.
//
// ── Y CÓMO SE MIDE «PERNOCTA» ──────────────────────────────────────
//
// Al instante **00:00 de la hora de pared del día SIGUIENTE**: a esa
// hora, o estaba en su cama o no. Es la medida menos ambigua que existe
// —no depende de los turnos del centro ni de a qué hora la auxiliar
// apaga la luz— y es la que usa cualquier concierto cuando dice «noche».
//
// La alternativa era partir el día en horas y contar fracciones. Se
// descartó: la Junta no paga medias noches.

/** El residente, en lo que a los días le importa. Fechas de PARED. */
export interface ResidenteParaLosDias {
  clientId: string;
  /** «YYYY-MM-DD». */
  ingreso: string;
  /** «YYYY-MM-DD», o `null` si sigue viviendo aquí. */
  alta: string | null;
}

/** Los días de un mes, repartidos. */
export interface DiasDelMes {
  /** El mes, «YYYY-MM». */
  mes: string;
  clientId: string;
  /** Noches que durmió **en el centro**. */
  ordinarios: number;
  /** Noches que durmió **en el hospital** (ingreso o urgencias). */
  hospital: number;
  /** Noches que durmió **fuera con la familia**. */
  vacaciones: number;
  /**
   * Noches fuera que **no son ninguna de las dos**: una consulta externa
   * que se alargó y una salida no controlada.
   *
   * Existe como cuarto número y no repartido entre los otros dos porque
   * meter en «vacaciones» una noche en que nadie encontró al residente
   * sería ponerla en la factura de la Junta como una salida con la
   * familia. Son pocas y normalmente cero, y cuando no lo son hay algo
   * que mirar — que es justo lo que un número aparte consigue.
   */
  otros: number;
  /**
   * El total de noches que el residente **tenía plaza** en el mes:
   * `ordinarios + hospital + vacaciones + otros`.
   *
   * Es el denominador de la estancia y lo que la facturación compara con
   * los días del mes.
   */
  presencia: number;
}

/**
 * **Los días de un mes de un residente** (D-93).
 *
 * `mes` es «YYYY-MM». Pura: ni base de datos ni reloj, así que la tabla
 * de casos de oro —mes completo, ingreso a mitad, ausencia que cruza de
 * mes, alta a mitad, dos ausencias en el mismo mes y año bisiesto— es una
 * tabla y no una maqueta.
 *
 * Las ausencias que entran pueden ser **todas las del residente**: esta
 * función recorta sola lo que cae en el mes. Pedirle al llamante que las
 * filtre sería pedirle que resuelva el caso de la ausencia que cruza de
 * mes, que es exactamente el que se equivoca.
 */
export function diasDelMes(
  residente: ResidenteParaLosDias,
  ausencias: AusenciaDelPlan[],
  mes: string,
  tz: string = CENTER_TZ,
): DiasDelMes {
  const anio = Number(mes.slice(0, 4));
  const numeroDeMes = Number(mes.slice(5, 7));
  const cuantos = cuantosDiasTieneElMes(anio, numeroDeMes);

  const mias = ausencias.filter((a) => a.clientId === residente.clientId);

  const fuera: DiasDelMes = {
    mes,
    clientId: residente.clientId,
    ordinarios: 0,
    hospital: 0,
    vacaciones: 0,
    otros: 0,
    presencia: 0,
  };

  for (let dia = 1; dia <= cuantos; dia += 1) {
    const fecha = `${mes}-${String(dia).padStart(2, "0")}`;

    // ── ¿Tenía plaza esa noche? ────────────────────────────────────
    //
    // La noche del día `fecha` se mide a las 00:00 del día siguiente
    // (ver la cabecera). La estancia va de `ingreso` (incluido, durmió
    // la noche del ingreso) a `alta` (excluido: la noche del alta ya no
    // durmió aquí).
    if (fecha < residente.ingreso) continue;
    if (residente.alta != null && fecha >= residente.alta) continue;
    fuera.presencia += 1;

    const pernocta = wallTimeToUtc(addDays(fecha, 1), "00:00", tz);
    const ausencia = ausenciaEn(mias, residente.clientId, pernocta);
    if (ausencia == null) {
      fuera.ordinarios += 1;
      continue;
    }
    switch (ausencia.tipo) {
      case "INGRESO_HOSPITALARIO":
      case "URGENCIAS":
        fuera.hospital += 1;
        break;
      case "VACACIONES_FAMILIA":
        fuera.vacaciones += 1;
        break;
      case "CONSULTA_EXTERNA":
      case "SALIDA_NO_CONTROLADA":
        fuera.otros += 1;
        break;
    }
  }

  return fuera;
}

/**
 * Cuántos días tiene un mes. `mes` 1–12.
 *
 * Se llamaba `diasDelMes` hasta historia-1, y se renombró porque el
 * nombre lo necesitaba la función de arriba —que es la que la facturación
 * va a llamar— y «cuántos días tiene este mes» no es «los días del mes de
 * este residente». Vive aquí y no en `obligaciones.ts` porque ahora la
 * usan las dos.
 */
export function cuantosDiasTieneElMes(anio: number, mes: number): number {
  // El día 0 del mes siguiente es el último del mes pedido, y `Date.UTC`
  // lo resuelve sin tabla de bisiestos ni `%4`.
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * El resumen del CENTRO: los cuatro números sumados de todos los
 * residentes.
 *
 * Es la segunda mitad de la pantalla de D-93 («por residente y por mes, y
 * un resumen del centro»), y se suma aquí y no en SQL porque la regla de
 * los días frontera está en esta página: un `SUM()` en Postgres sería una
 * segunda implementación de la misma regla, y el día que la Junta diga
 * cuál es la buena habría que cambiar las dos.
 */
export function diasDelMesDelCentro(
  residentes: ResidenteParaLosDias[],
  ausencias: AusenciaDelPlan[],
  mes: string,
  tz: string = CENTER_TZ,
): {
  mes: string;
  residentes: DiasDelMes[];
  total: Omit<DiasDelMes, "mes" | "clientId">;
} {
  const porResidente = residentes
    .map((r) => diasDelMes(r, ausencias, mes, tz))
    // Por residente, y en un orden estable que no dependa del de la
    // base: la pantalla pinta esto y un orden que cambia entre dos
    // refrescos hace imposible comparar dos capturas.
    .sort((a, b) => a.clientId.localeCompare(b.clientId));
  const total = porResidente.reduce(
    (acc, d) => ({
      ordinarios: acc.ordinarios + d.ordinarios,
      hospital: acc.hospital + d.hospital,
      vacaciones: acc.vacaciones + d.vacaciones,
      otros: acc.otros + d.otros,
      presencia: acc.presencia + d.presencia,
    }),
    { ordinarios: 0, hospital: 0, vacaciones: 0, otros: 0, presencia: 0 },
  );
  return { mes, residentes: porResidente, total };
}
