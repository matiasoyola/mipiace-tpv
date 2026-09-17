// B-reservas-mostrador F2 · el color de la profesional, llevado a la tarjeta
// de la cita sin romper el contraste.
//
// El problema del 13-09 (AP11): en la rejilla, lo que más grita es el rayado
// de «no reservable» —una banda que dice que ahí NO se puede hacer nada— y la
// cita, que es lo único que importa, es blanca sobre blanco. La jerarquía
// está invertida.
//
// El color de la profesional (`StaffProfile.color`) existe desde B4 y sólo se
// usaba en un filete de 3 px en la cabecera de la columna. Aquí pasa al fondo
// de la tarjeta. Pero «el color al 10 %» no vale: un morado oscuro y un
// amarillo casi blanco acabarían con pesos visuales completamente distintos, y
// uno de los dos se comería el texto.
//
// Lo que se hace es NORMALIZAR LA LUMINANCIA. Cada color se lleva —aclarando
// hacia el blanco si es oscuro, o bajando los canales si es clarísimo— a una
// misma luminancia relativa objetivo. El tono sobrevive; el peso visual es el
// mismo para todas; y el contraste con el texto es el mismo número para todas,
// así que se puede garantizar de una vez.
//
// De dónde sale el objetivo 0,72 — lo fija el texto MÁS DÉBIL de la tarjeta,
// que es la segunda línea (el nombre de los servicios):
//
//   · Hasta este bloque era `text-slate-500` (#64748b, L = 0,1706). Sobre
//     blanco da 4,76:1 y pasa AA, pero para seguir pasándolo sobre un fondo
//     teñido haría falta L_fondo ≥ 0,943 — un tinte que no se ve. O sea: con
//     slate-500 el color de la profesional es incompatible con AA.
//   · Pasa a `text-slate-600` (#475569, L = 0,0886), que sólo pide
//     L_fondo ≥ 4,5 · (0,0886 + 0,05) − 0,05 = 0,574.
//   · Con 0,72 sobra margen: 5,56:1 en la segunda línea y 10,76:1 en la
//     primera (`mipiace-ink`, #1F2937, que pediría 0,272).
//
// Y el filete del ESTADO, que se queda encima del tinte, es un componente no
// textual: WCAG 1.4.11 pide 3:1. Al medirlo salió un defecto que NO es de este
// bloque y que el tinte sólo destapa: `STATUS_COLOR` tal cual **tampoco llega
// a 3:1 contra la tarjeta blanca de hoy** — el verde de «en sala» (#10b981) da
// 2,36:1 sobre blanco y el ámbar de «pendiente» (#f59e0b) da 1,94:1. Y el
// mismo problema estaba en el chip del detalle, que pinta texto BLANCO encima
// de esos colores (2,15:1 con el ámbar).
//
// Por eso el estado se pinta con un TONO derivado: el mismo color bajado hasta
// una luminancia máxima. Con 0,18 salen los dos números a la vez:
//   · contra el tinte (0,72) → 3,34:1 ✔ (filete, WCAG 1.4.11)
//   · contra el blanco del chip → 4,56:1 ✔ (texto, WCAG 1.4.3)
// `STATUS_COLOR` no se toca: sigue siendo el mapeo de estados del mockup, y de
// él sale el tono.

/** La luminancia relativa que se le exige a cualquier tinte de tarjeta. */
export const LUMINANCIA_TINTE = 0.72;

/** La luminancia MÁXIMA de un color de estado (filete y chip). */
export const LUMINANCIA_MAX_ESTADO = 0.18;

/**
 * La luminancia MÁXIMA del filete de 3 px que identifica la columna.
 *
 * Lo cogió el bucle visual: la cabecera pintaba el color CRUDO, y el de una
 * profesional con un amarillo casi blanco (#fef9c3) desaparecía sobre el
 * blanco de la cabecera — la columna se quedaba sin su marca. Es un
 * componente no textual (WCAG 1.4.11, 3:1), y contra blanco eso exige
 * L ≤ 1,05/3 − 0,05 = 0,30. Se deja en 0,29 y no en 0,30 clavado: el color
 * acaba en canales de 8 bits, y redondear con el techo justo dejaba algún
 * tono del repertorio en 2,99997:1 — un test rojo por un pelo que no vale
 * para nada. Con 0,29 el peor caso es 3,04:1.
 */
export const LUMINANCIA_MAX_CABECERA = 0.29;

export type Rgb = [number, number, number];

/** "#rgb" o "#rrggbb" → canales 0-255. `null` si no se entiende. */
export function parseHex(hex: string | null | undefined): Rgb | null {
  if (!hex) return null;
  const s = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) {
    return [
      parseInt(s[0]! + s[0]!, 16),
      parseInt(s[1]! + s[1]!, 16),
      parseInt(s[2]! + s[2]!, 16),
    ];
  }
  if (/^[0-9a-f]{6}$/i.test(s)) {
    return [
      parseInt(s.slice(0, 2), 16),
      parseInt(s.slice(2, 4), 16),
      parseInt(s.slice(4, 6), 16),
    ];
  }
  return null;
}

