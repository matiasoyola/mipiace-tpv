// contrato-lectura-completa · **NO SE ACEPTA SIN HABER PASADO POR TODO EL
// TEXTO**, en la pantalla.
//
// Lo que este banco prueba, uno a uno los cierres del prompt:
//
//   1. el texto está DESPLEGADO (ya no hay `<details>` que se pueda no
//      abrir), en un recuadro con su propio scroll y recorrible con el
//      teclado;
//   2. la casilla y «Acepto» nacen DESACTIVADOS, con el aviso debajo;
//   3. cuando el centinela del final llega a la vista, se activan y el
//      aviso cambia — en una región `aria-live`, que es lo que lo anuncia;
//   4. un texto que cabe entero sin scroll cuenta como visto;
//   5. al aceptar, la petición lleva `textoMostradoCompleto` y el
//      instante;
//   6. el PDF de la versión pendiente está ANTES de aceptar;
//   7. con la residencia encendida la pantalla dice «residentes».
//
// ── EL OBSERVADOR, A MANO ───────────────────────────────────────────
//
// jsdom no trae `IntersectionObserver`, y la pantalla cuenta «sin
// observador» como «visto» a propósito (si no, con el observador caído la
// dueña no podría aceptar NUNCA el contrato). O sea: sin instalar uno,
// este fichero entero pasaría en verde sin que la puerta existiera. Así
// que lo instala, y es lo que hace que los sabotajes se vean.
//
// Lo que jsdom NO puede probar es la geometría —si el recuadro scrollea,
// si el centinela queda debajo del pliegue—. Eso lo contestan las capturas
// del bloque.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ── El observador falso ─────────────────────────────────────────────

interface Observado {
  cb: (entradas: { isIntersecting: boolean }[]) => void;
  raices: unknown[];
  elementos: Element[];
  vivo: boolean;
}
const observadores: Observado[] = [];

class ObservadorFalso {
  private yo: Observado;
  constructor(
    cb: (entradas: { isIntersecting: boolean }[]) => void,
    opciones?: { root?: unknown },
  ) {
    this.yo = { cb, raices: [opciones?.root], elementos: [], vivo: true };
    observadores.push(this.yo);
  }
  observe(el: Element) {
    this.yo.elementos.push(el);
  }
  unobserve() {}
  disconnect() {
    this.yo.vivo = false;
  }
}

/** El final del texto entra en la vista: lo que hace el navegador cuando
 *  se baja hasta abajo (o, si cabe sin scroll, en el primer disparo). */
async function verElFinal(): Promise<void> {
  await act(async () => {
    for (const o of observadores) {
      if (o.vivo) o.cb([{ isIntersecting: true }]);
    }
  });
}

// ── El cliente HTTP ─────────────────────────────────────────────────

class FakeApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

let residenciaEncendida = false;
let aceptaciones: unknown[] = [];
let apartados = [
  { encabezado: "1. Objeto", parrafos: ["Lo primero del contrato."] },
  { encabezado: "2. Deberes", parrafos: ["Lo segundo.", "Y lo tercero."] },
];
const pedidas: Array<{ path: string; body?: unknown }> = [];
const blobsPedidos: string[] = [];

vi.mock("../src/api.js", () => ({
  ApiError: FakeApiError,
  api: vi.fn(async (path: string, opts?: { body?: unknown }) => {
    pedidas.push({ path, body: opts?.body });
    if (path === "/clinica/contrato") {
      return {
        estado: { estado: "SIN_CONTRATO" },
        versionVigente: 2,
        pendienteDeValidar: true,
        titulo: "Contrato de encargado del tratamiento",
        apartados,
        huellaVigente: "a".repeat(64),
        aceptaciones,
        puedeAceptar: true,
      };
    }
    if (path === "/admin/tenant/settings") {
      return {
        settings: {
          cajaEnabled: false,
          agendaEnabled: true,
          clinicalRecordsEnabled: true,
          residenciaEnabled: residenciaEncendida,
        },
      };
    }
    if (path === "/auth/me") {
      return {
        tenant: {
          hasHoldedKey: false,
          holdedEnabled: false,
          holdedDisconnectedAt: null,
          facturaDesde: "2026-01-01",
          businessType: "SERVICES",
        },
      };
    }
    return {};
  }),
  apiBlob: vi.fn(async (path: string) => {
    blobsPedidos.push(path);
    return new Blob();
  }),
  readTokens: () => ({ access: "a", refresh: "r" }),
  clearTokens: vi.fn(),
  storeTokens: vi.fn(),
  readEffectiveAuth: () => ({
    role: "OWNER",
    canEdit: true,
    readonlyReason: null,
    impersonationMode: null,
  }),
  readCurrentRole: () => "OWNER",
  readImpersonationState: () => null,
  readonlyReasonLabel: () => null,
}));

