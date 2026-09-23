// Sole · la regla de "¿esto es un email?" en UN sitio.
//
// El 17-09-2026 el ticket 000257 de Peluquería Sole se cobró con "abc"
// en el campo "Enviar por email". El TPV lo aceptó, la API lo aceptó, se
// creó el job, el worker lo intentó tres veces contra una dirección
// imposible y la clienta no recibió nada. Tres capas y ninguna sabía
// decir que "abc" no es un email.
//
// Por eso esta función vive aquí y no en cada capa: el TPV valida con
// ella antes de dejar confirmar, la API valida con ella antes de
// persistir el intent y antes de encolar, y el worker valida con ella
// antes de gastar tres reintentos. Si alguna vez discrepan, discrepan
// todas a la vez — que es la única forma de que un cambio de criterio no
// abra el agujero otra vez por una sola rendija.
//
// Se exporta también por subpath (`@mipiacetpv/util-validation/email`)
// porque el índice del paquete arrastra `temporary-password.ts`, que
// importa `node:crypto` y no puede entrar en el bundle del TPV.

// Qué acepta, a propósito:
//   - local@dominio.tld con al menos un punto en el dominio y TLD ≥ 2.
//   - Los caracteres del local part que usa la gente de verdad, incluido
//     el `+` de las etiquetas de Gmail.
// Qué rechaza, a propósito:
//   - Espacios en cualquier posición (el teclado del AP12 mete uno al
//     autocompletar más veces de las que parece).
//   - Dominio sin punto: `ana@localhost` es válido para el RFC y es
//     basura para una clienta de peluquería.
//   - Puntos consecutivos o al principio/final del local part.
//
// No pretende ser el RFC 5322: pretende no dejar salir un email al que
// no se puede escribir. Un falso negativo cuesta un cobro sin email —
// recuperable con el reenvío del histórico. Un falso positivo cuesta un
// ticket que la clienta nunca recibe y del que nadie se entera, que es
// exactamente el incidente que este bloque cierra.
const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

// El mismo tope que el `maxLength` de los schemas de la API (RFC 5321:
// 64 del local part + @ + 255 del dominio).
export const EMAIL_MAX_LENGTH = 320;

/**
 * Recorta el email antes de validarlo o guardarlo. Es lo primero que se
 * hace en las tres capas: " ana@ejemplo.com " es un email bueno escrito
 * por un dedo gordo en una pantalla de 10", no una dirección inválida.
 */
export function normalizeEmail(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.trim();
}

/**
 * ¿Se le puede escribir a esto? Recorta primero — así el llamante nunca
 * tiene que acordarse de hacerlo.
 */
export function isValidEmail(raw: string | null | undefined): boolean {
  const email = normalizeEmail(raw);
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) return false;
  return EMAIL_PATTERN.test(email);
}

/**
 * El email recortado si vale, `null` si no. El helper que usan los
 * handlers: "dame lo que voy a guardar, o nada".
 */
export function validEmailOrNull(raw: string | null | undefined): string | null {
  const email = normalizeEmail(raw);
  return isValidEmail(email) ? email : null;
}

/** Lo que se le enseña a una persona cuando el email no vale. */
export const INVALID_EMAIL_MESSAGE =
  "Ese email no es válido. Revísalo: tiene que ser como ana@ejemplo.com.";
