// residencia-1 · LAS PANTALLAS DEL CENTRO.
//
// Lo que se fija aquí:
//
//   1. **Un tenant SIN residencia no ve nada de este bloque.** Ni en la
//      barra lateral, ni en Personal, ni entrando por la URL. Es la
//      garantía que protege a Sole, a la clínica de podología, a los bares
//      y a las tiendas.
//   2. Residentes: la lista con habitación, nivel y plaza; el aviso del
//      INGRESO PENDIENTE; y que el DNI **no sale en la lista**.
//   3. Edificio: el árbol de plantas → habitaciones → camas, con quién
//      ocupa cada una y el botón de emparejar la tablet.
//   4. Turnos: los tres de serie, el «ahora» y la etiqueta de que la
//      noche cruza medianoche.
//   5. Personal: los roles de cuidado y la zona, y que el colegiado se
//      pide **sólo si el rol lo exige** y antes de llegar al 400.
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

import { EdificioPage } from "../src/pages/residencia/EdificioPage.js";
import { ResidentesPage } from "../src/pages/residencia/ResidentesPage.js";
import { StaffPage } from "../src/pages/StaffPage.js";
import { TurnosPage } from "../src/pages/residencia/TurnosPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | undefined;
let residenciaEncendida = true;
let posts: Array<{ path: string; body: unknown }>;
let puts: Array<{ path: string; body: unknown }>;
let deletes: string[];

const CARMEN = "c-carmen";
const LUIS = "c-luis";
const PLANTA_1 = "p-1";
const PLANTA_2 = "p-2";

const EDIFICIO = {
  plantas: [
    {
      id: PLANTA_1,
      name: "Primera",
      sortOrder: 1,
      habitaciones: [
        {
          id: "h-112",
          number: "112",
          name: null,
          active: true,
          camas: [
            {
              id: "b-112a",
              label: "A",
              active: true,
              ocupa: {
                clientId: CARMEN,
                nombre: "Carmen Gómez",
                desde: "2026-01-10T00:00:00.000Z",
              },
            },
            { id: "b-112b", label: "B", active: true, ocupa: null },
          ],
          puerta: {
            deviceId: "d-1",
            name: "Tablet 112",
            lastSeenAt: "2026-10-14T08:00:00.000Z",
          },
        },
        {
          id: "h-113",
          number: "113",
          name: null,
          active: true,
          camas: [{ id: "b-113a", label: "A", active: true, ocupa: null }],
          puerta: null,
        },
      ],
    },
    {
      id: PLANTA_2,
      name: "Segunda",
      sortOrder: 2,
      habitaciones: [],
    },
  ],
};

const RESIDENTES = {
  alcance: "CENTRO" as const,
  // alta-minima · el resumen del centro. Carmen y Luis están COMPLETOS en
  // este fixture a propósito: lo que estos tests guardan es la pantalla de
  // residencia-1, y la de alta-minima tiene sus propios fixtures en
  // `alta-minima-pantallas.test.tsx` — con el resumen a cero, el filtro
  // «Sólo incompletas» ni se ofrece y la lista se pinta como siempre.
  resumen: { total: 2, incompletas: 0, datosPendientes: 0, conImprescindibles: 0 },
  residentes: [
    {
      clientId: CARMEN,
      nombre: "Carmen Gómez",
      firstName: "Carmen",
      lastName: "Gómez",
      phone: null,
      birthdate: null,
      admissionDate: "2026-01-10",
      dischargeDate: null,
      dischargeReason: null,
      dependencyLevel: "DEPENDIENTE" as const,
      dependencyGrade: "III" as const,
      placeType: "CONCERTADA" as const,
      responsible: null,
      cama: {
        assignmentId: "oc-1",
        bedId: "b-112a",
        bedLabel: "A",
        roomId: "h-112",
        roomNumber: "112",
        roomName: null,
        floorId: PLANTA_1,
        floorName: "Primera",
        desde: "2026-01-10T00:00:00.000Z",
      },
      faltan: [],
    },
    {
      // El INGRESO PENDIENTE: sin cama. Está permitido y tiene que verse.
      clientId: LUIS,
      nombre: "Luis Prieto",
      firstName: "Luis",
      lastName: "Prieto",
      phone: null,
      birthdate: null,
      admissionDate: "2026-10-20",
      dischargeDate: null,
      dischargeReason: null,
      dependencyLevel: "VALIDO" as const,
      dependencyGrade: null,
      placeType: "PRIVADA" as const,
      responsible: null,
      cama: null,
      faltan: [],
    },
  ],
};