vi.mock("../src/AdminShell.js", () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const real = await orig<typeof import("react-router-dom")>();
  return { ...real, useNavigate: () => navigate };
});

const { ContratoTratamientoPage } = await import(
  "../src/pages/ContratoTratamientoPage.js"
);
const { __resetCapacidadesParaTests } = await import("../src/capabilities.js");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  navigate.mockClear();
  pedidas.length = 0;
  blobsPedidos.length = 0;
  observadores.length = 0;
  residenciaEncendida = false;
  aceptaciones = [];
  apartados = [
    { encabezado: "1. Objeto", parrafos: ["Lo primero del contrato."] },
    { encabezado: "2. Deberes", parrafos: ["Lo segundo.", "Y lo tercero."] },
  ];
  __resetCapacidadesParaTests();
  (globalThis as Record<string, unknown>).IntersectionObserver = ObservadorFalso;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (globalThis as Record<string, unknown>).IntersectionObserver;
});

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ContratoTratamientoPage />
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const texto = () => container.textContent ?? "";
const q = (test: string) => container.querySelector(`[data-test="${test}"]`);
const casilla = () => q("contrato-casilla") as HTMLInputElement;
const aceptar = () => q("contrato-aceptar") as HTMLButtonElement;

// ════════════════════════════════════════════════════════════════════
//  1 · EL TEXTO, DESPLEGADO
// ════════════════════════════════════════════════════════════════════

