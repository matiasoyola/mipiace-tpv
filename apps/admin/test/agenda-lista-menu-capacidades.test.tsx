// agenda-lista (hallazgo 🟡 3, segunda mitad) · el menú gana sus
// secciones sin recargar.
//
// Lo que arregla: la dueña entra en Ajustes, enciende «Agenda de citas»,
// guarda… y la barra lateral sigue exactamente igual. El shell leía las
// capacidades UNA VEZ al montar, así que hasta un F5 no aparecían
// «Personal», «Agenda · Catálogo» ni «Agenda · Horario». No había nada
// roto, pero quien pulsa un interruptor y no ve cambiar nada concluye que
// no ha funcionado — y quien lo va a pulsar delante de Sole es Matías.
//
// Esto se prueba sin navegador porque el arreglo es una caché con
// suscriptores (`src/capabilities.ts`), no una pantalla. El capítulo 1
// del banco lo comprueba por la interfaz real.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Lo que contestaría el servidor ahora mismo. Los tests lo cambian a
// mitad de vida, que es justo lo que hace guardar en Ajustes.
let agendaEnabled = false;
let llamadas = 0;
let fallar = false;

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
    if (path === "/admin/tenant/settings") {
      llamadas += 1;
      if (fallar) throw new FakeApiError(500, "boom", "BOOM");
      return { settings: { cajaEnabled: true, agendaEnabled } };
    }
    if (path === "/auth/me") {
      if (fallar) throw new FakeApiError(500, "boom", "BOOM");
      return {
        user: { id: "u1", email: "o@x.es", role: "OWNER" },
        tenant: { id: "t1", name: "X", hasHoldedKey: true },
      };
    }
    return {};
  }),
  clearTokens: vi.fn(),
  readCurrentRole: () => "OWNER",
  readImpersonationState: () => null,
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const real = await orig<typeof import("react-router-dom")>();
  return { ...real, useNavigate: () => navigate };
});

const { AdminShell } = await import("../src/AdminShell.js");
const { refrescarCapacidades, __resetCapacidadesParaTests } = await import(
  "../src/capabilities.js"
);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  agendaEnabled = false;
  llamadas = 0;
  fallar = false;
  __resetCapacidadesParaTests();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function enlace(href: string): HTMLAnchorElement | null {
  return container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
}

async function pintar(): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <AdminShell title="Ajustes">
          <div />
        </AdminShell>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const SECCIONES_AGENDA = [
  "/admin/staff",
  "/admin/agenda-catalog",
  "/admin/agenda-hours",
];

describe("agenda-lista · encender la agenda cambia el menú sin recargar", () => {
  it("las tres secciones aparecen tras refrescar las capacidades", async () => {
    await pintar();
    for (const href of SECCIONES_AGENDA) expect(enlace(href)).toBeNull();

    // Lo que hace `onSave` de Ajustes: el servidor ya dice que sí, y la
    // pantalla avisa. Sin desmontar nada, sin `reload`.
    agendaEnabled = true;
    await act(async () => {
      await refrescarCapacidades();
    });

    for (const href of SECCIONES_AGENDA) expect(enlace(href)).not.toBeNull();
  });

  it("y desaparecen al apagarla, por el mismo camino", async () => {
    agendaEnabled = true;
    await pintar();
    for (const href of SECCIONES_AGENDA) expect(enlace(href)).not.toBeNull();

    agendaEnabled = false;
    await act(async () => {
      await refrescarCapacidades();
    });

    for (const href of SECCIONES_AGENDA) expect(enlace(href)).toBeNull();
  });

  it("sin refrescar no cambia nada: el fallo que esto viene a arreglar", async () => {
    // El control. Si este test se pusiera verde con las tres secciones
    // visibles, es que algo las pinta por su cuenta y el arreglo de
    // arriba no prueba lo que dice probar.
    await pintar();
    agendaEnabled = true;
    await act(async () => {
      await Promise.resolve();
    });
    for (const href of SECCIONES_AGENDA) expect(enlace(href)).toBeNull();
  });
});

describe("agenda-lista · la caché de capacidades", () => {
  it("los consumidores de una misma pantalla comparten una sola petición", async () => {
    // El shell (banner de Holded) y su `NavList` preguntaban cada uno por
    // su cuenta: dos pares de peticiones por pantalla. Ahora es uno.
    await pintar();
    expect(llamadas).toBe(1);
  });

  it("si el servidor no contesta, se sigue con los defaults de master", async () => {
    // Caja ENCENDIDA y agenda apagada: esconderle la caja a quien cobra
    // por un error de red sería el peor fallo posible. Mismo criterio que
    // `lib/caja-gate.ts`.
    fallar = true;
    await pintar();
    expect(enlace("/admin/cashiers")).not.toBeNull();
    for (const href of SECCIONES_AGENDA) expect(enlace(href)).toBeNull();
  });

  it("al quedarse sin nadie suscrito se tira, para no heredar el tenant anterior", async () => {
    await pintar();
    expect(llamadas).toBe(1);
    act(() => root.unmount());
    // Un login con otra empresa no puede ver el menú de la primera.
    root = createRoot(container);
    await pintar();
    expect(llamadas).toBe(2);
  });
});
