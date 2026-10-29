// clinica-11 · el saneado de Sentry, medido con un centinela.
//
// EL CRITERIO DE ESTOS TESTS: el centinela no aparece en el JSON del
// evento ENTERO, no «en el campo que yo me acordé de mirar». Un assert por
// campo es un assert que pasa el día que el SDK mueve el cuerpo de
// `request.data` a `contexts.request.data` — y eso ya ha pasado una vez en
// la v10.
//
// Sabotaje: quitar la línea `delete peticion.data` de `limpiarEvento` →
// rojo aquí y en `apps/api/test/clinica-11-sentry.test.ts`.

import { describe, expect, it } from "vitest";

import {
  CABECERAS_PERMITIDAS,
  esRutaClinica,
  limpiarEvento,
  limpiarMapa,
  limpiarMiga,
  limpiarUsuario,
  MAX_TEXTO,
  recortarUrl,
  type EventoDeSentry,
} from "../src/index.js";

const CENTINELA = "PACIENTE-CENTINELA";

/** Lo que de verdad se pregunta: ¿está el centinela en algún sitio? */
function llevaElCentinela(evento: unknown): boolean {
  return JSON.stringify(evento ?? null).includes(CENTINELA);
}

describe("clinica-11 · el evento que sale hacia Sentry", () => {
  function eventoConTodoDentro(): EventoDeSentry {
    return {
      event_id: "abc",
      transaction: `POST /clinica/clients/7f3b1c2d-0000-4000-8000-000000000001/entries`,
      request: {
        method: "POST",
        url: `https://api.mipiace.es/clinica/clients/7f3b1c2d-0000-4000-8000-000000000001/entries?nombre=${CENTINELA}`,
        data: { cuerpo: { exploracion: CENTINELA } },
        cookies: { sid: "s3cr3t" },
        query_string: `nombre=${CENTINELA}`,
        headers: {
          "content-type": "application/json",
          authorization: "Bearer s3cr3t",
          cookie: `nombre=${CENTINELA}`,
          "x-device-token": "d3v1c3",
          "user-agent": "Mozilla/5.0",
        },
      },
      user: {
        id: "11111111-1111-1111-1111-111111111111",
        tenantId: "22222222-2222-2222-2222-222222222222",
        email: "rosario@example.com",
        username: CENTINELA,
        ip_address: "88.0.0.1",
      },
      extra: {
        requestId: "req-1",
        prismaCode: "P2010",
        url: `/clinica/clients/7f3b1c2d-0000-4000-8000-000000000001/entries?nombre=${CENTINELA}`,
        cuerpo: { body: CENTINELA },
        nombrePaciente: CENTINELA,
        lineas: [{ nameSnapshot: CENTINELA }],
      },
      contexts: {
        runtime: { version: "20.11.0" },
        historia: { body: CENTINELA },
      },
      breadcrumbs: [
        { category: "ui.click", message: `button[aria-label="${CENTINELA}"]` },
        { category: "console", message: `historia: ${CENTINELA}` },
        {
          category: "navigation",
          data: { from: "/", to: `/admin/residencia/residentes/7f3b1c2d-0000-4000-8000-000000000001/plan` },
        },
        {
          category: "fetch",
          data: {
            url: `https://api.mipiace.es/clinica/clients/7f3b1c2d-0000-4000-8000-000000000001/historia?q=${CENTINELA}`,
            status_code: 500,
          },
        },
      ],
      exception: {
        values: [{ type: "Error", value: "la historia clínica no se edita" }],
      },
    };
  }

  it("el centinela no viaja en NINGÚN sitio del evento serializado", () => {
    const sucio = eventoConTodoDentro();
    expect(llevaElCentinela(sucio)).toBe(true); // el canario del canario
    const limpio = limpiarEvento(sucio);
    expect(llevaElCentinela(limpio)).toBe(false);
  });

  it("se van el cuerpo, las cookies y la query de la petición", () => {
    const limpio = limpiarEvento(eventoConTodoDentro());
    expect(limpio.request).toBeDefined();
    expect(limpio.request).not.toHaveProperty("data");
    expect(limpio.request).not.toHaveProperty("cookies");
    expect(limpio.request).not.toHaveProperty("query_string");
  });

  it("de las cabeceras sólo quedan las de la lista blanca", () => {
    const limpio = limpiarEvento(eventoConTodoDentro());
    const nombres = Object.keys(limpio.request?.headers ?? {});
    expect(nombres.sort()).toEqual(["content-type", "user-agent"]);
    for (const n of nombres) {
      expect(CABECERAS_PERMITIDAS).toContain(n);
    }
    expect(nombres).not.toContain("authorization");
    expect(nombres).not.toContain("x-device-token");
  });

  it("del usuario quedan el id interno y el tenant, y nada más", () => {
    const limpio = limpiarEvento(eventoConTodoDentro());
    expect(limpio.user).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      tenantId: "22222222-2222-2222-2222-222222222222",
    });
  });

  it("la url de la petición pierde la query y los ids", () => {
    const limpio = limpiarEvento(eventoConTodoDentro());
    expect(limpio.request?.url).toBe(
      "https://api.mipiace.es/clinica/clients/:id/entries",
    );
    expect(limpio.transaction).toBe("POST /clinica/clients/:id/entries");
  });

  it("el mensaje y el stack de la excepción se quedan", () => {
    const limpio = limpiarEvento(eventoConTodoDentro());
    expect(JSON.stringify(limpio.exception)).toContain(
      "la historia clínica no se edita",
    );
  });

  it("lo que sirve para diagnosticar sigue en extra", () => {
    const limpio = limpiarEvento(eventoConTodoDentro());
    expect(limpio.extra?.requestId).toBe("req-1");
    expect(limpio.extra?.prismaCode).toBe("P2010");
    // `url` sobrevive recortada: es la que dice QUÉ ruta falló.
    expect(limpio.extra?.url).toBe("/clinica/clients/:id/entries");
  });

  it("un evento sin request ni extra pasa sin romperse", () => {
    expect(limpiarEvento({ event_id: "x" })).toEqual({ event_id: "x" });
  });
});

