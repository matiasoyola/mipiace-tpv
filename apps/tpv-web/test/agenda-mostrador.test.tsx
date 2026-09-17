// B-reservas-mostrador · lo que la recepcionista ve en el mostrador.
//
// Los cuatro hallazgos del 13-09 en el AP11 (tenant PRUEBAS MIPIACE), en el
// orden del daño:
//
//   F1 · «Reservar» es el primario; «Reservar y cobrar» sólo en una cita de
//        HOY. Un cobro entra en el turno abierto: reservar el jueves y cobrar
//        por inercia descuadra el arqueo de hoy Y el del día de la devolución.
//   F2 · la tarjeta se tiñe con el color de la profesional y sigue diciendo
//        hora, cliente y servicio; la local y la rechazada de 6a NO se tiñen.
//   F4 · ningún botón desactivado es mudo, y sin servicios no hay «fin».
//   F5 · el nombre de la clienta aparece aunque el cliente llegue al caché
//        con la agenda ya abierta; si no se sabe, no se dice «Cliente».
//
// Mismo patrón que `agenda-horario.test.tsx` y `agenda-suelo.test.tsx`:
// createRoot + act + eventos nativos, sin testing-library.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

// El catálogo y los clientes viven en un caché que el test controla: el
// frente 5 va justamente de que la agenda los RELEA, así que la caché falsa
// es mutable y se cuenta cuántas veces se ha leído.
const cacheMock = vi.hoisted(() => ({
  servicios: [] as unknown[],
  clientes: [] as unknown[],
  lecturasDeClientes: 0,
  lecturasDeCatalogo: 0,
}));

vi.mock("../src/lib/catalog.js", () => ({
  loadCatalogFromCache: async () => {
    cacheMock.lecturasDeCatalogo++;
    return cacheMock.servicios;
  },
  productImageUrl: () => null,
}));

const clientesMock = vi.hoisted(() => ({ elegido: null as unknown }));

vi.mock("../src/lib/clients.js", () => ({
  clientFullName: (c: { firstName: string; lastName: string }) =>
    `${c.firstName} ${c.lastName}`.trim(),
  loadClientsFromCache: async () => {
    cacheMock.lecturasDeClientes++;
    return cacheMock.clientes;
  },
}));

// El selector es de B1 y tiene sus propios tests: aquí sólo hace falta poder
// disparar su `onSelect` para comprobar que la agenda se entera (F5).
vi.mock("../src/hooks/useClientPicker.js", () => ({
  useClientPicker: () => ({
    open: (onSelect: (c: unknown) => void) => {
      if (clientesMock.elegido) onSelect(clientesMock.elegido);
    },
    close: () => {},
    isOpen: false,
    element: null,
  }),
}));

import { __resetOutboxForTests } from "../src/lib/outbox.js";
import { AgendaPage } from "../src/pages/AgendaPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Martes 15-09-2026, 11:10 de pared en Madrid (CEST, UTC+2): con el centro ya
// abierto, para que el suelo de 6a deje reservar a las 12:00 de hoy.
const AHORA = new Date("2026-09-15T09:10:00.000Z");
const HOY = "2026-09-15";
const MANANA = "2026-09-16";

const SOLE = {
  userId: "00000000-0000-0000-0000-0000000000s1",
  displayName: "Sole",
  // Morado oscuro: el caso duro del tinte.
  color: "#4c1d95",
  active: true,
};
const ANA = {
  userId: "00000000-0000-0000-0000-0000000000a1",
  displayName: "Ana",
  // Amarillo clarísimo: el otro caso duro.
  color: "#fef9c3",
  active: true,
};
const ISA = {
  userId: "00000000-0000-0000-0000-0000000000i1",
  displayName: "Isa",
  // Sin color: la agenda le da uno estable derivado de su id.
  color: null,
  active: true,
};

const CORTE = {
  id: "00000000-0000-0000-0000-0000000000p1",
  holdedProductId: "h-corte",
  sku: "SVC-CORTE",
  name: "Corte de pelo",
  basePrice: 14.876,
  priceGross: 18,
  taxRate: 21,
  tags: [] as string[],
  kind: "SERVICE" as const,
  durationMin: 30,
};

const TINTE = { ...CORTE, id: "p-tinte", sku: "SVC-TINTE", name: "Tinte", durationMin: 90 };

