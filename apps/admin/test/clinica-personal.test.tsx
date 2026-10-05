// clinica-1 · la pantalla de Personal en una clínica.
//
// Lo que se fija aquí:
//
//   1. **En un tenant NO clínico, Personal es la de hoy.** Ni una palabra
//      de sanitarios, ni colegiado, ni alcance. Es la garantía que
//      protege a Sole y a los otros catorce.
//   2. Los TRES puestos, a un toque, y el colegiado apareciendo al marcar
//      sanitario.
//   3. El colegiado es obligatorio: sin él, Guardar no se puede pulsar.
//      («opcional en la base, exigido al marcar sanitario» — y aquí se ve
//      antes de llegar al 400.)
//   4. La propietaria NO elige puesto: se marca o no. Cambiarle el rol de
//      negocio a la dueña no es cosa de esta pantalla.
//   5. La lista de pacientes dice de dónde vino cada uno, y revocar llama
//      al DELETE del acceso.
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

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type Puesto =
  | "cajero"
  | "cajero-sanitario"
  | "sanitario"
  | "propietaria"
  | "propietaria-sanitaria";

function fila(opts: {
  userId: string;
  alias: string;
  role: "OWNER" | "MANAGER" | "CASHIER" | "CLINICIAN";
  esSanitario: boolean;
  colegiado?: string | null;
  alcance?: "ALL" | "SELECTION";
  puesto: Puesto;
}) {
  return {
    userId: opts.userId,
    alias: opts.alias,
    email: `${opts.alias.toLowerCase()}@clinica.local`,
    role: opts.role,
    profile: {
      userId: opts.userId,
      displayName: opts.alias,
      active: true,
      color: "#e8663c",
    },
    serviceIds: [] as string[],
    skillCount: 0,
    clinica: {
      esSanitario: opts.esSanitario,
      colegiado: opts.colegiado ?? null,
      alcance: opts.alcance ?? "SELECTION",
      puesto: opts.puesto,
    },
  };
}

let container: HTMLDivElement;
let root: Root | undefined;
let clinicaEncendida = true;
let staff: ReturnType<typeof fila>[];
let pacientes: Array<{
  accessId: string;
  clientId: string;
  name: string;
  source: "APPOINTMENT" | "MANUAL";
  grantedAt: string;
}>;
let patches: Array<{ path: string; body: unknown }>;
let deletes: string[];

