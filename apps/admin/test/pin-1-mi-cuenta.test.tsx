// pin-1 (puntos 1, 2 y 5) · «MI CUENTA» Y EL PIN.
//
// Tres pantallas distintas según quién esté delante, y la que se pinta
// no es cosmética: lo que cambia es QUÉ queda puesto al guardar.
//
//   · la propietaria SIN PIN (el primer día, porque desde este bloque el
//     sistema ya no le genera ninguno) → «Elige tu PIN del TPV»;
//   · la propietaria CON PIN → «Mi PIN del TPV», con el campo del actual
//     y un «He olvidado mi PIN» que lo quita;
//   · Mi Piace dentro de «Configurar como OWNER» → «PIN provisional del
//     propietario», que es lo único que soporte puede dejar.
//
// Lo que este fichero fija, y los sabotajes que pone en rojo:
//
//   1. «Regenerar PIN» **ya no existe** para la propietaria. Volver a
//      pintárselo es devolver el número al azar que se enseña una vez.
//   2. «He olvidado mi PIN» va a `/auth/me/pin/elegir` (sin el actual) y
//      lo normal a `/auth/me/pin` (con él). Cruzar las dos rutas es o
//      pedirle el PIN que acaba de olvidar, o dejar cambiar el PIN sin
//      saber el anterior.
//   3. Con un PIN PROVISIONAL se le dice, y no se le pide el actual: con
//      él no entra al TPV, y el aviso es lo que lo explica donde puede
//      arreglarlo.
//   4. Sin caja, nada de esto se pinta (H1 ·
//      contrato-lectura-completa).

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface MeUser {
  hasPin?: boolean;
  pinProvisional?: boolean;
}
let meUser: MeUser = {};
let cajaEnabled = true;
let impersonationMode: "readonly" | "full" | null = null;

class FakeApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

