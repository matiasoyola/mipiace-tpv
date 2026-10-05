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
// agenda-lista · dos afirmaciones más, y son la otra mitad de lo que H1
// dejó dicho en su commit pero no llegó a cumplir:
//
//   5. La empresa SIN caja SÍ ve "Ajustes" en su menú. El commit de H1
//      decía "Ajustes NO va envuelto a propósito: dentro vive «Módulos
//      del negocio» (CRM y agenda), que es justo lo que una empresa sin
//      caja viene a tocar" — y acto seguido le puso `capability: "caja"`
//      a la entrada del sidebar, que la tapaba entera. La pantalla estaba
//      bien; el camino hasta ella, no.
//   6. Y dentro sólo ve lo que no cuelga de la caja: "Módulos del
//      negocio" y la declaración responsable del art. 15.
//
// (El `superAdminOnly` que llevaba la misma entrada no era de H1 sino de
// B-OnboardingV2 `850063e`; se quita por su propia razón, escrita en
// `AdminShell.tsx` junto a la línea.)
//
// Sabotajes que este fichero pone en rojo (§3 del done):
//   · dejar la redirección a /onboarding para la empresa sin caja (nº 3)
//   · quitar el <CajaGate> de una pantalla escondida (nº 4, mitad UI)
//   · devolverle a "Ajustes" el `superAdminOnly` o el `capability: "caja"`
//     (agenda-lista nº 4)

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
      // agenda-lista · el payload entero, no sólo `cajaEnabled`: el último
      // describe pinta la pantalla de Ajustes de verdad y un slider sin
      // `value` deja de ser controlado a mitad de render.
      return {
        settings: {
          cashierAutoLogoutMinutes: 10,
          cashierSessionTtlMinutes: 720,
          requireManagerPinForForceClose: true,
          requireOwnerPinForCashClose: false,
          dayCutHour: 5,
          requireCashCountOnClose: false,
          deviceNewLoginAlertEnabled: true,
          discountThresholdPct: 10,
          cashierSearchableContacts: true,
          creditSalesEnabled: false,
          crmEnabled: true,
          agendaEnabled: false,
          cajaEnabled: settingsCaja,
        },
      };
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
const { SettingsPage } = await import("../src/pages/SettingsPage.js");
// agenda-lista · el shell de verdad, saltándose el mock de arriba: lo que
// se prueba aquí es precisamente su barra lateral.
const { AdminShell: RealAdminShell } = await vi.importActual<
  typeof import("../src/AdminShell.js")
>("../src/AdminShell.js");

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

// ── agenda-lista · el camino hasta "Ajustes" ──────────────────────────
//
// Por qué está aquí y no en un fichero nuevo: es literalmente la otra
// mitad de H1. Su commit dejó la pantalla bien (la sección "Módulos del
// negocio" fuera del gate de caja) y el menú mal (`capability: "caja"` en
// la entrada), así que la empresa sin caja no llegaba a lo único que
// venía a tocar. El banco de H1 no se enteró porque mockea el shell
// entero; estos tests lo pintan de verdad.

function sidebarLink(href: string): HTMLAnchorElement | null {
  // Por `href` y no por texto: "Ajustes" es también el `<h1>` de la
  // cabecera cuando la pantalla abierta es ésa.
  return container.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
}

describe("agenda-lista · el menú llega a Ajustes", () => {
  it("la empresa SIN caja ve Ajustes, y no ve lo que cuelga de la caja", async () => {
    settingsCaja = false;
    meTenant = { hasHoldedKey: false, initialSyncStatus: "NOT_APPLICABLE", cajaEnabled: false };
    await render(
      <RealAdminShell title="Mi cuenta">
        <div />
      </RealAdminShell>,
    );
    // Lo que H1 dijo que esta empresa venía a tocar.
    expect(sidebarLink("/admin/settings")).not.toBeNull();
    // Y lo que efectivamente no le toca, que sigue escondido.
    expect(sidebarLink("/admin/cashiers")).toBeNull();
    expect(sidebarLink("/admin/tag-sections")).toBeNull();
    expect(sidebarLink("/admin/gift-receipts")).toBeNull();
  });

  it("la dueña CON caja ve Ajustes sin impersonar a nadie", async () => {
    // El caso de Sole: OWNER, sin super-admin detrás, y el interruptor de
    // la agenda vive ahí dentro. `readImpersonationState` está mockeado a
    // `null` arriba, que es justo lo que `superAdminOnly` miraba.
    settingsCaja = true;
    meTenant = { hasHoldedKey: true, initialSyncStatus: "DONE", cajaEnabled: true };
    await render(
      <RealAdminShell title="Mi cuenta">
        <div />
      </RealAdminShell>,
    );
    expect(sidebarLink("/admin/settings")).not.toBeNull();
  });

  it("el MANAGER también la ve: el GET del servidor le deja mirar", async () => {
    // `GET /admin/tenant/settings` es `requireOwnerOrManager` y la página
    // le pinta todo en gris con su tooltip. Esconderla sería la tercera
    // capa en desacuerdo con las otras dos.
    meRole = "MANAGER";
    settingsCaja = true;
    meTenant = { hasHoldedKey: true, initialSyncStatus: "DONE", cajaEnabled: true };
    await render(
      <RealAdminShell title="Mi cuenta">
        <div />
      </RealAdminShell>,
    );
    expect(sidebarLink("/admin/settings")).not.toBeNull();
    // Pero lo que sí es ownerOnly sigue siéndolo.
    expect(sidebarLink("/admin/contacts-import")).toBeNull();
  });
});

describe("agenda-lista · qué ve dentro de Ajustes la empresa sin caja", () => {
  it("sólo los módulos del negocio y la declaración responsable", async () => {
    settingsCaja = false;
    await render(<SettingsPage />);
    const texto = container.textContent ?? "";

    // Lo que H1 dejó fuera del gate a propósito.
    expect(texto).toContain("Módulos del negocio");
    expect(texto).toContain("Agenda de citas");
    expect(texto).toContain("Ficha de cliente / CRM");
    // La declaración es del productor del sistema, no de lo que haya
    // comprado el comercio.
    expect(texto).toContain("Declaración responsable");

    // Y las cuatro secciones que cuelgan de la caja, que no.
    expect(texto).not.toContain("Cómo se comporta la sesión del cajero");
    expect(texto).not.toContain("Cierre del día");
    expect(texto).not.toContain("Umbral de descuento");
    expect(texto).not.toContain("PIN encargado para cerrar turnos");
  });

  it("con caja están las seis", async () => {
    settingsCaja = true;
    await render(<SettingsPage />);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Módulos del negocio");
    expect(texto).toContain("Cómo se comporta la sesión del cajero");
    expect(texto).toContain("Cierre del día");
    expect(texto).toContain("Umbral de descuento");
    expect(texto).toContain("PIN encargado para cerrar turnos");
    expect(texto).toContain("Declaración responsable");
  });
});
