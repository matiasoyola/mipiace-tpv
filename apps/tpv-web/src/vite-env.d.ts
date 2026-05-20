/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// v1.2-Lite Lote 3.B: build-time injected version string. Comparado
// contra `/version.json` en runtime para detectar bundle viejo y
// forzar limpieza de caches + reload.
declare const __APP_VERSION__: string;
