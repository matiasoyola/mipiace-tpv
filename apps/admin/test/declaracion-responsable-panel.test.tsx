// declaracion-responsable · el camino hasta el documento, dentro del panel.
//
// El art. 15 de la Orden HAC/1177/2024 pide que la declaración sea accesible
// «de forma rápida, fácil e intuitiva» DENTRO del sistema. Eso no lo prueba
// un test de la API: lo prueba que el enlace esté en la barra lateral de
// cualquier comercio, y que la pantalla pinte los apartados que llegan.
//
// Lo que este banco fija:
//
//   1. El enlace está en el pie de la barra lateral de un comercio CON
//      Holded y de uno SIN Holded, y para OWNER y para MANAGER. El producto
//      es el mismo.
//   2. El enlace está también en Ajustes.
//   3. La pantalla pinta los doce apartados con su clave, y el botón de PDF
//      apunta al endpoint público.
//   4. Si la API no contesta, el botón del PDF SIGUE ahí: es la vía de
//      entrega que la Orden exige y no puede depender de que cargue el JSON.
//
// Sabotajes que este fichero pone en rojo (tabla del done):
//   · meter el enlace en NAV_ITEMS con una capability (desaparece del panel
//     de un comercio sin caja o sin Holded)
//   · gatearlo por rol y dejar al MANAGER sin él
//   · quitarlo del drawer móvil y dejarlo sólo en el escritorio
//   · quitar la sección de Ajustes
//   · pintar la pantalla sin el botón de PDF cuando el JSON falla

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ── El cliente HTTP del admin, falseado por ruta ──────────────────────
let meRole = "OWNER";
let holdedKey = true;
let cajaEnabled: boolean | undefined = true;
let declaracionFalla = false;

const DECLARACION = {
  titulo: "DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN",
  apartados: [
    { clave: "1.a)", rotulo: "Nombre del sistema", valor: ["mipiacetpv"] },
    { clave: "1.b)", rotulo: "Código identificador", valor: ["MP"] },
    { clave: "1.c)", rotulo: "Versión", valor: ["2310f6e (servidor)"] },
    { clave: "1.d)", rotulo: "Componentes", valor: ["Se trata de software."] },
    { clave: "1.e)", rotulo: "Solo VERI*FACTU", valor: ["S - Sí"] },
    { clave: "1.f)", rotulo: "Varios obligados", valor: ["S - Sí"] },
    { clave: "1.g)", rotulo: "Tipos de firma", valor: ["No aplica."] },
    { clave: "1.h)", rotulo: "Razón social", valor: ["MI PIACE INTERNET SOLUTIONS SL"] },
    { clave: "1.i)", rotulo: "NIF", valor: ["B45902186"] },
    { clave: "1.j)", rotulo: "Dirección", valor: ["45634 Buenaventura (Toledo)"] },
    { clave: "1.k)", rotulo: "Cumplimiento", valor: ["El productor declara…"] },
    { clave: "1.l)", rotulo: "Fecha y lugar", valor: ["Fecha: 27 de septiembre de 2026"] },
  ],
  anexo: [
    { clave: "2.a)", rotulo: "Contacto", valor: ["soporte@mipiacetpv.com"] },
    { clave: "2.b)", rotulo: "Internet", valor: ["Sitio web: https://mipiacetpv.com"] },
  ],
};

class FakeApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

