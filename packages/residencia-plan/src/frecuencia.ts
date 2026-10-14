// residencia-2 · LA FRECUENCIA, como tipo.
//
// Las ocho formas en que un cuidado se reparte en el tiempo, y qué
// parámetros pide cada una. Es el MISMO contrato que el CHECK
// `…_frecuencia_coherente` de la migración escribe en el motor, y está
// escrito dos veces a propósito: la base garantiza que no entre una fila
// incoherente y este tipo garantiza que el compilador vea los parámetros
// que `queToca` va a leer. Sin lo primero, una fila escrita a mano por
// `psql` rompería la función; sin lo segundo, la función tendría que
// defenderse de datos que la base ya impide.
//
// ── Por qué una forma «plana» y no una unión discriminada ─────────────
//
// Los parámetros vienen de SIETE columnas de la base (`every_n_hours`,
// `weekdays`, `shift_codes`…), y una unión discriminada obligaría a
// construirla fila por fila con un `switch` en cada uno de los cuatro
// sitios que la leen. La forma plana es la de la fila, así que no hay
// traducción que se pueda escribir mal, y el `kind` dice qué campos miran.
//
// Lo que se pierde: el compilador no impide leer `everyNHours` de un
// `DAILY`. Lo que se gana: no hay un mapeo que mantener sincronizado con
// cuatro tablas. Y la coherencia la garantiza el motor, que es donde
// importa.

/** Las ocho formas. Espejo exacto del enum `CareFrequencyKind`. */
export type TipoDeFrecuencia =
  | "EVERY_SHIFT"
  | "DAILY"
  | "MOMENTS"
  | "EVERY_N_HOURS"
  | "WEEKDAYS"
  | "EVERY_N_DAYS"
  | "MONTHLY"
  | "ON_DEMAND";

/**
 * Una frecuencia, en la forma en que la trae la fila.
 *
 * Qué campos usa cada `kind`:
 *
 * | `kind`          | campos que lee                      |
 * |-----------------|-------------------------------------|
 * | `EVERY_SHIFT`   | `shiftCodes` (uno o más)            |
 * | `DAILY`         | `shiftCodes` (exactamente uno)      |
 * | `MOMENTS`       | `momentCodes` (uno o más)           |
 * | `EVERY_N_HOURS` | `everyNHours` (1–12)                |
 * | `WEEKDAYS`      | `weekdays` (1–7) + `shiftCodes` (1) |
 * | `EVERY_N_DAYS`  | `everyNDays` (1–365) + `shiftCodes` (1) |
 * | `MONTHLY`       | `monthDay` (1–28) + `shiftCodes` (1)|
 * | `ON_DEMAND`     | ninguno                             |
 */
export interface Frecuencia {
  kind: TipoDeFrecuencia;
  everyNHours?: number | null;
  everyNDays?: number | null;
  /** ISO: 1 = lunes … 7 = domingo. */
  weekdays?: number[];
  /** Día del mes, 1–28. El tope es 28 y no 31 para que un control mensual no se pierda febrero. */
  monthDay?: number | null;
  /** Códigos de `CenterShift`. */
  shiftCodes?: string[];
  /** Códigos de `CenterMoment`. */
  momentCodes?: string[];
}

/** Lo mínimo de un `CenterMoment` que hace falta para decidir. */
export interface MomentoDelCentro {
  code: string;
  name: string;
  /** Hora de pared «HH:MM». */
  atTime: string;
}

/**
 * Los días de la semana, en español y en orden ISO. Vive aquí y no en la
 * pantalla por lo mismo que `NIVEL_LABEL`: si cada sitio los tradujera,
 * dos acabarían empezando la semana en domingo.
 */
export const DIAS_SEMANA: Array<{ iso: number; corto: string; largo: string }> = [
  { iso: 1, corto: "L", largo: "lunes" },
  { iso: 2, corto: "M", largo: "martes" },
  { iso: 3, corto: "X", largo: "miércoles" },
  { iso: 4, corto: "J", largo: "jueves" },
  { iso: 5, corto: "V", largo: "viernes" },
  { iso: 6, corto: "S", largo: "sábado" },
  { iso: 7, corto: "D", largo: "domingo" },
];

/**
 * ¿Es esta frecuencia coherente con su `kind`?
 *
 * Mismo juicio que el CHECK de la base, para poder contestar un 400 con
 * una frase antes de que Postgres conteste un 500 de constraint. Devuelve
 * `null` si está bien, o el motivo en castellano si no.
 *
 * El orden importa: primero se comprueba lo que FALTA (es el error de
 * quien rellena un formulario) y después lo que SOBRA (es el error de
 * quien cambia de tipo y se deja el campo anterior puesto).
 */
