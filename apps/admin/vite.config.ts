import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

import { PRODUCT_VERSION } from "./src/version.js";

// v1.0-pilotos · Lote 7: emite /version.json en el build (y lo sirve en
// dev) con la versión de producto + hash de build. La versión sale de
// la MISMA constante que pinta el footer (src/version.ts) — fuente
// única, sin hardcodear en tres sitios.
function versionJsonPlugin(): Plugin {
  const payload = () =>
    JSON.stringify(
      {
        version: PRODUCT_VERSION,
        buildHash: process.env.VITE_BUILD_HASH ?? "",
      },
      null,
      2,
    );
  return {
    name: "mipiacetpv-version-json",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: payload(),
      });
    },
    configureServer(server) {
      server.middlewares.use("/version.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(payload());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionJsonPlugin()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // agenda-lista · el destino sale del entorno para que el banco
        // pueda levantar su propia stack en otros puertos sin pisar la
        // sesión de otro worktree. Sin la variable, lo de siempre: con
        // dos APIs vivas, un proxy clavado a :3001 manda la pantalla de
        // esta sesión contra la base de la otra.
        target: process.env.MIPIACETPV_API_PROXY ?? "http://127.0.0.1:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