vi.mock("../src/api.js", () => ({
  ApiError: FakeApiError,
  api: vi.fn(async (path: string) => {
    if (path === "/auth/me") {
      return {
        user: { id: "u1", email: "o@x.es", role: meRole },
        tenant: {
          id: "t1",
          name: "X",
          hasHoldedKey: holdedKey,
          holdedEnabled: holdedKey,
          holdedDisconnectedAt: null,
          initialSyncStatus: "DONE",
          fiscalProfile: null,
          lastIncrementalSyncAt: null,
        },
      };
    }
    if (path === "/admin/tenant/settings") {
      return {
        settings: {
          cashierAutoLogoutMinutes: 15,
          cashierSessionTtlMinutes: 480,
          requireManagerPinForForceClose: false,
          requireOwnerPinForCashClose: false,
          dayCutHour: 5,
          requireCashCountOnClose: false,
          deviceNewLoginAlertEnabled: false,
          discountThresholdPct: 20,
          cashierSearchableContacts: false,
          creditSalesEnabled: false,
          crmEnabled: false,
          agendaEnabled: false,
          cajaEnabled,
        },
      };
    }
    if (path === "/legal/declaracion-responsable") {
      if (declaracionFalla) throw new FakeApiError(500, "boom", "BOOM");
      return { declaracion: DECLARACION };
    }
    if (path === "/catalog/sync-status") return { health: { level: "ok" } };
    return {};
  }),
  readTokens: () => ({ accessToken: "a", refreshToken: "r" }),
  clearTokens: vi.fn(),
  storeTokens: vi.fn(),
  readEffectiveAuth: () => ({ canEdit: true, readonlyReason: null }),
  readCurrentRole: () => meRole,
  readImpersonationState: () => null,
  readonlyReasonLabel: () => null,
}));

const { AdminShell } = await import("../src/AdminShell.js");
const { DeclaracionResponsablePage, URL_PDF } = await import(
  "../src/pages/DeclaracionResponsablePage.js"
);
const { SettingsPage } = await import("../src/pages/SettingsPage.js");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  meRole = "OWNER";
  holdedKey = true;
  cajaEnabled = true;
  declaracionFalla = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(node: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(<MemoryRouter>{node}</MemoryRouter>);
  });
  // Dos vueltas: las capabilities del shell son un Promise.all.
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Los <a href="/admin/declaracion-responsable"> del árbol pintado. */
function enlacesALaDeclaracion(): HTMLAnchorElement[] {
  return [
    ...container.querySelectorAll<HTMLAnchorElement>(
      'a[href="/admin/declaracion-responsable"]',
    ),
  ];
}

/**
 * Los enlaces que NO cuelgan de una barra lateral.
 *
 * El segundo sabotaje de la tabla que salió VERDE: `SettingsPage` se pinta
 * DENTRO de `AdminShell`, que ya trae el enlace del pie. Contar enlaces en
 * esa pantalla no dice nada de la sección de Ajustes — el del pie la tapaba.
 */
function enlacesFueraDeLaBarra(): HTMLAnchorElement[] {
  return enlacesALaDeclaracion().filter((a) => a.closest("aside") === null);
}

describe("el enlace en la barra lateral", () => {
  // La matriz que importa: el bloque pide que se vea «de CUALQUIER comercio,
  // use Holded o no», para OWNER y MANAGER.
  const casos = [
    { rol: "OWNER", holded: true, caja: true },
    { rol: "OWNER", holded: false, caja: true },
    { rol: "MANAGER", holded: true, caja: true },
    { rol: "MANAGER", holded: false, caja: true },
    // Y el comercio sin caja (el colegio de Talavera, ADR-016): su barra
    // lateral es tres entradas de control horario, y la declaración también.
    { rol: "OWNER", holded: false, caja: false },
  ] as const;

  for (const caso of casos) {
    it(`se ve para ${caso.rol}, holded=${caso.holded}, caja=${caso.caja}`, async () => {
      meRole = caso.rol;
      holdedKey = caso.holded;
      cajaEnabled = caso.caja;
      await render(
        <AdminShell title="Lo que sea">
          <p>contenido</p>
        </AdminShell>,
      );
      const enlaces = enlacesALaDeclaracion();
      expect(enlaces.length).toBeGreaterThan(0);
      expect(enlaces[0].textContent).toContain("Declaración responsable");
    });
  }

  it("las barras se pueden desplazar, o el pie no se alcanza", async () => {
    // Lo encontró el bucle visual a 320 px, no un test: con la barra entera
    // el drawer mide 848 px de contenido en una caja de 720 y el `overflow`
    // era `visible`. El pie —el enlace a la declaración, «Cerrar sesión en
    // todos los dispositivos» y la versión— quedaba fuera de la pantalla y
    // SIN scroll. No es que costara llegar: no se llegaba.
    //
    // jsdom no aplica Tailwind, así que se comprueba la clase, que es el
    // mecanismo. La reachability de verdad la mide el bucle visual
    // (docs/blocks/declaracion-responsable-shots/panel-320-menu.png).
    await render(
      <AdminShell title="Lo que sea">
        <p>contenido</p>
      </AdminShell>,
    );
    const menu = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Abrir menú"]',
    );
    await act(async () => {
      menu!.click();
    });
    for (const aside of container.querySelectorAll("aside")) {
      expect(
        aside.className,
        "una barra lateral sin scroll esconde su pie en una pantalla baja",
      ).toContain("overflow-y-auto");
    }
  });

  it("está también en el drawer móvil, no sólo en el escritorio", async () => {
    await render(
      <AdminShell title="Lo que sea">
        <p>contenido</p>
      </AdminShell>,
    );
    // El escritorio pinta uno. Abrimos el drawer con el botón de menú y
    // tiene que aparecer el segundo: en una tablet a 320 px el <aside> del
    // escritorio está oculto por CSS (`hidden md:flex`) y el único camino es
    // el drawer.
    expect(enlacesALaDeclaracion()).toHaveLength(1);
    const menu = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Abrir menú"]',
    );
    expect(menu, "no se encuentra el botón del menú móvil").not.toBeNull();
    await act(async () => {
      menu!.click();
    });
    expect(enlacesALaDeclaracion()).toHaveLength(2);
  });
});