function cliente(id: string, firstName: string, lastName: string) {
  return {
    id,
    externalId: null,
    firstName,
    lastName,
    phone: null,
    email: null,
    birthdate: null,
    holdedContactId: null,
    marketingOptIn: false,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const CARMEN = cliente("cl-carmen", "Carmen", "Ruiz");

/** ISO UTC de una hora de pared de Madrid de un día dado (CEST = UTC+2). */
function madrid(date: string, hhmm: string): string {
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(
    `${date}T${String((hh ?? 0) - 2).padStart(2, "0")}:${String(mm ?? 0).padStart(2, "0")}:00.000Z`,
  ).toISOString();
}

const PX_PER_MIN = 1.1;

function cita(
  id: string,
  clientId: string | null,
  staffUserId: string,
  status: string,
  hhmm: string,
  durationMin = 30,
  extra: Record<string, unknown> = {},
) {
  const start = madrid(HOY, hhmm);
  return {
    id,
    clientId,
    status,
    source: "PRESENCIAL",
    start,
    end: new Date(new Date(start).getTime() + durationMin * 60_000).toISOString(),
    ticketId: null,
    notes: null,
    items: [{ id: `${id}-i0`, serviceId: CORTE.id, durationMin, sortOrder: 0, startOffsetMin: 0 }],
    assignments: [{ reservableType: "STAFF" as const, staffUserId, resourceId: null }],
    ...extra,
  };
}

interface Dia {
  date?: string;
  open: Array<{ startTime: string; endTime: string }> | null;
  closed: { name: string | null } | null;
  specialName: string | null;
  staffOpen: Record<string, Array<{ startTime: string; endTime: string }>>;
  absences: Array<{
    id: string | null;
    staffUserId: string | null;
    startTime: string;
    endTime: string;
    reason: string | null;
  }>;
}

function diaAbierto(staff: Array<{ userId: string }>): Dia {
  const tramo = [{ startTime: "09:00", endTime: "20:00" }];
  return {
    open: tramo,
    closed: null,
    specialName: null,
    staffOpen: Object.fromEntries(staff.map((s) => [s.userId, tramo])),
    absences: [],
  };
}

let respuesta: {
  staff: Array<typeof SOLE>;
  appointments: unknown[];
  slotMinutes?: number;
  dia: Dia;
};
let llamadas: Array<{ path: string; init?: unknown }>;
let slotsDeBusqueda: Array<{ start: string; end: string; options: number }>;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  await __resetOutboxForTests();
  llamadas = [];
  slotsDeBusqueda = [];
  cacheMock.servicios = [CORTE, TINTE];
  cacheMock.clientes = [CARMEN];
  cacheMock.lecturasDeClientes = 0;
  cacheMock.lecturasDeCatalogo = 0;
  clientesMock.elegido = null;
  respuesta = {
    staff: [SOLE],
    appointments: [],
    slotMinutes: 15,
    dia: diaAbierto([SOLE]),
  };
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(
    async (path: string, init?: unknown) => {
      llamadas.push({ path, init });
      if (path.startsWith("/agenda?")) {
        // El día que pinta la agenda es el que ha pedido: así `dayInfo` existe
        // también cuando se cambia de día con las flechas.
        const pedido = new URLSearchParams(path.slice(path.indexOf("?"))).get("date") ?? HOY;
        return { ...respuesta, days: [{ ...respuesta.dia, date: pedido }] };
      }
      if (path === "/agenda/availability") return { slots: slotsDeBusqueda };
      if (path === "/agenda/health") return { generatedAt: AHORA.toISOString(), cards: [] };
      if (path === "/agenda/appointments") {
        return { appointment: cita("ap-nueva", null, SOLE.userId, "CONFIRMED", "12:00") };
      }
      throw new Error(`ruta no mockeada: ${path}`);
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
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
    root.render(<AgendaPage onClose={() => {}} />);
  });
  await settle();
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

function texto(): string {
  return container.textContent ?? "";
}

function columna(userId: string): HTMLElement {
  const col = container.querySelector<HTMLElement>(`[data-columna="${userId}"]`);
  if (!col) throw new Error(`no hay columna de ${userId}`);
  return col;
}

function origenMin(): number {
  const primera = container.querySelector<HTMLElement>("[data-hora]");
  if (!primera) throw new Error("la regla no tiene horas");
  return Number(primera.dataset.hora!.slice(0, 2)) * 60;
}

async function tocarFranja(userId: string, hhmm: string) {
  const col = columna(userId);
  vi.spyOn(col, "getBoundingClientRect").mockReturnValue({
    top: 0, left: 0, right: 200, bottom: 2000, width: 200, height: 2000,
    x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  const [hh, mm] = hhmm.split(":").map(Number);
  const y = ((hh ?? 0) * 60 + (mm ?? 0) - origenMin()) * PX_PER_MIN;
  await act(async () => {
    col.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: y }));
  });
  await settle();
}

/** Cambia al día que dice el chip de la tira de días ("mié 16", "jue 17"…). */
async function irAlDia(date: string) {
  const etiqueta = new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00.000Z`));
  const chip = Array.from(container.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === etiqueta,
  );
  if (!chip) throw new Error(`no hay chip del día "${etiqueta}"`);
  await click(chip);
}

function botonPorTexto(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === text,
  ) as HTMLButtonElement | undefined;
}

function accion(nombre: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[data-accion="${nombre}"]`);
}

