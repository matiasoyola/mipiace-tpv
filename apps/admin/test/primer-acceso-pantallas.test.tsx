// primer-acceso · EL BANCO DE LAS PANTALLAS DEL PRIMER DÍA.
//
// El recorrido de Carmen, por la interfaz:
//
//   1. La página de bienvenida: su nombre, su email sin poder editarlo,
//      UN campo, los requisitos marcándose en vivo y «Entrar» que deja
//      la sesión iniciada (guarda tokens y navega a `/`).
//   2. El enlace muerto: «Este enlace ya no vale» y «Envíame uno nuevo».
//   3. `RootRouter`: con la clínica encendida y el contrato sin aceptar,
//      la primera pantalla es el contrato — y si la cuenta no tiene
//      clínica, se entra a donde se entraba siempre.
//   4. Quien NO es la propietaria lee qué falta, sin botones.
//   5. El panel de una residencia vacía: UNA tarjeta con «Nuevo ingreso».
//   6. El 423 del contrato se lee como «Falta aceptar el contrato de
//      datos», no como un error rojo.
//
// Sabotajes que este fichero pone en rojo:
//   · quitar la redirección al contrato (nº 3)
//   · pintarle a un encargado el botón de aceptar (nº 4)
//   · devolver el panel de cinco secciones vacías a un centro sin
//     residentes (nº 5)
//   · dejar que el 423 del contrato salga como error rojo (nº 6)

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MENSAJE_CONTRATO_SIN_ACEPTAR,
} from "@mipiacetpv/contrato-encargado";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ── El cliente HTTP, falseado por ruta ───────────────────────────────

class FakeApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

type Contrato = {
  estado: "APAGADO" | "SIN_CONTRATO" | "VIGENTE" | "SOLO_LECTURA";
  falta: boolean;
  puedeAceptar: boolean;
};

let meRole = "OWNER";
let meContrato: Contrato | null | undefined;
let invitacionViva = true;
let panelCentroVacio = false;
const pedidas: Array<{ path: string; body?: unknown }> = [];
const tokensGuardados: unknown[] = [];

vi.mock("../src/api.js", () => ({
  ApiError: FakeApiError,
  api: vi.fn(async (path: string, opts?: { body?: unknown }) => {
    pedidas.push({ path, body: opts?.body });
    if (path === "/auth/me") {
      return {
        user: { id: "u1", email: "carmen@jardindegredos.es", role: meRole },
        tenant: {
          id: "t1",
          name: "Jardín de Gredos",
          fiscalProfile: null,
          lastIncrementalSyncAt: null,
          hasHoldedKey: false,
          initialSyncStatus: "NOT_APPLICABLE",
          cajaEnabled: false,
          residenciaEnabled: true,
          agendaEnabled: true,
          // puesta-en-marcha · `null` = la cuenta no factura todavía, que
          // es como nace una residencia recién activada. Es lo que hace
          // que el caso de la banda del ensayo sea el de Carmen.
          facturaDesde: null,
          businessType: "SERVICES",
          holdedEnabled: false,
          holdedDisconnectedAt: null,
          contratoClinico: meContrato,
        },
      };
    }
    if (path === "/admin/tenant/settings") {
      return {
        settings: {
          agendaEnabled: true,
          cajaEnabled: false,
          residenciaEnabled: true,
          clinicalRecordsEnabled: true,
        },
      };
    }
    if (path === "/auth/invitacion/consultar") {
      if (!invitacionViva) {
        throw new FakeApiError(
          410,
          "Este enlace ya no vale",
          "INVITACION_CADUCADA_O_USADA",
        );
      }
      return {
        nombre: "Carmen",
        email: "carmen@jardindegredos.es",
        centro: "Jardín de Gredos",
      };
    }
    if (path === "/auth/invitacion/aceptar") {
      return { accessToken: "acc", refreshToken: "ref" };
    }
    if (path === "/auth/invitacion/reenviar") return { message: "ok" };
    if (path === "/residencia/panel") {
      return {
        abierto: { porNivel: [], avisosSinAcuse: 0, sinConstanciaDeFamilia: 0, esperandoCierreDeOtro: 0, total: 0 },
        relevos: { ultimo: null, sinConfirmar: [] },
        obligaciones: { hoy: [], vencidas: [], proximas: [] },
        turno: { turno: null, careDay: "2026-10-23", plantas: [], noHechoDeTurnosCerrados: 0 },
        porArreglar: { pinesPorRenovar: [], residentesSinPlan: [] },
        indicadores: [],
        mes: "2026-10",
        centroVacio: panelCentroVacio,
        generadoEn: new Date().toISOString(),
      };
    }
    if (path === "/clinica/contrato") {
      return {
        estado:
          meContrato?.estado === "SIN_CONTRATO"
            ? { estado: "SIN_CONTRATO" }
            : { estado: "VIGENTE", versionAceptada: 1 },
        versionVigente: 1,
        pendienteDeValidar: true,
        titulo: "Contrato de encargado del tratamiento",
        apartados: [{ encabezado: "1. Objeto", parrafos: ["Lo que sea."] }],
        huellaVigente: "abc",
        aceptaciones: [],
        puedeAceptar: meContrato?.puedeAceptar ?? false,
      };
    }
    return {};
  }),
  apiBlob: vi.fn(async () => new Blob()),
  readTokens: () => ({ access: "a", refresh: "r" }),
  clearTokens: vi.fn(),
  storeTokens: vi.fn((t: unknown) => tokensGuardados.push(t)),
  readEffectiveAuth: () => ({
    role: meRole,
    canEdit: true,
    readonlyReason: null,
    impersonationMode: null,
  }),
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
const { BienvenidaPage } = await import("../src/pages/BienvenidaPage.js");
const { ContratoTratamientoPage } = await import(
  "../src/pages/ContratoTratamientoPage.js"
);
const { PanelPage } = await import("../src/pages/residencia/PanelPage.js");
const { FieldError } = await import("../src/ui.js");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  navigate.mockClear();
  pedidas.length = 0;
  tokensGuardados.length = 0;
  meRole = "OWNER";
  meContrato = undefined;
  invitacionViva = true;
  panelCentroVacio = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(
  node: React.ReactNode,
  ruta = "/",
): Promise<void> {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[ruta]}>{node}</MemoryRouter>);
  });
  await act(async () => {
    await Promise.resolve();
  });
  // Una tercera vuelta: la bienvenida pide y luego pinta.
  await act(async () => {
    await Promise.resolve();
  });
}

