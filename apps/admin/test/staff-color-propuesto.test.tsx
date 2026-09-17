// B-reservas-mostrador · el día en que Sole da de alta a su equipo.
//
// El filo: el formulario de perfil proponía `COLOR_PRESETS[0]` a TODA
// profesional sin perfil. Se dan de alta SOLE, ANA e ISA, nadie toca el
// selector —que es lo normal: el campo ya venía relleno— y las tres quedan en
// el mismo coral. En la agenda, el tinte del frente 2 las pinta idénticas: el
// color deja de distinguir de quién es cada cita, que es para lo único que
// está.
//
// Aquí se fija la regla (el primer color libre) y, sobre la pantalla de
// verdad, que las tres altas seguidas salen con tres colores distintos.
//
// Mismo patrón sin testing-library que el resto del repo: createRoot + act.

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

import { StaffPage } from "../src/pages/StaffPage.js";
import {
  COLOR_PRESETS,
  colorPropuesto,
  coloresEnUso,
} from "../src/pages/StaffPage.colors.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ── La regla, sin pintar nada ─────────────────────────────────────────

describe("colorPropuesto · el primero de la paleta que esté libre", () => {
  it("sin nadie dado de alta, el primero", () => {
    expect(colorPropuesto([])).toBe(COLOR_PRESETS[0]);
  });

  it("con el primero pillado, el segundo", () => {
    expect(colorPropuesto([COLOR_PRESETS[0]!])).toBe(COLOR_PRESETS[1]);
  });

  it("con los dos primeros pillados, el tercero", () => {
    expect(colorPropuesto([COLOR_PRESETS[0]!, COLOR_PRESETS[1]!])).toBe(
      COLOR_PRESETS[2],
    );
  });

  it("no le importa el orden en que vengan", () => {
    expect(colorPropuesto([COLOR_PRESETS[2]!, COLOR_PRESETS[0]!])).toBe(
      COLOR_PRESETS[1],
    );
  });

  it("coge el HUECO, no el siguiente al último", () => {
    // Si el segundo se dio de baja y su color quedó libre, se reusa: la
    // regla es «el primero libre», no «el siguiente».
    expect(
      colorPropuesto([COLOR_PRESETS[0]!, COLOR_PRESETS[2]!, COLOR_PRESETS[3]!]),
    ).toBe(COLOR_PRESETS[1]);
  });

  it("con TODOS usados, vuelve a empezar por el principio", () => {
    expect(colorPropuesto(COLOR_PRESETS)).toBe(COLOR_PRESETS[0]);
  });

  it("un color de fuera de la paleta no tapa ninguno", () => {
    // Alguien eligió un color con el `input type=color`: ocupa ese, no un
    // preset.
    expect(colorPropuesto(["#123456"])).toBe(COLOR_PRESETS[0]);
  });

  it("compara sin mayúsculas ni espacios: el color viene de la BD como texto", () => {
    expect(colorPropuesto([COLOR_PRESETS[0]!.toUpperCase()])).toBe(
      COLOR_PRESETS[1],
    );
    expect(colorPropuesto([` ${COLOR_PRESETS[0]!} `])).toBe(COLOR_PRESETS[1]);
  });

  it("los nulos y los vacíos no ocupan nada", () => {
    expect(colorPropuesto([null, undefined, "", "   "])).toBe(COLOR_PRESETS[0]);
  });
});

describe("coloresEnUso · quién ocupa color", () => {
  const fila = (userId: string, color: string | null, active = true) => ({
    userId,
    profile: { active, color },
  });

  it("cuenta a las profesionales con perfil", () => {
    expect(
      coloresEnUso([fila("a", "#e8663c"), fila("b", "#3c8ce8")], "z"),
    ).toEqual(["#e8663c", "#3c8ce8"]);
  });

  it("NO cuenta a una dada de baja: sin citas en la rejilla, su color no estorba", () => {
    expect(
      coloresEnUso([fila("a", "#e8663c", false), fila("b", "#3c8ce8")], "z"),
    ).toEqual(["#3c8ce8"]);
  });

  it("NO cuenta a quien todavía no tiene perfil", () => {
    expect(
      coloresEnUso([{ userId: "a", profile: null }, fila("b", "#3c8ce8")], "z"),
    ).toEqual(["#3c8ce8"]);
  });

  it("NO se cuenta a sí misma: abrir su editor no ocupa su propio color", () => {
    expect(coloresEnUso([fila("a", "#e8663c")], "a")).toEqual([]);
  });
});

// ── La pantalla de verdad ─────────────────────────────────────────────

interface Perfil {
  userId: string;
  displayName: string;
  active: boolean;
  color: string | null;
}
function usuario(userId: string, alias: string, profile: Perfil | null) {
  return {
    userId,
    alias,
    email: `${alias.toLowerCase()}@sole.local`,
    role: "CASHIER" as const,
    profile,
    serviceIds: [] as string[],
    skillCount: 0,
  };
}
function perfil(userId: string, displayName: string, color: string | null): Perfil {
  return { userId, displayName, active: true, color };
}

let container: HTMLDivElement;
// `undefined` mientras el test no haya pintado: la mitad de arriba de este
// fichero son funciones puras y no montan nada.
let root: Root | undefined;
let staff: ReturnType<typeof usuario>[];
let guardados: Array<{ userId: string; color: string }>;