function servicio(nombre: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(nombre),
  );
  if (!btn) throw new Error(`no hay servicio "${nombre}"`);
  return btn as HTMLButtonElement;
}

/** El pie del panel de alta: lo que mide es lo que no puede saltar. */
function pieDelPanel(): HTMLElement {
  const boton = accion("reservar");
  if (!boton) throw new Error("el panel de alta no está abierto");
  return boton.parentElement as HTMLElement;
}

// ── F1 · el botón que no descuadra dos arqueos ────────────────────────

describe("F1 · «Reservar» es el primario y «Reservar y cobrar» sólo es de hoy", () => {
  it("el primario es «Reservar», y va PRIMERO en el DOM", async () => {
    await render();
    await tocarFranja(SOLE.userId, "12:00");

    const reservar = accion("reservar")!;
    const cobrar = accion("reservar-y-cobrar")!;
    expect(reservar.textContent?.trim()).toBe("Reservar");
    expect(cobrar.textContent?.trim()).toBe("Reservar y cobrar");

    // Primario = el coral de la casa. El secundario, borde gris.
    expect(reservar.className).toContain("bg-mipiace-coral");
    expect(cobrar.className).not.toContain("bg-mipiace-coral");

    // Y el orden del DOM, que es el orden del tabulador.
    expect(
      reservar.compareDocumentPosition(cobrar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("en una cita de OTRO DÍA no hay «Reservar y cobrar» en ninguna forma", async () => {
    await render();
    await irAlDia(MANANA);
    await tocarFranja(SOLE.userId, "12:00");

    expect(accion("reservar")).not.toBeNull();
    expect(accion("reservar-y-cobrar")).toBeNull();
    expect(botonPorTexto("Reservar y cobrar")).toBeUndefined();
    expect(texto()).toContain("Se cobra el día de la cita.");
  });

  it("el pie mide lo mismo con y sin el secundario: no hay salto de layout", async () => {
    await render();
    await tocarFranja(SOLE.userId, "12:00");
    const conBoton = pieDelPanel().innerHTML;
    const filasHoy = pieDelPanel().children.length;

    await irAlDia(MANANA);
    await tocarFranja(SOLE.userId, "12:00");
    const filasManana = pieDelPanel().children.length;

    expect(conBoton).toContain("Reservar y cobrar");
    // Mismo número de filas y la misma altura reservada para la segunda.
    expect(filasManana).toBe(filasHoy);
    const ranura = pieDelPanel().children[1] as HTMLElement;
    expect(ranura.className).toContain("h-11");
  });

  it("ningún atajo lleva a cobrar: el panel no tiene form ni submit", async () => {
    await render();
    await tocarFranja(SOLE.userId, "12:00");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('[type="submit"]')).toBeNull();
    // Y ninguno de los botones del pie es el botón por defecto del navegador.
    for (const b of [accion("reservar")!, accion("reservar-y-cobrar")!]) {
      expect(b.getAttribute("type")).not.toBe("submit");
    }
  });

  it("volver a HOY devuelve el botón, y sigue sin ser el primario", async () => {
    await render();
    await irAlDia(MANANA);
    await tocarFranja(SOLE.userId, "12:00");
    expect(accion("reservar-y-cobrar")).toBeNull();

    await irAlDia(HOY);
    await tocarFranja(SOLE.userId, "12:00");
    expect(accion("reservar-y-cobrar")).not.toBeNull();
    expect(accion("reservar")!.className).toContain("bg-mipiace-coral");
    expect(accion("reservar-y-cobrar")!.className).not.toContain("bg-mipiace-coral");
  });

  it("«Reservar» guarda SIN pasar por caja", async () => {
    await render();
    await tocarFranja(SOLE.userId, "12:00");
    await click(servicio("Corte de pelo"));
    await click(accion("reservar")!);

    const rutas = llamadas.map((l) => l.path);
    expect(rutas).toContain("/agenda/appointments");
    expect(rutas.some((p) => p.includes("/checkout"))).toBe(false);
  });
});
