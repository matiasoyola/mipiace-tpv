// A4 · lo que la APK lleva dentro, comprobado sobre el bundle de verdad.
//
// El 01-09 se instaló en el AP11 una APK con v1.14 dentro y el terminal siguió
// enseñando exactamente lo mismo que antes. La APK contenía
// `assets/index-DPJMFGpJ.js`; lo que se ejecutaba era `index-B2g4RT4W.js`, con
// `server: Caddy` y `last-modified: 31 Aug 10:45` en la caché del Service
// Worker del propio terminal. Es decir, el despliegue del VPS.
//
// La cadena: `server.hostname = mipiacetpv.com` hace que el origen del WebView
// sea el dominio real; Capacitor intercepta las peticiones DEL WEBVIEW con su
// WebViewAssetLoader pero NO las del Service Worker, así que el registro de
// `/sw.js` sale a la red, trae el sw.js de producción, precachea los assets de
// producción y pasa a controlar la página. Desde ahí, y para siempre, la APK
// sirve producción.
//
// Estos tests construyen tpv-web DOS veces —como el shell de Android y como la
// web— y afirman sobre los ficheros emitidos, que es lo que se empaqueta:
//
//   1. el bundle de Android NO trae Service Worker;
//   2. el bundle de Android SÍ trae la URL absoluta de la API;
//   3. el bundle de la web SIGUE trayendo Service Worker (regresión cero: ahí
//      el SW es el offline y no se toca).
//
// Van en el proyecto `infra` de vitest.workspace.ts por el mismo motivo que
// nombre-de-apk.test.ts: no son de ningún paquete, guardan invariantes de la
// cadena de build.
//
// El build de Android se hace ejecutando el script `build:web` de
// apps/tpv-android/package.json TAL CUAL, con VITE_API_URL y VITE_TARGET
// borradas del entorno: es el caso real de quien compila sin acordarse de
// exportarlas, y la deuda que dejó la ronda 2.
//
// Cuestan dos `vite build` (~30 s en el Mac de Matías). Es caro para un test,
// pero es el único punto donde la afirmación es sobre el artefacto real y no
// sobre la intención del config: el fallo del 01-09 no se veía ni al construir
// ni al instalar, se veía semanas después en el bar.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB_DIR = join(ROOT, "apps/tpv-web");

/** Lo que fija el build de Android (apps/tpv-android/package.json y scripts/). */
const API_URL = "https://api.mipiacetpv.com";

/**
 * Directorios de salida de los dos builds. Van dentro de apps/tpv-web y con
 * punto delante para no pisar el `dist` de trabajo: si un test dejara el dist
 * en estado "android", el siguiente `cap sync` metería ese bundle en el
 * proyecto nativo sin que nadie se enterase. Están en .gitignore.
 */
const OUT_ANDROID = ".a4-test-dist-android";
const OUT_WEB = ".a4-test-dist-web";

/**
 * Ficheros que delatan un Service Worker en el dist.
 *
 * `sw.js` es el worker; `registerSW.js` es el registrador que vite-plugin-pwa
 * inyecta cuando `injectRegister` no es `null`; `workbox-*.js` es el runtime
 * que el worker importa. Cualquiera de los tres dentro de la APK significa que
 * el build volvió a generar SW.
 *
 * `manifest.webmanifest` NO está en la lista: es del PWA, no del SW, y su
 * presencia dentro de la APK sería inútil pero inofensiva.
 */
function ficherosDeServiceWorker(outDir: string): string[] {
  if (!existsSync(outDir)) return [];
  return readdirSync(outDir).filter(
    (f) => f === "sw.js" || f === "registerSW.js" || /^workbox-.*\.js$/.test(f),
  );
}

function assetsJs(outDir: string): string[] {
  const dir = join(outDir, "assets");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(dir, f), "utf8"));
}

function correr(cmd: string, cwd: string, env: NodeJS.ProcessEnv): void {
  const r = spawnSync("sh", ["-c", cmd], {
    cwd,
    encoding: "utf8",
    timeout: 600_000,
    env,
  });
  if (r.status !== 0) {
    throw new Error(
      `falló (código ${r.status}): ${cmd}\n${r.stdout}\n${r.stderr}`,
    );
  }
}

/**
 * Construye el bundle de Android EJECUTANDO EL SCRIPT DE VERDAD.
 *
 * No se invoca `vite build` con el entorno puesto a mano: eso probaría el
 * config y dejaría fuera justo lo que falló en la ronda 2, que era el script.
 * Se lee `build:web` de apps/tpv-android/package.json y se ejecuta tal cual,
 * con `VITE_API_URL` y `VITE_TARGET` BORRADAS del entorno — el caso real de
 * quien compila sin acordarse de exportarlas. Si el script deja de fijarlas,
 * estos tests se ponen rojos.
 *
 * El `--outDir` se añade al final: `pnpm --filter … build` reenvía los
 * argumentos sobrantes al script del paquete, que acaba en `vite build`. Va a
 * un directorio aparte para no pisar el `dist` de trabajo — si un test lo
 * dejara en estado "android", el siguiente `cap sync` metería ese bundle en el
 * proyecto nativo sin que nadie se enterase.
 */