beforeEach(() => {
  // El día en que Sole enciende la agenda: tres cajeras, ninguna con perfil
  // de agenda todavía.
  staff = [
    usuario("u-sole", "SOLE", null),
    usuario("u-ana", "ANA", null),
    usuario("u-isa", "ISA", null),
  ];
  guardados = [];
  apiMock.api.mockReset();
  apiMock.api.mockImplementation(
    async (path: string, init?: { method?: string; body?: { color?: string } }) => {
      if (path === "/admin/tenant/settings") {
        return { settings: { agendaEnabled: true } };
      }
      // Copia, como haría el servidor: así el `setStaff` de la pantalla
      // dispara un repintado de verdad y no se pasa por la igualdad de
      // referencias.
      if (path === "/staff") return { staff: staff.map((u) => ({ ...u })) };
      if (path === "/staff/services") return { services: [] };
      const guardar = /^\/staff\/([^/]+)$/.exec(path);
      if (guardar && init?.method === "PUT") {
        const userId = guardar[1]!;
        const color = init.body!.color!;
        guardados.push({ userId, color });
        // El servidor devuelve el perfil creado; la pantalla se refresca.
        const fila = staff.find((u) => u.userId === userId)!;
        fila.profile = perfil(userId, fila.alias!, color);
        return { profile: fila.profile };
      }
      throw new Error(`ruta no mockeada: ${path}`);
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container.remove();
});

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <StaffPage />
      </MemoryRouter>,
    );
  });
  await settle();
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

/** Abre la tarjeta de una profesional por su nombre. */
async function abrir(nombre: string) {
  const cabecera = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(nombre),
  );
  if (!cabecera) throw new Error(`no hay tarjeta de ${nombre}`);
  await click(cabecera);
}

/** El color que el editor abierto trae PUESTO: el preset con el borde
 *  marcado. Se lee de la pantalla, no de un estado interno. */
function colorMarcado(): string | null {
  const marcado = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Color "]'),
  ).find((b) => b.className.includes("border-mipiace-ink"));
  return marcado ? marcado.getAttribute("aria-label")!.replace("Color ", "") : null;
}

async function guardar() {
  // La etiqueta cambia según tenga perfil o no: «Dar de alta como
  // profesional» la primera vez, «Guardar perfil» después.
  const btn = Array.from(container.querySelectorAll("button")).find((b) => {
    const t = (b.textContent ?? "").trim();
    return t === "Guardar perfil" || t === "Dar de alta como profesional";
  });
  if (!btn) throw new Error("no hay botón de guardar el perfil");
  await click(btn);
}

describe("dar de alta a SOLE, ANA e ISA sin tocar el color", () => {
  it("las tres salen con TRES colores distintos", async () => {
    await render();

    for (const nombre of ["SOLE", "ANA", "ISA"]) {
      await abrir(nombre);
      await guardar();
      await abrir(nombre); // cierra la tarjeta
    }

    expect(guardados).toHaveLength(3);
    const colores = guardados.map((g) => g.color);
    expect(new Set(colores).size).toBe(3);
    // Y en el orden de la paleta: el primero libre cada vez.
    expect(colores).toEqual([
      COLOR_PRESETS[0],
      COLOR_PRESETS[1],
      COLOR_PRESETS[2],
    ]);
  });

  it("la primera propone el primero de la paleta", async () => {
    await render();
    await abrir("SOLE");
    expect(colorMarcado()).toBe(COLOR_PRESETS[0]);
  });

  it("con SOLE ya en coral, a ANA se le propone el SIGUIENTE", async () => {
    staff[0]!.profile = perfil("u-sole", "SOLE", COLOR_PRESETS[0]!);
    await render();
    await abrir("ANA");
    expect(colorMarcado()).toBe(COLOR_PRESETS[1]);
  });

  it("con SOLE y ANA puestas, a ISA le toca el tercero", async () => {
    staff[0]!.profile = perfil("u-sole", "SOLE", COLOR_PRESETS[0]!);
    staff[1]!.profile = perfil("u-ana", "ANA", COLOR_PRESETS[1]!);
    await render();
    await abrir("ISA");
    expect(colorMarcado()).toBe(COLOR_PRESETS[2]);
  });

  it("EL COLOR YA GUARDADO NO SE TOCA, aunque lo comparta con otra", async () => {
    // Dos profesionales en el mismo color de antes de este cambio: abrir sus
    // editores tiene que enseñar EL SUYO, no proponerles uno nuevo. Esto no
    // repinta a nadie.
    staff[0]!.profile = perfil("u-sole", "SOLE", COLOR_PRESETS[3]!);
    staff[1]!.profile = perfil("u-ana", "ANA", COLOR_PRESETS[3]!);
    await render();

    await abrir("SOLE");
    expect(colorMarcado()).toBe(COLOR_PRESETS[3]);
    await abrir("SOLE");

    await abrir("ANA");
    expect(colorMarcado()).toBe(COLOR_PRESETS[3]);
  });

  it("una profesional DE BAJA no le quita el color a la siguiente", async () => {
    staff[0]!.profile = { ...perfil("u-sole", "SOLE", COLOR_PRESETS[0]!), active: false };
    await render();
    await abrir("ANA");
    // Sole no tiene citas en la rejilla: su color no estorba.
    expect(colorMarcado()).toBe(COLOR_PRESETS[0]);
  });
});
