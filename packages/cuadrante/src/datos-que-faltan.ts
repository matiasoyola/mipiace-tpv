// personal-1 (decisión 2) · **QUÉ LE FALTA A UNA FICHA DE PERSONAL.**
//
// El mismo patrón exacto que `datosQueFaltan` del residente (alta-minima),
// y a propósito: la lección es la misma y el centro ya la conoce. La
// auxiliar ya trabaja aquí; no saber su nº de afiliación no hace que fiche
// menos. Lo que falta pasa a ser **dato, no código**, y el programa no
// deja de recordarlo.
//
// ── POR QUÉ EN EL PAQUETE PURO ───────────────────────────────────────
//
// Porque lo ejecutan dos sitios que tienen que decir lo mismo: la API (la
// etiqueta de cada fila, la banda de la ficha, el aviso del panel) y el
// admin (la vista previa de la importación, para no pintar un aviso
// distinto del que el servidor acaba de contar).
//
// Y porque **añadir un campo mañana es una línea de esta tabla.**
//
// ── LO QUE ESTA FUNCIÓN NO MIRA ──────────────────────────────────────
//
// El contenido de un dato cifrado. El DNI y el nº de afiliación viven
// cifrados y contar si faltan no exige descifrarlos: basta con saber si la
// columna es NULL, y eso es lo que llega aquí como `tieneDni` /
// `tieneAfiliacion`. Esta función no toca una clave en su vida, y por eso
// puede correr también en el navegador.

/** Cuánto pesa que falte. Ninguno de los dos bloquea nada. */
export type PesoDelDatoDePersonal = "IMPRESCINDIBLE" | "RECOMENDABLE";

/**
 * Los campos que esta tabla sabe echar en falta.
 *
 * Unión y no `string`: el día que alguien escriba `"jornada"` en vez de
 * `"jornadaSemanal"` en la pantalla, lo dice el compilador y no una banda
 * que no enlaza a ningún sitio.
 */
export type CampoDeFichaDePersonal =
  | "apellidos"
  | "dni"
  | "afiliacion"
  | "categoria"
  | "jornadaSemanal"
  | "fechaDeAlta"
  | "finPrevisto"
  | "tipoDeContrato"
  | "telefono"
  | "email";

export interface DatoQueFaltaDePersonal {
  campo: CampoDeFichaDePersonal;
  /** Lo que lee la dirección. En minúscula: se compone en frases. */
  etiqueta: string;
  peso: PesoDelDatoDePersonal;
}

/**
 * Lo que hace falta saber de una ficha para contar lo que le falta.
 *
 * **Presencia, no valor**, en los dos cifrados. Y los enums llegan como
 * `string | null`, no como tipos del cliente de Prisma: este paquete no
 * depende de la base.
 */
export interface FichaDePersonalParaCompletar {
  /** `name` no entra: sin nombre no se crea a nadie, así que nunca falta. */
  lastName: string | null;
  /** Si la columna cifrada tiene algo. */
  tieneDni: boolean;
  tieneAfiliacion: boolean;
  /** El id de la categoría, o `null`. Lo único que se mira es si está. */
  categoryId: string | null;
  /** Minutos a la semana. */
  weeklyMinutes: number | null;
  /** «YYYY-MM-DD». */
  hiredOn: string | null;
  /** `INDEFINIDO` | `TEMPORAL` | `null`. */
  contractKind: string | null;
  contractEndsOn: string | null;
  phone: string | null;
  email: string | null;
}

function hay(v: string | null | undefined): boolean {
  return v != null && v.trim() !== "";
}

/**
 * **La tabla.** Lo que le falta a una ficha de personal, en el orden en
 * que la dirección lo va a cerrar: primero lo imprescindible y, dentro de
 * cada grupo, lo que más duele arriba.
 *
 * Los imprescindibles son los seis del prompt más el séptimo condicional:
 * apellidos, DNI/NIE, afiliación, categoría, jornada, fecha de alta, y
 * **fin previsto si el contrato es temporal**.
 *
 * ── Las dos reglas que no son «está o no está» ───────────────────────
 *
 *   1. **El fin previsto depende del tipo de contrato.** En un temporal
 *      es imprescindible: sin él, el aviso de «se le acaba el contrato en
 *      15 días» —que es lo que hoy se olvida y la razón de ser de este
 *      campo— no puede salir nunca. En un indefinido no se pide, y además
 *      la base no lo deja poner (CHECK). Y con el tipo de contrato sin
 *      declarar no se sabe, así que no se pide: el día que la dirección
 *      ponga «temporal», el fin previsto aparece solo en la lista. Misma
 *      forma exacta que `gradoReconocido` con la plaza concertada en
 *      alta-minima.
 *
 *   2. **El tipo de contrato es RECOMENDABLE y no imprescindible**, aunque
 *      de él cuelgue la regla de arriba. El prompt enumera los seis
 *      imprescindibles y éste no está, y la decisión se respeta: una ficha
 *      sin tipo de contrato sirve para fichar, para el cuadrante y para el
 *      registro de jornada. Lo que no sirve es para avisar de un fin que
 *      no se sabe que llega — y eso lo dice el ámbar.
 */
