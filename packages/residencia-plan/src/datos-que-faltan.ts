// alta-minima · **QUÉ LE FALTA A UNA FICHA DE RESIDENTE.**
//
// La señora ya vive aquí. Lo que el centro tiene el primer día es un
// listado de nombres, y obligar a tener la fecha de ingreso y el grado
// antes de poder crearla significa que **no está en el programa**: no
// aparece en la puerta, no se le puede apuntar «algo no va bien» y el
// relevo no la ve.
//
// Así que la ficha nace con el nombre y lo que falta pasa a ser **dato,
// no código**: esta función lo enumera y las cuatro pantallas que la
// dirección mira lo cantan hasta que esté completa.
//
// ── POR QUÉ ESTÁ EN EL PAQUETE PURO Y NO EN LA RUTA ─────────────────
//
// Por lo mismo que `queToca` y `gravedadDe`: lo ejecutan DOS sitios que
// tienen que decir lo mismo.
//
//   · la API, para la etiqueta de cada fila, la banda de la ficha, la
//     tarjeta del panel y la obligación del mes;
//   · el admin, para la vista previa del alta rápida y para no pintar un
//     aviso distinto del que el servidor acaba de contar.
//
// Y porque **añadir un campo mañana es una línea de esta tabla**. Ése es
// el criterio del bloque: la lista vive en un sitio.
//
// ── LO QUE ESTA FUNCIÓN NO MIRA ─────────────────────────────────────
//
// **El contenido de un dato cifrado.** El DNI y el NSS viven cifrados
// (residencia-1b, D-63) y contar si faltan no exige descifrarlos: basta
// con saber si la columna es NULL, y eso es lo que llega aquí como
// `tieneDni` / `tieneNss`. Esta función no toca una clave en su vida, y
// por eso puede correr también en el navegador.
//
// ── historia-1 LA ABSORBE ───────────────────────────────────────────
//
// historia-1 construye el ingreso guiado (`AdmissionChecklist`, D-94),
// que es la versión completa de esto: contrato firmado, consentimientos,
// alergias revisadas, dieta, dispositivos, escalas iniciales, PAI en 30
// días. Esta tabla es su primer tramo y la forma está pensada para que se
// extienda sin reescribirla:
//
//   · cada elemento tiene un `campo` ESTABLE, que es el código con el
//     que el checklist lo nombrará;
//   · el `peso` ya distingue «sin esto no se factura» de «estaría bien»;
//   · la regla de la plaza concertada demuestra que un elemento puede
//     cambiar de peso según otro dato, que es lo que el checklist
//     necesita para «contrato firmado» o «comunicar la baja».
//
// Lo que historia-1 tendrá que añadir son filas, no estructura.

/**
 * Cuánto pesa que falte.
 *
 * **Ninguno de los dos bloquea nada.** Un residente incompleto se atiende
 * igual: entra por la puerta, se le registra «como siempre» y sale en el
 * parte. La diferencia es el color del aviso y el orden en que la
 * dirección los va cerrando.
 *
 *   · `IMPRESCINDIBLE` — sin esto la ficha no sirve para lo que la ficha
 *     existe: no se puede facturar, no se puede llamar a nadie si pasa
 *     algo, o el residente no tiene cuidados agendados.
 *   · `RECOMENDABLE` — falta y se nota, pero el centro funciona.
 */
export type PesoDelDato = "IMPRESCINDIBLE" | "RECOMENDABLE";

/**
 * Los campos que esta tabla sabe echar en falta.
 *
 * Es una unión y no un `string` a propósito: el día que alguien escriba
 * `"telefonoFamiliar"` en vez de `"telefonoDelFamiliar"` en la pantalla,
 * lo dice el compilador y no una banda que no enlaza a ningún sitio.
 */
export type CampoDeFicha =
  | "apellidos"
  | "fechaDeIngreso"
  | "nivelDeDependencia"
  | "tipoDePlaza"
  | "dni"
  | "familiarResponsable"
  | "telefonoDelFamiliar"
  | "planDeCuidados"
  | "nss"
  | "fechaDeNacimiento"
  | "gradoReconocido"
  | "cama";

