// clinica-8 (fase B, 16) · UN SOLO GUARDADO POR TARJETA.
//
// Auditoría del 18-10, punto 23: «Personal: cuatro botones de guardar;
// sin "marcar todos" en servicios» — y punto 22: «"Crear turno" sin
// "Válido desde" no hace nada y no avisa».
//
// Lo que cuestan cuatro botones no es estética. Se cambia el nombre de
// la agenda, se marca «Es sanitario», se marcan los servicios, se pulsa
// UN botón y los otros dos cambios se quedan en la pantalla: la dueña
// sale creyendo que guardó. Es exactamente la forma de fallo que la fase
// A arregló para el aviso (un guardado mudo) con el botón que no era.
//
// Lo que este banco fija:
//
//   1. UN botón guarda las secciones tocadas, en el orden en que
//      dependen unas de otras.
//   2. Lo que no se ha tocado NO se manda: tres rutas por cada toque
//      serían tres sitios donde fallar sin que nadie haya cambiado nada.
//   3. Si una falla, se dice CUÁL, y las siguientes no se mandan.
//   4. Dar de alta como profesional NO lo hace ese botón: marcar «Es
//      sanitario» a la propietaria no puede abrirle de paso una columna
//      en la agenda.
//   5. «Todos los servicios» y su contrario, de un toque.
//   6. «Válido desde» nace con hoy.

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
import { hoyEnElCentro, StaffPage } from "../src/pages/StaffPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const SERVICIOS = [
  { id: "s1", name: "Quiropodia básica" },
  { id: "s2", name: "Quiropodia completa" },
  { id: "s3", name: "Cura" },
];

/** Rosa, la propietaria, CON perfil de agenda (es la única podóloga). */
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

/** Marta, recién creada: SIN perfil de agenda. */
const MARTA = {
  ...ROSA,
  userId: "u-marta",
  alias: "Marta",
  email: "marta@clinicademo.es",
  role: "CASHIER" as const,
  profile: null as null | typeof ROSA.profile,
};

let container: HTMLDivElement;
let root: Root | undefined;
let llamadas: Array<{ path: string; method: string; body: any }>;
/** Rutas que tienen que fallar, por su final. */
let fallan: string[];
let personal: Array<Record<string, unknown>>;

