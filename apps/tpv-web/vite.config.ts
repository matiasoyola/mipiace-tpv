import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// PWA en producción. En `vite dev` el SW también está activo (devOptions
// enabled=true) para detectar bugs de cacheo desde el primer día.
//
// El manifest todavía no lleva iconos definitivos — los PNG (192, 512)
// se añaden en B4 cuando exista identidad visual. Mientras tanto, el
// navegador usará el favicon SVG generado por Vite.

export default defineConfig({
  plugins: [
    react(),
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
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
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
