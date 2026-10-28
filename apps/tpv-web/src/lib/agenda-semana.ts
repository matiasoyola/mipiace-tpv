// agenda-1 · LA SEMANA, EN COLUMNAS DE DÍA.
//
// Hasta este bloque cambiar de día costaba una de tres cosas: la tira de
// SIETE chips (que sólo llega a siete), dos flechas que por debajo de
// 640 px no existen, o un `type="date"` nativo. Tres controles para lo
// mismo, y ninguno enseña la semana: «¿cuándo tienes hueco?» se contestaba
// tocando día por día y acordándose de lo que se había visto.
//
// El tablero 2 del diseño es la respuesta: los días que ABRE el centro, en
// columnas, con las citas y los huecos dentro y hoy destacado. Tocar un
// día lleva a su vista de día; tocar un hueco abre «Dar cita» con esa hora.
//
// Este módulo es la aritmética: qué días entran en la semana de una fecha,
// y cómo se resume cada uno en una línea. La pantalla la pinta
// `AgendaPage.semana.tsx`.
//
// ── Semana de lunes a domingo, y los que abra el centro ──────────────
//
// La semana natural de un centro español empieza el lunes. Qué días se
// pintan de verdad lo decide el horario: Rosario abre de lunes a viernes y
// su semana son cinco columnas, no siete con dos vacías. Un centro que
// abra el sábado tiene seis. El que no abra ninguno —una semana de
// vacaciones— se queda sin columnas y la pantalla lo dice con una frase,
// no con cinco columnas vacías.

import { duracionHumana, type Tramo, type TramoOcupado } from "./agenda-dia.js";

/** Fecha de pared "YYYY-MM-DD" + n días. Sin `Date` local: ver
 *  `nombreDelDia` en `agenda-proponer.ts`. */
export function masDias(fecha: string, n: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1)) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** El lunes de la semana de `fecha`. */
export function lunesDeLaSemana(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const dow = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  // getUTCDay: 0 = domingo. El lunes está 6 días atrás, no 1 adelante.
  return masDias(fecha, dow === 0 ? -6 : 1 - dow);
}

/** Los siete días de la semana de `fecha`, de lunes a domingo. */
export function sieteDias(fecha: string): string[] {
  const lunes = lunesDeLaSemana(fecha);
  return Array.from({ length: 7 }, (_, i) => masDias(lunes, i));
}

/** El resumen de un día, tal como lo lee la cabecera de su columna. */
export interface ResumenDeDia {
  fecha: string;
  citas: number;
  minutosLibres: number;
  /** «6 citas · lleno», «3 citas · 3 h 10 min libres», «Sin citas». */
  texto: string;
}

/**
 * La línea de la cabecera de una columna de día.
 *
 * Tres frases y no una cifra suelta, porque las tres cosas que la
 * recepción quiere saber de un día son distintas: si está LLENO (no
 * ofrecerlo), si está CASI LIBRE (ofrecerlo con alegría) o cuántos minutos
 * tiene sueltos (ofrecer el hueco concreto).
 */
export function resumenDeDia(e: {
  fecha: string;
  citas: TramoOcupado[];
  abiertos: Tramo[];
  minutosLibres: number;
}): ResumenDeDia {
  const abiertoMin = e.abiertos.reduce(
    (s, t) => s + Math.max(0, t.hastaMin - t.desdeMin),
    0,
  );
  const n = e.citas.length;
  let texto: string;
  if (n === 0) {
    texto = "Sin citas";
  } else if (e.minutosLibres <= 0) {
    texto = `${n} ${n === 1 ? "cita" : "citas"} · lleno`;
  } else if (abiertoMin > 0 && e.minutosLibres >= abiertoMin * 0.6) {
    // Más de la mitad larga del día sin vender: la cifra exacta no añade
    // nada y «casi libre» es lo que se dice por teléfono.
    texto = `${n} ${n === 1 ? "cita" : "citas"} · casi libre`;
  } else {
    texto = `${n} ${n === 1 ? "cita" : "citas"} · ${duracionHumana(
      e.minutosLibres,
    )} libres`;
  }
  return {
    fecha: e.fecha,
    citas: n,
    minutosLibres: e.minutosLibres,
    texto,
  };
}

/** «Lun 26», para la cabecera de la columna. */
export function diaCortoDeLaSemana(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const dow = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  const nombres = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  return `${nombres[dow]} ${d}`;
}

/** «26 – 30 oct» / «28 sep – 2 oct»: el rótulo de la cabecera. */
export function rotuloDeLaSemana(dias: string[]): string {
  const primera = dias[0];
  const ultima = dias[dias.length - 1];
  if (!primera || !ultima) return "";
  const mes = (f: string) => {
    const meses = [
      "ene",
      "feb",
      "mar",
      "abr",
      "may",
      "jun",
      "jul",
      "ago",
      "sep",
      "oct",
      "nov",
      "dic",
    ];
    return meses[Number(f.slice(5, 7)) - 1] ?? "";
  };
  const dia = (f: string) => String(Number(f.slice(8, 10)));
  return mes(primera) === mes(ultima)
    ? `${dia(primera)} – ${dia(ultima)} ${mes(ultima)}`
    : `${dia(primera)} ${mes(primera)} – ${dia(ultima)} ${mes(ultima)}`;
}
