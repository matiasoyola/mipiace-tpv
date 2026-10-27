// agenda-1 · LAS MEJORES HORAS, ORDENADAS POR CÓMO LLENAN LA AGENDA.
//
// Matías, 27-10, con la agenda abierta en la tablet: «dar cita es súper
// tedioso… en el spa lo hemos optimizado mejor… tenemos que reducirlo a la
// mínima expresión». Medido ese día: ~10 toques por «Nueva cita», 5 tocando
// la rejilla. Y de esos toques, los que más cuestan no son los del teclado:
// son los de ELEGIR. «Buscar hueco» devolvía veinticuatro chips de hora
// iguales, en orden de reloj, y la recepción leía la lista entera con la
// paciente delante para acabar cogiendo el primero.
//
// Este módulo es la respuesta: de todos los huecos que el motor dice que
// caben, cuáles son los TRES que conviene ofrecer, y por qué. El orden no
// es el del reloj: es el de lo que le hace bien a la agenda.
//
// ── Por qué vive aquí y no en el panel ───────────────────────────────
//
// Porque es la única parte de «Dar cita» que se puede equivocar en
// silencio. Un panel que pinta un chip de más se ve; un orden que pone
// delante la hora que parte la mañana en dos trozos inservibles no se ve
// nunca — simplemente la agenda se llena peor, mes a mes. Así que es una
// función pura, con sus propios tests y SIN AGENDA REAL: entra una lista
// de candidatos y la forma del día, sale una lista ordenada.
//
// No habla con la API, no sabe de React y no sabe de servicios: los
// candidatos los produce el motor (`POST /agenda/availability`, que es
// quien manda sobre si un hueco existe) y aquí sólo se ORDENAN. Si este
// módulo y el motor no están de acuerdo, manda el motor: la peor cosa que
// puede hacer `proponer` es dejar una hora buena en cuarto lugar.
//
// ── La regla de orden, escrita ───────────────────────────────────────
//
// 1. MENOS MINUTOS MUERTOS primero. Un minuto muerto es un trozo de hueco
//    libre que queda demasiado corto para que entre nada (por debajo de
//    `minimoUtilMin`). Dar una cita a las 11:30 en un hueco de 11:00 a
//    12:00 con una visita de 20 minutos deja 30 minutos antes (útiles) y
//    10 después (muertos). A las 11:00 deja 40 seguidos: cero muertos.
// 2. A igualdad de muertos, LA QUE SE PEGA a lo que ya hay. Deja el rato
//    libre de una pieza, que es lo que se puede vender después.
// 3. A igualdad, LA FECHA PROPUESTA por la sanitaria. Es la única parte de
//    este orden que viene de una decisión clínica y no de geometría.
// 4. A igualdad, la más PRONTO: primero el día, después la hora. No por
//    nada, sino porque un orden tiene que ser estable — dos listas iguales
//    no pueden salir distintas.
//
// ── Lo del spa que queda preparado y sin pantalla ────────────────────
//
// El embudo del spa ofrece además «sube el ticket» (un servicio de más) y
// el cheque regalo. En clínica no se ofrece nada de eso: ni cabinas, ni
// «relajarse», ni €/h, ni frases de venta. Pero el embudo es LA MISMA capa
// para los tres centros, así que lo que cambia va en configuración del
// centro y no en una rama por vertical: `ConfigDelCentro` los enciende y
// `Propuesta.extras` los devuelve. Nada de este bloque los pinta — es un
// hueco con nombre, no una media pantalla.

/** Un tramo de minutos de pared desde medianoche. `hasta` es exclusivo. */
export interface Tramo {
  desdeMin: number;
  hastaMin: number;
}

/** La forma de un día: cuándo se puede reservar y qué está pillado. */
export interface DiaDeLaPropuesta {
  /** "YYYY-MM-DD". */
  fecha: string;
  /** Turno ∩ horario del centro de quien va a atender. `[]` = cerrado. */
  abiertos: Tramo[];
  /** Citas y ausencias: todo lo que no se puede pisar. */
  ocupados: Tramo[];
}

/** Un inicio que el motor ya ha dicho que cabe. */
export interface Candidato {
  fecha: string;
  inicioMin: number;
}

