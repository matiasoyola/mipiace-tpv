// catalogo-local (addendum 3) · EL MURO de /onboarding.
//
// El hallazgo que amplió el alcance del bloque, en una línea de
// `App.tsx`:
//
//     if (!me.tenant.hasHoldedKey) navigate("/onboarding", { replace: true });
//
// Un tenant CON caja y SIN Holded entraba al admin y caía en la pantalla
// de "Conectar Holded", y de ahí no salía. H1 abrió la puerta sólo para
// `cajaEnabled === false` —el colegio—; el que tiene caja seguía contra
// el muro.
//
// Traducido: el bloque le daba un catálogo local AL QUE NO PODÍA LLEGAR,
// y el criterio 1 del prompt ("un tenant sin Holded y con caja da de alta
// tres productos, los ve en el TPV y cobra un ticket con ellos") era
// literalmente imposible de cumplir.
//
// Lo que este banco fija:
//
//   1. Con `holdedEnabled === false` se entra al panel y NO se pasa por
//      /onboarding. Nunca.
//   2. El ORDEN de las tres comprobaciones: caja, luego interruptor,
//      luego clave. Si el interruptor se mirara después de la clave, el
//      muro seguiría en pie.
//   3. El que SÍ usa Holded y aún no lo ha conectado sigue yendo a
//      /onboarding, que es lo correcto: está a mitad de su alta.
//   4. `undefined` (backend anterior al bloque) se comporta como master.
//
// Sabotajes que este fichero pone en rojo:
//   · mover la comprobación de `holdedEnabled` detrás de la de la clave
//   · escribirla como `!me.tenant.holdedEnabled` en vez de `=== false`
//   · quitarla

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type MeTenant = {
  hasHoldedKey: boolean;
  initialSyncStatus: string;
  cajaEnabled?: boolean;
  crmEnabled?: boolean;
  agendaEnabled?: boolean;
  holdedEnabled?: boolean;
};
let meRole = "OWNER";
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
  api: vi.fn(async (path: string) => {
    if (path === "/auth/me") {
      return {
        user: { id: "u1", email: "o@x.es", role: meRole },
        tenant: {
          id: "t1",
          name: "X",
          fiscalProfile: null,
          lastIncrementalSyncAt: null,
          ...meTenant,
        },
      };
    }
    if (path === "/admin/tenant/settings") {
      return { settings: { cajaEnabled: true, agendaEnabled: false } };
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  navigate.mockClear();
  meRole = "OWNER";
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
  await act(async () => {
    await Promise.resolve();
  });
}

function destinos(): unknown[] {
  return navigate.mock.calls.map((c) => c[0]);
}

describe("catalogo-local · el comercio que NO usa Holded entra a su panel", () => {
  const SIN_HOLDED: MeTenant = {
    hasHoldedKey: false,
    initialSyncStatus: "NOT_APPLICABLE",
    cajaEnabled: true,
    holdedEnabled: false,
  };

  it("no ve /onboarding jamás, aunque tenga caja y no tenga clave", async () => {
    meTenant = SIN_HOLDED;
    await render(<RootRouter />);
    expect(destinos()).not.toContain("/onboarding");
    expect(destinos()).not.toContain("/onboarding/sync");
  });

  it("aterriza en su panel, no en una pantalla de carga eterna", async () => {
    meTenant = SIN_HOLDED;
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/admin/account", { replace: true });
  });

  it("el estado del sync no le cambia el destino: no hay sync que esperar", async () => {
    // NOT_APPLICABLE es lo normal, pero un tenant que estrenó Holded y lo
    // apagó después podría llevar cualquier otro valor colgando. Ninguno
    // debe devolverlo a /onboarding/sync.
    for (const estado of ["PENDING", "RUNNING", "DONE", "FAILED"]) {
      navigate.mockClear();
      meTenant = { ...SIN_HOLDED, initialSyncStatus: estado };
      await render(<RootRouter />);
      expect(destinos(), estado).not.toContain("/onboarding/sync");
      expect(destinos(), estado).not.toContain("/onboarding");
    }
  });
});

describe("catalogo-local · el orden de las tres comprobaciones", () => {
  it("sin caja manda la caja, aunque el interruptor esté encendido", async () => {
    // H1 primero: una empresa sin caja entra por donde le corresponda por
    // sus módulos, y el interruptor de Holded no pinta nada ahí.
    meTenant = {
      hasHoldedKey: false,
      initialSyncStatus: "NOT_APPLICABLE",
      cajaEnabled: false,
      agendaEnabled: true,
      holdedEnabled: true,
    };
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/admin/agenda-catalog", { replace: true });
  });

  it("el interruptor manda sobre la clave, y no al revés", async () => {
    // Éste es el orden que arregla el muro. Si `hasHoldedKey` se mirara
    // antes, este tenant volvería a /onboarding y el bloque entero
    // seguiría siendo inalcanzable.
    meTenant = {
      hasHoldedKey: false,
      initialSyncStatus: "NOT_APPLICABLE",
      cajaEnabled: true,
      holdedEnabled: false,
    };
    await render(<RootRouter />);
    expect(destinos()).not.toContain("/onboarding");
  });
});

describe("catalogo-local · lo que NO cambia (criterio 4)", () => {
  it("el que usa Holded y no lo ha conectado sigue yendo a /onboarding", async () => {
    // Está a mitad de su alta. El muro es correcto para él, y es la
    // mitad del significado que el addendum conserva.
    meTenant = {
      hasHoldedKey: false,
      initialSyncStatus: "PENDING",
      cajaEnabled: true,
      holdedEnabled: true,
    };
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/onboarding", { replace: true });
  });

  it("con Holded conectado y sync a medias, a /onboarding/sync como siempre", async () => {
    meTenant = {
      hasHoldedKey: true,
      initialSyncStatus: "RUNNING",
      cajaEnabled: true,
      holdedEnabled: true,
    };
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/onboarding/sync", { replace: true });
  });

  it("con Holded conectado y sync hecho, a /admin/account como siempre", async () => {
    meTenant = {
      hasHoldedKey: true,
      initialSyncStatus: "DONE",
      cajaEnabled: true,
      holdedEnabled: true,
    };
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/admin/account", { replace: true });
  });

  it("sin el campo (backend anterior al bloque) se comporta como master", async () => {
    // `=== false` y no `!`. Si esto leyera `!holdedEnabled`, un front
    // desplegado por delante del backend dejaría de enseñar /onboarding a
    // TODOS los tenants que aún no han conectado Holded.
    meTenant = { hasHoldedKey: false, initialSyncStatus: "PENDING", cajaEnabled: true };
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/onboarding", { replace: true });
  });
});
