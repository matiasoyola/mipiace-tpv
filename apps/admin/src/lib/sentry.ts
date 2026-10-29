// Integración Sentry del admin (v1.5-consistencia-B · Lote 2).
//
// Gated por VITE_SENTRY_DSN en build-time: sin DSN, `initSentry` no
// llama a `Sentry.init` y el SDK queda inerte (captureException sin
// cliente es no-op).
//
// Release = sha del build vía VITE_BUILD_HASH (lo fija CI; en dev no
// existe y los eventos van sin release).
//
// ── clinica-11 · MISMA REGLA QUE EL TPV, Y POR MÁS MOTIVO ────────────
//
// El panel es donde vive la residencia entera: el plan de cuidados de
// doña Carmen, el libro de incidencias, los relevos, las no conformidades
// y la ficha de personal con su DNI. Y a diferencia del TPV, aquí las
// rutas clínicas SÍ están en la barra de direcciones:
// `/admin/residencia/residentes/:clientId/plan`.
//
// Así que lo que se filtra es lo mismo y por lo mismo (ver la cabecera de
// `sentry-limpio`, que es el único sitio donde se decide qué se va):
// breadcrumbs de interfaz y de consola fuera, navegación a una ruta
// clínica fuera, URLs recortadas, cuerpos y cabeceras sin recoger, y
// ninguna grabación de pantalla.

import * as Sentry from "@sentry/react";

import { limpiarEvento, limpiarMiga } from "@mipiacetpv/sentry-limpio";

let enabled = false;

export function isSentryEnabled(): boolean {
  return enabled;
}

/**
 * clinica-11 · las opciones con las que arranca Sentry en el panel.
 * Fuera de `initSentry` por lo mismo que en la API y el TPV: para que el
 * test mida lo que corre y no una copia suya.
 */
export function opcionesDeSentry(env: {
  dsn: string;
  mode?: string;
  release?: string;
}): Sentry.BrowserOptions {
  return {
    dsn: env.dsn,
    environment: env.mode,
    release: env.release,
    // Sólo errores; sin tracing/replay (cuota + peso del bundle).
    tracesSampleRate: 0,
    sendDefaultPii: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      queryParams: false,
      stackFrameVariables: false,
    },
    integrations: (porDefecto) =>
      porDefecto.filter((i) => !i.name.toLowerCase().includes("replay")),
    beforeSend: (evento) => limpiarEvento(evento),
    beforeSendTransaction: (evento) => limpiarEvento(evento),
    beforeBreadcrumb: (miga) => limpiarMiga(miga),
  };
}

// clinica-11 · `anadidos` existe para UNA cosa, igual que en la API: que
// el test le ponga un transporte falso y pueda mirar el evento que de
// verdad sale, pasando por este `init` y no por una copia suya de las
// opciones. En producción nadie le pasa nada.
export function initSentry(
  anadidos: Partial<Sentry.BrowserOptions> = {},
): boolean {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return false;
  Sentry.init({
    ...opcionesDeSentry({
      dsn,
      mode: import.meta.env.MODE,
      release:
        (import.meta.env.VITE_BUILD_HASH as string | undefined) || undefined,
    }),
    ...anadidos,
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
