// kds-1-cocina · LOS 14 ALÉRGENOS, en un solo sitio.
//
// La lista de declaración obligatoria del **anexo II del Reglamento (UE)
// 1169/2011**, que es la que un bar español tiene que poder informar de
// cada plato (art. 44.1.a y el RD 126/2015 que lo desarrolla en España).
//
// ── Por qué vive en `ticket-model` y no en la API ─────────────────────
//
// Porque hay cuatro consumidores y tienen que decir lo mismo:
//
//   1. la hoja de alergias del TPV (la rejilla de 14 iconos por silla);
//   2. la ficha del producto en el panel;
//   3. la pantalla de cocina, que pinta «⚠ SILLA 3 · SIN GLUTEN» y
//      «¡LLEVA GLUTEN!»;
//   4. el papel de la comanda cuando la sección no tiene pantalla —que es
//      por donde sale la alergia en un bar que no compró el módulo.
//
// Dos listas en dos sitios acaban en que la pantalla dice «Lácteos» y el
// papel «Leche», y en una alergia eso no es un detalle de estilo.
//
// ── Por qué el código corto, y de dónde sale ──────────────────────────
//
// `codigo` es el código de dos letras del **generador de cartas de La
// Maestranza** (`docs/implantaciones/maestranza/generador/maestranza_carta.py`,
// diccionario `ALG_HEX`), que ya lleva los alérgenos de sus 128 platos.
// Tenerlo aquí convierte la importación de su carta en una tabla de
// equivalencias comprobable, y no en una traducción a ojo de catorce
// nombres parecidos. Los catorce códigos del generador y los catorce
// valores del enum se corresponden uno a uno, y hay un test que lo guarda.
//
// `etiqueta` es el nombre largo y `corta` lo que cabe en una tarjeta de
// cocina a 1280 px: «SIN GLUTEN» no es un nombre, es lo que el cocinero
// necesita leer a un metro.
//
// ── Lo que esta lista NO hace ─────────────────────────────────────────
//
// No sabe nada de personas. Un alérgeno es una propiedad de un plato y de
// una silla de un servicio, nunca de un cliente: ver `TicketAllergy` en el
// esquema, que cuelga del ticket y no tiene clave hacia `Client`.

/** Los valores del enum `Allergen` de la base, en el orden del anexo II. */
export type Alergeno =
  | "GLUTEN"
  | "CRUSTACEOS"
  | "HUEVOS"
  | "PESCADO"
  | "CACAHUETES"
  | "SOJA"
  | "LACTEOS"
  | "FRUTOS_CASCARA"
  | "APIO"
  | "MOSTAZA"
  | "SESAMO"
  | "SULFITOS"
  | "ALTRAMUCES"
  | "MOLUSCOS";

export interface PresentacionAlergeno {
  /** El código de dos letras del generador de cartas de La Maestranza. */
  codigo: string;
  /** El nombre largo: la rejilla del TPV y la ficha del producto. */
  etiqueta: string;
  /**
   * Lo que se pinta en cocina, en mayúsculas y con el «SIN» delante: es
   * una instrucción al cocinero, no el nombre de una sustancia.
   */
  corta: string;
  /**
   * Cómo se nombra cuando es el plato el que lo lleva: «¡LLEVA GLUTEN!».
   * No es `corta` sin el «SIN» — «SIN FRUTOS DE CÁSCARA» ↔ «LLEVA FRUTOS
   * DE CÁSCARA», pero «SIN LÁCTEOS» ↔ «LLEVA LÁCTEOS» y «SIN SULFITOS» ↔
   * «LLEVA SULFITOS». Se escriben las dos y no se derivan.
   */
  lleva: string;
}

/**
 * Los catorce, EN EL ORDEN DEL ANEXO II.
 *
 * El orden importa porque es el de la rejilla del TPV, y el camarero que
 * use el TPV todos los días encuentra el gluten por donde está, no
 * leyendo. Ordenarla alfabéticamente la movería de sitio en cuanto
 * cambiase una etiqueta.
 */
