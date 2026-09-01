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

import { getCapacitor, isCapacitor } from "./index.js";

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
 * A4 · para quién se construyó el bundle QUE SE ESTÁ EJECUTANDO: "android"
 * si salió del build de la APK, "" si salió del de la web.
 *
 * `import.meta.env.VITE_TARGET` lo sustituye Vite en tiempo de build, así que
 * el valor viaja dentro del propio chunk. Sea cual sea el JS que acabe
 * corriendo, esta función habla de ÉL y no del servidor ni del contenedor.
 */
export function readBundleTarget(): string {
  return (
    (import.meta as unknown as { env?: { VITE_TARGET?: string } }).env
      ?.VITE_TARGET ?? ""
  ).trim();
}

/**
 * A4 · ¿estamos dentro de la APK ejecutando un bundle que NO es el suyo?
 *
 * La noche del 01-09 el terminal decía "1.0.0 (1) · build 9d76904" y esa
 * etiqueta era verdad — el hash ERA el del bundle en ejecución. Lo que no
 * decía es que ese bundle venía de producción por internet, servido por un
 * Service Worker que se coló bajo el origen real, y no de los assets de la
 * APK. Hicieron falta hora y media para verlo.
 *
 * El bundle de la APK lleva `VITE_TARGET=android` embebido; el de la web no
 * lleva nada. Si el contenedor es Capacitor y el bundle no se declara
 * "android", el JS en ejecución es ajeno a la APK. Se pinta en el menú.
 *
 * Fuera de Capacitor (navegador, PWA) siempre es `false`: ahí lo normal y
 * correcto es un bundle sin marca.
 *
 * `bundleTarget` es parámetro con default para poder probar la decisión: Vite
 * sustituye `import.meta.env.VITE_TARGET` en tiempo de build, así que dentro
 * de un test el valor real no se puede fingir (`vi.stubEnv` no llega ahí). Que
 * la marca sobreviva de verdad al build lo comprueba
 * `infra/test/bundle-android.test.ts` sobre el bundle emitido. En producción
 * nadie pasa el argumento.
 */
export function isForeignBundle(
  bundleTarget: string = readBundleTarget(),
): boolean {
  if (!isCapacitor()) return false;
  return bundleTarget !== "android";
}

/**
 * Etiqueta de versión para el menú del cajero.
 *
 *   Android → "1.10.2 (11002) · build a1b2c3d"
 *   Web     → "build a1b2c3d"
 *
 * A4: con `foreignBundle`, se añade "· ⚠ bundle ajeno a la APK". Ese aviso
 * significa que el JS en ejecución dentro de la app Android no salió de los
 * assets de la APK (ver isForeignBundle). Es la señal que habría cerrado en
 * dos segundos la noche del 01-09.
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
  foreignBundle = false,
): string {
  const hash = buildHash.trim();
  const build = hash ? `build ${hash}` : "";
  const version = native ? `${native.versionName} (${native.versionCode})` : "";
  const parts = [version, build].filter(Boolean);
  // A4 · el aviso va SIEMPRE, aunque no haya ni versión nativa ni hash: es
  // justo el caso en que la etiqueta no dice nada y hay que mirar.
  if (foreignBundle) parts.push("⚠ bundle ajeno a la APK");
  return parts.join(" · ");
}