/**
 * Lo que el centro quiere ofrecer de más al dar la cita.
 *
 * agenda-1 · preparado y SIN PANTALLA en este bloque, a propósito. Ver la
 * cabecera: el embudo es la misma capa para la clínica, la peluquería y el
 * spa, y lo que cambia entre ellos va aquí.
 */
export interface ConfigDelCentro {
  /** spa · «sube el ticket»: proponer un servicio de más. */
  sugerenciasDeVenta?: boolean;
  /** spa · ofrecer un cheque regalo en el embudo. */
  chequeRegalo?: boolean;
}

export type Extra =
  | { tipo: "SUGERENCIA_DE_VENTA" }
  | { tipo: "CHEQUE_REGALO" };

export interface EntradaDeProponer {
  /** Los inicios que caben, tal como los dio el motor. */
  candidatos: Candidato[];
  /** Lo que dura la visita entera, buffers incluidos si los hubiera. */
  duracionMin: number;
  /** La forma de cada día que aparezca en los candidatos. */
  dias: DiaDeLaPropuesta[];
  /**
   * El día que propuso la sanitaria al cerrar la sesión («en 4 semanas»),
   * si lo hay. Sólo desempata: no sube una hora que deje huecos muertos.
   */
  fechaPropuesta?: string | null;
  /**
   * Por debajo de esto, un trozo de hueco libre ya no vale para nada.
   * 15 minutos es la visita más corta de Rosario (una Cura) y la retícula
   * por defecto del motor.
   */
  minimoUtilMin?: number;
  /** Cuántas devolver. Tres: las que caben en una frase por teléfono. */
  cuantas?: number;
  centro?: ConfigDelCentro;
}

export interface Propuesta {
  fecha: string;
  inicioMin: number;
  /** La línea de debajo: por qué esta hora. */
  motivo: string;
  /** El chip de la derecha, o `null` si no hay nada que destacar. */
  etiqueta: string | null;
  /** Minutos de hueco que quedarían inservibles. Menos es mejor. */
  minutosMuertos: number;
  /** Mayor = mejor. Está para los tests y para poder leer el orden. */
  puntos: number;
  /** spa · lo que el centro quiere ofrecer de más. Vacío en clínica. */
  extras: Extra[];
}

const MINIMO_UTIL_POR_DEFECTO = 15;
const CUANTAS_POR_DEFECTO = 3;

/** Resta `fuera` de `dentro` y devuelve lo que queda, ordenado. */
function restar(dentro: Tramo[], fuera: Tramo[]): Tramo[] {
  let trozos = dentro
    .filter((t) => t.hastaMin > t.desdeMin)
    .map((t) => ({ ...t }))
    .sort((a, b) => a.desdeMin - b.desdeMin);
  for (const f of fuera) {
    if (f.hastaMin <= f.desdeMin) continue;
    const siguiente: Tramo[] = [];
    for (const t of trozos) {
      // Sin solape: el trozo sobrevive entero.
      if (f.hastaMin <= t.desdeMin || f.desdeMin >= t.hastaMin) {
        siguiente.push(t);
        continue;
      }
      if (f.desdeMin > t.desdeMin) {
        siguiente.push({ desdeMin: t.desdeMin, hastaMin: f.desdeMin });
      }
      if (f.hastaMin < t.hastaMin) {
        siguiente.push({ desdeMin: f.hastaMin, hastaMin: t.hastaMin });
      }
    }
    trozos = siguiente;
  }
  return trozos.sort((a, b) => a.desdeMin - b.desdeMin);
}

/** Los huecos libres de un día: lo abierto menos lo ocupado. */
export function huecosLibres(dia: DiaDeLaPropuesta): Tramo[] {
  return restar(dia.abiertos, dia.ocupados);
}

/** El día de los candidatos, o un día vacío si no vino su forma. */
function formaDe(e: EntradaDeProponer, fecha: string): DiaDeLaPropuesta {
  return (
    e.dias.find((d) => d.fecha === fecha) ?? {
      fecha,
      abiertos: [],
      ocupados: [],
    }
  );
}