/** Un dato que falta, tal y como lo pinta la pantalla. */
export interface DatoQueFalta {
  /** El código estable. Es lo que el admin traduce a «a qué input llevo». */
  campo: CampoDeFicha;
  /** Lo que lee la dirección. En minúscula: se compone en frases. */
  etiqueta: string;
  peso: PesoDelDato;
}

/**
 * Lo que `datosQueFaltan` necesita saber de un residente.
 *
 * **Presencia, no valor**, en todo lo que está cifrado o cuelga de otra
 * tabla: `tieneDni`, `tieneCama`, `tienePlan`. Pedir el valor obligaría a
 * descifrar un DNI para contar que está, y a traer el plan entero para
 * saber si tiene alguna línea viva.
 *
 * Los tres que este bloque vuelve opcionales (`admissionDate`,
 * `dependencyLevel`, `placeType`) llegan como `string | null` y no como
 * enums del cliente de Prisma: este paquete no depende de la base. Lo
 * único que se mira de `placeType` es si vale `"CONCERTADA"`.
 */
export interface FichaParaCompletar {
  /** `firstName` no entra: sin nombre no se crea nadie, así que nunca falta. */
  lastName: string | null;
  admissionDate: string | null;
  dependencyLevel: string | null;
  placeType: string | null;
  dependencyGrade: string | null;
  birthdate: string | null;
  responsibleName: string | null;
  responsiblePhone: string | null;
  /** residencia-1b · si la columna cifrada (o la clara antigua) tiene algo. */
  tieneDni: boolean;
  tieneNss: boolean;
  /** Si tiene una ocupación de cama viva. */
  tieneCama: boolean;
  /** Si tiene al menos una línea de plan de cuidados vigente. */
  tienePlan: boolean;
}

/** `true` si el texto es algo más que espacios. */
function hay(v: string | null | undefined): boolean {
  return v != null && v.trim() !== "";
}

/**
 * **La tabla.** Lo que le falta a una ficha, en el orden en que la
 * dirección lo va a cerrar: primero lo imprescindible, y dentro de cada
 * grupo lo que más duele arriba.
 *
 * Devolver una lista ORDENADA y no un objeto con banderas es lo que
 * permite que la banda de la ficha diga «le faltan: fecha de ingreso,
 * DNI, familiar responsable» leyendo de izquierda a derecha, y que la
 * etiqueta de la fila cuente `.length` sin saber qué hay dentro.
 *
 * ── Las dos reglas que no son «está o no está» ──────────────────────
 *
 *   1. **El grado reconocido depende de la plaza.** En una plaza
 *      concertada, sin grado **no se factura a la Junta**: pasa a
 *      imprescindible. En una privada estaría bien tenerlo y nada más.
 *      Con la plaza todavía sin poner no se sabe, y entonces se queda en
 *      recomendable: el día que la dirección ponga «concertada», el
 *      grado sube solo.
 *   2. **El teléfono del familiar se pide cuando hay familiar.** Sin
 *      nombre, lo que falta es el familiar —pedir su teléfono antes de
 *      saber quién es sería un aviso que no se puede cerrar—. Con
 *      nombre y sin teléfono, lo que falta es el teléfono, que es la
 *      mitad que sirve para algo a las cuatro de la mañana.
 */
