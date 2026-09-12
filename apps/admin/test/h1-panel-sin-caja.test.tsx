// H1 · el panel del cliente sin caja (ADR-016).
//
// Lo que este banco fija:
//
//   1. Una empresa SIN caja no pasa por /onboarding. Nunca. Era el muro
//      que dejaba al colegio fuera de su propio panel.
//   2. Una empresa CON caja se comporta exactamente como en master: sin
//      clave de Holded → /onboarding; con clave y sync a medias →
//      /onboarding/sync; con sync hecho → /admin/account.
//   3. El MANAGER sigue yendo a su bandeja, como antes del bloque.
//   4. <CajaGate> esconde una pantalla de caja y dice por qué, en vez de
//      dejar que reviente contra el 403.
//
// Sabotajes que este fichero pone en rojo (§3 del done):
//   · dejar la redirección a /onboarding para la empresa sin caja (nº 3)
//   · quitar el <CajaGate> de una pantalla escondida (nº 4, mitad UI)

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ── El cliente HTTP del admin, falseado por ruta ──────────────────────
type MeTenant = {
  hasHoldedKey: boolean;
  initialSyncStatus: string;
  cajaEnabled?: boolean;
  crmEnabled?: boolean;
  agendaEnabled?: boolean;
};
let meRole = "OWNER";
let meTenant: MeTenant;
let settingsCaja: boolean | undefined;

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
        tenant: { id: "t1", name: "X", fiscalProfile: null, lastIncrementalSyncAt: null, ...meTenant },
      };
    }
    if (path === "/admin/tenant/settings") {
      return { settings: { cajaEnabled: settingsCaja, agendaEnabled: false } };
    }
    return {};
  }),
  readTokens: () => ({ access: "a", refresh: "r" }),
  clearTokens: vi.fn(),
  storeTokens: vi.fn(),
  readEffectiveAuth: () => ({ canEdit: true, readonlyReason: null }),
  readCurrentRole: () => meRole,
  readImpersonationState: () => null,
  readonlyReasonLabel: () => null,
}));

// El shell arrastra media app (nav, polling, iconos). Para lo que aquí se
// prueba basta con que pinte a sus hijos.
vi.mock("../src/AdminShell.js", () => ({
  AdminShell: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-shell={title}>{children}</div>
  ),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const real = await orig<typeof import("react-router-dom")>();
  return { ...real, useNavigate: () => navigate };
});

const { RootRouter } = await import("../src/App.js");
const { CajaGate } = await import("../src/CajaGate.js");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  navigate.mockClear();
  meRole = "OWNER";
  settingsCaja = undefined;
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
  // Una vuelta más para que resuelvan los `await` del efecto.
  await act(async () => {
    await Promise.resolve();
  });
}

describe("H1 · a dónde entra el propietario", () => {
  it("SIN caja no pasa por /onboarding, aunque no tenga Holded", async () => {
    meTenant = {
      hasHoldedKey: false,
      initialSyncStatus: "NOT_APPLICABLE",
      cajaEnabled: false,
      crmEnabled: true,
    };
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/admin/account", { replace: true });
    const destinos = navigate.mock.calls.map((c) => c[0]);
    expect(destinos).not.toContain("/onboarding");
    expect(destinos).not.toContain("/onboarding/sync");
  });

  it("SIN caja y CON agenda entra al catálogo de agenda", async () => {
    meTenant = {
      hasHoldedKey: false,
      initialSyncStatus: "NOT_APPLICABLE",
      cajaEnabled: false,
      agendaEnabled: true,
    };
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/admin/agenda-catalog", { replace: true });
  });

  it("CON caja y sin Holded sigue yendo a /onboarding (master)", async () => {
    meTenant = { hasHoldedKey: false, initialSyncStatus: "PENDING", cajaEnabled: true };
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/onboarding", { replace: true });
  });

  it("CON caja, con Holded y sync a medias va a /onboarding/sync (master)", async () => {
    meTenant = { hasHoldedKey: true, initialSyncStatus: "RUNNING", cajaEnabled: true };
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/onboarding/sync", { replace: true });
  });

  it("CON caja y sync hecho va a /admin/account (master)", async () => {
    meTenant = { hasHoldedKey: true, initialSyncStatus: "DONE", cajaEnabled: true };
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/admin/account", { replace: true });
  });

  it("un tenant de master (sin el campo cajaEnabled) se comporta igual que antes", async () => {
    meTenant = { hasHoldedKey: false, initialSyncStatus: "PENDING" };
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/onboarding", { replace: true });
  });

  it("el MANAGER sigue yendo a su bandeja", async () => {
    meRole = "MANAGER";
    meTenant = { hasHoldedKey: false, initialSyncStatus: "NOT_APPLICABLE", cajaEnabled: false };
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/admin/tickets-errors", { replace: true });
  });
});

describe("H1 · <CajaGate>", () => {
  it("sin caja esconde la pantalla y dice por qué", async () => {
    settingsCaja = false;
    await render(
      <CajaGate title="Cajeros">
        <div>contenido de cajeros</div>
      </CajaGate>,
    );
    expect(container.textContent).not.toContain("contenido de cajeros");
    expect(container.textContent).toContain("módulo de caja");
  });

  it("con caja deja pasar", async () => {
    settingsCaja = true;
    await render(
      <CajaGate title="Cajeros">
        <div>contenido de cajeros</div>
      </CajaGate>,
    );
    expect(container.textContent).toContain("contenido de cajeros");
  });

  it("si el backend no manda el campo (master), deja pasar", async () => {
    settingsCaja = undefined;
    await render(
      <CajaGate title="Cajeros">
        <div>contenido de cajeros</div>
      </CajaGate>,
    );
    expect(container.textContent).toContain("contenido de cajeros");
  });
});