describe("el enlace en Ajustes", () => {
  it("está en el cuerpo de la pantalla, no sólo en la barra lateral", async () => {
    await render(<SettingsPage />);
    expect(
      enlacesFueraDeLaBarra().length,
      "el enlace de Ajustes no está (el del pie no cuenta)",
    ).toBeGreaterThan(0);
    expect(container.textContent).toContain(
      "Declaración responsable del sistema de facturación",
    );
  });

  it("está también en un comercio sin caja", async () => {
    // El bloque gateado por `cajaEnabled` de Ajustes esconde media pantalla.
    // La declaración no cuelga de la caja.
    cajaEnabled = false;
    await render(<SettingsPage />);
    expect(enlacesFueraDeLaBarra().length).toBeGreaterThan(0);
  });
});

describe("la pantalla de la declaración", () => {
  it("pinta los doce apartados y el anexo, con su clave", async () => {
    await render(<DeclaracionResponsablePage />);
    const texto = container.textContent ?? "";
    for (const clave of [
      "1.a)",
      "1.b)",
      "1.c)",
      "1.d)",
      "1.e)",
      "1.f)",
      "1.g)",
      "1.h)",
      "1.i)",
      "1.j)",
      "1.k)",
      "1.l)",
      "2.a)",
      "2.b)",
    ]) {
      expect(texto, `la pantalla no pinta ${clave}`).toContain(clave);
    }
    expect(texto).toContain(
      "DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN",
    );
    expect(texto).toContain("B45902186");
    expect(texto).toContain("MI PIACE INTERNET SOLUTIONS SL");
  });

  it("los apartados salen en el orden del art. 15", async () => {
    await render(<DeclaracionResponsablePage />);
    const texto = container.textContent ?? "";
    let cursor = -1;
    for (const clave of ["1.a)", "1.e)", "1.f)", "1.k)", "1.l)", "2.b)"]) {
      const pos = texto.indexOf(clave);
      expect(pos, `${clave} va desordenado`).toBeGreaterThan(cursor);
      cursor = pos;
    }
  });

  it("el botón de PDF apunta al endpoint público", async () => {
    await render(<DeclaracionResponsablePage />);
    const pdf = container.querySelector<HTMLAnchorElement>(
      `a[href="${URL_PDF}"]`,
    );
    expect(pdf, "no hay enlace al PDF").not.toBeNull();
    expect(URL_PDF).toBe("/api/legal/declaracion-responsable.pdf");
    expect(pdf!.textContent).toContain("Descargar PDF");
  });

  it("si el JSON falla, el PDF sigue siendo descargable", async () => {
    // La entrega en formato electrónico es una obligación del art. 15. No
    // puede caerse porque un fetch de más falle.
    declaracionFalla = true;
    await render(<DeclaracionResponsablePage />);
    expect(
      container.querySelector(`a[href="${URL_PDF}"]`),
      "el PDF desaparece cuando el JSON falla",
    ).not.toBeNull();
    expect(container.textContent).toContain("No se ha podido cargar");
  });
});
