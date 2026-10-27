// clinica-10 (paso 33) · QUE EL NOMBRE SE LEA ENTERO.
//
// La pasada en hierro del 27-10 (captura 33) encontró el catálogo de
// Rosario en la pantalla de venta con tres tarjetas diciendo
// «biomecánic» —la palabra cortada A MITAD DE LETRA, sin puntos
// suspensivos— y el rail de categorías diciendo «Biomecáni…».
//
// Las dos son el mismo problema con dos remates distintos:
//
//   · la tarjeta tiene `line-clamp-3` + `overflow: hidden`, y una
//     palabra que no cabe en el ancho NO SE PARTE (lo normal en CSS):
//     se sale y la caja la recorta;
//   · el rail tiene `truncate`, que sí pone los puntos.
//
// A 1280 px de lienzo —la Lenovo TB311FU, 1920 físicos a densidad 1,5—
// la rejilla de venta es de cinco columnas y cada tarjeta mide 125 px;
// descontando su `px-3` quedan unos 101 px de texto. «biomecánica» a
// 16,5 px pide 108. Faltan siete píxeles y se lleva la última letra.
//
// ── Dos capas, y cada una tiene su trabajo ──────────────────────────
//
//   1. **El cuerpo** (esto). Se estima el ancho del texto y se baja el
//      tamaño de letra un peldaño hasta que quepa. Es lo que hace que
//      «Exploración biomecánica» se lea en dos líneas limpias y no
//      partida por donde no toca. Es una ESTIMACIÓN y no una medida: la
//      medida de verdad necesita el navegador, y esta pantalla se pinta
//      sin medir.
//   2. **`break-words` en el elemento**, que es la garantía. Quien
//      llama a esto tiene que dejarlo puesto: si la estimación se queda
//      corta —una fuente distinta, un nombre que nadie imaginó—, la
//      palabra se parte y se sigue leyendo entera. Lo que no puede
//      volver a pasar es que se recorte.
//
// Por eso la tabla de abajo tira a lo ANCHO: equivocarse de más baja
// una letra de tamaño y no pasa nada; equivocarse de menos deja una
// palabra partida. Las dos salidas son legibles, pero una es más fea.

/**
 * Lo que mide cada letra, en múltiplos del tamaño de letra (`em`).
 *
 * Tres clases y no una tabla por carácter porque la diferencia que
 * importa es ésa: «diagnóstico» y «biomecánica» tienen las dos once
 * letras y la segunda ocupa un 15 % más, porque lleva una `m` y la otra
 * lleva tres astas finas. Con un ancho medio único, o se recorta la una
 * o se encoge la otra sin motivo.
 *
 * Los números son de la Inter de la casa, redondeados hacia arriba.
 */
const ESTRECHAS = new Set("ijltfrI1.,;:'!|()[]/\\ ");
const ANCHAS = new Set("mwMW@%");
const EM_ESTRECHA = 0.33;
const EM_ANCHA = 0.95;
const EM_MAYUSCULA = 0.68;
const EM_NORMAL = 0.6;

/** Las mayúsculas, con las acentuadas del castellano. */
function esMayuscula(c: string): boolean {
  return c !== c.toLowerCase() && c === c.toUpperCase();
}

/** Lo que ocupa `texto` a `cuerpo` píxeles, en píxeles. Estimado. */
export function anchoAproximado(texto: string, cuerpo: number): number {
  let em = 0;
  for (const c of texto) {
    if (ESTRECHAS.has(c)) em += EM_ESTRECHA;
    else if (ANCHAS.has(c)) em += EM_ANCHA;
    else if (esMayuscula(c)) em += EM_MAYUSCULA;
    else em += EM_NORMAL;
  }
  return em * cuerpo;
}

/**
 * La palabra más larga de un texto, medida a un cuerpo cualquiera.
 *
 * Es lo que hay que hacer caber en una tarjeta de varias líneas: entre
 * palabras el texto ya se parte solo, y lo que no cabe en una línea es
 * una palabra suelta. Para una etiqueta de UNA línea (el rail) lo que
 * hay que pasar es el texto entero.
 */
export function palabraMasLarga(texto: string): string {
  let peor = "";
  for (const palabra of texto.split(/\s+/)) {
    if (anchoAproximado(palabra, 10) > anchoAproximado(peor, 10)) {
      peor = palabra;
    }
  }
  return peor;
}

/**
 * El primer cuerpo de `cuerpos` con el que `texto` cabe en `ancho`.
 *
 * `cuerpos` va de mayor a menor y el último es el suelo: si ni con ése
 * cabe, se devuelve ése igual. Encoger sin fin haría ilegible lo que se
 * quería poder leer, y para eso está `break-words` (ver la cabecera).
 */
export function cuerpoQueCabe(
  texto: string,
  ancho: number,
  cuerpos: readonly number[],
): number {
  for (const cuerpo of cuerpos) {
    if (anchoAproximado(texto, cuerpo) <= ancho) return cuerpo;
  }
  return cuerpos[cuerpos.length - 1]!;
}

// ── Los dos sitios donde se usa, con su ancho medido ─────────────────

/**
 * El ancho útil del nombre de una tarjeta de producto, en px.
 *
 * El caso estrecho y el que la pasada vio: lienzo de 1280, rejilla de
 * cinco columnas (`xl:grid-cols-5`), tarjeta de 125 px menos su `px-3`.
 * En handheld las tarjetas son bastante más anchas y este número sobra —
 * que un nombre larguísimo salga ahí un peldaño más pequeño de lo
 * necesario no le quita nada a nadie, y tener DOS números habría sido
 * tener dos sitios donde equivocarse.
 */
export const ANCHO_UTIL_TARJETA = 100;

/** Los peldaños del nombre de la tarjeta. El primero es el de v1.22 §3
 *  (hallazgo N5) y no se toca: lo que cambia es que ahora hay dónde
 *  bajarse cuando no cabe. */
export const CUERPOS_DE_TARJETA = [16.5, 15, 13.5, 12] as const;

/**
 * El ancho útil de una etiqueta del rail de categorías, en px.
 *
 * `CATEGORY_RAIL_WIDTH` (144) menos el padding (2 × 14), el icono (18),
 * el hueco (10) y el `pr-0.5` del `nav` (2): 88.
 */
export const ANCHO_UTIL_RAIL = 88;

/** Los peldaños de la etiqueta del rail. El primero es el de v1.22 §4. */
export const CUERPOS_DE_RAIL = [14, 13, 12] as const;
