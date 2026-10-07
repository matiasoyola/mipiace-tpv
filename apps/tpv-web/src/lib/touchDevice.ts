// v1.22-el-terminal-del-bar · §1 (hallazgo N1 de la auditoría del
// 2026-10-06 sobre el AP13 / Kozen D8).
//
// "¿Esto es táctil?" dejaba de funcionar en cuanto un fabricante mentía.
// Hasta aquí la pregunta se hacía en un sitio, con una sola media query:
//
//   matchMedia("(pointer: coarse)").matches
//
// y el WebView 101 del Kozen D8 —pantalla goodix, `INPUT_PROP_DIRECT`—
// contesta que su puntero es FINO:
//
//   (pointer: coarse)      false
//   (pointer: fine)        true
//   (any-pointer: coarse)  false
//   (hover: hover)         false   →  (hover: none) true
//   navigator.maxTouchPoints  5
//
// Con eso, el refoco permanente del buscador de `SalePage` (que existe
// para el lector USB-HID) corría en cada toque, Android sacaba el QWERTY
// y el viewport pasaba de 812 a 368 px — también encima del CashPad del
// cobro mixto, que es donde bloquea un cobro.
//
// La detección de aquí es la PRIMERA de las dos capas del arreglo. La
// segunda es `inputMode="none"` en el buscador plegado: aunque esta
// función vuelva a equivocarse con el WebView del próximo fabricante, un
// input que no pide teclado no lo abre. Las dos, no una.
//
// Por qué estas tres señales y no otras:
//   - `(pointer: coarse)`      el caso normal, el que ya funcionaba.
//   - `(any-pointer: coarse)`  un terminal con dedo Y ratón conectado:
//                              el puntero primario puede ser el fino.
//   - `maxTouchPoints > 0` Y `(hover: none)`  el caso del D8. Los dos
//     juntos a propósito: `maxTouchPoints > 0` por sí solo da positivo
//     en un portátil con pantalla táctil usado con ratón y trackpad
//     —donde el refoco permanente SÍ es lo que se quiere—, y `hover:
//     none` es justo lo que distingue "se usa con el dedo" de "tiene
//     dedo disponible".

/**
 * La ventana que se interroga. Parámetro y no `window` global para que el
 * test pueda montar el entorno exacto del D8 sin tocar el entorno de
 * jsdom (que es compartido con el resto de la suite).
 */
export interface PointerEnvironment {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { maxTouchPoints?: number };
}

/**
 * ¿Se usa este terminal con el dedo?
 *
 * Devuelve `false` cuando no hay forma de saberlo (SSR, jsdom sin
 * `matchMedia`): sin señales, el comportamiento es el de un escritorio
 * con ratón, que es el que había antes de este bloque.
 */
export function isTouchDevice(env?: PointerEnvironment): boolean {
  const w: PointerEnvironment | undefined =
    env ?? (typeof window !== "undefined" ? (window as PointerEnvironment) : undefined);
  if (!w) return false;

  const mm = typeof w.matchMedia === "function" ? w.matchMedia.bind(w) : null;
  const matches = (q: string): boolean => {
    if (!mm) return false;
    try {
      return mm(q).matches === true;
    } catch {
      // Un `matchMedia` que no entiende la consulta no puede tumbar la
      // pantalla de venta.
      return false;
    }
  };

  if (matches("(pointer: coarse)")) return true;
  if (matches("(any-pointer: coarse)")) return true;

  const touchPoints = w.navigator?.maxTouchPoints ?? 0;
  if (touchPoints > 0 && matches("(hover: none)")) return true;

  return false;
}
