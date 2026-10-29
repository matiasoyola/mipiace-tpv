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
//
// ── clinica-11 · LOS DATOS DE SALUD NO SALEN NI EN UN ERROR ──────────
//
// Antes de este bloque, `init` llevaba cuatro líneas: dsn, environment,
// release y `tracesSampleRate: 0`. Lo que eso significa en la v10 del SDK,
// leído en el código del paquete y no en la documentación:
//
//   · `dataCollection` tiene por defecto `cookies: true`, `queryParams:
//     true`, `httpHeaders.request: true`, `stackFrameVariables: true` y
//     `httpBodies: ['incomingRequest', …]`. Es decir: **el cuerpo de la
//     petición entrante viaja con el evento.** Un 500 en
//     `POST /clinica/clients/:id/entries` mandaba la exploración del pie
//     —en claro: el cifrado pasa después de validar— a un tercero.
//   · `stackFrameVariables` son las variables LOCALES de cada marco del
//     stack. En un handler clínico, una de ellas es el cuerpo parseado.
//   · `sendDefaultPii: false` NO arregla ninguna de las dos. Es la
//     palanca vieja (en la v10 está marcada `@deprecated`) y gobierna
//     `user.*`, no los cuerpos.
//
// Así que la negativa va en TRES capas, y las tres a propósito:
//
//   1. `dataCollection` — que el cuerpo, las cookies, la query, las
//      cabeceras y las locales **no se recojan**.
//   2. `requestDataIntegration({ include: { data: false, … } })` — porque
//      el `include.data` de esa integración está cableado a `true` en el
//      propio SDK («Always attach body data that's already on the scope»),
//      así que si algo deja el cuerpo en el scope, se adjunta igual.
//   3. `beforeSend` / `beforeSendTransaction` / `beforeBreadcrumb` →
//      `limpiarEvento` / `limpiarMiga` del paquete `sentry-limpio`, que es
//      lo último que toca el evento antes del transporte.
//
// ¿Por qué tres y no una? Porque las dos primeras son configuración de un
// SDK que ya cambió de criterio una vez entre versiones menores, y la
// tercera es nuestra. Si mañana la v11 mueve el cuerpo de `request.data` a
// otro sitio, las capas 1 y 2 se quedan calladas; la 3 se ve en rojo en
// `clinica-11-sentry.test.ts`, que mira el JSON entero del evento.
//
// Lo que este fichero NO puede arreglar: que el MENSAJE de una excepción
// lleve el texto del paciente. No hay filtro que sepa qué trozo de una
// cadena es un nombre. Eso se arregla no concatenándolo al lanzar, y en
// este bloque se revisaron los `throw` de las rutas clínicas (ver el
// `-done`).

import * as Sentry from "@sentry/node";

import { limpiarEvento, limpiarMiga } from "@mipiacetpv/sentry-limpio";

import { loadEnv } from "../env.js";

let enabled = false;

export function isSentryEnabled(): boolean {
  return enabled;
}

/**
 * clinica-11 · las opciones con las que arranca Sentry en la API.
 *
 * Están fuera de `initSentry` para que el test pueda arrancar un cliente
 * de verdad con un transporte falso y medir qué llega. Si estuvieran
 * dentro, el test tendría que reconstruirlas a mano y entonces no estaría
 * midiendo lo que corre en producción: estaría midiendo su propia copia.
 */
export function opcionesDeSentry(env: {
  SENTRY_DSN?: string;
  NODE_ENV?: string;
  SENTRY_RELEASE?: string;
}): Sentry.NodeOptions {
  return {
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    // Sólo errores — el tracing/performance queda fuera de este bloque
    // (coste de cuota y de CPU en un VPS de 1 vCPU).
    tracesSampleRate: 0,
    // La palanca vieja. Se deja puesta aunque `dataCollection` la ignore:
    // cuesta una línea y cubre el día que alguien quite `dataCollection`.
    sendDefaultPii: false,
    // CAPA 1 · que no se recoja.
    dataCollection: {
      // Ni IP, ni usuario adivinado desde las cabeceras.
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      // La lista vacía es «ningún cuerpo»: ni el de la petición entrante,
      // ni el de la saliente a Holded (que lleva el nombre del cliente).
      httpBodies: [],
      queryParams: false,
      // Las variables locales de cada marco del stack. En un handler
      // clínico, una de ellas ES el cuerpo.
      stackFrameVariables: false,
    },
    // CAPA 2 · y que, si algo la deja en el scope, no se adjunte.
    // La integración se declara con el MISMO nombre que la de la lista por
    // defecto (`RequestData`), y el SDK deja ganar a la del usuario.
    integrations: [
      Sentry.requestDataIntegration({
        include: {
          data: false,
          cookies: false,
          query_string: false,
          headers: false,
          ip: false,
          // La url SÍ: es lo que dice qué ruta falló. `limpiarEvento` le
          // quita la query y le sustituye los ids.
          url: true,
        },
      }),
    ],
    // CAPA 3 · y lo último antes del transporte.
    beforeSend: (evento) => limpiarEvento(evento),
    beforeSendTransaction: (evento) => limpiarEvento(evento),
    beforeBreadcrumb: (miga) => limpiarMiga(miga),
  };
}

// Llamar UNA vez al arrancar el proceso (server.ts / workers/index.ts),
// lo antes posible. `component` distingue api vs worker en los eventos.
//
// clinica-11 · `anadidos` existe para UNA cosa: que el test le ponga un
// transporte falso y pueda mirar el evento que de verdad sale. Entra por
// aquí y no por un `Sentry.init` suelto en el test porque lo que hay que
// medir incluye el `enabled` de este módulo —`captureError` es no-op sin
// él— y porque un `init` propio del test sería una copia de las opciones,
// y entonces el test no mediría producción (el criterio de la casa:
// «verde pero nadie la llama»). En producción nadie le pasa nada.
export function initSentry(
  component: "api" | "worker",
  anadidos: Partial<Sentry.NodeOptions> = {},
): boolean {
  const env = loadEnv();
  if (!env.SENTRY_DSN) return false;
  Sentry.init({ ...opcionesDeSentry(env), ...anadidos });
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
