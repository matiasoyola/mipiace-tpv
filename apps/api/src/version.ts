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

// declaracion-responsable · FECHA de la versión en ejecución.
//
// El apartado 1.l) de la declaración responsable (art. 15 de la Orden
// HAC/1177/2024) pide la fecha en que el productor la suscribe, y eso es la
// fecha de LA VERSIÓN, no la de hoy. Se hornea junto a `APP_VERSION`
// (infra/Dockerfile: ARG GIT_COMMIT_DATE → ENV APP_VERSION_DATE, alimentado
// por el job `publish` de CI con la fecha del commit), por el mismo motivo
// que la versión: así la imagen sabe de cuándo es aunque se despliegue como
// `:latest`, y nadie teclea la fecha en una plantilla.
//
// SIN fallback a `new Date()`: una declaración responsable cuya fecha
// cambia cada vez que alguien abre el documento no es la declaración de
// ninguna versión. Si no está horneada devolvemos null y la declaración lo
// dice — que es la verdad en una build de desarrollo.
const FECHA_CIVIL_RE = /^\d{4}-\d{2}-\d{2}$/;

export function getAppVersionDate(): string | null {
  // CI puede pasar la fecha del commit completa en ISO 8601
  // (`2026-09-27T18:04:11Z`); nos quedamos con la parte civil, que es lo que
  // el apartado 1.l) pide. Una hora en un documento legal sólo añade la
  // pregunta de en qué huso.
  const raw = pick(process.env.APP_VERSION_DATE);
  if (raw === null) return null;
  const civil = raw.slice(0, 10);
  return FECHA_CIVIL_RE.test(civil) ? civil : null;
}