export const ALERGENOS: Record<Alergeno, PresentacionAlergeno> = {
  GLUTEN: {
    codigo: "GL",
    etiqueta: "Cereales con gluten",
    corta: "SIN GLUTEN",
    lleva: "LLEVA GLUTEN",
  },
  CRUSTACEOS: {
    codigo: "CR",
    etiqueta: "Crustáceos",
    corta: "SIN CRUSTÁCEOS",
    lleva: "LLEVA CRUSTÁCEOS",
  },
  HUEVOS: {
    codigo: "HU",
    etiqueta: "Huevo",
    corta: "SIN HUEVO",
    lleva: "LLEVA HUEVO",
  },
  PESCADO: {
    codigo: "PE",
    etiqueta: "Pescado",
    corta: "SIN PESCADO",
    lleva: "LLEVA PESCADO",
  },
  CACAHUETES: {
    codigo: "CA",
    etiqueta: "Cacahuetes",
    corta: "SIN CACAHUETES",
    lleva: "LLEVA CACAHUETES",
  },
  SOJA: {
    codigo: "SO",
    etiqueta: "Soja",
    corta: "SIN SOJA",
    lleva: "LLEVA SOJA",
  },
  LACTEOS: {
    codigo: "LA",
    etiqueta: "Lácteos",
    corta: "SIN LÁCTEOS",
    lleva: "LLEVA LÁCTEOS",
  },
  FRUTOS_CASCARA: {
    codigo: "FC",
    etiqueta: "Frutos de cáscara",
    corta: "SIN FRUTOS DE CÁSCARA",
    lleva: "LLEVA FRUTOS DE CÁSCARA",
  },
  APIO: {
    codigo: "AP",
    etiqueta: "Apio",
    corta: "SIN APIO",
    lleva: "LLEVA APIO",
  },
  MOSTAZA: {
    codigo: "MO",
    etiqueta: "Mostaza",
    corta: "SIN MOSTAZA",
    lleva: "LLEVA MOSTAZA",
  },
  SESAMO: {
    codigo: "SE",
    etiqueta: "Sésamo",
    corta: "SIN SÉSAMO",
    lleva: "LLEVA SÉSAMO",
  },
  SULFITOS: {
    codigo: "SU",
    etiqueta: "Sulfitos",
    corta: "SIN SULFITOS",
    lleva: "LLEVA SULFITOS",
  },
  ALTRAMUCES: {
    codigo: "AL",
    etiqueta: "Altramuces",
    corta: "SIN ALTRAMUCES",
    lleva: "LLEVA ALTRAMUCES",
  },
  MOLUSCOS: {
    codigo: "MC",
    etiqueta: "Moluscos",
    corta: "SIN MOLUSCOS",
    lleva: "LLEVA MOLUSCOS",
  },
};

/** Los catorce en el orden del anexo II. */
export const LISTA_ALERGENOS: readonly Alergeno[] = Object.keys(
  ALERGENOS,
) as Alergeno[];

export function esAlergeno(v: unknown): v is Alergeno {
  return typeof v === "string" && v in ALERGENOS;
}

/** Del código de dos letras del generador al valor del enum. */
const POR_CODIGO = new Map<string, Alergeno>(
  LISTA_ALERGENOS.map((a) => [ALERGENOS[a].codigo, a]),
);

/**
 * Traduce un código de dos letras del generador de cartas.
 *
 * Devuelve `null` y NO lanza, a propósito: la importación de una carta
 * tiene que poder decir «esta clave no la conozco, estas tres líneas no
 * las toco» en vez de morirse a mitad y dejar media carta importada. El
 * script de importación lo cuenta y lo enseña en el «en seco».
 */
export function alergenoDesdeCodigo(codigo: string): Alergeno | null {
  return POR_CODIGO.get(codigo.trim().toUpperCase()) ?? null;
}

/**
 * La franja de la tarjeta de cocina para la alergia de una silla:
 * «⚠ SILLA 3 · SIN GLUTEN», o «⚠ TODA LA MESA · SIN GLUTEN» si no se sabe
 * en qué silla está.
 *
 * El «⚠ TODA LA MESA» tiene su propio sabotaje en la tabla del bloque:
 * una alergia sin silla que no saliera en cocina sería peor que no
 * haberla declarado, porque el camarero creería que la declaró.
 */
export function franjaAlergia(
  seat: number | null,
  alergenos: readonly Alergeno[],
): string {
  const quien = seat == null ? "TODA LA MESA" : `SILLA ${seat}`;
  const que = alergenos.map((a) => ALERGENOS[a].corta).join(" · ");
  return `⚠ ${quien} · ${que}`;
}

