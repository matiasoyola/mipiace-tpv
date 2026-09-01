import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// PWA en producción. En `vite dev` el SW también está activo (devOptions
// enabled=true) para detectar bugs de cacheo desde el primer día.
//
// El manifest todavía no lleva iconos definitivos — los PNG (192, 512)
// se añaden en B4 cuando exista identidad visual. Mientras tanto, el
// navegador usará el favicon SVG generado por Vite.

// v1.2-Lite Lote 3.B · invalidación SW agresiva.
//
// Tras detectar que tras un deploy el TPV del cajero seguía sirviendo
// el bundle viejo (a pesar de registerType:autoUpdate), añadimos un
// version-check determinista:
//
//   1. Build emite un `APP_VERSION` único (timestamp de build) que
//      queda embebido en el bundle vía Vite `define`.
//   2. Build emite también `dist/version.json` con el mismo valor.
//      Caddy lo sirve plano (no precacheado por el SW: ".json" no está
//      en globPatterns).
//   3. En arranque, el TPV hace `fetch('/version.json', cache:'no-store')`
//      y, si la versión del servidor difiere de la embebida, limpia
//      caches + IDB + SW y recarga.
//
// La constante se calcula una sola vez por proceso de Vite (no por
// archivo importado), así dev y build comparten valor en la misma
// sesión.
const APP_VERSION = `${Date.now()}`;

// v1.3-UX-Iteración Lote 3 · build hash inyectado por commit. Garantiza
// que el contenido del SW cambia en cada commit aunque los assets
// emitidos sean iguales (p.ej. un cambio sólo en docs). En CI o en
// entornos sin git (Docker build sin .git), caemos al APP_VERSION.
function resolveBuildHash(): string {
  if (process.env.VITE_BUILD_HASH) return process.env.VITE_BUILD_HASH;
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return APP_VERSION;
  }
}
const BUILD_HASH = resolveBuildHash();

// A4 · ¿para quién es este build? "android" cuando lo lanza el shell de
// Capacitor (apps/tpv-android fija VITE_TARGET), vacío para la web.
//
// Sirve para dos cosas distintas y las dos importan:
//
//   1. Apagar el Service Worker en el build de Android (ver `disable` en
//      VitePWA, abajo).
//   2. Quedar EMBEBIDO en el bundle, para que en runtime se pueda saber si
//      el JS que se está ejecutando salió de la APK o de producción. El
//      bundle de la web no lleva esta marca; el de la APK sí. Si dentro de
//      Capacitor el bundle no dice "android", es que no es el suyo
//      (platform/AppInfo.ts).
const BUILD_TARGET = process.env.VITE_TARGET ?? "";
const IS_ANDROID_BUILD = BUILD_TARGET === "android";

function emitVersionJson(): import("vite").Plugin {
  // A4: el destino sale de la config resuelta y no de un "dist" a pelo. Con
  // la ruta fija, un build a otro `--outDir` (los tests de bundle de A4 lo
  // hacen para no pisar el dist de trabajo) escribía en el dist equivocado —
  // y petaba si ese dist no existía todavía.
  let outDir = resolve(__dirname, "dist");
  return {
    name: "mipiacetpv-emit-version-json",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(
        resolve(outDir, "version.json"),
        JSON.stringify({ version: APP_VERSION }) + "\n",
        "utf8",
      );
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    // v1.3-UX-Iteración Lote 3: expuesto como import.meta.env. Útil
    // para diagnóstico ("¿qué build estoy ejecutando?") y para que el
    // SW cambie deterministamente por commit.
    "import.meta.env.VITE_BUILD_HASH": JSON.stringify(BUILD_HASH),
    // A4: la marca de destino viaja dentro del bundle (ver BUILD_TARGET).
    "import.meta.env.VITE_TARGET": JSON.stringify(BUILD_TARGET),
  },
  plugins: [
    react(),
    emitVersionJson(),
    VitePWA({
      // A4 · en el build de Android NO se genera Service Worker.
      //
      // Dentro de la APK los assets ya son locales: el SW no aporta offline
      // (lo da el propio APK) y es exactamente el vector del fallo del
      // 01-09. Capacitor intercepta las peticiones DEL WEBVIEW con su
      // WebViewAssetLoader, pero NO las del Service Worker: el registro de
      // `/sw.js` salía a la red bajo el origen real (server.hostname =
      // mipiacetpv.com), traía el sw.js de producción, precacheaba los
      // assets de producción y pasaba a controlar la página. A partir de
      // ahí la APK servía producción para siempre y su bundle quedaba de
      // adorno — una APK entregada a un cliente enseñaba lo que hubiera en
      // el VPS ese día, no lo que se le entregó.
      //
      // `disable` es la vía soportada del plugin: no emite sw.js, no
      // inyecta el registro en el HTML y resuelve `virtual:pwa-register`
      // a un `registerSW` no-op — así main.tsx no cambia y la web
      // (navegador/PWA), donde el SW SÍ es el offline, se queda igual.
      disable: IS_ANDROID_BUILD,
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      devOptions: { enabled: true, type: "module" },
      manifest: {
        name: "mipiacetpv",
        short_name: "mipiacetpv",
        description: "TPV multi-tenant integrado con Holded",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "landscape",
        start_url: "/",
        scope: "/",
        // Iconos de marca (docs/design/tokens.md §1). Generados por
        // `node scripts/gen-pwa-icons.mjs` desde el logo canónico. El mismo
        // set sirve web (manifest) y assets de marca; el icono nativo Android
        // es un VectorDrawable aparte.
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // v1.3-UX-Iteración Lote 3: cleanupOutdatedCaches limpia caches
        // antiguas del propio workbox cuando el SW se actualiza. Sin
        // esto, runtime caches de bundles previos quedaban colgadas
        // ocupando cuota y a veces sirviendo respuestas viejas.
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        // v1.3-UX-Iteración Lote 3: inyecta un message handler en el
        // SW generado. El botón "Sincronizar" del TPV manda
        // `{type: "PURGE_RUNTIME"}` y este script borra las caches de
        // runtime para que la siguiente request fuerce red.
        importScripts: ["sw-message-handler.js"],
        // El catálogo va a IndexedDB (Dexie) en B4 — no por workbox.
        // B-ProductImages: imágenes de producto bajo /product-images/*
        // se cachean on-demand con StaleWhileRevalidate (7d). El TPV
        // pinta la versión cacheada inmediatamente y revalida en
        // background — ADR-007 offline-friendly se respeta porque la
        // primera vez que se ve un producto ya queda guardado.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/product-images/"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "product-images",
              expiration: {
                maxEntries: 1000,
                maxAgeSeconds: 7 * 24 * 60 * 60,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // v1.3-UX-Iteración Lote 3: catálogo + historial vía
          // NetworkFirst con timeout corto. El precedente #55 dejó
          // claro que en producción real el catálogo cambia
          // constantemente y servir caché vieja envenena la
          // experiencia (tags nuevos, servicios recién activados,
          // tickets nuevos no aparecen hasta cerrar/reabrir la PWA).
          // Offline sigue funcionando: si la red tarda >5s, cae al
          // caché. El sync incremental backend + IDB local del
          // catálogo son la fuente principal — la red para refrescos
          // explícitos.
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/api/tpv/catalog/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-catalog",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/tickets"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-tickets",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 64, maxAgeSeconds: 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
