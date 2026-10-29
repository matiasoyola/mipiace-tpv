// clinica-11 · EL NOMBRE DE LA PACIENTE NO LLEGA A SENTRY DESDE EL TPV.
//
// El riesgo del TPV no es el cuerpo de la petición: son los breadcrumbs.
// El SDK de navegador deja una miga por cada clic con el árbol del DOM
// pulsado dentro —`aria-label` y texto incluidos—, y en la agenda de una
// clínica eso es el nombre de la paciente.
//
// Lo que se mide aquí: se arranca Sentry por el `initSentry` DE VERDAD con
// un transporte falso, se pulsa un botón de la agenda con el centinela en
// su etiqueta, se fuerza un error y **el envelope no lleva el centinela en
// ningún sitio**.
//
// Sabotajes (los dos vistos en rojo, ver el `-done`):
//   · quitar `beforeBreadcrumb` de `opcionesDeSentry` → rojo;
//   · quitar `beforeSend` → rojo (la URL con el nombre en la query).

import { describe, expect, it, vi } from "vitest";

const CENTINELA = "PACIENTE-CENTINELA";
const CLIENT_ID = "7f3b1c2d-0000-4000-8000-000000000001";

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

function loEnviado(): string {
  return JSON.stringify(enviados);
}

describe("clinica-11 · Sentry en el TPV", () => {
  it("un clic en la agenda y un error: el centinela no sale", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://0123456789abcdef@o0.ingest.sentry.io/1");
    const Sentry = await import("@sentry/react");
    const { initSentry, captureError } = await import("../src/lib/sentry.js");

    // Si el gate del DSN no se abre, el resto del fichero no mide nada.
    expect(initSentry({ transport: transporteFalso })).toBe(true);

    // 1. La miga del clic, tal como la deja el SDK: el `message` es el
    //    árbol del DOM con la etiqueta dentro.
    Sentry.addBreadcrumb({
      category: "ui.click",
      message: `button[aria-label="Cobrar a ${CENTINELA}"]`,
    });
    // 2. La de consola, que es la otra que nadie audita.
    Sentry.addBreadcrumb({
      category: "console",
      level: "log",
      message: `historia cargada: ${CENTINELA}`,
    });
    // 3. La del fetch a la historia, con el id de la paciente y su nombre
    //    en la query. Ésta SÍ viaja — recortada.
    Sentry.addBreadcrumb({
      category: "fetch",
      data: {
        url: `https://api.mipiace.es/clinica/clients/${CLIENT_ID}/historia?q=${CENTINELA}`,
        status_code: 500,
      },
    });
    // 4. Y la navegación a una ruta clínica, que se tira entera.
    Sentry.addBreadcrumb({
      category: "navigation",
      data: { from: "/", to: `/clinica/clients/${CLIENT_ID}/historia` },
    });

    captureError(new Error("fallo al pintar la historia"), {
      registerId: "44444444-4444-4444-4444-444444444444",
      // Lo que un `captureError` descuidado metería: el objeto que se
      // estaba mirando.
      visita: { cuerpo: CENTINELA },
      clientName: CENTINELA,
    });
    await Sentry.flush(2000);

    expect(enviados.length).toBeGreaterThan(0);
    expect(loEnviado()).not.toContain(CENTINELA);
    // Y lo que sí sirve sigue estando.
    expect(loEnviado()).toContain("fallo al pintar la historia");
    // La ruta del fetch, recortada: sin la query y sin el id.
    expect(loEnviado()).toContain("/clinica/clients/:id/historia");
    expect(loEnviado()).not.toContain(CLIENT_ID);

    vi.unstubAllEnvs();
  });

  it("sin DSN no se arranca nada", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    vi.resetModules();
    const { initSentry, isSentryEnabled } = await import("../src/lib/sentry.js");
    expect(initSentry()).toBe(false);
    expect(isSentryEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });

  // El envelope de arriba sale limpio por DOS razones a la vez: el
  // `beforeBreadcrumb` no guarda la miga, y el `beforeSend` la tiraría
  // igual si estuviera guardada (`limpiarEvento` también sanea
  // `breadcrumbs`). Eso es a propósito —dos capas—, pero significa que
  // quitar sólo el `beforeBreadcrumb` NO se ve desde el envelope. Así que
  // se afirma aquí, sobre la opción cableada: una miga de interfaz no se
  // guarda nunca, y eso es lo que impide que viaje en el evento SIGUIENTE
  // (el que no pase por el mismo `beforeSend`, p. ej. una transacción).
  it("beforeBreadcrumb no guarda las migas de interfaz ni de consola", async () => {
    const { opcionesDeSentry } = await import("../src/lib/sentry.js");
    const o = opcionesDeSentry({ dsn: "https://x@o0.ingest.sentry.io/1" });
    expect(o.beforeBreadcrumb).toBeTypeOf("function");
    const antes = o.beforeBreadcrumb!;
    expect(antes({ category: "ui.click", message: CENTINELA }, {})).toBeNull();
    expect(antes({ category: "ui.input", message: CENTINELA }, {})).toBeNull();
    expect(antes({ category: "console", message: CENTINELA }, {})).toBeNull();
    expect(
      antes(
        {
          category: "navigation",
          data: { from: "/", to: `/clinica/clients/${CLIENT_ID}/historia` },
        },
        {},
      ),
    ).toBeNull();
    // Y la de un fetch no clínico sigue viva, con la ruta recortada.
    const miga = antes(
      { category: "fetch", data: { url: "/shift/current?x=1", status_code: 200 } },
      {},
    );
    expect(miga?.data).toEqual({ url: "/shift/current", status_code: 200 });
  });

  it("las opciones no traen Replay ni recogen cuerpos", async () => {
    const { opcionesDeSentry } = await import("../src/lib/sentry.js");
    const o = opcionesDeSentry({ dsn: "https://x@o0.ingest.sentry.io/1" });
    expect(o.dataCollection?.httpBodies).toEqual([]);
    expect(o.dataCollection?.cookies).toBe(false);
    expect(o.dataCollection?.queryParams).toBe(false);
    expect(o.sendDefaultPii).toBe(false);
    // Una grabación de pantalla en una consulta de podología es la
    // historia de la paciente en vídeo.
    const integraciones = (
      o.integrations as (porDefecto: { name: string }[]) => { name: string }[]
    )([{ name: "Replay" }, { name: "ReplayCanvas" }, { name: "Breadcrumbs" }]);
    expect(integraciones.map((i) => i.name)).toEqual(["Breadcrumbs"]);
  });
});
