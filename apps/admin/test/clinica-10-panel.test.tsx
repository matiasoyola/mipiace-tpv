// clinica-10 · LO QUE LA PASADA DEL 27-10 ENCONTRÓ EN EL PANEL.
//
//   · **H1** · guardar Personal sin cambiar nada no mandaba nada, así
//     que el puente de clinica-9 (5) —guardar escribe también
//     `users.alias`— no llegaba a cruzarse en una cuenta que ya existía:
//     no hay NADA que cambiar en el formulario de Rosario, su nombre de
//     agenda ya es «Rosario». La pasada lo resolvió cambiando el nombre,
//     guardando, y volviéndolo a cambiar.
//   · **H2** · Agenda · Catálogo decía «Todavía no has asignado ninguna
//     categoría» en una cuenta cuyo check «Catálogo clínico completo»
//     estaba verde, y ese check cuenta exactamente esas filas. Era un
//     `.catch(() => setItems([]))`: un fallo de lectura pintado como una
//     lista vacía.
//   · **Cajeros**, en una cuenta de una sola persona, pedía «crea al
//     menos un cajero para que pueda iniciar sesión en el TPV» — y
//     Rosario entra con su propio PIN desde el primer día.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ api: vi.fn(), rol: { valor: "OWNER" } }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return {
    ...actual,
    api: apiMock.api,
    readEffectiveAuth: () => ({ canEdit: true }),
    readCurrentRole: () => apiMock.rol.valor,
    clearTokens: () => {},
  };
});

vi.mock("../src/AdminShell.js", () => ({
  AdminShell: ({ children }: { children: unknown }) => children,
}));

import { ApiError } from "../src/api.js";
import { __resetCapacidadesParaTests } from "../src/capabilities.js";
import { AgendaCatalogPage } from "../src/pages/AgendaCatalogPage.js";
import { CashiersPage } from "../src/pages/CashiersPage.js";
import { StaffPage } from "../src/pages/StaffPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | undefined;
let llamadas: Array<{ path: string; method: string; body: any }>;

/**
 * Rosario, la propietaria de la «Clínica demo» TAL COMO ESTABA el 27-10:
 * «Nombre en la agenda» = Rosario, y el `alias` todavía con el email,
 * que es lo que las seis superficies pintaban.
 */
const ROSARIO = {
  userId: "u-rosario",
  alias: "m.oyola+clinica-demo",
  email: "m.oyola+clinica-demo@mipiace.es",
  role: "OWNER" as const,
  profile: {
    userId: "u-rosario",
    displayName: "Rosario",
    active: true,
    color: "#e8663c",
  },
  serviceIds: [] as string[],
  skillCount: 0,
  clinica: {
    esSanitario: true,
    colegiado: "45/0123",
    alcance: "ALL" as const,
    puesto: "propietaria" as const,
  },
};

/** Las categorías del catálogo clínico de la demo, en el servidor. */
let tiposDeCategoria: Array<Record<string, unknown>>;
/** Rutas que fallan al leer, por su final. */
let fallanAlLeer: string[];
let personal: Array<Record<string, unknown>>;
let cajeros: Array<Record<string, unknown>>;