describe("clinica-11 · limpiarMapa", () => {
  it("tira las claves que nombran a alguien", () => {
    const m = limpiarMapa({
      nombre: "Rosario",
      clientName: "Rosario",
      email: "r@x.es",
      dni: "12345678Z",
      bodyCifrado: "c1:abc",
      NOMBRE: "Rosario",
      // sin acentos ni mayúsculas: `Descripción` cae igual
      Descripción: "úlcera plantar",
    });
    expect(m).toEqual({});
  });

  it("tira todo lo que no es un primitivo", () => {
    const m = limpiarMapa({
      ficha: { x: 1 },
      lista: [1, 2],
      contador: 3,
      activo: true,
      texto: "ok",
    });
    expect(m).toEqual({ contador: 3, activo: true, texto: "ok" });
  });

  it("recorta los textos largos", () => {
    const m = limpiarMapa({ lastError: "a".repeat(500) });
    expect((m.lastError as string).length).toBe(MAX_TEXTO + 1);
    expect(m.lastError as string).toMatch(/…$/);
  });

  it("recorta las claves que son una ruta", () => {
    const m = limpiarMapa({
      url: "/clinica/clients/7f3b1c2d-0000-4000-8000-000000000001/historia?x=1",
      endpoint: "/agenda/appointments/42/checkout",
      holdedUrl: "https://api.holded.com/api/invoicing/v1/documents/abc?key=k",
    });
    expect(m.url).toBe("/clinica/clients/:id/historia");
    expect(m.endpoint).toBe("/agenda/appointments/:id/checkout");
    expect(m.holdedUrl).toBe(
      "https://api.holded.com/api/invoicing/v1/documents/abc",
    );
  });
});

describe("clinica-11 · recortarUrl", () => {
  it("sustituye uuids, números y tokens opacos", () => {
    expect(recortarUrl("/clinica/clients/7f3b1c2d-0000-4000-8000-000000000001")).toBe(
      "/clinica/clients/:id",
    );
    expect(recortarUrl("/agenda/appointments/42")).toBe(
      "/agenda/appointments/:id",
    );
    expect(recortarUrl("/clinica/informe/Ab3dEf9hIj2kLm5n")).toBe(
      "/clinica/informe/:id",
    );
  });

  it("deja en paz las rutas sin ids", () => {
    expect(recortarUrl("/shift/current")).toBe("/shift/current");
    expect(recortarUrl("https://admin.mipiace.es/admin/staff")).toBe(
      "https://admin.mipiace.es/admin/staff",
    );
  });

  it("tira la query y el hash", () => {
    expect(recortarUrl("/clients?nombre=Rosario#x")).toBe("/clients");
  });

  it("la cadena vacía se queda vacía", () => {
    expect(recortarUrl("")).toBe("");
  });
});

describe("clinica-11 · esRutaClinica", () => {
  it("reconoce las rutas de la clínica, la residencia y el personal", () => {
    expect(esRutaClinica("/clinica/clients/1/historia")).toBe(true);
    expect(esRutaClinica("/admin/residencia/residentes/1/plan")).toBe(true);
    expect(esRutaClinica("/admin/fichaje/personal/1")).toBe(true);
    expect(esRutaClinica("https://x/clients/1")).toBe(true);
  });

  it("no se inventa rutas clínicas donde no hay", () => {
    expect(esRutaClinica("/admin/catalog")).toBe(false);
    expect(esRutaClinica("/shift/open")).toBe(false);
    expect(esRutaClinica("/")).toBe(false);
  });
});

describe("clinica-11 · limpiarMiga", () => {
  it("tira los de interfaz y los de consola", () => {
    expect(limpiarMiga({ category: "ui.click", message: "x" })).toBeNull();
    expect(limpiarMiga({ category: "ui.input", message: "x" })).toBeNull();
    expect(limpiarMiga({ category: "ui.swipe", message: "x" })).toBeNull();
    expect(limpiarMiga({ category: "console", message: "x" })).toBeNull();
  });

  it("tira la navegación a una ruta clínica y recorta el resto", () => {
    expect(
      limpiarMiga({
        category: "navigation",
        data: { from: "/", to: "/admin/residencia/residentes/42/plan" },
      }),
    ).toBeNull();
    const m = limpiarMiga({
      category: "navigation",
      data: { from: "/", to: "/admin/catalog?x=1" },
    });
    expect(m?.data).toEqual({ from: "/", to: "/admin/catalog" });
  });

  it("de un fetch deja la ruta recortada y el estado", () => {
    const m = limpiarMiga({
      category: "fetch",
      data: { url: "/clinica/clients/42/historia?q=Rosario", status_code: 500 },
    });
    expect(m?.data).toEqual({
      url: "/clinica/clients/:id/historia",
      status_code: 500,
    });
  });
});

describe("clinica-11 · limpiarUsuario", () => {
  it("sin usuario, nada", () => {
    expect(limpiarUsuario(null)).toBeUndefined();
    expect(limpiarUsuario(undefined)).toBeUndefined();
    expect(limpiarUsuario({ email: "r@x.es" })).toBeUndefined();
  });
});
