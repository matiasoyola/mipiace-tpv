// v1.0-pilotos · Lote 7: versión de producto. FUENTE ÚNICA — la leen
// el footer del admin (AdminShell) y el plugin de vite que emite
// /version.json en el build. No hardcodear este string en ningún otro
// sitio: al etiquetar la siguiente versión sólo se toca esta línea.

export const PRODUCT_VERSION = "v1.0";

// Hash de build inyectado por CI (infra/Dockerfile → VITE_BUILD_HASH).
// Cadena vacía en dev local.
export function readBuildHash(): string {
  return (
    (import.meta as unknown as { env?: { VITE_BUILD_HASH?: string } }).env
      ?.VITE_BUILD_HASH ?? ""
  );
}
