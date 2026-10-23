// primer-acceso · «GUARDAR Y DAR DE ALTA OTRO» (punto 5).
//
// Cuarenta y ocho residentes no se cargan volviendo cada vez a la lista.
// Lo que este banco fija:
//
//   1. `?alta=1` abre el formulario directo, que es lo que hace que la
//      tarjeta del panel vacío sea UN toque.
//   2. «Guardar y dar de alta otro» guarda, deja el formulario abierto y
//      en blanco, y lo DICE («… queda registrado»).
//   3. La lista se recarga por detrás, así que el contador de arriba no
//      se queda mintiendo mientras entran los cuarenta y ocho.
//   4. «Registrar ingreso» sigue cerrando, que es lo que se pulsa un día
//      normal.
//
// Sabotajes que pone en rojo:
//   · dejar el nombre del anterior en el formulario (nº 2)
//   · no recargar la lista (nº 3)
//   · que el botón de siempre deje el modal abierto (nº 4)

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const peticiones: Array<{ path: string; method: string; body?: any }> = [];
let residentes: any[] = [];

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return {
    ...actual,
    api: vi.fn(async (path: string, init?: any) => {
      peticiones.push({ path, method: init?.method ?? "GET", body: init?.body });
      if (path === "/residencia/edificio") {
        return {
          plantas: [
            {
              id: "p1",
              name: "Primera",
              sortOrder: 1,
              habitaciones: [
                {
                  id: "h1",
                  number: "101",
                  name: null,
                  camas: [{ id: "cama-1", label: "A", ocupante: null }],
                },
              ],
            },
          ],
        };
      }
      if (path.startsWith("/residencia/residentes") && init?.method == null) {
        return { residentes, alcance: "CENTRO" };
      }
      if (init?.method === "POST") {
        residentes = [
          ...residentes,
          {
            clientId: `c-${residentes.length + 1}`,
            firstName: init.body.firstName,
            lastName: init.body.lastName ?? null,
            admissionDate: init.body.admissionDate,
            dischargeDate: null,
            dependencyLevel: init.body.dependencyLevel,
            dependencyGrade: null,
            placeType: init.body.placeType,
            cama: null,
          },
        ];
        return {};
      }
      return {};
    }),
    readEffectiveAuth: () => ({ canEdit: true, role: "OWNER" }),
    clearTokens: () => {},
  };
});

vi.mock("../src/AdminShell.js", () => ({
  AdminShell: ({ children }: { children: unknown }) => children,
}));

const { ResidentesPage } = await import(
  "../src/pages/residencia/ResidentesPage.js"
);

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  peticiones.length = 0;
  residentes = [];
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  container.remove();
});

async function pintar(ruta: string): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[ruta]}>
        <ResidentesPage />
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function botonQueContiene(texto: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function pulsar(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function escribir(id: string, valor: string): Promise<void> {
  const input = container.querySelector(`#${id}`) as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Lo mínimo que el formulario exige: nombre, nivel y plaza. */
async function rellenar(nombre: string): Promise<void> {
  await escribir("nombre", nombre);
  await pulsar(botonQueContiene("Dependiente")!);
  await pulsar(botonQueContiene("Privada")!);
}

describe("el formulario de ingreso", () => {
  it("«?alta=1» lo abre directo, sin pasar por la lista", async () => {
    await pintar("/admin/residencia/residentes?alta=1");
    expect(container.textContent).toContain("Nuevo ingreso");
    expect(container.querySelector("#nombre")).toBeTruthy();
  });

  it("sin el parámetro, la lista se pinta cerrada", async () => {
    await pintar("/admin/residencia/residentes");
    expect(container.querySelector("#nombre")).toBeNull();
  });

  it("«Guardar y dar de alta otro» guarda, se queda abierto y en blanco", async () => {
    await pintar("/admin/residencia/residentes?alta=1");
    await rellenar("Dolores");
    await pulsar(botonQueContiene("Guardar y dar de alta otro")!);

    const altas = peticiones.filter(
      (p) => p.method === "POST" && p.path === "/residencia/residentes",
    );
    expect(altas).toHaveLength(1);
    expect(altas[0]!.body.firstName).toBe("Dolores");

    // Sigue abierto…
    expect(container.querySelector("#nombre")).toBeTruthy();
    // …en blanco…
    expect((container.querySelector("#nombre") as HTMLInputElement).value).toBe("");
    // …y lo dice, para que no parezca que el botón no ha hecho nada.
    expect(
      container.querySelector('[data-test="ultimo-ingreso"]')!.textContent,
    ).toContain("Dolores queda registrado");
    // …con el cursor ya en el nombre del siguiente: sin esto el modal se
    // queda abajo, junto a los botones, y cada residente cuesta un
    // scroll de vuelta.
    expect(document.activeElement).toBe(container.querySelector("#nombre"));

    // Y la lista se ha recargado por detrás.
    const lecturas = peticiones.filter(
      (p) => p.method === "GET" && p.path.startsWith("/residencia/residentes"),
    );
    expect(lecturas.length).toBeGreaterThan(1);
  });

  it("dos seguidos entran como dos, y el segundo no hereda el nombre", async () => {
    await pintar("/admin/residencia/residentes?alta=1");
    await rellenar("Dolores");
    await pulsar(botonQueContiene("Guardar y dar de alta otro")!);
    await rellenar("Amparo");
    await pulsar(botonQueContiene("Guardar y dar de alta otro")!);

    const altas = peticiones.filter(
      (p) => p.method === "POST" && p.path === "/residencia/residentes",
    );
    expect(altas.map((a) => a.body.firstName)).toEqual(["Dolores", "Amparo"]);
  });

  it("«Registrar ingreso» sigue cerrando el formulario", async () => {
    await pintar("/admin/residencia/residentes?alta=1");
    await rellenar("Dolores");
    await pulsar(botonQueContiene("Registrar ingreso")!);
    expect(container.querySelector("#nombre")).toBeNull();
  });
});