function texto(): string {
  return container.textContent ?? "";
}

async function teclear(input: HTMLInputElement, valor: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// ════════════════════════════════════════════════════════════════════
//  1 · La página de bienvenida
// ════════════════════════════════════════════════════════════════════

describe("la página de bienvenida", () => {
  it("saluda por su nombre y enseña el email sin poder editarlo", async () => {
    await render(<BienvenidaPage />, "/bienvenida?token=abc");
    expect(texto()).toContain("Hola Carmen");
    expect(texto()).toContain("carmen@jardindegredos.es");
    // El email NO es un campo: es un dato. Un solo `input`, el de la
    // contraseña — es el «UN solo campo» del prompt.
    const inputs = [...container.querySelectorAll("input")];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.type).toBe("password");
  });

  it("los requisitos se marcan en vivo y «Entrar» no se puede pulsar antes", async () => {
    await render(<BienvenidaPage />, "/bienvenida?token=abc");
    const entrar = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Entrar"),
    ) as HTMLButtonElement;
    expect(entrar.disabled).toBe(true);

    const campo = container.querySelector("input")! as HTMLInputElement;
    await teclear(campo, "corta1");
    expect(entrar.disabled).toBe(true);
    // Con doce caracteres, una letra y un número, los tres cumplidos.
    await teclear(campo, "jardindegredos2026");
    const requisitos = container.querySelector('[data-test="requisitos"]')!;
    expect(requisitos.textContent).not.toContain("(pendiente)");
    expect(entrar.disabled).toBe(false);
  });

  it("al pulsar queda DENTRO: guarda la sesión y va a «/»", async () => {
    await render(<BienvenidaPage />, "/bienvenida?token=abc");
    const campo = container.querySelector("input")! as HTMLInputElement;
    await teclear(campo, "jardindegredos2026");
    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(pedidas.some((p) => p.path === "/auth/invitacion/aceptar")).toBe(true);
    expect(tokensGuardados).toEqual([
      { accessToken: "acc", refreshToken: "ref" },
    ]);
    // Y NO pasa por el login: el paso que el bloque viene a quitar.
    expect(navigate).toHaveBeenCalledWith("/", { replace: true });
    expect(navigate.mock.calls.map((c) => c[0])).not.toContain("/login");
  });

  it("el enlace muerto dice que ya no vale y ofrece pedir otro", async () => {
    invitacionViva = false;
    await render(<BienvenidaPage />, "/bienvenida?token=caducado");
    expect(texto()).toContain("Este enlace ya no vale");
    const boton = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Envíame uno nuevo"),
    ) as HTMLButtonElement;
    expect(boton).toBeTruthy();
    // Sin correo escrito no se puede pedir: el botón pediría por nadie.
    expect(boton.disabled).toBe(true);
    const campo = container.querySelector("input")! as HTMLInputElement;
    await teclear(campo, "carmen@jardindegredos.es");
    await act(async () => boton.click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      pedidas.find((p) => p.path === "/auth/invitacion/reenviar")?.body,
    ).toEqual({ email: "carmen@jardindegredos.es" });
    // Respuesta neutra, también en la pantalla.
    expect(texto()).toContain("Si ese correo tiene una invitación pendiente");
  });

  it("sin token en la URL no pide nada: es un enlace muerto", async () => {
    await render(<BienvenidaPage />, "/bienvenida");
    expect(texto()).toContain("Este enlace ya no vale");
    expect(pedidas.some((p) => p.path === "/auth/invitacion/consultar")).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
//  2 · El contrato, primero
// ════════════════════════════════════════════════════════════════════

describe("a dónde entra después de elegir la contraseña", () => {
  it("con la clínica encendida y el contrato sin aceptar, al contrato", async () => {
    meContrato = { estado: "SIN_CONTRATO", falta: true, puedeAceptar: true };
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/admin/contrato-tratamiento", {
      replace: true,
    });
  });

  it("también cuando quien entra NO es la propietaria", async () => {
    meRole = "MANAGER";
    meContrato = { estado: "SIN_CONTRATO", falta: true, puedeAceptar: false };
    await render(<RootRouter />);
    // Y el contrato va DELANTE de la bandeja del encargado: con el
    // contrato sin aceptar, la bandeja tampoco funciona.
    expect(navigate).toHaveBeenCalledWith("/admin/contrato-tratamiento", {
      replace: true,
    });
  });

  it("con el contrato vigente entra al panel de dirección de siempre", async () => {
    meContrato = { estado: "VIGENTE", falta: false, puedeAceptar: true };
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/admin/residencia/panel", {
      replace: true,
    });
  });

  it("una cuenta SIN clínica entra donde entraba siempre", async () => {
    meContrato = { estado: "APAGADO", falta: false, puedeAceptar: false };
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/admin/residencia/panel", {
      replace: true,
    });
    expect(navigate.mock.calls.map((c) => c[0])).not.toContain(
      "/admin/contrato-tratamiento",
    );
  });

  it("un backend anterior al bloque (sin el campo) se comporta como master", async () => {
    meContrato = undefined;
    await render(<RootRouter />);
    expect(navigate).toHaveBeenCalledWith("/admin/residencia/panel", {
      replace: true,
    });
  });
});

