// n1-hosteleria-2 · R4 · EL CONTRASTE SE MIDE, NO SE MIRA.
//
// La regla R4 del bloque pide «contraste AA (4,5:1) sobre el color de
// cada estado» en todas las pantallas de venta y sala del N1. Dicho así
// parece una revisión a ojo, y a ojo es exactamente como se cuelan los
// fallos que este bloque encontró:
//
//   · la etiqueta «LISTO» de una mesa llevaba `#FFFFFF` sobre el verde
//     `#8FD9A8` desde kds-1. Medido: **1,66:1**. No es «poco
//     contraste» — es texto invisible, y la constante correcta
//     (`VERDE_LISTA_TEXT`) estaba exportada justo al lado y sin usar;
//   · el importe de una mesa ocupada llevaba blanco sobre el coral de la
//     casa: **3,03:1**. Pasa de milagro el umbral de «texto grande» y no
//     el de texto normal, que es lo que un importe de 15 px es.
//
// Las dos llevaban meses en pantalla y las dos se ven bien en una
// captura si uno no las mide. De ahí este módulo: una función pura, sin
// navegador, para que los bancos puedan recorrer la tabla de estados
// entera.
//
// La fórmula es la de WCAG 2.1 (relative luminance + ratio), que es la
// que cita el bloque al pedir 4,5:1.

/** Un color `#RRGGBB` a sus tres canales en 0…1. */
function canales(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (h.length !== 6) {
    throw new Error(`contraste: se esperaba #RRGGBB y llegó «${hex}»`);
  }
  const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return [v[0]!, v[1]!, v[2]!];
}

/** La linealización de sRGB que pide WCAG antes de pesar los canales. */
function lineal(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Luminancia relativa de un color, 0 (negro) … 1 (blanco). */
export function luminancia(hex: string): number {
  const [r, g, b] = canales(hex).map(lineal) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Lo que de verdad se ve cuando un color se pinta con `opacidad` encima
 * de otro.
 *
 * Hace falta porque media sala está escrita con `opacity`: los `pax` de
 * una mesa libre van a 0,65, la meta de una ocupada a 0,85 y la tarjeta
 * de una mesa unida entera a 0,55. Medir el contraste del color NOMINAL
 * de esos textos da un número que nadie ve — y siempre mejor que el
 * real, que es la dirección en la que un error no se nota.
 */
export function mezcla(
  color: string,
  fondo: string,
  opacidad: number,
): string {
  const c = canales(color);
  const f = canales(fondo);
  const m = c.map((v, i) => v * opacidad + f[i]! * (1 - opacidad));
  return (
    "#" +
    m
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/**
 * La razón de contraste entre dos colores, de 1:1 a 21:1.
 *
 * `opacidad` es la del PRIMER color sobre el segundo; por defecto 1, que
 * es un texto opaco.
 */
export function contraste(
  color: string,
  fondo: string,
  opacidad = 1,
): number {
  const efectivo = opacidad === 1 ? color : mezcla(color, fondo, opacidad);
  const a = luminancia(efectivo);
  const b = luminancia(fondo);
  const [alto, bajo] = a > b ? [a, b] : [b, a];
  return (alto + 0.05) / (bajo + 0.05);
}

/**
 * El umbral AA de WCAG para texto normal. Es el que cita R4.
 */
export const AA_TEXTO_NORMAL = 4.5;

/**
 * El umbral AA para «texto grande»: ≥ 24 px, o ≥ 18,66 px en negrita.
 *
 * Está aquí para poder decir en voz alta cuándo se usa y cuándo no. En
 * este bloque **no se usa para nada que lleve un número**: el blanco
 * sobre el coral da 3,03:1 y se acogía a este umbral por tener el nombre
 * de la mesa en negrita a 20 px, mientras el importe de al lado —texto
 * normal— se quedaba sin cumplir ninguno de los dos.
 */
export const AA_TEXTO_GRANDE = 3;

/** ¿Es «texto grande» a efectos de WCAG? */
export function esTextoGrande(fontPx: number, negrita: boolean): boolean {
  return fontPx >= 24 || (negrita && fontPx >= 18.66);
}
