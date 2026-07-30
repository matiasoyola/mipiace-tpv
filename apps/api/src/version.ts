// v1.9.8 · versión visible en /health.
//
// Objetivo: saber qué imagen corre en producción sin entrar al VPS.
// `APP_VERSION` se hornea en la imagen (infra/Dockerfile: ARG GIT_SHA →
// ENV APP_VERSION, alimentado por el job `publish` de CI con el sha
// corto del commit). Así la imagen sabe su propia versión aunque se
// despliegue como `:latest`.
//
// Fallbacks defensivos: si `APP_VERSION` no está horneada, se intenta
// `SENTRY_RELEASE` (el compose la fija a IMAGE_TAG); si tampoco hay algo
// útil, "unknown" — el health NUNCA se rompe por esto.

function pick(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // "latest" es el tag por defecto del deploy: no identifica la versión.
  if (trimmed === "latest") return null;
  return trimmed;
}

export function getAppVersion(): string {
  return (
    pick(process.env.APP_VERSION) ??
    pick(process.env.SENTRY_RELEASE) ??
    "unknown"
  );
}

// Instante de arranque del proceso. Se evalúa al cargar el módulo (boot
// del server); sirve para ver de un vistazo si hubo un reinicio.
export const SERVER_STARTED_AT: string = new Date().toISOString();
