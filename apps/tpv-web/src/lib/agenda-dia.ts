// agenda-1 · EL DÍA DE UNA PROFESIONAL, EN FILAS.
//
// Matías, 27-10: «no me gusta la agenda, no es nada intuitiva». Con una
// sola profesional —Rosario— la rejilla por columnas deja 208 px de agenda
// y el resto de la tablet en blanco, y las citas de 10 y 20 minutos son
// rayas de 11 y 22 px que no se tocan. Decisión suya (D1): con UNA
// profesional el día es una LISTA de filas de altura tocable; con varias,
// la rejilla por columnas del tablero 4.
//
// Esto es la aritmética de esa lista, aparte de la pantalla y sin React:
// entran las citas y la forma del día, salen las filas en orden. Lo que la
// hace útil no es el orden —eso es trivial— son las DOS cosas que la
// rejilla no decía:
//
//   · LOS HUECOS LIBRES, con su duración y qué cabe dentro. En la rejilla
//     un hueco es ausencia de tarjeta: se ve si te fijas y no se puede
//     tocar con intención. Aquí es una fila con «Libre 25 min · cabe una
//     Cura o un Papiloma · + Dar cita aquí».
//   · LAS HORAS CERRADAS, plegadas en una línea. En la rejilla el mediodía
//     de un centro que cierra de 14 a 16 son 132 px de rayado que hay que
//     recorrer con el dedo para llegar a la tarde.
//
// ── Trabaja con tramos, no con citas ─────────────────────────────────
//
// Las filas de cita llevan sólo el `id`: quién es la paciente, qué
// servicio y en qué estado está lo sabe la pantalla, que tiene el mapa de
// clientes y el catálogo. Aquí entra `{id, desdeMin, hastaMin}` y nada
// más. Así este módulo se prueba con cuatro números y sin montar la
// agenda, que es de lo que iba hacerlo puro.
//
// ── El suelo es el mismo de B-reservas-6a ────────────────────────────
//
// Un hueco que ya pasó no invita a crear una cita: el servidor la
// rechazaría igual (409 BOOKING_IN_PAST) y enseñar el panel para acabar en
// un error es pasear a la recepción delante de la paciente. Así que los
// huecos se RECORTAN al suelo, y el que se queda corto desaparece. Las
// citas pasadas no: se siguen viendo (atenuadas) porque se cobran, se
// finalizan y se miran.

import type { Tramo } from "./agenda-proponer.js";

export type { Tramo };

/** Lo que ocupa un rato del día. `id` para que la pantalla lo re-ate. */
export interface TramoOcupado {
  id: string;
  desdeMin: number;
  hastaMin: number;
}

export interface FilaCita {
  tipo: "cita";
  id: string;
  desdeMin: number;
  hastaMin: number;
}

export interface FilaHueco {
  tipo: "hueco";
  desdeMin: number;
  hastaMin: number;
  duracionMin: number;
  /** Los nombres de los servicios que caben, de más largo a más corto. */
  cabe: string[];
  /** `false` si el hueco ya pasó: se ve, pero no se ofrece. */
  reservable: boolean;
}

export interface FilaCerrado {
  tipo: "cerrado";
  desdeMin: number;
  /** `1440` = hasta el final del día. */
  hastaMin: number;
}

export type FilaDelDia = FilaCita | FilaHueco | FilaCerrado;

export interface ServicioQueCabe {
  nombre: string;
  duracionMin: number;
}

export interface EntradaDelDia {
  citas: TramoOcupado[];
  /** Turno ∩ horario del centro. `[]` = el centro no abre ese día. */
  abiertos: Tramo[];
  /** Ausencias: no son citas y no se pintan como huecos libres. */
  ausencias?: Tramo[];
  /**
   * El comienzo de la franja EN CURSO, igual que en la rejilla. `null` =
   * nada del día ha pasado. `Infinity` = el día entero pasó.
   */
  sueloMin?: number | null;
  /** Para decir qué cabe en cada hueco. */
  servicios?: ServicioQueCabe[];
  /** Un hueco más corto que esto no es una fila: es un redondeo. */
  minimoDeHuecoMin?: number;
  /** Cuántos servicios se nombran por hueco. Dos: «cabe una X o una Y». */
  cuantosCaben?: number;
}

const MINIMO_DE_HUECO = 10;
const CUANTOS_CABEN = 2;
const FIN_DEL_DIA = 24 * 60;