beforeEach(() => {
  llamadas = [];
  fallan = [];
  personal = [{ ...ROSA }];
  apiMock.api.mockReset();
  apiMock.api.mockImplementation(
    async (path: string, init?: { method?: string; body?: any }) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") llamadas.push({ path, method, body: init?.body });
      if (fallan.some((f) => path.endsWith(f)) && method !== "GET") {
        throw new ApiError(400, "NO", "El servidor ha dicho que no.");
      }
      if (path === "/admin/tenant/settings") {
        return {
          settings: { agendaEnabled: true, clinicalRecordsEnabled: true },
        };
      }
      if (path === "/staff") return { staff: personal.map((p) => ({ ...p })) };
      if (path === "/staff/services") return { services: SERVICIOS };
      if (/\/staff\/[^/]+\/shifts$/.test(path)) return { shifts: [] };
      if (/\/clinica\/clinicians\/[^/]+\/clients$/.test(path)) {
        return { clients: [] };
      }
      if (path.endsWith("/clinica")) {
        return { clinica: {}, sesionesInvalidadas: false };
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

async function asentar() {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function pintar() {
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter>
        <StaffPage />
      </MemoryRouter>,
    );
  });
  await asentar();
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await asentar();
}

function boton(texto: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;
}

function escribir(el: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function abrir(email: string) {
  const cabecera = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(email),
  )!;
  await click(cabecera);
}

function casillaPorEtiqueta(texto: string): HTMLInputElement {
  return [...container.querySelectorAll("label")]
    .find((l) => l.textContent?.includes(texto))!
    .querySelector("input") as HTMLInputElement;
}

function resultado(): string {
  return (
    container.querySelector("[data-guardado]")?.textContent?.trim() ?? ""
  );
}

function escrituras() {
  return llamadas.map((l) => `${l.method} ${l.path}`);
}

// ── 1 · UNO solo, y guarda lo que se ha tocado ──────────────────────

describe("clinica-8 (16) · la tarjeta tiene UN botón de guardar", () => {
  it("no hay ni «Guardar perfil» ni «Guardar servicios»", async () => {
    await pintar();
    await abrir(ROSA.email);
    expect(boton("Guardar perfil")).toBeUndefined();
    expect(boton("Guardar servicios")).toBeUndefined();
    expect(boton("Guardar")).toBeDefined();
  });

  it("un solo toque guarda el PERFIL, la CLÍNICA y los SERVICIOS", async () => {
    await pintar();
    await abrir(ROSA.email);

    // Las tres secciones, tocadas.
    escribir(
      container.querySelector('input[placeholder="Rosa"]') as HTMLInputElement,
      "Rosa M.",
    );
    await act(async () => {
      casillaPorEtiqueta("Es sanitario").click();
    });
    escribir(
      container.querySelector("[data-colegiado]") as HTMLInputElement,
      "45-0123",
    );
    await act(async () => {
      casillaPorEtiqueta("Quiropodia básica").click();
    });

    await click(boton("Guardar")!);

    // Las tres rutas, y EN ESTE ORDEN: el perfil primero, porque darla de
    // alta es lo que hace existir los servicios que van después.
    expect(escrituras()).toEqual([
      "PUT /staff/u-rosa",
      "PATCH /staff/u-rosa/clinica",
      "PUT /staff/u-rosa/skills",
    ]);
    expect(llamadas[0]!.body.displayName).toBe("Rosa M.");
    expect(llamadas[1]!.body.colegiado).toBe("45-0123");
    expect(llamadas[2]!.body.serviceIds).toEqual(["s1"]);
    expect(resultado()).toBe("Guardado.");
  });

  it("lo que NO se ha tocado no se manda", async () => {
    await pintar();
    await abrir(ROSA.email);
    await act(async () => {
      casillaPorEtiqueta("Quiropodia básica").click();
    });
    await click(boton("Guardar")!);
    expect(escrituras()).toEqual(["PUT /staff/u-rosa/skills"]);
  });

  it("sin tocar nada, el botón no manda nada y lo deja dicho", async () => {
    await pintar();
    await abrir(ROSA.email);
    await click(boton("Guardar")!);
    expect(escrituras()).toEqual([]);
    expect(resultado()).toBe("Guardado.");
  });

  it("si una sección falla, se dice CUÁL y las de después no se mandan", async () => {
    fallan = ["/clinica"];
    await pintar();
    await abrir(ROSA.email);
    escribir(
      container.querySelector('input[placeholder="Rosa"]') as HTMLInputElement,
      "Rosa M.",
    );
    await act(async () => {
      casillaPorEtiqueta("Es sanitario").click();
    });
    escribir(
      container.querySelector("[data-colegiado]") as HTMLInputElement,
      "45/0123",
    );
    await act(async () => {
      casillaPorEtiqueta("Cura").click();
    });

    await click(boton("Guardar")!);

    // El perfil SÍ entró, la clínica falló, los servicios no se tocaron.
    expect(escrituras()).toEqual([
      "PUT /staff/u-rosa",
      "PATCH /staff/u-rosa/clinica",
    ]);
    // Y se dice con el nombre de la sección delante: «no se pudo
    // guardar» a secas no dice si entró el nombre y no el colegiado.
    expect(resultado()).toContain("la historia clínica");
    expect(resultado()).toContain("El servidor ha dicho que no.");
  });

  it("lo que falta en la pantalla se dice SIN su nombre delante", async () => {
    // «Falta el nº de colegiado…» ya está escrito para la persona: no se
    // lee mejor con «la historia clínica:» por delante.
    await pintar();
    await abrir(ROSA.email);
    await act(async () => {
      casillaPorEtiqueta("Es sanitario").click();
    });
    await click(boton("Guardar")!);
    expect(escrituras()).toEqual([]);
    expect(resultado()).toMatch(/^Falta el nº de colegiado/);
  });
});

// ── 2 · El alta es OTRA cosa, y por eso tiene su botón ──────────────

describe("clinica-8 (16) · dar de alta no es guardar", () => {
  it("sin perfil, el alta tiene su propio botón y el guardado no la hace", async () => {
    personal = [{ ...MARTA }];
    await pintar();
    await abrir(MARTA.email);
    expect(boton("Dar de alta como profesional")).toBeDefined();

    // Se la marca sanitaria y se guarda: lo que tiene que pasar es el
    // PATCH de la clínica y NADA MÁS. Si el guardado diera de alta,
    // Marta aparecería con columna en la agenda sin que nadie lo pidiera.
    //
    // A una cajera se le ofrecen los TRES puestos en vez de la casilla
    // (la casilla es para la propietaria y el encargado, que no cambian
    // de puesto desde aquí).
    await click(boton("Cajero-sanitario")!);
    escribir(
      container.querySelector("[data-colegiado]") as HTMLInputElement,
      "45/0123",
    );
    await click(boton("Guardar")!);
    expect(escrituras()).toEqual(["PATCH /staff/u-marta/clinica"]);
  });

  it("y el alta, cuando se pide, sí escribe el perfil", async () => {
    personal = [{ ...MARTA }];
    await pintar();
    await abrir(MARTA.email);
    await click(boton("Dar de alta como profesional")!);
    expect(escrituras()).toEqual(["PUT /staff/u-marta"]);
  });

  it("con perfil ya hecho, el botón del alta no está", async () => {
    await pintar();
    await abrir(ROSA.email);
    expect(boton("Dar de alta como profesional")).toBeUndefined();
  });
});

// ── 3 · «Todos los servicios» ───────────────────────────────────────

describe("clinica-8 (16) · «Todos los servicios», de un toque", () => {
  it("marca los tres y lo cuenta", async () => {
    await pintar();
    await abrir(ROSA.email);
    expect(container.textContent).toContain("0 de 3 marcados");
    await click(
      container.querySelector('[data-test="todos-los-servicios"]')!,
    );
    expect(container.textContent).toContain("3 de 3 marcados");
    await click(boton("Guardar")!);
    expect(llamadas[0]!.body.serviceIds.sort()).toEqual(["s1", "s2", "s3"]);
  });

  it("con todos marcados, el botón pasa a «Ninguno»", async () => {
    // Empezar de cero para marcar tres cuesta los mismos toques al
    // revés, así que el interruptor va en los dos sentidos.
    await pintar();
    await abrir(ROSA.email);
    const interruptor = () =>
      container.querySelector('[data-test="todos-los-servicios"]')!;
    await click(interruptor());
    expect(interruptor().textContent).toBe("Ninguno");
    await click(interruptor());
    expect(container.textContent).toContain("0 de 3 marcados");
    expect(interruptor().textContent).toBe("Todos los servicios");
  });
});

// ── 4 · «Válido desde» nace con hoy ─────────────────────────────────

describe("clinica-8 (16) · el turno nuevo arranca con la fecha de hoy", () => {
  it("el campo viene puesto, en la zona del CENTRO", () => {
    // 00:30 del 20 en Madrid son las 22:30 del 19 en UTC. Lo que manda
    // es el calendario del centro, que es contra el que se compara el
    // turno: con la fecha del navegador en UTC, el turno de la madrugada
    // nacería rigiendo desde ayer.
    expect(hoyEnElCentro(new Date("2026-10-19T22:30:00.000Z"))).toBe(
      "2026-10-20",
    );
    expect(hoyEnElCentro(new Date("2026-10-19T09:00:00.000Z"))).toBe(
      "2026-10-19",
    );
  });

  it("y el formulario del turno lo trae escrito", async () => {
    await pintar();
    await abrir(ROSA.email);
    await click(boton("+ Añadir turno")!);
    const campos = [...container.querySelectorAll('input[type="date"]')];
    expect((campos[0] as HTMLInputElement).value).toBe(hoyEnElCentro());
    // Y «Válido hasta» sigue vacío: un turno sin fin es lo normal.
    expect((campos[1] as HTMLInputElement).value).toBe("");
  });
});
