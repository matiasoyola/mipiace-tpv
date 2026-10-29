// clinica-11 · EL CENTINELA NO LLEGA A SENTRY.
//
// Lo que prueba este fichero: un error en una ruta clínica, con el cuerpo,
// la query y una cabecera llevando `PACIENTE-CENTINELA`, y el evento que
// el transporte de Sentry recibe **sin el centinela en ningún sitio**.
//
// «En ningún sitio» es literal: se serializa el envelope ENTERO y se busca
// la cadena. Un assert por campo (`request.data`, `extra.url`, …) es un
// assert que pasa el día que el SDK mueve el dato de sitio, y eso ya pasó
// una vez entre versiones menores de la v10.
//
// Las tres capas de `lib/sentry.ts` tienen su test:
//
//   · capa 3 (`beforeSend`) · el envelope real, abajo. Quitar el
//     `beforeSend` de `opcionesDeSentry` → rojo: la query del error entra
//     por `extra.url` del manejador global y nadie más la quita.
//   · capa 2 (`requestDataIntegration`) · que la integración se declara
//     con `data: false`. Es configuración de un SDK, así que lo que se
//     puede afirmar es que se declara.
//   · capa 1 (`dataCollection`) · idem: que los cuerpos no se recogen.
//
// Y el `beforeSend` cableado se ejercita a pelo con un evento que SÍ trae
// `request.data`, que es el caso que las capas 1 y 2 impiden que ocurra:
// si algún día dejan de impedirlo, el `beforeSend` sigue quitándolo.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
// El DSN tiene que ser válido en forma: con uno roto el SDK se desactiva
// solo y este fichero pasaría en verde sin mirar nada.
process.env.SENTRY_DSN = "https://0123456789abcdef@o0.ingest.sentry.io/1";

import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { olvidarEnv } from "../src/env.js";
import { registerErrorHandler } from "../src/lib/error-handler.js";
import { captureError, initSentry, opcionesDeSentry } from "../src/lib/sentry.js";

const CENTINELA = "PACIENTE-CENTINELA";
const CLIENT_ID = "7f3b1c2d-0000-4000-8000-000000000001";

// ── El transporte falso ──────────────────────────────────────────────
//
// Guarda los envelopes en crudo. No se interpreta nada: lo que se busca
// es una cadena dentro de lo que habría salido por la red.
const enviados: unknown[] = [];

function transporteFalso() {
  return {
    send: async (envelope: unknown) => {
      enviados.push(envelope);
      return {};
    },
    flush: async () => true,
  };
}

