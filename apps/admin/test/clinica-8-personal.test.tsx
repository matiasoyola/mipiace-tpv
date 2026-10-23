// clinica-8 · NINGÚN GUARDADO DE PERSONAL FALLA EN SILENCIO.
//
// El 18-10, en la pantalla de Personal de la clínica: se marcó «Es
// sanitario», se escribió el colegiado «45-0123», se pulsó Guardar… y la
// casilla volvió sola a su sitio, sin una palabra. Sin esa marca la cita no
// enseña nada clínico, así que un guardado mudo paró el recorrido entero —
// y lo que quedó escrito en la auditoría fue «falla en silencio con
// 45-0123», porque el segundo intento (con 45/0123) sí salió.
//
// Lo primero que este banco fija es que **el formato del colegiado no tiene
// nada que ver**: se guarda tal cual, con guion, con barra o como sea. Y lo
// segundo, lo que de verdad arregla el problema: en esta pantalla hay
// CUATRO botones de guardar y hasta este bloque ninguno decía nada — el
// acierto se notaba porque los datos se refrescaban solos, y el fallo salía
// en la cabecera de la página, lejos del botón y fuera de la pantalla con
// la tarjeta desplegada.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return {
    ...actual,
    api: apiMock.api,
    readEffectiveAuth: () => ({ canEdit: true }),
    clearTokens: () => {},
  };
});

vi.mock("../src/AdminShell.js", () => ({
  AdminShell: ({ children }: { children: unknown }) => children,
}));

import { ApiError } from "../src/api.js";
import { StaffPage } from "../src/pages/StaffPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ROSA = {
  userId: "u-rosa",
  alias: "Rosa",
  email: "rosa@clinicademo.es",
  role: "OWNER" as const,
  profile: {
    userId: "u-rosa",
    displayName: "Rosa",
    active: true,
    color: "#e8663c",
  },
  serviceIds: [] as string[],
  skillCount: 0,
  clinica: {
    esSanitario: false,
    colegiado: null as string | null,
    alcance: "SELECTION" as const,
    puesto: "propietaria" as const,
  },
};

let container: HTMLDivElement;
let root: Root | undefined;
let patches: Array<{ path: string; body: any }>;
/** Qué contesta la API al PATCH de la sección clínica. */
let respuestaDelPatch: "ok" | "error" | "red";

