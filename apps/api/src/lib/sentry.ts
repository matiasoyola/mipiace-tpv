// Integración Sentry del backend (v1.5-consistencia-B · Lote 2).
//
// TODO gated por SENTRY_DSN: sin DSN configurado, `initSentry` no llama
// a `Sentry.init` y los helpers de captura son no-op absolutos — los
// pilotos sin Sentry no notan nada (ni red, ni logs, ni overhead).
//
// Importar `@sentry/node` sin `init` no abre conexiones ni instala
// instrumentación: el SDK sólo activa transporte e integraciones dentro
// de `init`. `captureException` sin cliente inicializado es no-op.
//
// Release = sha del build. Llega vía SENTRY_RELEASE (el compose lo fija
// a IMAGE_TAG, que es el sha corto publicado por CI en GHCR).

import * as Sentry from "@sentry/node";

import { loadEnv } from "../env.js";

let enabled = false;

export function isSentryEnabled(): boolean {
  return enabled;
}

// Llamar UNA vez al arrancar el proceso (server.ts / workers/index.ts),
// lo antes posible. `component` distingue api vs worker en los eventos.
export function initSentry(component: "api" | "worker"): boolean {
  const env = loadEnv();
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    // Sólo errores — el tracing/performance queda fuera de este bloque
    // (coste de cuota y de CPU en un VPS de 1 vCPU).
    tracesSampleRate: 0,
  });
  Sentry.setTag("component", component);
  enabled = true;
  return true;
}

export interface SentryErrorContext {
  tenantId?: string | null;
  requestId?: string | null;
  // Etiquetas/extra adicionales (jobId, externalId, endpoint…).
  extra?: Record<string, unknown>;
}

export function captureError(err: unknown, ctx: SentryErrorContext = {}): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (ctx.tenantId) scope.setTag("tenantId", ctx.tenantId);
    if (ctx.requestId) scope.setTag("requestId", ctx.requestId);
    if (ctx.extra) scope.setExtras(ctx.extra);
    Sentry.captureException(err);
  });
}

// Para condiciones alertables que no son excepciones (p.ej. mismatches
// de la conciliación diaria del Lote 4).
export function captureAlert(
  message: string,
  ctx: SentryErrorContext = {},
): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (ctx.tenantId) scope.setTag("tenantId", ctx.tenantId);
    if (ctx.requestId) scope.setTag("requestId", ctx.requestId);
    if (ctx.extra) scope.setExtras(ctx.extra);
    scope.setLevel("error");
    Sentry.captureMessage(message);
  });
}
