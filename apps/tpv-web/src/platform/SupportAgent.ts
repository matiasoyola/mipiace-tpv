// A5 · el puente con el plugin nativo del agente de soporte.
//
// Mismo patrón que `AppInfo.ts` y `camera/CameraPermission.ts`: leemos el
// global `Capacitor` que inyecta el bridge y hablamos por `registerPlugin`. NO
// se importa `@capacitor/core` — esa dependencia vive en `apps/tpv-android`, y
// el bundle de la PWA no carga Capacitor (ver `platform/index.ts`).
//
// En navegador el global no existe y todo esto devuelve null. Un terminal en
// una pestaña de Chrome se anuncia igual, sólo que sin IP local ni arranque:
// son datos del cacharro, no del TPV.

import { getNativePlugin } from "./index.js";

export type NetworkKind = "wifi" | "cellular" | "ethernet" | "none" | "unknown";

export interface SupportAgentInfo {
  network: NetworkKind | null;
  localIp: string | null;
  /** Epoch millis del último arranque del terminal. */
  bootedAt: number | null;
}

export interface SupportAgentLogs {
  logcat: string | null;
  error: string | null;
}

export interface CapturaPantalla {
  /** PNG en base64, sin cabecera data:. */
  pngBase64: string;
  width: number;
  height: number;
  /**
   * Cómo se obtuvo: "pixelcopy" (copia del Surface real) o "software" (la
   * jerarquía de vistas dibujándose en un canvas). Viaja hasta el panel porque
   * las dos no valen lo mismo: la de respaldo no ve nada pintado por una capa
   * de hardware.
   */
  via: string | null;
}

interface SupportAgentPlugin {
  info(): Promise<{
    network?: unknown;
    localIp?: unknown;
    bootedAt?: unknown;
  }>;
  logs(options: { lines: number }): Promise<{
    logcat?: unknown;
    error?: unknown;
  }>;
  restart(): Promise<{ restarted?: unknown }>;
  screenshot(): Promise<{
    pngBase64?: unknown;
    width?: unknown;
    height?: unknown;
    via?: unknown;
  }>;
}

const NETWORK_KINDS: readonly NetworkKind[] = [
  "wifi",
  "cellular",
  "ethernet",
  "none",
  "unknown",
];

function asNetwork(value: unknown): NetworkKind | null {
  return typeof value === "string" &&
    (NETWORK_KINDS as readonly string[]).includes(value)
    ? (value as NetworkKind)
    : null;
}

function getPlugin(): SupportAgentPlugin | null {
  return getNativePlugin<SupportAgentPlugin>("SupportAgent");
}

/**
 * Red, IP local y arranque del terminal. Null fuera de la APK, y null en cada
 * campo que el plugin no sepa contestar.
 *
 * NUNCA lanza: esto alimenta un heartbeat de soporte. Si falla, el terminal se
 * anuncia con menos datos; lo que no puede es dejar de anunciarse.
 */
export async function readSupportAgentInfo(): Promise<SupportAgentInfo | null> {
  const plugin = getPlugin();
  if (!plugin) return null;
  try {
    const info = await plugin.info();
    return {
      network: asNetwork(info?.network),
      localIp:
        typeof info?.localIp === "string" && info.localIp.length > 0
          ? info.localIp
          : null,
      bootedAt:
        typeof info?.bootedAt === "number" && Number.isFinite(info.bootedAt)
          ? info.bootedAt
          : null,
    };
  } catch {
    return null;
  }
}

/** Líneas de logcat que se piden. Suficiente para ver un arranque entero. */
const LOGCAT_LINES = 300;

/**
 * Últimas líneas del log nativo del propio proceso, o null en navegador.
 *
 * Complementa al diario de consola del WebView: aquí salen las líneas que el JS
 * no puede ver (Capacitor, el rescate de A4, el plugin USB de la impresora), y
 * son justo las que faltan cuando lo que falla es el arranque.
 */
export async function readSupportAgentLogs(): Promise<SupportAgentLogs | null> {
  const plugin = getPlugin();
  if (!plugin) return null;
  try {
    const res = await plugin.logs({ lines: LOGCAT_LINES });
    return {
      logcat: typeof res?.logcat === "string" ? res.logcat : null,
      error: typeof res?.error === "string" ? res.error : null,
    };
  } catch (err) {
    return { logcat: null, error: String(err) };
  }
}

/**
 * Reinicia la app recreando la Activity. `false` si no estamos en la APK — el
 * llamante decide qué hacer entonces (recargar es lo más parecido en web).
 *
 * No mata el proceso, a propósito: ver `SupportAgentPlugin.restart`.
 */
export async function restartApp(): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    const res = await plugin.restart();
    return res?.restarted === true;
  } catch {
    return false;
  }
}

/**
 * Captura de nuestra propia ventana. `null` fuera de la APK.
 *
 * Es nuestra app mirándose a sí misma: no hay MediaProjection, no hay
 * consentimiento que nadie tenga que aceptar tras cada reinicio, y no hace
 * falta un plugin firmado por el fabricante del terminal. Lo que NO sale: el
 * teclado de Android y los diálogos del sistema, que son ventanas ajenas.
 */
export async function captureOwnWindow(): Promise<CapturaPantalla | null> {
  const plugin = getPlugin();
  if (!plugin) return null;
  try {
    const res = await plugin.screenshot();
    if (typeof res?.pngBase64 !== "string" || res.pngBase64.length === 0) {
      return null;
    }
    return {
      pngBase64: res.pngBase64,
      width: typeof res.width === "number" ? res.width : 0,
      height: typeof res.height === "number" ? res.height : 0,
      via: typeof res.via === "string" ? res.via : null,
    };
  } catch {
    return null;
  }
}