export function toHex([r, g, b]: Rgb): string {
  const dos = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${dos(r)}${dos(g)}${dos(b)}`;
}

/** Luminancia relativa de WCAG 2.x (0 = negro, 1 = blanco). */
export function luminanciaRelativa(rgb: Rgb): number {
  const lin = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as Rgb;
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Razón de contraste de WCAG entre dos colores. Siempre ≥ 1. */
export function contraste(a: string, b: string): number {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return 1;
  const la = luminanciaRelativa(ra);
  const lb = luminanciaRelativa(rb);
  const [alto, bajo] = la >= lb ? [la, lb] : [lb, la];
  return (alto + 0.05) / (bajo + 0.05);
}

/**
 * El color de la profesional llevado a la luminancia objetivo.
 *
 * Si es más oscuro que el objetivo se mezcla con blanco; si es más claro, se
 * bajan los canales proporcionalmente (que conserva el tono mejor que mezclar
 * con negro). En los dos casos la luminancia es monótona en el parámetro, así
 * que basta una bisección: 24 vueltas dejan el error por debajo de lo que
 * distingue un canal de 8 bits, y el resultado es DETERMINISTA — el mismo
 * color de entrada da el mismo tinte en cada render y en cada terminal.
 */
export function tinteClaro(
  hex: string | null | undefined,
  objetivo = LUMINANCIA_TINTE,
): string {
  const rgb = parseHex(hex);
  if (!rgb) return "#ffffff";
  const l = luminanciaRelativa(rgb);
  const mezcla =
    l < objetivo
      ? (t: number): Rgb =>
          [
            rgb[0] + (255 - rgb[0]) * t,
            rgb[1] + (255 - rgb[1]) * t,
            rgb[2] + (255 - rgb[2]) * t,
          ]
      : (t: number): Rgb => [rgb[0] * (1 - t), rgb[1] * (1 - t), rgb[2] * (1 - t)];

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const lm = luminanciaRelativa(mezcla(mid));
    // Aclarando, la luminancia SUBE con t; oscureciendo, BAJA.
    if (l < objetivo ? lm < objetivo : lm > objetivo) lo = mid;
    else hi = mid;
  }
  return toHex(mezcla((lo + hi) / 2));
}

/**
 * Un color bajado hasta caber bajo un techo de luminancia.
 *
 * Es `tinteClaro` con el objetivo por el otro lado: un color que ya está por
 * debajo del techo se deja como está, y uno por encima se baja
 * proporcionalmente, que conserva el tono. El ámbar sigue siendo ámbar y el
 * amarillo, amarillo; lo que cambia es que se ven.
 */
export function bajarHasta(hex: string | null | undefined, techo: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return "#000000";
  if (luminanciaRelativa(rgb) <= techo) return hex!.trim();
  return tinteClaro(hex, techo);
}

/** El color con el que se pinta un ESTADO de cita (filete y chip). */
export function tonoDeEstado(
  hex: string,
  techo = LUMINANCIA_MAX_ESTADO,
): string {
  return bajarHasta(hex, techo);
}

// ── El color de quien no tiene color ──────────────────────────────────
//
// Un `StaffProfile` puede tener `color = null` (la pantalla del admin todavía
// no lo pide). Ese caso NO puede resolverse con un color al azar: la tarjeta
// cambiaría de color en cada repintado y la cajera vería la agenda parpadear.
// Sale del `userId`, que es estable: mismo id, mismo color, siempre, y en
// todos los terminales del centro.

/** Ocho tonos bien separados en el círculo, a saturación pareja. */
const PALETA = [
  "#6366f1", // índigo
  "#0ea5e9", // cielo
  "#14b8a6", // verde azulado
  "#84cc16", // lima
  "#f59e0b", // ámbar
  "#f43f5e", // rosa fuerte
  "#a855f7", // violeta
  "#ec4899", // magenta
];

/** FNV-1a de 32 bits. Determinista y sin dependencias. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** El color base de una profesional: el suyo, o uno estable de la paleta. */
export function colorDeProfesional(
  userId: string,
  color: string | null | undefined,
): string {
  if (parseHex(color)) return color!.trim();
  return PALETA[hash32(userId) % PALETA.length]!;
}

/** El fondo de la tarjeta de una cita de esa profesional. */
export function tinteDeProfesional(
  userId: string,
  color: string | null | undefined,
): string {
  return tinteClaro(colorDeProfesional(userId, color));
}

/** El filete de 3 px de la cabecera de su columna: el mismo tono, pero
 *  garantizando que se ve sobre el blanco de la cabecera. */
export function colorDeCabecera(
  userId: string,
  color: string | null | undefined,
): string {
  return bajarHasta(colorDeProfesional(userId, color), LUMINANCIA_MAX_CABECERA);
}