describe("la pantalla del contrato", () => {
  // contrato-lectura-completa · ESTE CASO CAMBIÓ DE FORMA.
  //
  // En primer-acceso el texto legal iba PLEGADO en un `<details>` y las
  // tres líneas en llano lo sustituían. El 24-10-2026 se vio que así se
  // podía marcar la casilla y aceptar sin haberlo abierto, y el bloque
  // `contrato-lectura-completa` lo desplegó: el texto está a la vista en
  // un recuadro con su propio scroll, y las tres líneas se quedan ENCIMA
  // como resumen.
  //
  // Lo que primer-acceso fijó y sigue en pie es el ORDEN —lo llano
  // primero— y que la pantalla abre con el botón de aceptar. La puerta del
  // recorrido tiene su propio banco en
  // `contrato-lectura-completa-pantallas.test.tsx`.
  it("abre con las tres líneas en llano PRIMERO y el texto legal a la vista", async () => {
    meContrato = { estado: "SIN_CONTRATO", falta: true, puedeAceptar: true };
    await render(<ContratoTratamientoPage />);
    const llano = container.querySelector('[data-test="contrato-en-llano"]')!;
    expect(llano).toBeTruthy();
    const legal = container.querySelector('[data-test="contrato-texto"]')!;
    expect(legal).toBeTruthy();
    // Lo llano, antes del texto legal.
    expect(
      llano.compareDocumentPosition(legal) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Y ya no hay nada plegado que se pueda no abrir.
    expect(container.querySelector("details")).toBeNull();
    const aceptar = container.querySelector('[data-test="contrato-aceptar"]')!;
    expect(aceptar.textContent).toContain("Acepto");
  });

  it("a quien no es la propietaria le dice qué falta y NO le pinta botón", async () => {
    meRole = "MANAGER";
    meContrato = { estado: "SIN_CONTRATO", falta: true, puedeAceptar: false };
    await render(<ContratoTratamientoPage />);
    expect(texto()).toContain(
      "Antes de empezar, la propietaria del centro tiene que aceptar el contrato de datos",
    );
    expect(container.querySelector('[data-test="contrato-aceptar"]')).toBeNull();
    expect(container.querySelector('[data-test="contrato-en-llano"]')).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
//  3 · El panel de una residencia vacía
// ════════════════════════════════════════════════════════════════════

describe("el panel de dirección el primer día", () => {
  it("sin residentes es UNA tarjeta con «Nuevo ingreso»", async () => {
    panelCentroVacio = true;
    await render(<PanelPage />);
    const tarjeta = container.querySelector('[data-test="panel-centro-vacio"]')!;
    expect(tarjeta).toBeTruthy();
    expect(tarjeta.textContent).toContain("Empieza dando de alta a tus residentes");
    // El enlace abre el formulario directo, no la lista vacía.
    const enlace = tarjeta.querySelector("a")!;
    expect(enlace.getAttribute("href")).toBe(
      "/admin/residencia/residentes?alta=1",
    );
    expect(enlace.textContent).toContain("Nuevo ingreso");
    // Y NO está el panel de cinco secciones vacías.
    expect(texto()).not.toContain("Todavía no hay ningún parte de relevo");
    expect(texto()).not.toContain("Qué hay abierto hoy");
  });

  it("con residentes es el panel de siempre", async () => {
    panelCentroVacio = false;
    await render(<PanelPage />);
    expect(container.querySelector('[data-test="panel-centro-vacio"]')).toBeNull();
    // cuadro-de-control · «el panel de siempre» es desde este bloque el
    // cuadro de control: la cabecera con el saludo, «Ahora» y «Hoy». Lo
    // que este test fija no es la maqueta, es que la tarjeta de centro
    // vacío NO tapa el panel cuando hay residentes.
    expect(texto()).toContain("Ahora");
    expect(texto()).toContain("Hoy");
  });
});

// ════════════════════════════════════════════════════════════════════
//  4 · El 423 del contrato, en cualquier pantalla
// ════════════════════════════════════════════════════════════════════

describe("el 423 del contrato no es un error rojo", () => {
  it("a la propietaria le dice qué falta y le da el botón para ir", async () => {
    meRole = "OWNER";
    await render(<FieldError message={MENSAJE_CONTRATO_SIN_ACEPTAR} />);
    const aviso = container.querySelector('[data-test="falta-contrato"]')!;
    expect(aviso).toBeTruthy();
    expect(aviso.textContent).toContain("Falta aceptar el contrato de datos");
    expect(aviso.querySelector("a")!.getAttribute("href")).toBe(
      "/admin/contrato-tratamiento",
    );
  });

  it("al encargado le dice quién lo acepta, sin botón", async () => {
    meRole = "MANAGER";
    await render(<FieldError message={MENSAJE_CONTRATO_SIN_ACEPTAR} />);
    const aviso = container.querySelector('[data-test="falta-contrato"]')!;
    expect(aviso.textContent).toContain(
      "La propietaria del centro tiene que aceptarlo",
    );
    expect(aviso.querySelector("a")).toBeNull();
  });

  it("cualquier otro error sigue siendo un error rojo", async () => {
    await render(<FieldError message="No se pudo guardar. Reintenta." />);
    expect(container.querySelector('[data-test="falta-contrato"]')).toBeNull();
    expect(texto()).toContain("No se pudo guardar");
  });
});

// ════════════════════════════════════════════════════════════════════
//  5 · La banda del ensayo no le habla del TPV a quien no tiene caja
// ════════════════════════════════════════════════════════════════════
//
// Lo encontró el bucle visual del 23-10, en la PRIMERA pantalla de
// Carmen: seis líneas sobre vender, cobrar, arquear y Hacienda, en un
// centro que no tiene caja. Es la misma mitad que faltaba en el banner de
// Holded antes de H1.

describe("la banda del ensayo", () => {
  it("no se pinta en una cuenta sin caja, aunque esté en ensayo", async () => {
    const { AdminShell } = await vi.importActual<
      typeof import("../src/AdminShell.js")
    >("../src/AdminShell.js");
    await render(
      <AdminShell title="Panel de dirección">
        <p>contenido</p>
      </AdminShell>,
    );
    // `/auth/me` de este fichero es una residencia sin caja y sin
    // `facturaDesde`, que es justo el caso: en ensayo y sin TPV.
    expect(texto()).not.toContain("Tu cuenta está en ensayo");
  });
});