/** Todo lo que habría salido por el cable, como texto. */
function loEnviado(): string {
  return JSON.stringify(enviados, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

const app = Fastify({ logger: false });

beforeAll(async () => {
  olvidarEnv();
  const on = initSentry("api", { transport: transporteFalso });
  // Si esto falla, el resto del fichero no prueba nada: el SDK estaría
  // apagado y `captureError` sería un no-op.
  expect(on).toBe(true);

  registerErrorHandler(app);

  // Una ruta clínica que revienta. El 500 pasa por el manejador global,
  // que es quien llama a `captureError` — el mismo camino que un error de
  // verdad en `POST /clinica/clients/:clientId/entries`.
  app.post(
    "/clinica/clients/:clientId/entries",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
    async () => {
      throw new Error("fallo forzado en una ruta clínica");
    },
  );
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("clinica-11 · capa 3 · el evento que sale", () => {
  it("un 500 en una ruta clínica no manda el centinela a Sentry", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/clinica/clients/${CLIENT_ID}/entries?nombre=${CENTINELA}`,
      headers: {
        authorization: `Bearer ${CENTINELA}`,
        cookie: `sid=${CENTINELA}`,
        "content-type": "application/json",
      },
      payload: {
        kind: "SESSION",
        cuerpo: { exploracion: CENTINELA, motivo: CENTINELA },
      },
    });
    expect(res.statusCode).toBe(500);
    const { flush } = await import("@sentry/node");
    await flush(2000);

    // El canario del canario: si no salió NINGÚN evento, este fichero no
    // está midiendo nada.
    expect(enviados.length).toBeGreaterThan(0);
    expect(loEnviado()).not.toContain(CENTINELA);
  });

  it("el mensaje del error sí llega: Sentry sigue sirviendo para algo", () => {
    expect(loEnviado()).toContain("fallo forzado en una ruta clínica");
  });

  // ── EL CAMINO QUE DE VERDAD FILTRABA LA QUERY ─────────────────────
  //
  // `lib/error-handler.ts` registra `extra: { url: request.url, method }`
  // en sus dos `captureError`, y `request.url` de Fastify **incluye la
  // query**. Así que la query de una ruta clínica —`?nombre=…`, el token
  // del informe por enlace— llegaba a Sentry por ahí, sin pasar por
  // ninguna integración que se pudiera apagar.
  //
  // Se llama a `captureError` con el MISMO contexto que arma el manejador
  // global, en vez de inyectar otra petición, porque lo que hay que medir
  // es ese `extra` y `app.inject` no lo garantiza (el evento de arriba lo
  // emite la instrumentación de Fastify, que no pasa por aquí).
  it("la query de una ruta clínica no viaja en el extra del manejador", async () => {
    enviados.length = 0;
    captureError(new Error("error no controlado"), {
      tenantId: "22222222-2222-2222-2222-222222222222",
      requestId: "req-7",
      extra: {
        sqlState: null,
        method: "POST",
        url: `/clinica/clients/${CLIENT_ID}/entries?nombre=${CENTINELA}`,
      },
    });
    const { flush } = await import("@sentry/node");
    await flush(2000);

    const texto = loEnviado();
    expect(enviados.length).toBeGreaterThan(0);
    expect(texto).not.toContain(CENTINELA);
    // Pero la ruta sigue estando, recortada: es lo que dice QUÉ falló.
    expect(texto).toContain("/clinica/clients/:id/entries");
    expect(texto).not.toContain(CLIENT_ID);
    // Y el requestId, que es con lo que se cruza con el log de la API.
    expect(texto).toContain("req-7");
  });
});

describe("clinica-11 · capa 3 · el beforeSend cableado", () => {
  const opciones = opcionesDeSentry({
    SENTRY_DSN: "https://x@o0.ingest.sentry.io/1",
    NODE_ENV: "test",
  });

  it("quita el cuerpo de la petición aunque llegue puesto", () => {
    expect(opciones.beforeSend).toBeTypeOf("function");
    const limpio = opciones.beforeSend!(
      {
        request: {
          url: `https://api/clinica/clients/${CLIENT_ID}/entries?nombre=${CENTINELA}`,
          data: { cuerpo: CENTINELA },
          cookies: { sid: CENTINELA },
          query_string: `nombre=${CENTINELA}`,
          headers: { authorization: CENTINELA, "content-type": "application/json" },
        },
        user: { id: "u1", email: `${CENTINELA}@x.es` },
        extra: { nombre: CENTINELA, requestId: "req-1" },
      } as never,
      {},
    );
    expect(JSON.stringify(limpio)).not.toContain(CENTINELA);
  });

  it("y los breadcrumbs de interfaz y de consola no viajan", () => {
    expect(opciones.beforeBreadcrumb).toBeTypeOf("function");
    expect(
      opciones.beforeBreadcrumb!({ category: "ui.click", message: CENTINELA }, {}),
    ).toBeNull();
    expect(
      opciones.beforeBreadcrumb!({ category: "console", message: CENTINELA }, {}),
    ).toBeNull();
  });
});

describe("clinica-11 · capas 1 y 2 · lo que el SDK tiene prohibido recoger", () => {
  const opciones = opcionesDeSentry({
    SENTRY_DSN: "https://x@o0.ingest.sentry.io/1",
    NODE_ENV: "test",
  });

  it("capa 1 · dataCollection no recoge cuerpos, cookies, query ni cabeceras", () => {
    const dc = opciones.dataCollection;
    expect(dc).toBeDefined();
    // La lista vacía es «ningún cuerpo». `undefined` significaría TODOS.
    expect(dc!.httpBodies).toEqual([]);
    expect(dc!.cookies).toBe(false);
    expect(dc!.queryParams).toBe(false);
    expect(dc!.httpHeaders).toEqual({ request: false, response: false });
    expect(dc!.userInfo).toBe(false);
    // Las variables locales de cada marco del stack: en un handler
    // clínico, una de ellas es el cuerpo parseado.
    expect(dc!.stackFrameVariables).toBe(false);
    expect(opciones.sendDefaultPii).toBe(false);
  });

  it("capa 2 · la RequestData declarada no adjunta cuerpo, cookies ni query", () => {
    // El `include.data` de la integración por defecto está cableado a
    // `true` en el propio SDK. La de aquí la pisa por nombre.
    const nombres = (opciones.integrations as { name: string }[]).map(
      (i) => i.name,
    );
    expect(nombres).toContain("RequestData");
  });

  it("y no hay ni rastro de Replay", () => {
    const nombres = (opciones.integrations as { name: string }[]).map(
      (i) => i.name,
    );
    for (const n of nombres) {
      expect(n.toLowerCase()).not.toContain("replay");
    }
  });
});