beforeEach(() => {
  llamadas = [];
  fallanAlLeer = [];
  personal = [{ ...ROSARIO }];
  cajeros = [];
  apiMock.rol.valor = "OWNER";
  tiposDeCategoria = [
    { id: "t1", slug: "consulta", visitType: "GENERAL" },
    { id: "t2", slug: "quiropodia", visitType: "QUIROPODIA" },
  ];
  apiMock.api.mockReset();
  apiMock.api.mockImplementation(
    async (path: string, init?: { method?: string; body?: any }) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") llamadas.push({ path, method, body: init?.body });
      if (fallanAlLeer.some((f) => path.endsWith(f))) {
        // La 404 de `ensureClinicaEnabled`, literal: es la que el panel
        // recibía al abrirse desde una sesión de super-admin.
        throw new ApiError(404, "NOT_FOUND", `Route GET:${path} not found`);
      }
      if (path === "/admin/tenant/settings") {
        return {
          settings: { agendaEnabled: true, clinicalRecordsEnabled: true },
        };
      }
      if (path === "/staff") return { staff: personal.map((p) => ({ ...p })) };
      if (path === "/staff/services") return { services: [] };
      if (/\/staff\/[^/]+\/shifts$/.test(path)) return { shifts: [] };
      if (/\/clinica\/clinicians\/[^/]+\/clients$/.test(path)) {
        return { clients: [] };
      }
      if (path.endsWith("/clinica")) {
        return { clinica: {}, sesionesInvalidadas: false };
      }
      if (path === "/admin/tag-visit-types") {
        return { items: tiposDeCategoria };
      }
      if (path === "/cashiers") return { cashiers: cajeros };
      if (path === "/auth/me") {
        return {
          tenant: {
            name: "Clínica demo",
            hasHoldedKey: false,
            holdedEnabled: false,
            facturaDesde: null,
            businessType: "SERVICES",
          },
        };
      }
      if (path === "/services/scheduling") return { items: [] };
      if (path === "/resources") return { resources: [] };
      if (path.startsWith("/admin/tag-")) return { items: [] };
      return {};
    },
  );
  __resetCapacidadesParaTests();
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

async function pintar(pagina: React.ReactNode) {
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter>{pagina}</MemoryRouter>);
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

function texto(): string {
  return container.textContent ?? "";
}

function escrituras() {
  return llamadas.map((l) => `${l.method} ${l.path}`);
}

// ── H1 · Guardar escribe el alias aunque el nombre no cambie ────────

describe("clinica-10 (H1) · Personal escribe el alias sin tocar el nombre", () => {
  it("Guardar manda el perfil cuando el alias todavía es el email", async () => {
    await pintar(<StaffPage />);
    await click(
      [...container.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(ROSARIO.email),
      )!,
    );
    await click(boton("Guardar")!);
    expect(escrituras()).toContain(`PUT /staff/${ROSARIO.userId}`);
    // Y con el nombre que ya estaba: lo que arregla el guardado es la
    // OTRA columna, no ésta.
    expect(llamadas.at(-1)?.body?.displayName).toBe("Rosario");
  });

  it("y cuando las dos columnas ya coinciden, no manda nada", async () => {
    // Ésta es la regla que no se puede perder: lo que no está sucio no
    // se manda. Con el alias ya escrito, «Guardar» sin tocar nada no
    // tiene por qué llamar a tres rutas.
    personal = [{ ...ROSARIO, alias: "Rosario" }];
    await pintar(<StaffPage />);
    await click(
      [...container.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(ROSARIO.email),
      )!,
    );
    await click(boton("Guardar")!);
    expect(escrituras()).not.toContain(`PUT /staff/${ROSARIO.userId}`);
  });
});

// ── H2 · Leer mal no es estar vacío ─────────────────────────────────

describe("clinica-10 (H2) · Agenda · Catálogo y los tipos de visita", () => {
  it("con categorías, las enseña", async () => {
    await pintar(<AgendaCatalogPage />);
    expect(texto()).toContain("quiropodia");
    expect(texto()).not.toContain("Todavía no has asignado ninguna categoría");
  });

  it("si la lectura FALLA no dice que no hay ninguna", async () => {
    fallanAlLeer = ["/admin/tag-visit-types"];
    await pintar(<AgendaCatalogPage />);
    expect(texto()).not.toContain("Todavía no has asignado ninguna categoría");
    expect(
      container.querySelector('[data-test="tipos-no-se-pudieron-leer"]'),
    ).not.toBeNull();
    expect(texto()).toContain("No se han podido leer los tipos de visita");
  });

  it("y vacío de verdad sí lo dice", async () => {
    tiposDeCategoria = [];
    await pintar(<AgendaCatalogPage />);
    expect(texto()).toContain("Todavía no has asignado ninguna categoría");
    expect(
      container.querySelector('[data-test="tipos-no-se-pudieron-leer"]'),
    ).toBeNull();
  });
});

// ── Cajeros en una clínica de una sola persona ──────────────────────

describe("clinica-10 · Cajeros no pide crear uno para poder entrar", () => {
  it("sin cajeros, dice que la propietaria entra con su PIN", async () => {
    await pintar(<CashiersPage />);
    expect(texto()).not.toContain("Crea al menos un cajero");
    expect(texto()).toContain("No hay nadie más con acceso al TPV");
    expect(texto()).toContain("Tú entras con tu propio PIN");
  });

  it("y a un encargado le dice de quién es ese PIN", async () => {
    apiMock.rol.valor = "MANAGER";
    await pintar(<CashiersPage />);
    expect(texto()).toContain("El propietario entra con su propio PIN");
  });
});
