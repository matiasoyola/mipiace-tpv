// Integración Sentry del TPV (v1.5-consistencia-B · Lote 2).
//
// Gated por VITE_SENTRY_DSN en build-time: sin DSN, `initSentry` no
// llama a `Sentry.init` y el SDK queda inerte (captureException sin
// cliente es no-op) — los pilotos sin Sentry no notan nada.
//
// Release = sha del build: reutilizamos VITE_BUILD_HASH (v1.3-UX-Iter
// Lote 3), que CI fija al sha corto del commit.
//
// ── clinica-11 · LOS NOMBRES DE LAS PACIENTES NO SALEN DE AQUÍ ───────
//
// El riesgo del TPV no es el cuerpo de la petición (eso es la API): son
// los BREADCRUMBS. El SDK de navegador va dejando migas de todo lo que
// pasa antes del error, y dos de esas categorías llevan datos de la
// paciente con nombre y apellidos:
//
//   · `ui.click` / `ui.input` — el `message` de la miga es el árbol del
//     DOM que se pulsó, con su `aria-label` y su texto dentro. En la
//     agenda de una clínica eso es «Demetria Cobos · Quiropodia 10:30»;
//     en la historia, el título de una visita.
//   · `console` — cualquier `console.log` de depuración con la respuesta
//     de `GET /clinica/clients/:id/historia` dentro. Y la consola no se
//     audita: nadie revisa los `console.log` buscando datos de salud.
//
// Y luego las URLs: las de `fetch` y las de navegación llevan el id de la
// paciente, y las de la agenda llevan su nombre en la query.
//
// Qué se hace, todo en `sentry-limpio` (el mismo fichero que usan la API y
// el panel, por lo mismo que `cripto-campos.ts` es uno):
//
//   · `beforeBreadcrumb` tira las de interfaz y las de consola, tira la
//     navegación a una ruta clínica y recorta las URLs del resto.
//   · `beforeSend` quita `request.data`, recorta la URL del evento y
//     sanea `extra`, `contexts` y `user`.
//   · `dataCollection` apaga la recogida de cuerpos, cookies, query y
//     cabeceras, que es la capa que hace que lo de arriba no tenga que
//     ser perfecto.
//
// SIN REPLAY, y no por omisión: la lista de integraciones se filtra y hay
// un test que lo mira. Un Replay en una consulta de podología es una
// grabación de la pantalla con la historia de la paciente dentro.

import * as Sentry from "@sentry/react";

import { limpiarEvento, limpiarMiga } from "@mipiacetpv/sentry-limpio";

let enabled = false;

export function isSentryEnabled(): boolean {
  return enabled;
}

/**
 * clinica-11 · las opciones con las que arranca Sentry en el TPV.
 *
 * Fuera de `initSentry` para que el test pueda arrancar un cliente con un
 * transporte falso y medir qué llega. Dentro, el test tendría que
 * reconstruirlas y estaría midiendo su copia.
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
    // NI UNA GRABACIÓN DE PANTALLA. Se filtra por nombre y no se confía en
    // que la lista por defecto no la traiga: el día que el SDK la meta por
    // defecto, esto sigue diciendo no.
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
  Sentry.setTag("app", "tpv-web");
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