function construirAndroid(outDir: string): void {
  const pkg = JSON.parse(
    readFileSync(join(ROOT, "apps/tpv-android/package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  const script = pkg.scripts["build:web"];
  expect(script, "apps/tpv-android/package.json no tiene build:web").toBeTruthy();

  const env = { ...process.env };
  delete env.VITE_API_URL;
  delete env.VITE_TARGET;

  correr(
    `${script} --outDir ${outDir} --emptyOutDir`,
    join(ROOT, "apps/tpv-android"),
    env,
  );
}

/** Construye el bundle de la web: sin VITE_TARGET, con la API de producción. */
function construirWeb(outDir: string): void {
  const env = { ...process.env, VITE_API_URL: API_URL };
  delete env.VITE_TARGET;
  correr(
    `pnpm exec vite build --outDir ${outDir} --emptyOutDir`,
    WEB_DIR,
    env,
  );
}

let DIST_ANDROID: string;
let DIST_WEB: string;

beforeAll(() => {
  DIST_ANDROID = join(WEB_DIR, OUT_ANDROID);
  DIST_WEB = join(WEB_DIR, OUT_WEB);
  construirAndroid(OUT_ANDROID);
  construirWeb(OUT_WEB);
}, 600_000);

afterAll(() => {
  rmSync(DIST_ANDROID, { recursive: true, force: true });
  rmSync(DIST_WEB, { recursive: true, force: true });
});

describe("A4 · el bundle de Android no lleva Service Worker", () => {
  // SABOTAJE: quitar `disable: IS_ANDROID_BUILD` de VitePWA en
  // apps/tpv-web/vite.config.ts, o quitar `VITE_TARGET=android` del `build:web`
  // de apps/tpv-android/package.json. Cualquiera de los dos lo pone rojo.
  it("no emite sw.js, registerSW.js ni workbox-*.js", () => {
    expect(ficherosDeServiceWorker(DIST_ANDROID)).toEqual([]);
  });

  it("el index.html no registra ningún service worker", () => {
    const html = readFileSync(join(DIST_ANDROID, "index.html"), "utf8");
    expect(html).not.toContain("registerSW.js");
    expect(html).not.toContain("serviceWorker");
  });

  it("el bundle no llama a serviceWorker.register()", () => {
    // `registerSW` de virtual:pwa-register queda resuelto a un no-op cuando el
    // plugin va con `disable`. Si volviera el real, esta llamada aparecería.
    const js = assetsJs(DIST_ANDROID).join("\n");
    expect(js).not.toContain("serviceWorker.register");
  });
});

describe("A4 · el bundle de Android lleva la API absoluta", () => {
  // SABOTAJE: quitar `VITE_API_URL=…` del `build:web` de
  // apps/tpv-android/package.json. Este test se pone rojo — el build corre con
  // esa variable fuera del entorno a propósito (ver construirAndroid).
  //
  // Sin la URL absoluta, `api.ts` cae a `/api`, que dentro del WebView la
  // sirve Capacitor devolviendo `index.html` con 200 a todo: la APK instala
  // perfectamente y no hace login, ni baja catálogo, ni cobra.
  it("la URL de producción aparece en los assets emitidos", () => {
    const js = assetsJs(DIST_ANDROID);
    expect(js.length).toBeGreaterThan(0);
    expect(js.some((src) => src.includes(API_URL))).toBe(true);
  });

  it("no queda ningún `/api` relativo como base", () => {
    // La comprobación de arriba pasaría también si la base fuese `/api` y la
    // URL absoluta apareciera por otro motivo. Ésta mira la forma minificada
    // del fallback de api.ts.
    const js = assetsJs(DIST_ANDROID).join("\n");
    expect(js).not.toMatch(/VITE_API_URL/);
    expect(js).toContain(API_URL);
  });
});

describe("A4 · el bundle de Android se declara Android", () => {
  // No es una fila de la tabla de sabotaje: es el mecanismo del punto 4 del
  // bloque (que el terminal diga qué bundle está ejecutando). Se comprueba
  // aquí porque sólo se puede afirmar sobre el artefacto: la marca la sustituye
  // Vite en tiempo de build.
  //
  // La forma es la minificada de `readBundleTarget()` en platform/AppInfo.ts:
  //   export function readBundleTarget() { return (...VITE_TARGET ?? "").trim() }
  // Si un día el minificador cambia de forma, este test se pone rojo y hay que
  // actualizar el patrón — no es un falso positivo, es que dejó de ser legible.
  it("el bundle de Android inlinea la marca \"android\"", () => {
    const js = assetsJs(DIST_ANDROID).join("\n");
    expect(js).toContain('return"android".trim()');
  });

  it("el bundle de la web NO lleva la marca (y por eso se distingue)", () => {
    const js = assetsJs(DIST_WEB).join("\n");
    expect(js).toContain('return"".trim()');
    expect(js).not.toContain('return"android".trim()');
  });
});

describe("A4 · regresión cero en la web", () => {
  // La mitad que se olvida: apagar el SW en Android no puede apagarlo en el
  // navegador. En la PWA el Service Worker ES el offline, y esa promesa no la
  // toca este bloque.
  it("el bundle de la web SÍ emite sw.js", () => {
    expect(ficherosDeServiceWorker(DIST_WEB)).toContain("sw.js");
  });

  it("el bundle de la web sigue emitiendo el manifest del PWA", () => {
    expect(existsSync(join(DIST_WEB, "manifest.webmanifest"))).toBe(true);
  });

  it("el sw.js de la web precachea los assets", () => {
    const sw = readFileSync(join(DIST_WEB, "sw.js"), "utf8");
    expect(sw).toContain("precache");
  });
});
