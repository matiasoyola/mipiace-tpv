// residencia-5 (D-42) · **CUÁNDO TOCA UNA OBLIGACIÓN DE DIRECCIÓN.**
//
// Las nóminas el 25 de cada mes, los extintores cada trimestre, el
// certificado del mantenedor de PCI cada año, la inspección OCA de baja
// tensión cada cinco. Hoy todo eso vive en la cabeza de Carmen; aquí es
// una fila con su periodicidad, y las veces que toca las genera esta
// función.
//
// ── PURA, y por qué importa aquí en concreto ────────────────────────
//
// Porque los casos difíciles son de calendario y no de base de datos: el
// 31 de febrero, el 29 de febrero de 2028, el trimestre que empieza en
// marzo y acaba en diciembre. Con esto en un `WHERE` de SQL, «¿genera
// bien el fin de mes?» se contesta levantando un Postgres; con esto aquí,
// es una tabla de verdad.
//
// ── EL FIN DE MES, QUE ES LA DECISIÓN DEL FICHERO ───────────────────
//
// `monthDay` se **recorta al último día del mes** cuando el mes es más
// corto. O sea: una obligación «el 31» toca el 28 en febrero de 2027, el
// 29 en febrero de 2028 y el 30 en abril.
//
// De ahí sale gratis «el último día de cada mes», que es como un centro
// paga las nóminas, sin inventar un valor centinela ni una columna
// booleana. Y la alternativa —no generar nada cuando el día no existe—
// habría dejado un centro sin la obligación de febrero, que es justo el
// mes en que una nómina no puede faltar.

import { addDays, daysBetween, isoWeekday } from "./tiempo.js";

/** Las siete periodicidades de D-42. Copia del enum de la base; el
 *  paquete es puro y no importa Prisma. */
export type PeriodicidadDeObligacion =
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "ANNUAL"
  | "FIVE_YEARLY"
  | "VALIDITY";

/** Una obligación, en lo que al calendario le importa. */
export interface ObligacionParaGenerar {
  periodicity: PeriodicidadDeObligacion;
  /** 1–7 ISO (1 = lunes). Sólo en `WEEKLY`. */
  weekday: number | null;
  /** 1–31, recortado al último día del mes. */
  monthDay: number | null;
  /** 1–12; en `QUARTERLY` es el primer mes del ciclo (1–3). */
  month: number | null;
  /** El año desde el que se cuentan los cinco. Sólo en `FIVE_YEARLY`. */
  anchorYear: number | null;
  /** «YYYY-MM-DD». Sólo en `VALIDITY`, y es su única ocurrencia. */
  validUntil: string | null;
  /** Desde cuándo se genera. Nada antes de esto. */
  startsOn: string;
}