/** Cómo queda el día si se coge este candidato. */
interface Encaje {
  /** El hueco libre que lo contiene, o `null` si no cabe en ninguno. */
  hueco: Tramo | null;
  /** Lo que sobra por delante y por detrás dentro de ese hueco. */
  antesMin: number;
  despuesMin: number;
  minutosMuertos: number;
  /** ¿Empieza justo donde acaba algo (otra cita o el borde del turno)? */
  pegadaPorDelante: boolean;
  /** ¿Acaba justo donde empieza algo? */
  pegadaPorDetras: boolean;
  /** ¿Es el primer minuto reservable del día? */
  primeraDelDia: boolean;
  /** ¿Lo de antes y lo de detrás son citas (y no el borde del turno)? */
  entreDosCitas: boolean;
}

function encajar(
  e: EntradaDeProponer,
  c: Candidato,
  minimoUtil: number,
): Encaje {
  const dia = formaDe(e, c.fecha);
  const libres = huecosLibres(dia);
  const fin = c.inicioMin + e.duracionMin;
  const hueco =
    libres.find((h) => h.desdeMin <= c.inicioMin && fin <= h.hastaMin) ?? null;
  if (!hueco) {
    // El motor dijo que cabe y la forma del día dice que no. Manda el
    // motor (ver la cabecera): se devuelve el candidato, al final de la
    // cola, en vez de esconder una hora que sí se puede dar.
    return {
      hueco: null,
      antesMin: 0,
      despuesMin: 0,
      minutosMuertos: Number.POSITIVE_INFINITY,
      pegadaPorDelante: false,
      pegadaPorDetras: false,
      primeraDelDia: false,
      entreDosCitas: false,
    };
  }
  const antesMin = c.inicioMin - hueco.desdeMin;
  const despuesMin = hueco.hastaMin - fin;
  // Un trozo de CERO no es un minuto muerto: es que no sobra nada.
  const muerto = (min: number) => (min > 0 && min < minimoUtil ? min : 0);
  const primerMinutoDelDia = libres[0]?.desdeMin ?? null;
  const esCita = (min: number) =>
    dia.ocupados.some((o) => o.desdeMin === min || o.hastaMin === min);
  return {
    hueco,
    antesMin,
    despuesMin,
    minutosMuertos: muerto(antesMin) + muerto(despuesMin),
    pegadaPorDelante: antesMin === 0,
    pegadaPorDetras: despuesMin === 0,
    primeraDelDia: primerMinutoDelDia === c.inicioMin,
    entreDosCitas:
      antesMin === 0 &&
      despuesMin === 0 &&
      esCita(hueco.desdeMin) &&
      esCita(hueco.hastaMin),
  };
}

/** "HH:MM" de unos minutos de pared. */
function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const DIAS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
] as const;

/**
 * El día de la semana de una fecha "YYYY-MM-DD", en castellano.
 *
 * A mano y no con `Intl`: esto se compara en un test y una fecha de pared
 * metida en un `Date` depende de la zona del proceso — en CI (UTC) y en el
 * portátil (Madrid) saldrían días distintos el 1 de un mes a las 00:00.
 * `Date.UTC` sobre los tres números no depende de nada.
 */
export function nombreDelDia(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  if (!y || !m || !d) return "";
  return DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
}

/** El motivo que se le lee a la paciente, y el chip de la derecha. */
function redactar(enc: Encaje, c: Candidato): {
  motivo: string;
  etiqueta: string | null;
} {
  if (!enc.hueco) {
    return { motivo: `A las ${hhmm(c.inicioMin)}`, etiqueta: null };
  }
  if (enc.entreDosCitas) {
    return {
      motivo: "Entre dos citas: no deja hueco",
      etiqueta: "Llena el hueco justo",
    };
  }
  if (enc.pegadaPorDelante && enc.pegadaPorDetras) {
    return {
      motivo: "Ocupa el hueco entero",
      etiqueta: "Llena el hueco justo",
    };
  }
  if (enc.minutosMuertos === 0 && enc.primeraDelDia) {
    return { motivo: "Primera de la mañana", etiqueta: "Sin hueco muerto" };
  }
  if (enc.minutosMuertos === 0 && enc.pegadaPorDelante) {
    return {
      motivo: "Justo después de la cita de antes",
      etiqueta: "Sin hueco muerto",
    };
  }
  if (enc.minutosMuertos === 0 && enc.pegadaPorDetras) {
    return {
      motivo: "Justo antes de la cita de después",
      etiqueta: "Sin hueco muerto",
    };
  }
  if (enc.minutosMuertos === 0) {
    return { motivo: "No deja minutos sueltos", etiqueta: "Sin hueco muerto" };
  }
  return {
    motivo: `Deja ${enc.minutosMuertos} min sueltos`,
    etiqueta: null,
  };
}