beforeEach(() => {
  patches = [];
  respuestaDelPatch = "ok";
  apiMock.api.mockReset();
  apiMock.api.mockImplementation(
    async (path: string, init?: { method?: string; body?: any }) => {
      if (path === "/admin/tenant/settings") {
        return {
          settings: { agendaEnabled: true, clinicalRecordsEnabled: true },
        };
      }
      if (path === "/staff") return { staff: [{ ...ROSA }] };
      if (path === "/staff/services") return { services: [] };
      if (/\/staff\/[^/]+\/shifts$/.test(path)) return { shifts: [] };
      if (path.endsWith("/clinica") && init?.method === "PATCH") {
        patches.push({ path, body: init.body });
        if (respuestaDelPatch === "error") {
          throw new ApiError(
            400,
            "CLINICIAN_LICENSE_REQUIRED",
            "El personal sanitario necesita su nº de colegiado.",
          );
        }
        if (respuestaDelPatch === "red") throw new TypeError("Failed to fetch");
        return { clinica: {}, sesionesInvalidadas: false };
      }
      if (/\/clinica\/clinicians\/[^/]+\/clients$/.test(path)) {
        return { clients: [] };
      }
      return {};
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = undefined;
  }
  container.remove();
});

async function pintar() {
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter>
        <StaffPage />
      </MemoryRouter>,
    );
  });
  // Dos vueltas: el `useEffect` carga ajustes y personal.
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function escribir(el: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botonPorTexto(texto: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function abrirFichaDeRosa() {
  const cabecera = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("rosa@clinicademo.es"),
  )!;
  await click(cabecera);
}

/** Marca «Es sanitario» y escribe el colegiado que se le pase. */
function casillaDeSanitario(): HTMLInputElement {
  // La tarjeta tiene DOS casillas: «Activo en la agenda» (perfil) y «Es
  // sanitario» (historia clínica). Por el texto de su etiqueta, no por el
  // orden: el orden cambia el día que alguien mueva una sección.
  const label = [...container.querySelectorAll("label")].find((l) =>
    l.textContent?.includes("Es sanitario"),
  );
  const casilla = label?.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  if (!casilla) throw new Error("no hay casilla «Es sanitario»");
  return casilla;
}

async function marcarSanitaria(colegiado: string) {
  const casilla = casillaDeSanitario();
  await act(async () => {
    casilla.click();
  });
  const campo = container.querySelector<HTMLInputElement>("[data-colegiado]")!;
  await act(async () => {
    escribir(campo, colegiado);
  });
}

function avisos(): string[] {
  return [...container.querySelectorAll("[data-guardado]")].map(
    (p) => `${p.getAttribute("data-guardado")}: ${p.textContent}`,
  );
}

describe("clinica-8 · el nº de colegiado se guarda COMO SEA", () => {
  it.each(["45-0123", "45/0123", "COL-450123", "280001"])(
    "«%s» llega al servidor tal cual",
    async (colegiado) => {
      await pintar();
      await abrirFichaDeRosa();
      await marcarSanitaria(colegiado);
      await click(botonPorTexto("Guardar")!);
      expect(patches).toHaveLength(1);
      expect(patches[0]!.body.colegiado).toBe(colegiado);
      expect(patches[0]!.body.esSanitario).toBe(true);
    },
  );

  it("y la pantalla dice en qué formatos vale, antes de que cueste un intento", async () => {
    await pintar();
    await abrirFichaDeRosa();
    await marcarSanitaria("45-0123");
    expect(container.textContent).toContain("45/0123, 45-0123");
  });
});

describe("clinica-8 · el guardado contesta SIEMPRE, al lado del botón", () => {
  it("cuando sale bien, lo dice", async () => {
    await pintar();
    await abrirFichaDeRosa();
    await marcarSanitaria("45-0123");
    await click(botonPorTexto("Guardar")!);
    expect(avisos()).toContain("ok: Guardado.");
  });

  it("cuando el servidor lo rechaza, dice su motivo DONDE está el dedo", async () => {
    respuestaDelPatch = "error";
    await pintar();
    await abrirFichaDeRosa();
    await marcarSanitaria("45-0123");
    await click(botonPorTexto("Guardar")!);
    expect(avisos().join(" ")).toContain(
      "El personal sanitario necesita su nº de colegiado.",
    );
  });

  it("y cuando no hay red, también: nunca se queda mudo", async () => {
    // Éste es el que de verdad protege el recorrido: un fallo de red no
    // es un `ApiError`, y antes de este bloque caía en un «Error al
    // guardar» genérico en la cabecera de la página.
    respuestaDelPatch = "red";
    await pintar();
    await abrirFichaDeRosa();
    await marcarSanitaria("45-0123");
    await click(botonPorTexto("Guardar")!);
    expect(avisos().join(" ")).toContain("No se ha podido guardar");
  });

  it("sin colegiado, «Guardar» SE PUEDE PULSAR y explica qué falta", async () => {
    // El botón ya no se desactiva: un botón apagado en una tablet se lee
    // como «esto está roto». Se pulsa, y contesta.
    await pintar();
    await abrirFichaDeRosa();
    await act(async () => {
      casillaDeSanitario().click();
    });
    const guardar = botonPorTexto("Guardar")!;
    expect(guardar.disabled).toBe(false);
    await click(guardar);
    // No se manda nada, y se dice por qué.
    expect(patches).toEqual([]);
    expect(avisos().join(" ")).toContain("Falta el nº de colegiado");
  });

  // clinica-8 (fase B, 16) · ya no hay «Guardar perfil»: hay UN botón
  // por tarjeta. Lo que este test fija sigue siendo lo mismo —que
  // guardar el perfil contesta donde está el dedo— con el botón que hay.
  it("el guardado del PERFIL también contesta", async () => {
    await pintar();
    await abrirFichaDeRosa();
    const nombre = container.querySelector(
      'input[placeholder="Rosa"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(nombre, "Rosa M.");
      nombre.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(botonPorTexto("Guardar")!);
    expect(avisos()).toContain("ok: Guardado.");
  });
});
