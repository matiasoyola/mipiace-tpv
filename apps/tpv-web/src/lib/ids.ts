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
// El fallback no es criptográficamente seguro — esto NO importa aquí
// porque los IDs son sólo claves de UI (cartLine.id, externalId del
// ticket pre-sync). El backend valida unicidad real y no se fía de los
// IDs del cliente.

/** Devuelve un UUID v4 si el navegador lo soporta; si no, un id
 *  pseudo-único basado en timestamp + Math.random. Suficiente para
 *  claves de React, externalIds pre-sync y keys de carrito. */
export function newId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Fallback compatible con Chrome <92 / Android stock WebView viejo.
  // Formato: 8-4-4-4-12 hex tras Date.now + Math.random — no es UUID
  // v4 real pero respeta el shape para sistemas que lo parseen como
  // string genérico.
  const rand = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  const ts = Date.now().toString(16).padStart(12, "0");
  return `${rand()}${rand()}-${rand()}-${rand()}-${rand()}-${ts}`;
}