export function problemaDeFrecuencia(f: Frecuencia): string | null {
  const turnos = f.shiftCodes ?? [];
  const momentos = f.momentCodes ?? [];
  const dias = f.weekdays ?? [];
  const horas = f.everyNHours ?? null;
  const ndias = f.everyNDays ?? null;
  const diaDelMes = f.monthDay ?? null;

  const sobra = (...campos: Array<[string, boolean]>): string | null => {
    for (const [nombre, puesto] of campos) {
      if (puesto) return `«${nombre}» no se usa con esta frecuencia.`;
    }
    return null;
  };

  switch (f.kind) {
    case "EVERY_SHIFT":
      if (turnos.length === 0) return "Dime en qué turnos.";
      return sobra(
        ["momentos", momentos.length > 0],
        ["cada N horas", horas !== null],
        ["cada N días", ndias !== null],
        ["días de la semana", dias.length > 0],
        ["día del mes", diaDelMes !== null],
      );
    case "DAILY":
      if (turnos.length !== 1) return "Una vez al día es en un turno, y sólo uno.";
      return sobra(
        ["momentos", momentos.length > 0],
        ["cada N horas", horas !== null],
        ["cada N días", ndias !== null],
        ["días de la semana", dias.length > 0],
        ["día del mes", diaDelMes !== null],
      );
    case "MOMENTS":
      if (momentos.length === 0) return "Dime en qué momentos del día.";
      return sobra(
        ["turnos", turnos.length > 0],
        ["cada N horas", horas !== null],
        ["cada N días", ndias !== null],
        ["días de la semana", dias.length > 0],
        ["día del mes", diaDelMes !== null],
      );
    case "EVERY_N_HOURS":
      if (horas === null) return "Dime cada cuántas horas.";
      if (horas < 1 || horas > 12) {
        return "Cada cuántas horas, entre 1 y 12: menos de una hora es vigilancia continua y más de doce es una vez al día.";
      }
      return sobra(
        ["turnos", turnos.length > 0],
        ["momentos", momentos.length > 0],
        ["cada N días", ndias !== null],
        ["días de la semana", dias.length > 0],
        ["día del mes", diaDelMes !== null],
      );
    case "WEEKDAYS":
      if (dias.length === 0) return "Dime qué días de la semana.";
      if (dias.some((d) => d < 1 || d > 7)) return "Los días van de 1 (lunes) a 7 (domingo).";
      if (turnos.length !== 1) return "Dime en qué turno, y sólo uno.";
      return sobra(
        ["momentos", momentos.length > 0],
        ["cada N horas", horas !== null],
        ["cada N días", ndias !== null],
        ["día del mes", diaDelMes !== null],
      );
    case "EVERY_N_DAYS":
      if (ndias === null) return "Dime cada cuántos días.";
      if (ndias < 1 || ndias > 365) return "Cada cuántos días, entre 1 y 365.";
      if (turnos.length !== 1) return "Dime en qué turno, y sólo uno.";
      return sobra(
        ["momentos", momentos.length > 0],
        ["cada N horas", horas !== null],
        ["días de la semana", dias.length > 0],
        ["día del mes", diaDelMes !== null],
      );
    case "MONTHLY":
      if (diaDelMes === null) return "Dime qué día del mes.";
      if (diaDelMes < 1 || diaDelMes > 28) {
        return "El día del mes, entre 1 y 28: con el 29, el 30 o el 31 el control no tocaría en febrero y nadie lo notaría.";
      }
      if (turnos.length !== 1) return "Dime en qué turno, y sólo uno.";
      return sobra(
        ["momentos", momentos.length > 0],
        ["cada N horas", horas !== null],
        ["cada N días", ndias !== null],
        ["días de la semana", dias.length > 0],
      );
    case "ON_DEMAND":
      return sobra(
        ["turnos", turnos.length > 0],
        ["momentos", momentos.length > 0],
        ["cada N horas", horas !== null],
        ["cada N días", ndias !== null],
        ["días de la semana", dias.length > 0],
        ["día del mes", diaDelMes !== null],
      );
  }
}

/**
 * La frecuencia, en una frase para la pantalla y el parte.
 *
 * Vive en el paquete y no en la pantalla porque la va a leer también el
 * parte de relevo de residencia-5 y el panel: dos traducciones de «cada 3
 * h» acabarían diciendo cosas distintas.
 */
export function frecuenciaEnPalabras(
  f: Frecuencia,
  nombreTurno: (code: string) => string = (c) => c,
  nombreMomento: (code: string) => string = (c) => c,
): string {
  const turnos = (f.shiftCodes ?? []).map(nombreTurno);
  const momentos = (f.momentCodes ?? []).map(nombreMomento);
  switch (f.kind) {
    case "EVERY_SHIFT":
      return `Cada turno (${turnos.join(", ")})`;
    case "DAILY":
      return `Una vez al día (${turnos[0] ?? "—"})`;
    case "MOMENTS":
      return `En ${momentos.join(", ")}`;
    case "EVERY_N_HOURS":
      return `Cada ${f.everyNHours} h, también de noche`;
    case "WEEKDAYS": {
      const dias = (f.weekdays ?? [])
        .slice()
        .sort((a, b) => a - b)
        .map((d) => DIAS_SEMANA.find((x) => x.iso === d)?.corto ?? String(d));
      return `${dias.join("·")} (${turnos[0] ?? "—"})`;
    }
    case "EVERY_N_DAYS":
      return f.everyNDays === 1
        ? `Todos los días (${turnos[0] ?? "—"})`
        : `Cada ${f.everyNDays} días (${turnos[0] ?? "—"})`;
    case "MONTHLY":
      return `El día ${f.monthDay} de cada mes (${turnos[0] ?? "—"})`;
    case "ON_DEMAND":
      return "A demanda (no tiene agenda)";
  }
}