/** Resta `fuera` de `dentro`. La misma que `agenda-proponer`, que no se
 *  exporta desde allí porque allí es un detalle del encaje. */
function restar(dentro: Tramo[], fuera: Tramo[]): Tramo[] {
  let trozos = dentro
    .filter((t) => t.hastaMin > t.desdeMin)
    .map((t) => ({ ...t }))
    .sort((a, b) => a.desdeMin - b.desdeMin);
  for (const f of fuera) {
    if (f.hastaMin <= f.desdeMin) continue;
    const siguiente: Tramo[] = [];
    for (const t of trozos) {
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

/** Los tramos abiertos, fusionados y ordenados. */
function fusionar(tramos: Tramo[]): Tramo[] {
  const orden = tramos
    .filter((t) => t.hastaMin > t.desdeMin)
    .sort((a, b) => a.desdeMin - b.desdeMin);
  const fuera: Tramo[] = [];
  for (const t of orden) {
    const ultimo = fuera[fuera.length - 1];
    if (ultimo && t.desdeMin <= ultimo.hastaMin) {
      ultimo.hastaMin = Math.max(ultimo.hastaMin, t.hastaMin);
    } else {
      fuera.push({ ...t });
    }
  }
  return fuera;
}

/** Qué servicios caben en un hueco de `duracionMin`, los más largos
 *  primero: lo que la recepción quiere saber es lo MÁS que puede meter. */
export function queCabe(
  duracionMin: number,
  servicios: ServicioQueCabe[],
  cuantos = CUANTOS_CABEN,
): string[] {
  return servicios
    .filter((s) => s.duracionMin > 0 && s.duracionMin <= duracionMin)
    .sort((a, b) => b.duracionMin - a.duracionMin || a.nombre.localeCompare(b.nombre))
    .slice(0, cuantos)
    .map((s) => s.nombre);
}

/**
 * Las filas del día, en orden: citas, huecos libres y horas cerradas.
 *
 * Las horas cerradas que se plieguen son las de ENTRE dos tramos abiertos
 * (el mediodía de quien cierra a comer) y la de después del último (que es
 * la línea «Cerrado desde las 14:00» del diseño). Las de ANTES del primero
 * no: el día empieza donde el centro abre, y una línea que diga que a las
 * 3 de la mañana está cerrado no le dice nada a nadie.
 */
export function filasDelDia(e: EntradaDelDia): FilaDelDia[] {
  const abiertos = fusionar(e.abiertos);
  const citas = [...e.citas].sort(
    (a, b) => a.desdeMin - b.desdeMin || a.hastaMin - b.hastaMin,
  );
  const filas: FilaDelDia[] = citas.map((c) => ({
    tipo: "cita" as const,
    id: c.id,
    desdeMin: c.desdeMin,
    hastaMin: c.hastaMin,
  }));

  if (abiertos.length > 0) {
    const minimo = e.minimoDeHuecoMin ?? MINIMO_DE_HUECO;
    const servicios = e.servicios ?? [];
    const suelo = e.sueloMin ?? null;
    const libres = restar(abiertos, [
      ...citas.map((c) => ({ desdeMin: c.desdeMin, hastaMin: c.hastaMin })),
      ...(e.ausencias ?? []),
    ]);
    for (const h of libres) {
      // El suelo recorta por delante; lo que queda corto no es una fila.
      const desdeMin = suelo == null ? h.desdeMin : Math.max(h.desdeMin, suelo);
      const reservable = Number.isFinite(desdeMin) && desdeMin < h.hastaMin;
      // Un hueco ENTERAMENTE pasado se sigue viendo —la recepción cuenta
      // los minutos que se han ido— pero sin «+ Dar cita aquí», que sería
      // un 409 con la paciente delante.
      const inicio = reservable ? desdeMin : h.desdeMin;
      const duracionMin = h.hastaMin - inicio;
      if (duracionMin < minimo) continue;
      filas.push({
        tipo: "hueco",
        desdeMin: inicio,
        hastaMin: h.hastaMin,
        duracionMin,
        cabe: reservable ? queCabe(duracionMin, servicios, e.cuantosCaben) : [],
        reservable,
      });
    }
    // Las horas cerradas, plegadas.
    for (let i = 0; i < abiertos.length - 1; i++) {
      const fin = abiertos[i]!.hastaMin;
      const siguiente = abiertos[i + 1]!.desdeMin;
      if (siguiente > fin) {
        filas.push({ tipo: "cerrado", desdeMin: fin, hastaMin: siguiente });
      }
    }
    const ultimo = abiertos[abiertos.length - 1]!;
    if (ultimo.hastaMin < FIN_DEL_DIA) {
      filas.push({
        tipo: "cerrado",
        desdeMin: ultimo.hastaMin,
        hastaMin: FIN_DEL_DIA,
      });
    }
  }

  return filas.sort((a, b) => {
    if (a.desdeMin !== b.desdeMin) return a.desdeMin - b.desdeMin;
    // A la misma hora, la cita antes que el hueco: un hueco que empieza
    // donde empieza una cita es un hueco de otra columna, y lo que la
    // recepción busca es la cita.
    const peso = (f: FilaDelDia) =>
      f.tipo === "cita" ? 0 : f.tipo === "hueco" ? 1 : 2;
    return peso(a) - peso(b);
  });
}

/** Lo que se está haciendo ahora y lo que viene después. */
export interface AhoraYDespues {
  /** La cita en curso: la que contiene el minuto de ahora. */
  ahora: string | null;
  /** La siguiente que empieza después de ahora. */
  despues: string | null;
}

/**
 * Qué toca AHORA y qué va después.
 *
 * «Ahora» es la cita que contiene el minuto actual, no la que está marcada
 * «en sala»: el estado lo mueve una persona y se olvida, y la pregunta que
 * la columna izquierda contesta es «qué toca», que es del reloj. Si no hay
 * ninguna en curso, `ahora` es `null` y la de después sigue siendo la
 * siguiente — la columna dirá «libre hasta las 11:00».
 */
export function ahoraYDespues(
  citas: TramoOcupado[],
  ahoraMin: number | null,
): AhoraYDespues {
  if (ahoraMin == null) {
    const orden = [...citas].sort((a, b) => a.desdeMin - b.desdeMin);
    return { ahora: null, despues: orden[0]?.id ?? null };
  }
  const orden = [...citas].sort((a, b) => a.desdeMin - b.desdeMin);
  const enCurso =
    orden.find((c) => c.desdeMin <= ahoraMin && ahoraMin < c.hastaMin) ?? null;
  const siguiente = orden.find((c) => c.desdeMin > ahoraMin) ?? null;
  return { ahora: enCurso?.id ?? null, despues: siguiente?.id ?? null };
}

/** Las tres cifras del día de la columna izquierda. */
export interface CifrasDelDia {
  citas: number;
  hechas: number;
  minutosLibres: number;
}

/**
 * Cuántas citas, cuántas hechas y cuántos minutos libres quedan.
 *
 * «Libres» cuenta desde el SUELO, no desde que abre: a las 12:30 lo que la
 * recepción puede vender son los minutos que quedan, no los que hubo. Con
 * el día entero por delante (un día futuro) son todos.
 */
export function cifrasDelDia(e: {
  citas: TramoOcupado[];
  hechas: number;
  abiertos: Tramo[];
  ausencias?: Tramo[];
  sueloMin?: number | null;
}): CifrasDelDia {
  const abiertos = fusionar(e.abiertos);
  const suelo = e.sueloMin ?? null;
  const desdeElSuelo =
    suelo == null
      ? abiertos
      : abiertos
          .map((t) => ({
            desdeMin: Math.max(t.desdeMin, suelo),
            hastaMin: t.hastaMin,
          }))
          .filter((t) => Number.isFinite(t.desdeMin) && t.hastaMin > t.desdeMin);
  const libres = restar(desdeElSuelo, [
    ...e.citas.map((c) => ({ desdeMin: c.desdeMin, hastaMin: c.hastaMin })),
    ...(e.ausencias ?? []),
  ]);
  return {
    citas: e.citas.length,
    hechas: e.hechas,
    minutosLibres: libres.reduce((s, t) => s + (t.hastaMin - t.desdeMin), 0),
  };
}

/**
 * Minutos → «45 min», «1 h», «1 h 30 min», «3 h 10 min».
 *
 * Como lo dice la recepción por teléfono. Nada de «90 minutos»: nadie
 * cuenta hora y media en minutos en voz alta.
 */
export function duracionHumana(min: number): string {
  if (min <= 0) return "0 min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
