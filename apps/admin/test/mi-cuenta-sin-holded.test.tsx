// bloque ticket-con-iva §C · "Mi cuenta" no le ofrece Holded a quien no
// tiene Holded.
//
// El Bar La Maestranza factura él mismo con VERI*FACTU: `holdedEnabled`
// es false y no va a pegar ninguna API Key nunca. Su pantalla de cuenta
// le enseñaba un panel "Conexión con Holded · No conectada" con un check
// VERDE al lado y dos botones ("Probar conexión", "Cambiar API Key") que
// no hacen nada que le sirva.
//
// La condición es `holdedEnabled !== false`, no `hasHoldedKey`, y la
// diferencia importa: un comercio que SÍ va a usar Holded y todavía no ha
// pegado la clave tiene algo que conectar y tiene que seguir viendo el
// panel. Es la misma distinción que catalogo-local (addendum 3) ya hizo
// para el muro de /onboarding.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type MeTenant = {
  hasHoldedKey: boolean;
  cajaEnabled?: boolean;
  holdedEnabled?: boolean;
};
let meTenant: MeTenant;

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
  clearTokens: vi.fn(),
  readTokens: () => ({ access: "a", refresh: "r" }),
  storeTokens: vi.fn(),
  readEffectiveAuth: () => ({ canEdit: true, readonlyReason: null }),
  api: vi.fn(async (path: string) => {
    if (path === "/auth/me") {
      return {
        user: { id: "u1", email: "mo@maestranza.es", role: "OWNER" },
        tenant: {
          id: "t1",
          name: "BAR LA MAESTRANZA SL",
          fiscalProfile: { legalName: "BAR LA MAESTRANZA SL", taxId: "B45902186" },
          initialSyncStatus: "NOT_APPLICABLE",
          lastIncrementalSyncAt: null,
          ...meTenant,
        },
      };
    }
    throw new FakeApiError(404, "no", "NOT_FOUND");
  }),
}));

// El shell arrastra media app (nav, polling, iconos); aquí sólo se mira
// qué secciones pinta la pantalla.
vi.mock("../src/AdminShell.js", () => ({
  AdminShell: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-shell={title}>{children}</div>
  ),
}));

const { AccountPage } = await import("../src/App.js");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(): Promise<string> {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
  });
  // Una vuelta más para que resuelva el `await` del efecto de /auth/me.
  await act(async () => {
    await Promise.resolve();
  });
  return container.textContent ?? "";
}

describe("§C · Mi cuenta y el panel de Holded", () => {
  it("SABOTAJE · sin Holded previsto, el panel no se pinta", async () => {
    meTenant = { hasHoldedKey: false, cajaEnabled: true, holdedEnabled: false };
    const texto = await render();
    expect(texto).not.toContain("Conexión con Holded");
    expect(texto).not.toContain("No conectada");
    expect(texto).not.toContain("Probar conexión");
    expect(texto).not.toContain("Cambiar API Key");
    // Y la pantalla sigue siendo su pantalla: el perfil fiscal se queda.
    expect(texto.length).toBeGreaterThan(0);
  });

  it("con Holded previsto y sin clave todavía, SÍ se pinta: hay algo que conectar", async () => {
    meTenant = { hasHoldedKey: false, cajaEnabled: true, holdedEnabled: true };
    const texto = await render();
    expect(texto).toContain("Conexión con Holded");
    expect(texto).toContain("No conectada");
  });

  it("con Holded conectado se pinta como siempre", async () => {
    meTenant = { hasHoldedKey: true, cajaEnabled: true, holdedEnabled: true };
    const texto = await render();
    expect(texto).toContain("Conexión con Holded");
    expect(texto).toContain("Conectada correctamente");
  });

  it("si el backend no manda `holdedEnabled`, se comporta como master", async () => {
    // Mismo criterio `!== false` que los módulos de H1: un front por
    // delante del backend no puede esconderle el panel a quien lo usa.
    meTenant = { hasHoldedKey: true, cajaEnabled: true };
    const texto = await render();
    expect(texto).toContain("Conexión con Holded");
  });

  it("sin caja no se pinta, como ya hacía H1", async () => {
    meTenant = { hasHoldedKey: true, cajaEnabled: false, holdedEnabled: true };
    const texto = await render();
    expect(texto).not.toContain("Conexión con Holded");
  });
});