describe("el texto del contrato", () => {
  it("está a la vista y YA NO HAY nada plegado", async () => {
    await render();
    // El `<details>` era lo que se podía no abrir. Ya no está.
    expect(container.querySelector("details")).toBeNull();
    expect(texto()).not.toContain("Leer el contrato completo");
    // Y el texto entero está pintado.
    const caja = q("contrato-texto")!;
    expect(caja.textContent).toContain("1. Objeto");
    expect(caja.textContent).toContain("Y lo tercero.");
  });

  it("va en un recuadro con su propio scroll y recorrible con el teclado", async () => {
    await render();
    const caja = q("contrato-texto") as HTMLElement;
    expect(caja.className).toContain("overflow-y-auto");
    // Sin `tabIndex` un recuadro con scroll no se recorre con el teclado,
    // y entonces quien no usa ratón no podría aceptar el contrato nunca.
    expect(caja.getAttribute("tabindex")).toBe("0");
    expect(caja.getAttribute("role")).toBe("region");
    expect(caja.getAttribute("aria-label")).toContain(
      "Contrato de encargado del tratamiento",
    );
  });

  it("las tres líneas en llano siguen ENCIMA, como resumen", async () => {
    await render();
    const llano = q("contrato-en-llano")!;
    expect(llano).toBeTruthy();
    // Encima del texto, no debajo: es el resumen de lo que viene.
    expect(
      llano.compareDocumentPosition(q("contrato-texto")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════
//  2 · LA PUERTA
// ════════════════════════════════════════════════════════════════════

describe("la casilla y «Acepto»", () => {
  it("nacen DESACTIVADOS, con el aviso de bajar hasta el final", async () => {
    await render();
    expect(casilla().disabled).toBe(true);
    expect(aceptar().disabled).toBe(true);
    expect(q("contrato-aviso-recorrer")!.textContent).toBe(
      "Baja hasta el final del contrato para poder aceptarlo.",
    );
  });

  it("se activan cuando el final del texto llega a la vista", async () => {
    await render();
    await verElFinal();
    // La casilla ya se puede marcar…
    expect(casilla().disabled).toBe(false);
    // …y hasta que se marca, el botón sigue cerrado: recorrerlo no es
    // aceptarlo.
    expect(aceptar().disabled).toBe(true);
    await act(async () => casilla().click());
    expect(aceptar().disabled).toBe(false);
  });

  it("y el aviso lo ANUNCIA: cambia dentro de una región `aria-live`", async () => {
    await render();
    const aviso = q("contrato-aviso-recorrer")!;
    // Montada desde el primer render: una región que nace con el mensaje
    // dentro no se anuncia en varios lectores de pantalla.
    expect(aviso.getAttribute("role")).toBe("status");
    expect(aviso.getAttribute("aria-live")).toBe("polite");
    await verElFinal();
    expect(q("contrato-aviso-recorrer")).toBe(aviso);
    expect(aviso.textContent).toContain("Has llegado al final del contrato");
  });

  it("un texto que cabe entero sin scroll cuenta como visto", async () => {
    // El navegador avisa en el PRIMER disparo del observador cuando el
    // centinela ya está a la vista — no hace falta ningún scroll. Es lo
    // que hace que la pantalla grande no necesite un `if` propio.
    apartados = [{ encabezado: "1. Objeto", parrafos: ["Dos líneas."] }];
    await render();
    expect(casilla().disabled).toBe(true);
    await verElFinal();
    expect(casilla().disabled).toBe(false);
    // Y el recuadro no se ha movido: nadie ha scrolleado nada.
    expect((q("contrato-texto") as HTMLElement).scrollTop).toBe(0);
  });

  it("el centinela está AL FINAL del texto, no al principio", async () => {
    await render();
    const caja = q("contrato-texto")!;
    const centinela = q("contrato-final-del-texto")!;
    expect(caja.contains(centinela)).toBe(true);
    expect(caja.lastElementChild).toBe(centinela);
  });
});

// ════════════════════════════════════════════════════════════════════
//  3 · LO QUE SE MANDA
// ════════════════════════════════════════════════════════════════════

describe("al aceptar", () => {
  it("la petición dice que el texto se recorrió, y cuándo", async () => {
    await render();
    await verElFinal();
    await act(async () => casilla().click());
    await act(async () => aceptar().click());
    await act(async () => {
      await Promise.resolve();
    });
    const post = pedidas.find((p) => p.path === "/clinica/contrato/aceptar")!;
    expect(post).toBeTruthy();
    const body = post.body as {
      textoMostradoCompleto: boolean;
      finalDelTextoEn: string;
    };
    expect(body.textoMostradoCompleto).toBe(true);
    // Un ISO de verdad: es lo que la API guarda como prueba.
    expect(Number.isNaN(Date.parse(body.finalDelTextoEn))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
//  4 · EL PDF, ANTES DE ACEPTAR
// ════════════════════════════════════════════════════════════════════

describe("el PDF de la versión pendiente", () => {
  it("se puede descargar SIN haber aceptado todavía", async () => {
    // Es lo que se le manda a un abogado, y pedírselo después de aceptar
    // llega tarde.
    await render();
    const boton = q("contrato-pdf-pendiente") as HTMLButtonElement;
    expect(boton).toBeTruthy();
    // Y no está detrás de la puerta del recorrido: leerlo no es aceptarlo.
    expect(boton.disabled).toBe(false);
    await act(async () => boton.click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(blobsPedidos).toContain("/clinica/contrato/2.pdf");
  });
});

// ════════════════════════════════════════════════════════════════════
//  5 · «RESIDENTES»
// ════════════════════════════════════════════════════════════════════

describe("la palabra del centro", () => {
  it("con la residencia encendida, la pantalla dice «residentes»", async () => {
    residenciaEncendida = true;
    await render();
    expect(texto()).toContain("la historia clínica de tus residentes");
    expect(texto()).toContain("la historia completa de cada residente");
    // Y no queda ni un «paciente» suelto en lo que la pantalla escribe.
    // El texto legal NO se toca (viene del paquete versionado) y aquí no
    // lleva ninguno, así que la ausencia se puede afirmar.
    expect(texto()).not.toContain("paciente");
  });

  it("sin residencia sigue diciendo «pacientes», como en los quince de hoy", async () => {
    await render();
    expect(texto()).toContain("la historia clínica de tus pacientes");
    expect(texto()).not.toContain("residente");
  });
});

// ════════════════════════════════════════════════════════════════════
//  6 · LO QUE LA PRUEBA CUENTA DESPUÉS
// ════════════════════════════════════════════════════════════════════

describe("el historial de aceptaciones", () => {
  const base = {
    id: "ac-1",
    version: 2,
    huella: "b".repeat(64),
    aceptadoEn: "2026-10-24T09:00:00.000Z",
    quien: "Carmen",
    aparato: null,
    revocado: false,
    revocadoEn: null,
    revocadoPor: null,
    textoDisponible: true,
  };

  // Se mira LA FILA y no la página: la frase «se recorrió hasta el final»
  // también está en el pie de debajo del botón («al aceptar queda
  // registrado…»), así que afirmar su ausencia sobre todo el texto daría
  // verde por el motivo equivocado.
  const fila = () => q("contrato-aceptacion")!.textContent ?? "";

  it("dice que el texto se recorrió cuando la fila lo trae", async () => {
    aceptaciones = [
      { ...base, textoRecorridoEn: "2026-10-24T08:59:12.000Z" },
    ];
    await render();
    expect(fila()).toContain(
      "El texto completo se mostró y se recorrió hasta el final",
    );
  });

  it("y NO AFIRMA NADA de las aceptaciones de antes de la regla", async () => {
    // `null` es «no se midió», no «no lo leyó». Escribir lo segundo sería
    // inventárselo: las ya guardadas no se tocan.
    aceptaciones = [{ ...base, textoRecorridoEn: null }];
    await render();
    expect(fila()).not.toContain("se recorrió");
    // Lo que sí sigue estando es lo que esa fila sí demuestra.
    expect(fila()).toContain("Huella:");
    expect(fila()).toContain("Aceptado por Carmen");
  });
});
