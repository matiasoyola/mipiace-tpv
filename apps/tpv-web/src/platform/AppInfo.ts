// A3-distribución · Frente 2 · qué versión tiene este terminal.
//
// En una implantación nadie sabe qué versión tiene el terminal que tiene en
// la mano. Con la APK distribuida fuera de Play eso empeora: no hay una
// pantalla del sistema donde mirarlo y varios terminales pueden llevar builds
// distintos a la vez. La app tiene que decirlo ella.
//
// Patrón calcado de platform/camera/CameraPermission.ts: leemos el global
// `Capacitor` que el bridge inyecta en el WebView y hablamos con el plugin por
// `registerPlugin`. NO importamos `@capacitor/app` — esa dependencia vive en
// apps/tpv-android, no en tpv-web, y platform/index.ts documenta que el bundle
// de la PWA no carga Capacitor. En navegador el global no existe y devolvemos
// null, que el formateador degrada a mostrar sólo el hash de build.

import { getCapacitor } from "./index.js";

export interface NativeAppInfo {
  /** `versionName` de Gradle. Ej: "1.10.2". */
  versionName: string;
  /** `versionCode` de Gradle, como string. Ej: "11002". */
  versionCode: string;
}

// Contrato de @capacitor/app: getInfo() devuelve { name, id, build, version },
// donde `version` es el versionName y `build` el versionCode. El plugin lo
// tipa como string, pero algunas versiones del bridge lo serializan como
// número, así que aceptamos ambos y normalizamos.
interface AppPlugin {
  getInfo(): Promise<{ version?: unknown; build?: unknown }>;
}

function asNonEmptyString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/**
 * Versión nativa del APK, o null si no estamos en la app Android (o si el
 * plugin no responde). NUNCA lanza: esto pinta una línea de texto en un menú,
 * y un fallo aquí no puede tumbar la pantalla de venta.
 */
export async function getNativeAppInfo(): Promise<NativeAppInfo | null> {
  const cap = getCapacitor();
  if (!cap?.registerPlugin) return null;
  try {
    const plugin = cap.registerPlugin<AppPlugin>("App");
    const info = await plugin.getInfo();
    const versionName = asNonEmptyString(info?.version);
    const versionCode = asNonEmptyString(info?.build);
    // Media versión es peor que ninguna: "1.10.2 ()" en un menú no dice nada
    // y parece un bug. Si falta cualquiera de las dos, degradamos al hash.
    if (!versionName || !versionCode) return null;
    return { versionName, versionCode };
  } catch {
    return null;
  }
}

/** Hash de build inyectado por CI (vite define). Vacío en dev local. */
export function readBuildHash(): string {
  return (
    (import.meta as unknown as { env?: { VITE_BUILD_HASH?: string } }).env
      ?.VITE_BUILD_HASH ?? ""
  ).trim();
}

/**
 * Etiqueta de versión para el menú del cajero.
 *
 *   Android → "1.10.2 (11002) · build a1b2c3d"
 *   Web     → "build a1b2c3d"
 *
 * En web NO hay versionName ni versionCode y no nos los inventamos. El
 * versionCode sólo existe en Gradle, y como versionName tpv-web no tiene
 * ninguno: `__APP_VERSION__` es un timestamp de build (vite.config.ts) que a
 * un cajero no le dice nada, y la constante manual del admin
 * (`PRODUCT_VERSION = "v1.0"`) lleva desfasada desde v1.0 — precisamente el
 * fallo que no queremos repetir. La PWA se despliega en continuo: su
 * identidad ES el hash del commit.
 */
export function formatVersionLabel(
  native: NativeAppInfo | null,
  buildHash: string,
): string {
  const hash = buildHash.trim();
  const build = hash ? `build ${hash}` : "";
  if (!native) return build;
  const version = `${native.versionName} (${native.versionCode})`;
  return build ? `${version} · ${build}` : version;
}