/**
 * Cómo se nombra a la PERSONA de esa silla, para la primera línea de la
 * franja de la pantalla.
 *
 * La maqueta escribe «SILLA 3 · CELÍACO». En una cocina española el
 * celíaco tiene su propia palabra y es la que se usa; para los otros trece
 * no hay una palabra corriente («sulfítico» no existe) y se dice
 * «ALÉRGICO». Con dos o más alérgenos en la misma silla también
 * «ALÉRGICO»: «CELÍACO Y ALÉRGICO A LOS LÁCTEOS» no cabe a 21 px en una
 * tarjeta de 251 px, y lo que hace falta leer de un golpe es que esa silla
 * tiene algo — el QUÉ va en la segunda línea, con el nombre del alérgeno.
 */
const PERSONA: Partial<Record<Alergeno, string>> = { GLUTEN: "CELÍACO" };

/** La franja de alergia de la tarjeta de cocina, en sus dos líneas. */
export interface FranjaAlergiaPantalla {
  /** «SILLA 3 · CELÍACO» / «TODA LA MESA · ALÉRGICO». 21 px, negrita. */
  titulo: string;
  /** «Gluten» / «Gluten · Lácteos». 15 px, debajo. */
  alergenos: string;
}

/**
 * La misma franja, pero para la PANTALLA y no para el papel.
 *
 * El papel sigue llevando la de arriba, en una línea y en mayúsculas, que
 * es lo que cabe en 42 caracteres de una térmica de 80 mm. La pantalla
 * tiene dos líneas y las usa, porque es lo que la maqueta dibuja y lo que
 * kds-1b vino a corregir: antes era una cajita oscura con «⚠ SILLA 3 · SIN
 * GLUTEN», y ahora es una franja roja ancha de ancho completo justo debajo
 * de la cabecera de la mesa.
 *
 * El «SIN GLUTEN» no desaparece: se va **al recuadro del plato** de esa
 * silla, que es donde dice algo — ahí es una instrucción sobre un plato
 * concreto, y en la franja era sólo una repetición del alérgeno.
 */
export function franjaAlergiaPantalla(
  seat: number | null,
  alergenos: readonly Alergeno[],
): FranjaAlergiaPantalla {
  const quien = seat == null ? "TODA LA MESA" : `SILLA ${seat}`;
  const persona =
    alergenos.length === 1 ? (PERSONA[alergenos[0]!] ?? "ALÉRGICO") : "ALÉRGICO";
  return {
    titulo: `${quien} · ${persona}`,
    alergenos: alergenos.map((a) => ALERGENOS[a].etiqueta).join(" · "),
  };
}

/**
 * Lo que va en la sub-franja del recuadro del plato de una silla con
 * alergia: «SIN GLUTEN». Vacío si esa silla no tiene nada declarado.
 */
export function sinAlergenos(alergenos: readonly Alergeno[]): string | null {
  if (alergenos.length === 0) return null;
  return alergenos.map((a) => ALERGENOS[a].corta).join(" · ");
}

/**
 * Los alérgenos de un plato que chocan con los de su silla.
 *
 * Es la capa 3 de la decisión 3: un plato **de la silla alérgica que lleva
 * su alérgeno** sale rojo y parpadeando. Vacío si el producto no tiene
 * alérgenos informados —que no es lo mismo que no tenerlos— y entonces la
 * capa 3 calla y las capas 1 y 2 siguen avisando igual.
 */
export function choqueAlergenos(
  alergenosDelPlato: readonly Alergeno[],
  alergenosDeLaSilla: readonly Alergeno[],
): Alergeno[] {
  if (alergenosDelPlato.length === 0 || alergenosDeLaSilla.length === 0) {
    return [];
  }
  const silla = new Set(alergenosDeLaSilla);
  return alergenosDelPlato.filter((a) => silla.has(a));
}

/** «¡LLEVA GLUTEN!» · «¡LLEVA GLUTEN Y LÁCTEOS!» */
export function avisoChoque(choque: readonly Alergeno[]): string | null {
  if (choque.length === 0) return null;
  const nombres = choque.map((a) => ALERGENOS[a].lleva.replace("LLEVA ", ""));
  const texto =
    nombres.length === 1
      ? nombres[0]!
      : `${nombres.slice(0, -1).join(", ")} Y ${nombres[nombres.length - 1]}`;
  return `¡LLEVA ${texto}!`;
}
