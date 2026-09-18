// A5 · qué cuenta el terminal de sí mismo en cada latido.
//
// Todo se lee de fuentes que ya existen y que sobreviven a un reinicio de la
// app: la cola de IndexedDB, el turno local, y el bundle en ejecución. Nada de
// esto pasa por el estado de React — el canal no puede depender de que haya
// una pantalla montada, ni al revés.
//
// La regla de A4 manda aquí: la versión que se reporta es la del BUNDLE QUE SE
// ESTÁ EJECUTANDO, leída del propio chunk, no la que diga el servidor ni la que
// ponga en la APK. Si un día vuelve a haber un terminal ejecutando algo ajeno,
// el panel lo va a ver desde el primer latido.

import { getLocalShift } from "../offlineShift.js";
import { outboxCounts } from "../outbox.js";
import {
  getNativeAppInfo,
  readBuildHash,
  readBundleTarget,
} from "../../platform/AppInfo.js";
import { getPlatform } from "../../platform/index.js";
import { readSupportAgentInfo } from "../../platform/SupportAgent.js";

export interface DeviceStatusPayload {
  bundleBuildHash?: string;
  bundleTarget?: string;
  platform?: "web" | "android";
  appVersionName?: string;
  appVersionCode?: number;
  shiftOpen?: boolean;
  shiftOpenedAt?: string;
  outboxPending?: number;
  outboxRejected?: number;
  network?: "wifi" | "cellular" | "ethernet" | "none" | "unknown";
  localIp?: string;
  deviceTime?: string;
  bootedAt?: string;
}

/** Quita las claves sin valor: el servidor las trata como «no lo sé». */
function compact(obj: Record<string, unknown>): DeviceStatusPayload {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as DeviceStatusPayload;
}

/**
 * Instantánea del terminal.
 *
 * Cada fuente va en su propio `catch`: un IndexedDB que no abre no puede dejar
 * al terminal sin anunciar su versión, y un plugin nativo que no responde no
 * puede ocultar que la cola lleva tres horas atascada. Lo que falle se omite.
 */
export async function collectDeviceStatus(): Promise<DeviceStatusPayload> {
  const [counts, shift, native, agent] = await Promise.all([
    outboxCounts().catch(() => null),
    getLocalShift().catch(() => null),
    getNativeAppInfo().catch(() => null),
    readSupportAgentInfo().catch(() => null),
  ]);

  // Un turno con `closedAt` ya no está abierto: el registro local sobrevive al
  // cierre hasta que el outbox lo sube.
  const shiftOpen = shift != null && shift.closedAt == null;

  // `appVersionCode` es string en el bridge (@capacitor/app lo tipa así) y un
  // entero en Gradle. Se convierte aquí y se omite si no cuadra, en vez de
  // mandar un NaN que el schema del servidor rechazaría y que dejaría el latido
  // entero en la basura.
  const versionCode = native ? Number.parseInt(native.versionCode, 10) : NaN;

  return compact({
    bundleBuildHash: readBuildHash() || undefined,
    bundleTarget: readBundleTarget() || undefined,
    platform: getPlatform(),
    appVersionName: native?.versionName,
    appVersionCode: Number.isFinite(versionCode) ? versionCode : undefined,
    shiftOpen,
    shiftOpenedAt: shiftOpen ? shift?.openedAt : undefined,
    outboxPending: counts?.pending,
    outboxRejected: counts?.rejected,
    network: agent?.network ?? undefined,
    localIp: agent?.localIp ?? undefined,
    // La hora del propio terminal, tal cual, para que el servidor calcule el
    // desvío. Es el dato que explica los errores raros que no se explican.
    deviceTime: new Date().toISOString(),
    bootedAt:
      agent?.bootedAt != null ? new Date(agent.bootedAt).toISOString() : undefined,
  });
}