const apiMock = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("../src/api.js", () => ({
  ApiError: FakeApiError,
  clearTokens: vi.fn(),
  readTokens: () => ({ access: "a", refresh: "r" }),
  storeTokens: vi.fn(),
  readEffectiveAuth: () => ({
    role: "OWNER",
    canEdit: true,
    readonlyReason: null,
    impersonationMode,
  }),
  api: apiMock.api,
}));

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
  meUser = { hasPin: true, pinProvisional: false };
  cajaEnabled = true;
  impersonationMode = null;
  apiMock.api.mockReset().mockImplementation(async (path: string) => {
    if (path === "/auth/me") {
      return {
        user: {
          id: "u1",
          email: "carmen@sirope.es",
          role: "OWNER",
          ...meUser,
        },
        tenant: {
          id: "t1",
          name: "SIROPE SL",
          hasHoldedKey: true,
          holdedEnabled: false,
          cajaEnabled,
          fiscalProfile: { legalName: "SIROPE SL" },
          initialSyncStatus: "NOT_APPLICABLE",
          lastIncrementalSyncAt: null,
        },
      };
    }
    return { ok: true };
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function pintar(): Promise<string> {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container.textContent ?? "";
}

function porTestId(id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function campo(id: string): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>(`#${id}`);
}

async function teclear(id: string, valor: string) {
  const input = campo(id)!;
  await act(async () => {
    // React escucha `input`, no `change`, y hay que pasar por el setter
    // nativo para que el valor llegue al estado.
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function guardar(): HTMLButtonElement {
  const b = [...container.querySelectorAll("button")].find((x) =>
    x.textContent?.includes("Guardar PIN"),
  );
  if (!b) throw new Error("sin botón de guardar");
  return b as HTMLButtonElement;
}

// ── 1 · «REGENERAR PIN» SE FUE ──────────────────────────────────────

describe("«Regenerar PIN» ya no se le ofrece a la propietaria", () => {
  it("no está, y en su lugar está la sección de su PIN", async () => {
    // El sabotaje: devolverle el botón. Es el camino que hizo perder el
    // PIN de la propietaria dos veces en la mañana del 27-10.
    const texto = await pintar();
    expect(texto).not.toContain("Regenerar PIN");
    expect(texto).not.toContain("PIN de respaldo");
    expect(texto).toContain("Mi PIN del TPV");
  });

  it("Mi Piace, dentro de «Configurar como OWNER», SÍ lo tiene", async () => {
    impersonationMode = "full";
    const texto = await pintar();
    expect(texto).toContain("Regenerar PIN");
    // Y la pantalla dice lo que de verdad hace: dejar uno provisional.
    expect(texto).toContain("provisional");
    // Y no le ofrece la sección de la dueña: el PIN definitivo no es
    // cosa de soporte.
    expect(texto).not.toContain("Mi PIN del TPV");
  });
});

// ── 2 · LAS DOS RUTAS, SIN CRUZARSE ─────────────────────────────────

describe("cambiar el mío pide el actual; «lo he olvidado» no", () => {
  it("con PIN puesto, el campo del actual está", async () => {
    await pintar();
    expect(campo("pinActual")).not.toBeNull();
    expect(campo("pinNuevo")).not.toBeNull();
    expect(campo("pinRepetido")).not.toBeNull();
  });

  it("y va a /auth/me/pin con el actual y el nuevo", async () => {
    await pintar();
    await teclear("pinActual", "5061");
    await teclear("pinNuevo", "9473");
    await teclear("pinRepetido", "9473");
    await act(async () => guardar().click());
    expect(apiMock.api).toHaveBeenCalledWith("/auth/me/pin", {
      method: "POST",
      body: { currentPin: "5061", newPin: "9473" },
    });
  });

  it("«He olvidado mi PIN» quita el campo y cambia de ruta", async () => {
    await pintar();
    await act(async () => porTestId("mi-pin-olvidado")!.click());
    expect(campo("pinActual")).toBeNull();
    await teclear("pinNuevo", "9473");
    await teclear("pinRepetido", "9473");
    await act(async () => guardar().click());
    expect(apiMock.api).toHaveBeenCalledWith("/auth/me/pin/elegir", {
      method: "POST",
      body: { newPin: "9473" },
    });
  });

  it("«Guardar» no se enciende con los dos nuevos distintos", async () => {
    await pintar();
    await teclear("pinActual", "5061");
    await teclear("pinNuevo", "9473");
    await teclear("pinRepetido", "9474");
    expect(guardar().disabled).toBe(true);
    expect(porTestId("mi-pin-no-coinciden")).not.toBeNull();
    // Y nada ha salido: sólo la lectura de /auth/me.
    expect(
      apiMock.api.mock.calls.filter(([p]) => p !== "/auth/me"),
    ).toHaveLength(0);
  });

  it("ni con menos de cuatro cifras", async () => {
    await pintar();
    await teclear("pinActual", "5061");
    await teclear("pinNuevo", "947");
    await teclear("pinRepetido", "947");
    expect(guardar().disabled).toBe(true);
  });
});

// ── 3 · EL PRIMER DÍA Y EL PIN PRESTADO ─────────────────────────────

describe("sin PIN y con PIN prestado, no se pide el actual", () => {
  it("sin PIN: «Elige tu PIN» y ningún campo de actual", async () => {
    meUser = { hasPin: false };
    const texto = await pintar();
    expect(texto).toContain("Elige tu PIN del TPV");
    expect(campo("pinActual")).toBeNull();
    // Ni «He olvidado mi PIN»: no hay nada que olvidar.
    expect(porTestId("mi-pin-olvidado")).toBeNull();
  });

  it("sin PIN: elegirlo va a la ruta de elegir", async () => {
    meUser = { hasPin: false };
    await pintar();
    await teclear("pinNuevo", "9473");
    await teclear("pinRepetido", "9473");
    await act(async () => guardar().click());
    expect(apiMock.api).toHaveBeenCalledWith("/auth/me/pin/elegir", {
      method: "POST",
      body: { newPin: "9473" },
    });
  });

  it("con PIN PROVISIONAL: se le dice, y tampoco se le pide el actual", async () => {
    // Es lo que explica que no pueda entrar en la caja. Si no se dijera
    // aquí, lo descubriría delante del TPV.
    meUser = { hasPin: true, pinProvisional: true };
    await pintar();
    expect(porTestId("mi-pin-provisional")).not.toBeNull();
    expect(porTestId("mi-pin-provisional")!.textContent).toContain("soporte");
    expect(campo("pinActual")).toBeNull();
  });

  it("si el backend no manda los campos, se comporta como master", async () => {
    // Mismo criterio que los módulos de H1: un panel por delante de la
    // API no puede pedirle «elige tu PIN» a quien ya tiene uno.
    meUser = {};
    const texto = await pintar();
    expect(texto).toContain("Mi PIN del TPV");
    expect(campo("pinActual")).not.toBeNull();
  });
});

// ── 4 · SIN CAJA, NADA DE ESTO ──────────────────────────────────────

describe("sin caja no hay PIN en Mi cuenta", () => {
  it("no se pinta ninguna de las dos secciones", async () => {
    cajaEnabled = false;
    const texto = await pintar();
    expect(texto).not.toContain("Mi PIN del TPV");
    expect(texto).not.toContain("Elige tu PIN del TPV");
    expect(texto).not.toContain("Regenerar PIN");
    // Y la pantalla sigue siendo su pantalla.
    expect(texto.length).toBeGreaterThan(0);
  });

  it("tampoco en una sesión de soporte", async () => {
    cajaEnabled = false;
    impersonationMode = "full";
    const texto = await pintar();
    expect(texto).not.toContain("Regenerar PIN");
  });
});