export function datosQueFaltan(ficha: FichaParaCompletar): DatoQueFalta[] {
  const fuera: DatoQueFalta[] = [];
  const falta = (campo: CampoDeFicha, etiqueta: string, peso: PesoDelDato) => {
    fuera.push({ campo, etiqueta, peso });
  };

  // ── Imprescindibles ──────────────────────────────────────────────
  if (!hay(ficha.lastName)) {
    falta("apellidos", "apellidos", "IMPRESCINDIBLE");
  }
  if (!hay(ficha.admissionDate)) {
    falta("fechaDeIngreso", "fecha de ingreso", "IMPRESCINDIBLE");
  }
  if (!hay(ficha.dependencyLevel)) {
    falta("nivelDeDependencia", "nivel de dependencia", "IMPRESCINDIBLE");
  }
  if (!hay(ficha.placeType)) {
    falta("tipoDePlaza", "tipo de plaza", "IMPRESCINDIBLE");
  }
  if (!ficha.tieneDni) {
    falta("dni", "DNI", "IMPRESCINDIBLE");
  }
  if (!hay(ficha.responsibleName)) {
    falta("familiarResponsable", "familiar responsable", "IMPRESCINDIBLE");
  } else if (!hay(ficha.responsiblePhone)) {
    falta(
      "telefonoDelFamiliar",
      "teléfono del familiar responsable",
      "IMPRESCINDIBLE",
    );
  }
  // El plan es imprescindible y va al final de su grupo porque es el
  // único que no se arregla escribiendo en un input: hace falta tener el
  // nivel antes (sin nivel no hay plantilla que cargar, decisión 5).
  if (!ficha.tienePlan) {
    falta("planDeCuidados", "plan de cuidados", "IMPRESCINDIBLE");
  }

  // ── Recomendables ────────────────────────────────────────────────
  //
  // El grado PRIMERO de los recomendables, porque es el que puede
  // ascender: así la lista no cambia de orden al cambiar de peso.
  if (!hay(ficha.dependencyGrade)) {
    falta(
      "gradoReconocido",
      "grado reconocido",
      ficha.placeType === "CONCERTADA" ? "IMPRESCINDIBLE" : "RECOMENDABLE",
    );
  }
  if (!ficha.tieneNss) {
    falta("nss", "nº de la Seguridad Social", "RECOMENDABLE");
  }
  if (!hay(ficha.birthdate)) {
    falta("fechaDeNacimiento", "fecha de nacimiento", "RECOMENDABLE");
  }
  if (!ficha.tieneCama) {
    falta("cama", "cama asignada", "RECOMENDABLE");
  }

  // El grado concertado sube de peso pero NO de sitio en la lista, así
  // que el orden final se reordena por peso una sola vez. `sort` estable
  // (lo es en todos los motores desde ES2019), así que dentro de cada
  // peso se conserva el orden de arriba.
  return fuera.sort((a, b) => pesoNumerico(a.peso) - pesoNumerico(b.peso));
}

function pesoNumerico(p: PesoDelDato): number {
  return p === "IMPRESCINDIBLE" ? 0 : 1;
}

/** Lo que la etiqueta de una fila y la banda de la ficha necesitan. */
export interface EstadoDeLaFicha {
  faltan: DatoQueFalta[];
  /** `false` cuando no falta nada: entonces no se pinta ningún aviso. */
  incompleta: boolean;
  /** Si falta algo IMPRESCINDIBLE. Decide el color: rojo o ámbar. */
  conImprescindibles: boolean;
}

/** `datosQueFaltan` más lo que la pantalla pregunta de ello. */
export function estadoDeLaFicha(ficha: FichaParaCompletar): EstadoDeLaFicha {
  const faltan = datosQueFaltan(ficha);
  return {
    faltan,
    incompleta: faltan.length > 0,
    conImprescindibles: faltan.some((f) => f.peso === "IMPRESCINDIBLE"),
  };
}

/** El resumen del CENTRO: lo que pinta la tarjeta del panel. */
export interface ResumenDeFichas {
  /** Cuántos residentes vivos hay. */
  total: number;
  /** Cuántos tienen algo que falta. */
  incompletas: number;
  /** Y cuántos datos suman entre todos: «31 datos pendientes». */
  datosPendientes: number;
  /** De las incompletas, cuántas tienen algún imprescindible. */
  conImprescindibles: number;
}

/**
 * El resumen de un centro a partir de la lista de lo que le falta a cada
 * uno.
 *
 * Recibe una lista de listas y no los residentes: así la API la puede
 * llamar con lo que ya calculó para la respuesta y el admin con lo que ya
 * tiene pintado, sin que ninguno de los dos vuelva a recorrer la tabla.
 */
export function resumenDeFichas(porResidente: DatoQueFalta[][]): ResumenDeFichas {
  const incompletas = porResidente.filter((f) => f.length > 0);
  return {
    total: porResidente.length,
    incompletas: incompletas.length,
    datosPendientes: incompletas.reduce((n, f) => n + f.length, 0),
    conImprescindibles: incompletas.filter((f) =>
      f.some((d) => d.peso === "IMPRESCINDIBLE"),
    ).length,
  };
}