/** Cuántos días tiene un mes. `mes` 1–12. */
export function diasDelMes(anio: number, mes: number): number {
  // El día 0 del mes siguiente es el último del mes pedido, y `Date.UTC`
  // lo resuelve sin tabla de bisiestos ni `%4`.
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** El día del mes, recortado a lo que el mes da de sí. Ver la cabecera. */
export function diaRecortado(anio: number, mes: number, dia: number): number {
  return Math.min(dia, diasDelMes(anio, mes));
}

/** «YYYY-MM-DD» de un año, mes y día ya recortado. */
function fecha(anio: number, mes: number, dia: number): string {
  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Las fechas en que esta obligación toca dentro de `[desde, hasta]`,
 * **los dos incluidos**.
 *
 * Cerrado por los dos lados y no semiabierto como `queToca`, y es a
 * propósito: aquí la unidad es el DÍA y no el instante, y «genérame las
 * de octubre» con un `hasta` exclusivo obligaría a escribir el 1 de
 * noviembre en todas las llamadas.
 *
 * Nada antes de `startsOn`: cargar la plantilla del bloque C en octubre
 * no debe inventar las nóminas de enero.
 *
 * El resultado va **ordenado y sin repetidos**: es lo que se inserta con
 * `ON CONFLICT DO NOTHING` contra `duty_occurrences_una_por_dia_key`, y
 * una lista con repetidos haría que la pasada fuera idempotente por
 * accidente del motor en vez de por construcción.
 */
export function ocurrenciasDeObligacion(
  o: ObligacionParaGenerar,
  desde: string,
  hasta: string,
): string[] {
  if (daysBetween(desde, hasta) < 0) return [];
  const arranque = o.startsOn > desde ? o.startsOn : desde;
  if (daysBetween(arranque, hasta) < 0) return [];

  const fuera: string[] = [];
  switch (o.periodicity) {
    // ── Por vigencia: UNA ocurrencia, la de su caducidad ────────────
    //
    // No se repite: caduca. El certificado del mantenedor vence el 5 de
    // noviembre de 2029 y lo que hay que hacer es renovarlo antes, no
    // «hacerlo otra vez el año que viene». El aviso a 60 días (bloque C
    // §2) es del panel, no de aquí: aquí la fecha es la que es.
    case "VALIDITY": {
      const v = o.validUntil;
      if (v == null) break;
      if (daysBetween(arranque, v) >= 0 && daysBetween(v, hasta) >= 0) fuera.push(v);
      break;
    }

    case "DAILY": {
      for (let d = arranque; daysBetween(d, hasta) >= 0; d = addDays(d, 1)) {
        fuera.push(d);
      }
      break;
    }

    case "WEEKLY": {
      if (o.weekday == null) break;
      for (let d = arranque; daysBetween(d, hasta) >= 0; d = addDays(d, 1)) {
        if (isoWeekday(d) === o.weekday) fuera.push(d);
      }
      break;
    }

    // ── Las cuatro que cuelgan de un mes ───────────────────────────
    //
    // Se barre MES A MES y no día a día, y no es sólo por velocidad: con
    // el barrido por días habría que preguntar «¿es hoy el día
    // recortado de este mes?», y eso vuelve a escribir el recorte en
    // otro sitio. Barriendo meses, el recorte se hace una vez y por mes.
    case "MONTHLY":
    case "QUARTERLY":
    case "ANNUAL":
    case "FIVE_YEARLY": {
      if (o.monthDay == null) break;
      const anioDesde = Number(arranque.slice(0, 4));
      const anioHasta = Number(hasta.slice(0, 4));
      for (let anio = anioDesde; anio <= anioHasta; anio++) {
        for (const mes of mesesDe(o, anio)) {
          const dia = diaRecortado(anio, mes, o.monthDay);
          const f = fecha(anio, mes, dia);
          if (daysBetween(arranque, f) < 0) continue;
          if (daysBetween(f, hasta) < 0) continue;
          fuera.push(f);
        }
      }
      break;
    }
  }

  return [...new Set(fuera)].sort();
}

/** En qué meses de este año toca, para las cuatro periodicidades que
 *  cuelgan de un mes. */
function mesesDe(o: ObligacionParaGenerar, anio: number): number[] {
  switch (o.periodicity) {
    case "MONTHLY":
      return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    // Cuatro al año desde el mes de anclaje (1–3). Con anclaje en marzo
    // son marzo, junio, septiembre y diciembre — que es exactamente el
    // calendario de los informes de extintores del cliente cero.
    case "QUARTERLY": {
      const base = o.month ?? 1;
      return [0, 3, 6, 9].map((n) => base + n).filter((m) => m >= 1 && m <= 12);
    }
    case "ANNUAL":
      return o.month == null ? [] : [o.month];
    // Cada cinco años desde el de anclaje, en los dos sentidos: una
    // inspección anclada en 2024 toca en 2029 y tocó en 2019, y una
    // ventana que pregunte por 2019 tiene que decirlo.
    case "FIVE_YEARLY": {
      if (o.month == null || o.anchorYear == null) return [];
      return (anio - o.anchorYear) % 5 === 0 ? [o.month] : [];
    }
    default:
      return [];
  }
}

/**
 * Cómo se lee una periodicidad en la pantalla.
 *
 * Vive aquí y no en el admin por lo mismo que `frecuenciaEnPalabras`: la
 * frase la necesitan el panel, la lista de obligaciones y el informe, y
 * tres copias de «cada tres meses» se separan a la tercera.
 */
export function periodicidadEnPalabras(o: ObligacionParaGenerar): string {
  const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  const MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  const elDia = (d: number): string => (d >= 31 ? "el último día del mes" : `el día ${d}`);
  switch (o.periodicity) {
    case "DAILY":
      return "Todos los días";
    case "WEEKLY":
      return o.weekday == null
        ? "Cada semana"
        : `Cada semana, el ${DIAS[o.weekday - 1] ?? "lunes"}`;
    case "MONTHLY":
      return o.monthDay == null ? "Cada mes" : `Cada mes, ${elDia(o.monthDay)}`;
    case "QUARTERLY": {
      if (o.month == null || o.monthDay == null) return "Cada trimestre";
      const meses = mesesDe(o, 2026).map((m) => MESES[m - 1]).join(", ");
      return `Cada trimestre (${meses}), ${elDia(o.monthDay)}`;
    }
    case "ANNUAL":
      return o.month == null || o.monthDay == null
        ? "Cada año"
        : `Cada año, el ${o.monthDay} de ${MESES[o.month - 1]}`;
    case "FIVE_YEARLY":
      return o.month == null || o.monthDay == null || o.anchorYear == null
        ? "Cada cinco años"
        : `Cada cinco años desde ${o.anchorYear}, el ${o.monthDay} de ${MESES[o.month - 1]}`;
    case "VALIDITY":
      return o.validUntil == null
        ? "Por vigencia"
        : `Vence el ${o.validUntil.slice(8, 10)}-${o.validUntil.slice(5, 7)}-${o.validUntil.slice(0, 4)}`;
  }
}

/** Cuántos días quedan de `hoy` a `cuando`. Negativo = vencida. */
export function diasHasta(hoy: string, cuando: string): number {
  return daysBetween(hoy, cuando);
}

/**
 * **Los 60 días del bloque C §2.** «¿Qué vencimientos caducan en los
 * próximos 60 días?» es una de las cuatro consultas de dirección, y el
 * número vive aquí para que el panel y el aviso de la lista usen el
 * mismo.
 */
export const DIAS_DE_PREAVISO = 60;