export function datosQueFaltanDePersonal(
  ficha: FichaDePersonalParaCompletar,
): DatoQueFaltaDePersonal[] {
  const fuera: DatoQueFaltaDePersonal[] = [];
  const falta = (
    campo: CampoDeFichaDePersonal,
    etiqueta: string,
    peso: PesoDelDatoDePersonal,
  ) => {
    fuera.push({ campo, etiqueta, peso });
  };

  // ── Imprescindibles ──────────────────────────────────────────────
  if (!hay(ficha.lastName)) falta("apellidos", "apellidos", "IMPRESCINDIBLE");
  if (!ficha.tieneDni) falta("dni", "DNI o NIE", "IMPRESCINDIBLE");
  if (!ficha.tieneAfiliacion) {
    falta("afiliacion", "nº de afiliación a la Seguridad Social", "IMPRESCINDIBLE");
  }
  if (!hay(ficha.categoryId)) {
    falta("categoria", "categoría profesional", "IMPRESCINDIBLE");
  }
  if (ficha.weeklyMinutes == null) {
    falta("jornadaSemanal", "jornada contratada", "IMPRESCINDIBLE");
  }
  if (!hay(ficha.hiredOn)) {
    falta("fechaDeAlta", "fecha de alta", "IMPRESCINDIBLE");
  }
  // El condicional, y va al final de su grupo porque sólo existe para la
  // mitad de las fichas.
  if (ficha.contractKind === "TEMPORAL" && !hay(ficha.contractEndsOn)) {
    falta("finPrevisto", "fecha de fin prevista", "IMPRESCINDIBLE");
  }

  // ── Recomendables ────────────────────────────────────────────────
  //
  // El tipo de contrato PRIMERO, porque es el que abre el condicional de
  // arriba: ponerlo puede añadir un imprescindible, y así la lista no
  // cambia de orden al cambiar de peso.
  if (!hay(ficha.contractKind)) {
    falta("tipoDeContrato", "tipo de contrato", "RECOMENDABLE");
  }
  if (!hay(ficha.phone)) falta("telefono", "teléfono", "RECOMENDABLE");
  if (!hay(ficha.email)) falta("email", "email", "RECOMENDABLE");

  // `sort` estable (lo es en todos los motores desde ES2019), así que
  // dentro de cada peso se conserva el orden de arriba.
  return fuera.sort((a, b) => pesoNumerico(a.peso) - pesoNumerico(b.peso));
}

function pesoNumerico(p: PesoDelDatoDePersonal): number {
  return p === "IMPRESCINDIBLE" ? 0 : 1;
}

export interface EstadoDeLaFichaDePersonal {
  faltan: DatoQueFaltaDePersonal[];
  incompleta: boolean;
  /** Si falta algo IMPRESCINDIBLE. Decide el color: rojo o ámbar. */
  conImprescindibles: boolean;
}

export function estadoDeLaFichaDePersonal(
  ficha: FichaDePersonalParaCompletar,
): EstadoDeLaFichaDePersonal {
  const faltan = datosQueFaltanDePersonal(ficha);
  return {
    faltan,
    incompleta: faltan.length > 0,
    conImprescindibles: faltan.some((f) => f.peso === "IMPRESCINDIBLE"),
  };
}

export interface ResumenDeFichasDePersonal {
  total: number;
  incompletas: number;
  datosPendientes: number;
  conImprescindibles: number;
}

/** El resumen de la plantilla: lo que pinta el aviso del panel. */
export function resumenDeFichasDePersonal(
  porPersona: DatoQueFaltaDePersonal[][],
): ResumenDeFichasDePersonal {
  const incompletas = porPersona.filter((f) => f.length > 0);
  return {
    total: porPersona.length,
    incompletas: incompletas.length,
    datosPendientes: incompletas.reduce((n, f) => n + f.length, 0),
    conImprescindibles: incompletas.filter((f) =>
      f.some((d) => d.peso === "IMPRESCINDIBLE"),
    ).length,
  };
}

// ── El temporal que se le acaba ───────────────────────────────────────

/**
 * Cuántos días quedan para que acabe el contrato, o `null` si no hay fecha.
 *
 * Días de CALENDARIO entre dos fechas de pared, sin tocar instantes:
 * «¿cuántos días le quedan?» es una pregunta del calendario del centro, y
 * restar milisegundos daría 14,96 días la semana del cambio de hora.
 */
export function diasHastaElFin(
  contractEndsOn: string | null,
  hoy: string,
): number | null {
  if (!hay(contractEndsOn)) return null;
  const [ay, am, ad] = hoy.split("-").map(Number);
  const [by, bm, bd] = contractEndsOn!.split("-").map(Number);
  return Math.round(
    (Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)) / 86_400_000,
  );
}

/**
 * Cuántos días antes del fin de un contrato temporal se avisa.
 *
 * **Quince**, y es el número del prompt: es lo que hoy se olvida. Da
 * tiempo a renovar, a avisar a la persona o a buscar a quien la sustituya,
 * y es poco como para que el aviso siga significando algo cuando sale.
 */
export const DIAS_DE_AVISO_DE_FIN = 15;

/**
 * ¿Hay que avisar de que a esta persona se le acaba el contrato?
 *
 * `true` desde quince días antes **y también después de la fecha**: un
 * contrato que venció hace tres días y cuya persona sigue en el cuadrante
 * es un aviso más urgente, no uno que se apaga. El número de días lo dice
 * `diasHastaElFin`, y en ese caso es negativo.
 */
export function elContratoSeAcaba(
  ficha: { contractKind: string | null; contractEndsOn: string | null },
  hoy: string,
  dias: number = DIAS_DE_AVISO_DE_FIN,
): boolean {
  if (ficha.contractKind !== "TEMPORAL") return false;
  const quedan = diasHastaElFin(ficha.contractEndsOn, hoy);
  return quedan != null && quedan <= dias;
}
