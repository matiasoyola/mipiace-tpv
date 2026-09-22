// Adaptador de plataforma del TPV (carryover de A0, Frente 4).
//
// tpv-web corre en DOS entornos con el MISMO bundle JS:
//   - Navegador / PWA (Chrome de escritorio o tablet).
//   - WebView de la app Android (Capacitor) → `apps/tpv-android`.
//
// El código de pantalla NO debe ramificar por `navigator.userAgent` ni
// por hacks frágiles. Pregunta a este módulo. La detección se hace por
// el global `Capacitor` que el bridge nativo inyecta en el WebView; en
// navegador ese global no existe y `getPlatform()` devuelve "web".
//
// IMPORTANTE (regresión cero en web): NO importamos `@capacitor/core`.
// Leer el global inyectado evita añadir una dependencia de Capacitor al
// bundle de la PWA — en navegador el objeto simplemente no está.

/** Global que Capacitor inyecta en el WebView de la app nativa. */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  registerPlugin?: <T>(name: string, impls?: unknown) => T;
  Plugins?: Record<string, unknown>;
}

/**
 * A5 · acceso a un plugin nativo por su nombre. `null` en navegador o si ese
 * plugin no está registrado.
 *
 * **Por qué existe esta función, verificado en el AP11 el 2026-09-04:** el
 * global que inyecta el bridge nativo **NO tiene `registerPlugin`**. Sus claves
 * son `Plugins`, `toNative`, `nativePromise`, `isNativePlatform`… y nada más.
 * `registerPlugin` lo aporta el paquete `@capacitor/core`, que el bundle de
 * tpv-web NO carga a propósito (ver la nota de arriba). Así que todo el código
 * que llamaba a `cap.registerPlugin(...)` obtenía `undefined` y degradaba en
 * silencio: es la causa del cabo suelto de A4 —«la etiqueta del menú no enseña
 * versionName (versionCode)»— y de que el primer heartbeat de A5 llegara sin
 * red, sin IP y sin arranque.
 *
 * Lo correcto es leer `Capacitor.Plugins[name]`, que el bridge sí rellena con
 * todos los plugins registrados en `MainActivity`. Se deja `registerPlugin`
 * como respaldo por si un día el bundle sí carga `@capacitor/core`.
 */
export function getNativePlugin<T>(name: string): T | null {
  const cap = getCapacitor();
  if (!cap) return null;
  const fromBridge = cap.Plugins?.[name];
  if (fromBridge) return fromBridge as T;
  try {
    return cap.registerPlugin ? cap.registerPlugin<T>(name) : null;
  } catch {
    return null;
  }
}

/** Acceso tipado al global `Capacitor` (o null en navegador). */
export function getCapacitor(): CapacitorGlobal | null {
  const w = globalThis as unknown as { Capacitor?: CapacitorGlobal };
  return w.Capacitor ?? null;
}

/** ¿Estamos dentro de la app Android (Capacitor), no en el navegador? */
export function isCapacitor(): boolean {
  const cap = getCapacitor();
  return !!cap?.isNativePlatform?.();
}

export type Platform = "web" | "android";

/**
 * Plataforma efectiva. "android" sólo cuando corremos empaquetados en
 * Capacitor nativo; cualquier otra cosa (Chrome, PWA instalada) es "web".
 */
export function getPlatform(): Platform {
  if (!isCapacitor()) return "web";
  // Capacitor soporta ios/android/web; el TPV sólo empaqueta android.
  const native = getCapacitor()?.getPlatform?.();
  return native === "android" ? "android" : "web";
}