const TURNOS = {
  ahora: "T",
  turnos: [
    { id: "t-m", code: "M", name: "Mañana", startsAt: "08:00", endsAt: "15:00", sortOrder: 1 },
    { id: "t-t", code: "T", name: "Tarde", startsAt: "15:00", endsAt: "22:00", sortOrder: 2 },
    { id: "t-n", code: "N", name: "Noche", startsAt: "22:00", endsAt: "08:00", sortOrder: 3 },
  ],
};

const ROLES = {
  roles: [
    {
      id: "r-aux",
      code: "AUXILIAR",
      name: "Auxiliar / gerocultora",
      category: "OPERATIVO" as const,
      isStandard: true,
      active: true,
      sortOrder: 1,
      recordsCare: true,
      requiresLicense: false,
      fullScope: false,
    },
    {
      id: "r-due",
      code: "DUE",
      name: "DUE (enfermería)",
      category: "SUPERVISOR" as const,
      isStandard: true,
      active: true,
      sortOrder: 2,
      recordsCare: true,
      requiresLicense: true,
      fullScope: true,
    },
  ],
};

function filaDePersonal(userId: string, alias: string) {
  return {
    userId,
    alias,
    email: `${alias.toLowerCase()}@gredos.local`,
    role: "CLINICIAN" as const,
    profile: {
      userId,
      displayName: alias,
      active: true,
      color: "#e8663c",
    },
    serviceIds: [] as string[],
    skillCount: 0,
    clinica: {
      esSanitario: true,
      colegiado: null,
      alcance: "SELECTION" as const,
      puesto: "sanitario" as const,
    },
  };
}

beforeEach(() => {
  residenciaEncendida = true;
  posts = [];
  puts = [];
  deletes = [];
  apiMock.api.mockReset();
  apiMock.api.mockImplementation(
    async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path === "/admin/tenant/settings") {
        return {
          settings: {
            agendaEnabled: true,
            clinicalRecordsEnabled: true,
            residenciaEnabled: residenciaEncendida,
          },
        };
      }
      if (path.startsWith("/residencia/residentes/") && init?.method == null) {
        const r = RESIDENTES.residentes.find((x) =>
          path.endsWith(x.clientId),
        )!;
        return {
          residente: {
            ...r,
            dni: "11111111H",
            nss: "28/1234567890",
            ocupaciones: [],
          },
        };
      }
      if (path.startsWith("/residencia/residentes")) return RESIDENTES;
      if (path === "/residencia/edificio") return EDIFICIO;
      if (path === "/residencia/turnos") return TURNOS;
      if (path === "/residencia/roles-de-cuidado") return ROLES;
      if (/\/residencia\/staff\/[^/]+\/cuidado$/.test(path)) {
        return {
          esSanitario: true,
          colegiado: null,
          roles: [],
          zonas: [],
          alcance: "SIN_ROL",
        };
      }
      if (path === "/staff") {
        return { staff: [filaDePersonal("u-rocio", "ROCIO")] };
      }
      if (path === "/staff/services") return { services: [] };
      if (/\/staff\/[^/]+\/shifts$/.test(path)) return { shifts: [] };
      if (init?.method === "POST") {
        posts.push({ path, body: init.body });
        if (path.endsWith("/pairing-codes")) {
          return {
            code: "483920",
            expiresAt: "2026-10-14T13:00:00.000Z",
            kind: "ROOM",
            roomId: "h-113",
            roomNumber: "113",
          };
        }
        return {};
      }
      if (init?.method === "PUT") {
        puts.push({ path, body: init.body });
        return { zonas: [] };
      }
      if (init?.method === "DELETE") {
        deletes.push(path);
        return { revocado: true };
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

async function pintar(Pantalla: () => JSX.Element) {
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter>
        <Pantalla />
      </MemoryRouter>,
    );
  });
}

function botonPorTexto(texto: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;
}

