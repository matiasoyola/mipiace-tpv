// clinica-11 · EL PANEL TAMPOCO MANDA LA RESIDENCIA A SENTRY.
//
// En el panel las rutas clínicas SÍ están en la barra de direcciones
// (`/admin/residencia/residentes/:clientId/plan`), así que aquí el
// breadcrumb de navegación es tan peligroso como el del clic.
//
// Mismo criterio que el TPV: se arranca Sentry por el `initSentry` de
// verdad con un transporte falso y se mira el envelope ENTERO.
//
// Sabotajes: quitar `beforeSend` → rojo; quitar `beforeBreadcrumb` → rojo
// en el último test (desde el envelope no se ve, porque `limpiarEvento`
// también sanea `breadcrumbs`: son dos capas a propósito).

import { describe, expect, it, vi } from "vitest";

const CENTINELA = "RESIDENTE-CENTINELA";
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

describe("clinica-11 · Sentry en el panel", () => {
  it("navegar al plan de un residente y petar: el centinela no sale", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://0123456789abcdef@o0.ingest.sentry.io/1");
    const Sentry = await import("@sentry/react");
    const { initSentry, captureError } = await import("../src/lib/sentry.js");
    expect(initSentry({ transport: transporteFalso })).toBe(true);

    Sentry.addBreadcrumb({
      category: "navigation",
      data: {
        from: "/admin/residencia/residentes",
        to: `/admin/residencia/residentes/${CLIENT_ID}/plan`,
      },
    });
    Sentry.addBreadcrumb({
      category: "ui.click",
      message: `button[aria-label="Abrir el plan de ${CENTINELA}"]`,
    });
    captureError(new Error("fallo al pintar el plan de cuidados"), {
      componentStack: "at PlanResidentePage",
      residente: { nombre: CENTINELA },
    });
    await Sentry.flush(2000);

    expect(enviados.length).toBeGreaterThan(0);
    const texto = JSON.stringify(enviados);
    expect(texto).not.toContain(CENTINELA);
    expect(texto).not.toContain(CLIENT_ID);
    expect(texto).toContain("fallo al pintar el plan de cuidados");

    vi.unstubAllEnvs();
  });

  it("beforeBreadcrumb tira la navegación a una ruta de residencia", async () => {
    const { opcionesDeSentry } = await import("../src/lib/sentry.js");
    const o = opcionesDeSentry({ dsn: "https://x@o0.ingest.sentry.io/1" });
    expect(o.beforeBreadcrumb).toBeTypeOf("function");
    expect(
      o.beforeBreadcrumb!(
        {
          category: "navigation",
          data: { from: "/", to: `/admin/residencia/residentes/${CLIENT_ID}/plan` },
        },
        {},
      ),
    ).toBeNull();
    expect(
      o.beforeBreadcrumb!({ category: "ui.click", message: CENTINELA }, {}),
    ).toBeNull();
    // El panel sin residencia no pierde nada: su navegación sigue viva.
    const miga = o.beforeBreadcrumb!(
      { category: "navigation", data: { from: "/", to: "/admin/catalog" } },
      {},
    );
    expect(miga?.data).toEqual({ from: "/", to: "/admin/catalog" });
  });

  it("sin Replay y sin recoger cuerpos", async () => {
    const { opcionesDeSentry } = await import("../src/lib/sentry.js");
    const o = opcionesDeSentry({ dsn: "https://x@o0.ingest.sentry.io/1" });
    expect(o.dataCollection?.httpBodies).toEqual([]);
    expect(o.dataCollection?.cookies).toBe(false);
    expect(o.sendDefaultPii).toBe(false);
    const integraciones = (
      o.integrations as (porDefecto: { name: string }[]) => { name: string }[]
    )([{ name: "Replay" }, { name: "Breadcrumbs" }]);
    expect(integraciones.map((i) => i.name)).toEqual(["Breadcrumbs"]);
  });
});