beforeEach(() => {
  clinicaEncendida = true;
  staff = [
    fila({
      userId: "u-marta",
      alias: "MARTA",
      role: "CASHIER",
      esSanitario: false,
      puesto: "cajero",
    }),
    fila({
      userId: "u-lucia",
      alias: "LUCIA",
      role: "CLINICIAN",
      esSanitario: true,
      colegiado: "28/1234",
      puesto: "sanitario",
    }),
    fila({
      userId: "u-pilar",
      alias: "PILAR",
      role: "OWNER",
      esSanitario: false,
      puesto: "propietaria",
    }),
  ];
  pacientes = [
    {
      accessId: "a-1",
      clientId: "c-1",
      name: "Antonio Gil",
      source: "APPOINTMENT",
      grantedAt: "2026-10-05T09:00:00.000Z",
    },
    {
      accessId: "a-2",
      clientId: "c-2",
      name: "Carmen Ruiz",
      source: "MANUAL",
      grantedAt: "2026-10-04T09:00:00.000Z",
    },
  ];
  patches = [];
  deletes = [];
  apiMock.api.mockReset();
  apiMock.api.mockImplementation(
    async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path === "/admin/tenant/settings") {
        return {
          settings: {
            agendaEnabled: true,
            clinicalRecordsEnabled: clinicaEncendida,
          },
        };
      }
      if (path === "/staff") return { staff: staff.map((s) => ({ ...s })) };
      if (path === "/staff/services") return { services: [] };
      if (path.endsWith("/clinica") && init?.method === "PATCH") {
        patches.push({ path, body: init.body });
        return { clinica: {}, sesionesInvalidadas: false };
      }
      if (/\/clinica\/clinicians\/[^/]+\/clients$/.test(path)) {
        if (init?.method === "POST") return { created: true, accessId: "a-3" };
        return { clients: pacientes };
      }
      if (init?.method === "DELETE") {
        deletes.push(path);
        return { revoked: true };
      }
      if (path.startsWith("/clients?query=")) return { clients: [] };
      // Las fichas de este banco tienen perfil de agenda, así que
      // `ShiftsEditor` se monta y pide los turnos. Devolver `{}` lo
      // reventaba — no es cosa del bloque, es que el doble estaba corto.
      if (/\/staff\/[^/]+\/shifts$/.test(path)) return { shifts: [] };
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
}

// React 19 no ve un `el.value = x` a secas en un input controlado: hay
// que pasar por el setter del prototipo. Mismo truco que usa Testing
// Library por dentro, y que ya usa `catalogo-local-pantalla.test.tsx`.
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

async function abrirFicha(alias: string) {
  const cabecera = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(alias),
  )!;
  await act(async () => {
    cabecera.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// ── 1 · el tenant NO clínico no nota nada ───────────────────────────

describe("clinica-1 · en un tenant sin clínica, Personal es la de hoy", () => {
  it("ni sanitarios, ni colegiado, ni alcance", async () => {
    clinicaEncendida = false;
    await pintar();
    await abrirFicha("MARTA");
    const texto = container.textContent ?? "";
    expect(texto).not.toContain("Historia clínica");
    expect(texto).not.toContain("colegiado");
    expect(texto).not.toContain("Sólo los suyos");
    expect(container.querySelector("[data-colegiado]")).toBeNull();
  });

  it("y la cabecera sigue diciendo el puesto de siempre", async () => {
    clinicaEncendida = false;
    await pintar();
    expect(container.textContent).toContain("Cajero");
    expect(container.textContent).toContain("Propietaria");
  });
});

// ── 2, 3 · los tres puestos y el colegiado ──────────────────────────

describe("clinica-1 · los tres puestos, a un toque", () => {
  it("la ficha de una cajera ofrece los TRES", async () => {
    await pintar();
    await abrirFicha("MARTA");
    expect(botonPorTexto("Cajero")).toBeDefined();
    expect(botonPorTexto("Cajero-sanitario")).toBeDefined();
    expect(botonPorTexto("Sanitario")).toBeDefined();
  });

  it("una cajera NO sanitaria no tiene colegiado ni alcance a la vista", async () => {
    await pintar();
    await abrirFicha("MARTA");
    expect(container.querySelector("[data-colegiado]")).toBeNull();
    expect(botonPorTexto("Sólo los suyos")).toBeUndefined();
  });

  it("al marcar «cajero-sanitario» aparecen el colegiado y el alcance", async () => {
    await pintar();
    await abrirFicha("MARTA");
    await act(async () => {
      botonPorTexto("Cajero-sanitario")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(container.querySelector("[data-colegiado]")).not.toBeNull();
    expect(botonPorTexto("Todos los pacientes")).toBeDefined();
    expect(botonPorTexto("Sólo los suyos")).toBeDefined();
  });

  it("SIN COLEGIADO no se puede guardar, y lo dice antes del 400", async () => {
    await pintar();
    await abrirFicha("MARTA");
    await act(async () => {
      botonPorTexto("Sanitario")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const guardar = botonPorTexto("Guardar")!;
    expect(guardar.disabled).toBe(true);
    expect(container.textContent).toContain("Hace falta");
    // Y no se ha mandado nada.
    expect(patches).toHaveLength(0);
  });

  it("con colegiado, Guardar manda el puesto, la marca y el alcance", async () => {
    await pintar();
    await abrirFicha("MARTA");
    await act(async () => {
      botonPorTexto("Sanitario")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const input = container.querySelector<HTMLInputElement>(
      "[data-colegiado]",
    )!;
    await act(async () => {
      escribir(input, "28/9999");
    });
    await act(async () => {
      botonPorTexto("Guardar")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(patches).toHaveLength(1);
    expect(patches[0]!.path).toBe("/staff/u-marta/clinica");
    expect(patches[0]!.body).toEqual({
      puesto: "CLINICIAN",
      esSanitario: true,
      colegiado: "28/9999",
      alcance: "SELECTION",
    });
  });
});

// ── 4 · la propietaria se marca, no cambia de puesto ────────────────

describe("clinica-1 · la propietaria y el encargado se marcan y nada más", () => {
  it("no se le ofrecen los tres puestos: una casilla", async () => {
    await pintar();
    await abrirFicha("PILAR");
    expect(botonPorTexto("Cajero-sanitario")).toBeUndefined();
    expect(container.textContent).toContain("Es sanitario");
  });

  it("y al guardarla NO se manda `puesto`", async () => {
    await pintar();
    await abrirFicha("PILAR");
    await act(async () => {
      botonPorTexto("Guardar")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).not.toHaveProperty("puesto");
  });
});

// ── 5 · la lista de pacientes ───────────────────────────────────────

describe("clinica-1 · sus pacientes, con el origen de cada uno", () => {
  it("la lista no se pide hasta que se abre", async () => {
    await pintar();
    await abrirFicha("LUCIA");
    const pedidas = apiMock.api.mock.calls.filter((c) =>
      String(c[0]).includes("/clinica/clinicians/"),
    );
    expect(pedidas).toHaveLength(0);
  });

  it("al abrirla, dice de dónde vino cada paciente", async () => {
    await pintar();
    await abrirFicha("LUCIA");
    const toggle = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Sus pacientes"),
    )!;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const texto = container.textContent ?? "";
    expect(texto).toContain("Antonio Gil");
    expect(texto).toContain("De la agenda");
    expect(texto).toContain("Carmen Ruiz");
    expect(texto).toContain("A mano");
  });

  it("revocar llama al DELETE del acceso, y avisa de que no borra nada", async () => {
    await pintar();
    await abrirFicha("LUCIA");
    const toggle = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Sus pacientes"),
    )!;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Revocar no borra nada");
    const revocar = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent?.trim() === "Revocar",
    );
    expect(revocar).toHaveLength(2);
    await act(async () => {
      revocar[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(deletes).toEqual(["/clinica/clinicians/u-lucia/clients/c-1"]);
  });

  it("una sanitaria con alcance ALL no tiene lista: ve todas", async () => {
    staff[1] = fila({
      userId: "u-lucia",
      alias: "LUCIA",
      role: "CLINICIAN",
      esSanitario: true,
      colegiado: "28/1234",
      alcance: "ALL",
      puesto: "sanitario",
    });
    await pintar();
    await abrirFicha("LUCIA");
    const toggle = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Sus pacientes"),
    );
    expect(toggle).toBeUndefined();
  });
});
