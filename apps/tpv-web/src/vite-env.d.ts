/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// v1.2-Lite Lote 3.B: build-time injected version string. Comparado
// contra `/version.json` en runtime para detectar bundle viejo y
// forzar limpieza de caches + reload.
declare const __APP_VERSION__: string;

// v1.3-UX-Iteración Lote 3: build hash inyectado por commit. Útil
// para diagnóstico ("¿qué build se está ejecutando?") y para que el
// contenido del SW cambie deterministamente.
interface ImportMetaEnv {
  readonly VITE_BUILD_HASH?: string;
  readonly VITE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