function botonQueContiene(texto: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function pulsar(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// ── 1 · el tenant sin residencia no nota NADA ───────────────────────

describe("residencia-1 · en un tenant sin residencia, Personal es la de hoy", () => {
  it("ni roles de cuidado, ni zona, ni una palabra de residentes", async () => {
    residenciaEncendida = false;
    await pintar(StaffPage);
    await pulsar(botonQueContiene("ROCIO")!);
    const texto = container.textContent ?? "";
    expect(texto).not.toContain("Residencia");
    expect(texto).not.toContain("Roles de cuidado");
    expect(texto).not.toContain("Zona");
  });

  it("y con la residencia encendida, la sección aparece", async () => {
    await pintar(StaffPage);
    await pulsar(botonQueContiene("ROCIO")!);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Residencia");
    expect(texto).toContain("Roles de cuidado");
    expect(texto).toContain("Zona");
  });
});

// ── 2 · Residentes ──────────────────────────────────────────────────

describe("residencia-1 · Residentes", () => {
  it("la lista dice habitación, cama, nivel de dependencia y tipo de plaza", async () => {
    await pintar(ResidentesPage);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Carmen Gómez");
    expect(texto).toContain("Hab. 112 · cama A · Primera");
    expect(texto).toContain("Dependiente · grado III");
    expect(texto).toContain("Concertada");
  });

  it("EL INGRESO PENDIENTE se pinta como aviso, no como error", async () => {
    await pintar(ResidentesPage);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Sin habitación · ingreso pendiente");
    expect(texto).toContain("sin habitación asignada (ingreso pendiente)");
  });

  it("el DNI NO sale en la lista — sólo en la ficha", async () => {
    // La lista se enseña en una pantalla que mira cualquiera que pase por
    // el despacho. Y la API tampoco lo manda; esto es la otra mitad.
    await pintar(ResidentesPage);
    expect(container.textContent).not.toContain("11111111H");
    // Al abrir la ficha, sí.
    await pulsar(botonQueContiene("Carmen Gómez")!);
    expect(container.textContent).toContain("11111111H");
  });

  it("«INGRESO» Y «DAR DE ALTA» NO SE LLAMAN IGUAL", async () => {
    // Lo encontró este test y era un problema de verdad: en una residencia
    // «dar de alta» significa que alguien SE VA, y el botón de la cabecera
    // —que es para ADMITIR— decía lo mismo que el de cada línea. Ahora la
    // cabecera dice «Nuevo ingreso» y sólo las líneas dicen «Dar de alta».
    await pintar(ResidentesPage);
    const cabecera = botonPorTexto("Nuevo ingreso");
    expect(cabecera).toBeDefined();
    // Dos residentes vivos → dos botones de dar de alta, y ninguno más.
    const altas = [...container.querySelectorAll("button")].filter(
      (b) => b.textContent?.trim() === "Dar de alta",
    );
    expect(altas).toHaveLength(2);
  });

  it("«Dar de alta» (el de la línea) dice que NO BORRA NADA", async () => {
    // La dirección tiene que leer que la ficha se conserva antes de pulsar.
    await pintar(ResidentesPage);
    const alta = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Dar de alta",
    )!;
    await pulsar(alta);
    const texto = container.textContent ?? "";
    expect(texto).toContain("dar de alta no borra nada");
    expect(texto).toContain("Se libera su cama");
  });

  it("alta-minima · el ingreso SÓLO exige el nombre, y dice qué va a quedar pendiente", async () => {
    // Esto es lo que alta-minima invirtió. Antes bloqueaban tres —nombre,
    // nivel y plaza— y era lo que dejaba a cuarenta y tres señoras fuera
    // del programa: existir en el sistema no puede depender de tener el
    // papeleo hecho. Lo que queda es el aviso, que es dato y no bloqueo.
    await pintar(ResidentesPage);
    await pulsar(botonPorTexto("Nuevo ingreso")!);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Con el nombre basta");
    expect(texto).toContain("puedes completarlo después");
    // Lo que se va a quedar pendiente, dicho antes de guardar.
    expect(texto).toContain("el nivel de dependencia");
    expect(texto).toContain("el tipo de plaza");
    // Y el botón sigue deshabilitado SIN NOMBRE: eso no cambió.
    const guardar = botonPorTexto("Registrar ingreso")!;
    expect(guardar.disabled).toBe(true);
    expect(posts).toHaveLength(0);
  });
});

// ── 3 · Edificio ────────────────────────────────────────────────────

describe("residencia-1 · Edificio", () => {
  it("pinta plantas → habitaciones → camas con quién ocupa cada una", async () => {
    await pintar(EdificioPage);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Primera");
    expect(texto).toContain("Segunda");
    expect(texto).toContain("112");
    expect(texto).toContain("Carmen Gómez");
    expect(texto).toContain("libre");
    expect(texto).toContain("1 de 3 plazas ocupadas");
  });

  it("la habitación CON tablet lo dice; la que no, ofrece emparejar", async () => {
    await pintar(EdificioPage);
    expect(container.textContent).toContain("Tablet emparejada");
    expect(botonQueContiene("Emparejar tablet")).toBeDefined();
  });

  it("emparejar pide el código a la ruta de la HABITACIÓN y lo enseña", async () => {
    await pintar(EdificioPage);
    await pulsar(botonQueContiene("Emparejar tablet")!);
    await pulsar(botonPorTexto("Generar código")!);
    expect(posts.map((p) => p.path)).toEqual([
      "/residencia/habitaciones/h-113/pairing-codes",
    ]);
    expect(container.textContent).toContain("483920");
    expect(container.textContent).toContain("Se usa una sola vez");
  });

  it("NI UN DATO DE SALUD en el edificio: sólo nombres", async () => {
    // Esta pantalla se mira de pie, con gente alrededor.
    await pintar(EdificioPage);
    const texto = container.textContent ?? "";
    expect(texto).not.toContain("Dependiente");
    expect(texto).not.toContain("Concertada");
    expect(texto).not.toContain("11111111H");
  });
});

// ── 4 · Turnos ──────────────────────────────────────────────────────

describe("residencia-1 · Turnos", () => {
  it("los tres de serie, y «ahora» con el turno en curso", async () => {
    await pintar(TurnosPage);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Mañana");
    expect(texto).toContain("Tarde");
    expect(texto).toContain("Noche");
    expect(texto).toContain("Tarde · 15:00–22:00");
  });

  it("la noche se etiqueta como «cruza medianoche», no se corrige", async () => {
    await pintar(TurnosPage);
    expect(container.textContent).toContain("cruza medianoche");
  });

  it("y con un HUECO en el cuadrante lo dice en ámbar", async () => {
    apiMock.api.mockImplementation(async (path: string) => {
      if (path === "/residencia/turnos") {
        return { ahora: null, turnos: [TURNOS.turnos[0]] };
      }
      return {};
    });
    await pintar(TurnosPage);
    const texto = container.textContent ?? "";
    expect(texto).toContain("Ningún turno cubre esta hora");
    expect(texto).toContain("se quedaría sin turno");
  });
});

// ── 5 · Personal · roles de cuidado y zona ──────────────────────────

describe("residencia-1 · Personal · roles de cuidado y zona", () => {
  it("sin rol de cuidado, la frase lo dice: no ve a ningún residente", async () => {
    await pintar(StaffPage);
    await pulsar(botonQueContiene("ROCIO")!);
    expect(container.textContent).toContain(
      "Sin rol de cuidado vigente: no ve a ningún residente",
    );
  });

  it("ofrece las plantas del centro como zona, y «todo el centro»", async () => {
    await pintar(StaffPage);
    await pulsar(botonQueContiene("ROCIO")!);
    expect(botonPorTexto("Todo el centro")).toBeDefined();
    expect(botonPorTexto("Primera")).toBeDefined();
    expect(botonPorTexto("Segunda")).toBeDefined();
  });

  it("marcar una planta manda el PUT con la lista completa", async () => {
    await pintar(StaffPage);
    await pulsar(botonQueContiene("ROCIO")!);
    await pulsar(botonPorTexto("Primera")!);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.path).toBe("/residencia/staff/u-rocio/zona");
    expect(puts[0]!.body).toEqual({ alcance: "PLANTAS", floorIds: [PLANTA_1] });
  });

  it("«todo el centro» manda `alcance: CENTRO` y SIN plantas", async () => {
    await pintar(StaffPage);
    await pulsar(botonQueContiene("ROCIO")!);
    await pulsar(botonPorTexto("Todo el centro")!);
    expect(puts[0]!.body).toEqual({ alcance: "CENTRO" });
  });

  it("EL COLEGIADO se pide SÓLO si el rol lo exige, y antes de llegar al 400", async () => {
    await pintar(StaffPage);
    await pulsar(botonQueContiene("ROCIO")!);
    const select = container.querySelector(
      'select[aria-label="Rol de cuidado"]',
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();

    // La auxiliar NO necesita colegiado: registra y no tiene colegio
    // profesional. Pedírselo habría dejado a media plantilla sin poder
    // entrar en la puerta.
    await act(async () => {
      select.value = "r-aux";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(
      container.querySelector('input[aria-label="Nº de colegiado"]'),
    ).toBeNull();

    // La DUE sí.
    await act(async () => {
      select.value = "r-due";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(
      container.querySelector('input[aria-label="Nº de colegiado"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("profesión con colegio");
  });
});