/**
 * De todos los huecos que caben, los que conviene ofrecer — y por qué.
 *
 * Ver la cabecera del módulo para la regla de orden. Devuelve como mucho
 * `cuantas` (tres por defecto) y nunca lanza: con la lista de candidatos
 * vacía devuelve `[]`, que es lo que el panel pinta como «no hay huecos».
 */
export function proponer(e: EntradaDeProponer): Propuesta[] {
  const minimoUtil = e.minimoUtilMin ?? MINIMO_UTIL_POR_DEFECTO;
  const cuantas = e.cuantas ?? CUANTAS_POR_DEFECTO;
  if (e.duracionMin <= 0) return [];

  const conEncaje = e.candidatos.map((c, i) => ({
    c,
    i,
    enc: encajar(e, c, minimoUtil),
  }));

  conEncaje.sort((a, b) => {
    // 1 · menos minutos muertos.
    if (a.enc.minutosMuertos !== b.enc.minutosMuertos) {
      return a.enc.minutosMuertos - b.enc.minutosMuertos;
    }
    // 2 · la que se pega a lo que ya hay deja el rato libre de una pieza.
    const pegada = (x: Encaje) =>
      (x.pegadaPorDelante ? 1 : 0) + (x.pegadaPorDetras ? 1 : 0);
    if (pegada(a.enc) !== pegada(b.enc)) return pegada(b.enc) - pegada(a.enc);
    // 3 · la fecha que propuso la sanitaria.
    if (e.fechaPropuesta) {
      const esLaPropuesta = (f: string) => (f === e.fechaPropuesta ? 1 : 0);
      const pa = esLaPropuesta(a.c.fecha);
      const pb = esLaPropuesta(b.c.fecha);
      if (pa !== pb) return pb - pa;
    }
    // 4 · la más pronto, y el orden de entrada como último recurso para
    // que dos listas iguales no salgan distintas.
    if (a.c.fecha !== b.c.fecha) return a.c.fecha < b.c.fecha ? -1 : 1;
    if (a.c.inicioMin !== b.c.inicioMin) return a.c.inicioMin - b.c.inicioMin;
    return a.i - b.i;
  });

  const elegidas = conEncaje.slice(0, cuantas);
  const extras: Extra[] = [];
  if (e.centro?.sugerenciasDeVenta) extras.push({ tipo: "SUGERENCIA_DE_VENTA" });
  if (e.centro?.chequeRegalo) extras.push({ tipo: "CHEQUE_REGALO" });

  const primera = elegidas[0]?.c ?? null;
  return elegidas.map(({ c, enc }, pos) => {
    const { motivo, etiqueta } = redactar(enc, c);
    return {
      fecha: c.fecha,
      inicioMin: c.inicioMin,
      // Un candidato de OTRO día que no sea el primero se explica por lo
      // que es: la alternativa si el día de arriba no le viene bien. Es la
      // tercera fila del tablero 3 del diseño.
      motivo:
        pos > 0 && primera && c.fecha !== primera.fecha
          ? `Si el ${nombreDelDia(primera.fecha)} no le viene bien`
          : motivo,
      etiqueta,
      minutosMuertos: Number.isFinite(enc.minutosMuertos)
        ? enc.minutosMuertos
        : 0,
      // Los puntos son para poder LEER el orden en un test y en un
      // volcado; el orden de verdad lo hace el comparador de arriba.
      puntos:
        (Number.isFinite(enc.minutosMuertos) ? -enc.minutosMuertos : -9999) +
        (enc.pegadaPorDelante ? 1 : 0) +
        (enc.pegadaPorDetras ? 1 : 0),
      // Sólo en la primera: el embudo del spa ofrece el extra UNA vez, no
      // uno por hora. Vacío en clínica, que es el caso de este bloque.
      extras: pos === 0 ? extras : [],
    };
  });
}
