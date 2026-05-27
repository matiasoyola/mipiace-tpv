import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
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

function emitVersionJson(): import("vite").Plugin {
  return {
    name: "mipiacetpv-emit-version-json",
    apply: "build",
    closeBundle() {
      const outFile = resolve(__dirname, "dist", "version.json");
      writeFileSync(
        outFile,
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
  },
  plugins: [
    react(),
    emitVersionJson(),
    VitePWA({
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
        // TODO B4: añadir icons reales (192, 512, maskable).
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
