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
    // Para hot-reload en desarrollo contra la PWA local, descomentar y
    // poner la IP del Mac en la LAN. NO commitear con esto activo.
    // url: "http://192.168.1.50:5174",
    // cleartext: true,
  },
  plugins: {
    // Splash/status bar se afinan en A0 cuando exista identidad visual.
  },
};

export default config;
