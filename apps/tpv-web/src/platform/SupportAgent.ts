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

import { getCapacitor } from "./index.js";

export type NetworkKind = "wifi" | "cellular" | "ethernet" | "none" | "unknown";

export interface SupportAgentInfo {
  network: NetworkKind | null;
  localIp: string | null;
  /** Epoch millis del último arranque del terminal. */
  bootedAt: number | null;
}

interface SupportAgentPlugin {
  info(): Promise<{
    network?: unknown;
    localIp?: unknown;
    bootedAt?: unknown;
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
  const cap = getCapacitor();
  if (!cap?.registerPlugin) return null;
  try {
    return cap.registerPlugin<SupportAgentPlugin>("SupportAgent");
  } catch {
    return null;
  }
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
