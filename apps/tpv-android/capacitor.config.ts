import type { CapacitorConfig } from "@capacitor/cli";

// Shell Android de mipiacetpv. El WebView carga el build estático de
// tpv-web (webDir apunta a su dist). En desarrollo se puede apuntar
// server.url a la PWA en vivo para hot-reload — comentado por defecto
// para no acoplar el build a una IP local.
//
// ADR-011: el appId es de mipiace, no de un fabricante. Nada de SDKs
// propietarios; los periféricos hablan ESC/POS estándar.
const config: CapacitorConfig = {
  appId: "es.mipiace.tpv",
  appName: "mipiacetpv",
  // Apuntamos al dist de tpv-web (ruta relativa desde apps/tpv-android).
  webDir: "../tpv-web/dist",
  android: {
    // El TPV asume HTTPS (WebUSB/cam/SW). En el WebView usamos esquema
    // https para que el Service Worker y los permisos se comporten como
    // en producción.
    allowMixedContent: false,
  },
  server: {
    // Esquema https explícito (es el default de Capacitor 6, pero el SW
    // y los permisos del TPV dependen de él; no dejarlo implícito).
    androidScheme: "https",
    // El WebView sirve el bundle local bajo este host, de modo que el
    // origen es https://mipiacetpv.com y NO https://localhost. Sin esto,
    // la API rechaza por CORS (server.ts usa lista blanca exacta contra
    // CORS_ORIGINS) y la APK no puede ni vincularse. Verificado en el
    // AP11 el 2026-09-01. Alternativa descartada: meter https://localhost
    // en CORS_ORIGINS del VPS, que ensancha la lista blanca sin necesidad.
    hostname: "mipiacetpv.com",
    // Para hot-reload en desarrollo contra la PWA local, descomentar y
    // poner la IP del Mac en la LAN. NO commitear con esto activo.
    // url: "http://192.168.1.50:5174",
    // cleartext: true,
  },
  plugins: {
    // A3 · identidad visual. La app corre en modo inmersivo (MainActivity,
    // A0) con las barras ocultas; cuando el usuario las revela con un swipe
    // deben ser coherentes con el theme_color del TPV (#0F172A slate-900).
    StatusBar: {
      style: "DARK", // texto/iconos claros sobre fondo oscuro
      backgroundColor: "#0F172A",
      overlaysWebView: false,
    },
  },
};

export default config;
