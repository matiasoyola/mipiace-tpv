// Integración Sentry del admin (v1.5-consistencia-B · Lote 2).
//
// Gated por VITE_SENTRY_DSN en build-time: sin DSN, `initSentry` no
// llama a `Sentry.init` y el SDK queda inerte (captureException sin
// cliente es no-op).
//
// Release = sha del build vía VITE_BUILD_HASH (lo fija CI; en dev no
// existe y los eventos van sin release).

import * as Sentry from "@sentry/react";

let enabled = false;

export function isSentryEnabled(): boolean {
  return enabled;
}

export function initSentry(): boolean {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: (import.meta.env.VITE_BUILD_HASH as string | undefined) || undefined,
    // Sólo errores; sin tracing/replay (cuota + peso del bundle).
    tracesSampleRate: 0,
  });
  Sentry.setTag("app", "admin");
  enabled = true;
  return true;
}

export function captureError(
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (extra) scope.setExtras(extra);
    Sentry.captureException(err);
  });
}
