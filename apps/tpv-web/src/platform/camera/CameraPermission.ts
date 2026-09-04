// A2-Android · Frente 1 · permiso de cámara en el WebView.
//
// El escaneo de código de barras lo sigue haciendo zxing sobre el
// `<video>` con getUserMedia (idéntico en web y android). Pero el WebView
// de Capacitor exige, ADEMÁS del prompt web, el permiso NATIVO de cámara
// de Android en runtime. Este módulo lo pide detrás de la capa de
// plataforma — NINGÚN componente de pantalla toca Capacitor.
//
// Patrón calcado de A1 (UsbNativeTransport): leemos el global `Capacitor`
// inyectado en el WebView (ver platform/index.ts) y hablamos con un plugin
// Java local (`CameraPermissionPlugin`). En navegador el global no existe
// → devolvemos "web" y el llamador va directo a getUserMedia, cuyo propio
// prompt gestiona el permiso. Regresión CERO en web: no importamos
// `@capacitor/core`, no añadimos dependencia al bundle de la PWA.

import { getCapacitor, getPlatform } from "../index.js";

/**
 * Resultado de asegurar el permiso de cámara:
 *   - "granted": el usuario concedió el permiso nativo → seguir.
 *   - "denied":  lo denegó → el modal debe mostrar mensaje claro.
 *   - "web":     no hay nada nativo que pedir (navegador/PWA, o Capacitor
 *                sin el plugin) → seguir a getUserMedia, que gestiona su
 *                propio prompt. El fallo real caería en NotAllowedError.
 */
export type CameraPermissionResult = "granted" | "denied" | "web";

// Contrato del plugin nativo (lo que expone CameraPermissionPlugin.java).
interface CameraPermissionPlugin {
  check(): Promise<{ granted: boolean }>;
  request(): Promise<{ granted: boolean }>;
}

// El bridge nativo NO expone `registerPlugin` en el global `Capacitor`
// (esa función vive en @capacitor/core, que este bundle no importa a
// propósito). Lo que inyecta es `Capacitor.Plugins.<Nombre>` ya construido.
// Mismo fallo que tenía UsbNativeTransport y que dejó la impresión USB
// muerta desde A1 — ver el commit 905bd21.
function getPlugin(): CameraPermissionPlugin | null {
  const cap = getCapacitor();
  if (!cap) return null;
  const fromBridge = cap.Plugins?.["CameraPermission"] as
    | CameraPermissionPlugin
    | undefined;
  if (fromBridge) return fromBridge;
  if (typeof cap.registerPlugin === "function") {
    return cap.registerPlugin<CameraPermissionPlugin>("CameraPermission");
  }
  return null;
}

/**
 * Asegura el permiso de cámara antes de abrir el stream. En android pide
 * el permiso nativo (una sola vez; Android recuerda la decisión). En
 * navegador es un no-op que devuelve "web".
 */
export async function ensureCameraPermission(): Promise<CameraPermissionResult> {
  // Navegador / PWA: el permiso lo gestiona el prompt de getUserMedia.
  if (getPlatform() !== "android") return "web";
  const plugin = getPlugin();
  // Capacitor sin el plugin (build viejo del shell): mismo camino web —
  // getUserMedia intentará y, si de verdad no hay permiso, fallará con
  // NotAllowedError, que el modal ya maneja.
  if (!plugin) return "web";
  try {
    const checked = await plugin.check();
    if (checked.granted) return "granted";
    const requested = await plugin.request();
    return requested.granted ? "granted" : "denied";
  } catch {
    // Si el plugin peta, no bloqueamos el escaneo: dejamos que
    // getUserMedia lo intente igualmente.
    return "web";
  }
}
