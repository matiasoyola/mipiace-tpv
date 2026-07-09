// v1.3-hotfix · Generación de IDs únicos client-side con fallback.
//
// `crypto.randomUUID()` requiere Chrome 92+ (Jul 2021), Safari 15.4
// (Mar 2022), Firefox 95 (Dic 2021). En Android 11 con Chrome / WebView
// sin actualizar puede ser < 92 → `crypto.randomUUID` es undefined →
// llamarlo lanza TypeError y rompe el render de React (pantalla blanca).
//
// Detectado al pulsar un producto en TPV modo prueba sobre Android
// táctil 11. El TPV cargaba bien (no usa randomUUID al boot), pero
// `addProduct → pushProductLine → newId()` reventaba en runtime.
//
// v1.9.7 · Bug-UUID-Fallback (implantación Sirope, 2026-07-08).
// El fallback anterior generaba el *shape* 8-4-4-4-12 pero NO fijaba el
// nibble de versión (`4`) ni el de variante (`[89ab]`), así que no era
// un UUID v4 válido. La API valida `externalId` y `lineExternalId` con
//   ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
// (ADR-005, idempotencia). Resultado: en cualquier tablet sin
// `crypto.randomUUID`, TODO `POST /tables/:id/lines` y `POST /tickets`
// devolvía 400 VALIDATION_ERROR → no se podían añadir productos a una
// mesa ni cobrar. En equipos modernos no se reproducía nunca.
//
// El fallback sigue sin ser criptográficamente seguro — no importa: los
// IDs son claves de UI e idempotencia pre-sync. Pero ahora es un v4
// bien formado, que es lo que el contrato exige.

/** Devuelve un UUID v4 válido (RFC 4122). Usa `crypto.randomUUID` si
 *  existe; si no, `crypto.getRandomValues`; y como último recurso
 *  `Math.random`. En los tres casos los nibbles de versión y variante
 *  son correctos, así que pasa la validación de la API. */
export function newId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 §4.4: versión 4 en el nibble alto del byte 6, variante
  // 10xx en los dos bits altos del byte 8.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
