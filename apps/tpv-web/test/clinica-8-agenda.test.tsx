// clinica-8 · LA CITA QUE DESAPARECIÓ, Y EL ORDEN DE LA CITA EN UNA CLÍNICA.
//
// ── La cita que desapareció (18-10) ─────────────────────────────────
//
// Cita del lunes 19 a las 10:00, confirmada y visible. Un rato después: la
// agenda sin ella, «Buscar hueco» ofreciendo las 10:00 como libres, y la
// cita todavía en Clientes → Historial. Tres síntomas, un solo estado del
// dato: `appointments.status = 'CANCELLED'`.
//
//   · la rejilla filtra `status <> 'CANCELLED'` ⇒ desaparece;
//   · `setStatus` inactiva sus assignments ⇒ el hueco se ofrece otra vez;
//   · y `listForClient` NO filtra por estado ⇒ sigue en el historial, que
//     hasta este bloque la pintaba «Cita» a secas, como si estuviera viva.
//
// Lo que no había era forma de llegar a ese estado sin querer… salvo una:
// «Cancelar» era UN TOQUE, sin confirmar, en una rejilla de cuatro botones
// del panel de detalle. Irreversible, libera el hueco y no deja rastro.
//
// Este banco fija las dos mitades del arreglo: cancelar pregunta, y el
// historial dice el estado.
//
// ── Y el orden de la cita en una clínica ────────────────────────────
//
// Decisión de producto de Matías (18-10): en una clínica se entra por la
// agenda, al cerrar la sesión el ticket sale hecho y quien cobra sólo lo
// confirma. Hasta este bloque «Cobrar en caja» era el botón más fuerte del
// detalle y «Sesión de hoy» el más suave: la pantalla invitaba a cobrar la
// previsión antes de registrar la consulta.

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

const cacheMock = vi.hoisted(() => ({ clinica: false }));
vi.mock("../src/lib/catalog.js", () => ({
  loadCatalogFromCache: async () => [
    {
      id: "00000000-0000-0000-0000-0000000000p1",
      holdedProductId: null,
      sku: "SVC-QUIRO",
      name: "Quiropodia completa",
      basePrice: 26,
      priceGross: 26,
      taxRate: 0,
      tags: ["quiropodia"],
      kind: "SERVICE" as const,
      durationMin: 30,
    },
  ],
  productImageUrl: () => null,
  getCachedClinicaEnabled: () => cacheMock.clinica,
}));

vi.mock("../src/lib/clients.js", () => ({
  clientFullName: (c: { firstName: string; lastName: string }) =>
    `${c.firstName} ${c.lastName}`.trim(),
  loadClientsFromCache: async () => [
    {
      id: "cl-carmen",
      externalId: null,
      firstName: "Carmen",
      lastName: "Prueba Demo",
      phone: null,
      email: null,
      birthdate: null,
      holdedContactId: null,
      marketingOptIn: false,
      notes: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  asegurarClientesEnCache: async () => false,
}));

vi.mock("../src/hooks/useClientPicker.js", () => ({
  useClientPicker: () => ({
    open: () => {},
    close: () => {},
    isOpen: false,
    element: null,
  }),
}));

import { __resetOutboxForTests } from "../src/lib/outbox.js";
import { AgendaPage } from "../src/pages/AgendaPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Lunes 19-10-2026, 09:10 de pared en Madrid (CEST, UTC+2).
const AHORA = new Date("2026-10-19T07:10:00.000Z");
const HOY = "2026-10-19";

const ROSA = {
  userId: "00000000-0000-0000-0000-0000000000r1",
  displayName: "Rosa",
  color: "#e8663c",
  active: true,
};

const CITA = {
  id: "ap-carmen",
  clientId: "cl-carmen",
  status: "CONFIRMED",
  source: "PRESENCIAL",
  start: "2026-10-19T08:00:00.000Z",
  end: "2026-10-19T08:30:00.000Z",
  ticketId: null,
  notes: null,
  items: [
    {
      id: "ap-carmen-i0",
      serviceId: "00000000-0000-0000-0000-0000000000p1",
      durationMin: 30,
      sortOrder: 0,
      startOffsetMin: 0,
    },
  ],
  assignments: [
    { reservableType: "STAFF" as const, staffUserId: ROSA.userId, resourceId: null },
  ],
};

const DIA = {
  date: HOY,
  open: [{ startTime: "09:00", endTime: "14:00" }],
  closed: null,
  specialName: null,
  staffOpen: { [ROSA.userId]: [{ startTime: "09:00", endTime: "14:00" }] },
  absences: [],
};

let llamadas: Array<{ path: string; init?: any }>;
let sesionesPorCobrar: string[];
let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  await __resetOutboxForTests();
  llamadas = [];
  sesionesPorCobrar = [];
  cacheMock.clinica = false;
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string, init?: any) => {
    llamadas.push({ path, init });
    if (path.startsWith("/agenda?")) {
      return {
        staff: [ROSA],
        appointments: [CITA],
        slotMinutes: 15,
        days: [DIA],
        valoracionesPendientes: [],
        sesionesPorCobrar,
      };
    }
    if (path === "/agenda/availability") return { slots: [] };
    if (path === "/agenda/health")
      return { generatedAt: AHORA.toISOString(), cards: [] };
    if (path.startsWith("/agenda/appointments/")) {
      return { appointment: { ...CITA, status: init?.body?.status ?? "CONFIRMED" } };
    }
    throw new Error(`ruta no mockeada: ${path}`);
  });
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

async function render(props: Record<string, unknown> = {}) {
  root = createRoot(container);
  await act(async () => {
    root.render(<AgendaPage onClose={() => {}} {...props} />);
  });
  await settle();
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

function porTexto(txt: string): HTMLElement | null {
  return (
    [...container.querySelectorAll<HTMLElement>("button")].find(
      (b) => (b.textContent ?? "").trim() === txt,
    ) ?? null
  );
}

async function abrirDetalle() {
  const tarjeta = [...container.querySelectorAll<HTMLElement>("button")].find(
    (b) => (b.textContent ?? "").includes("Carmen Prueba Demo"),
  );
  if (!tarjeta) throw new Error("la cita no está en la rejilla");
  await click(tarjeta);
}

function patches() {
  return llamadas.filter(
    (l) => l.path.startsWith("/agenda/appointments/") && l.init?.method === "PATCH",
  );
}

describe("clinica-8 · cancelar una cita PREGUNTA", () => {
  it("un toque en «Cancelar» NO cancela: abre el diálogo y dice qué va a pasar", async () => {
    await render();
    await abrirDetalle();
    await click(porTexto("Cancelar")!);
    // Ni una petición: lo que ha pasado es que la pantalla pregunta.
    expect(patches()).toEqual([]);
    const dialogo = container.querySelector('[data-test="confirmar-estado"]');
    expect(dialogo).not.toBeNull();
    expect(dialogo!.textContent).toContain("su hora vuelve a ofrecerse");
    expect(dialogo!.textContent).toContain("No se puede deshacer");
  });

  it("y «No» la deja como estaba", async () => {
    await render();
    await abrirDetalle();
    await click(porTexto("Cancelar")!);
    await click(porTexto("No")!);
    expect(patches()).toEqual([]);
    expect(container.querySelector('[data-test="confirmar-estado"]')).toBeNull();
  });

  it("confirmando sí se cancela, y sólo entonces", async () => {
    await render();
    await abrirDetalle();
    await click(porTexto("Cancelar")!);
    await click(porTexto("Sí, cancelar")!);
    expect(patches()).toHaveLength(1);
    expect(patches()[0]!.init.body).toEqual({ status: "CANCELLED" });
  });

  it("«No-show» también pregunta: libera el hueco igual", async () => {
    await render();
    await abrirDetalle();
    await click(porTexto("No-show")!);
    expect(patches()).toEqual([]);
    expect(
      container.querySelector('[data-test="confirmar-estado"]')!.textContent,
    ).toContain("Su hora vuelve a ofrecerse");
  });

  it("pero «Finalizar» sigue siendo un toque: se corrige tocando otra", async () => {
    await render();
    await abrirDetalle();
    await click(porTexto("Finalizar")!);
    expect(patches()).toHaveLength(1);
    expect(patches()[0]!.init.body).toEqual({ status: "COMPLETED" });
  });
});

describe("clinica-8 · en una clínica, primero la sesión y después el cobro", () => {
  it("fuera de la clínica el detalle no cambia: «Cobrar en caja» está", async () => {
    cacheMock.clinica = false;
    await render({ esSanitario: true });
    await abrirDetalle();
    expect(container.querySelector('[data-test="cobrar-en-caja"]')).not.toBeNull();
    expect(
      container.querySelector('[data-test="cobrar-tras-la-sesion"]'),
    ).toBeNull();
  });

  it("en una clínica y SIN sesión cerrada, «Cobrar» no se ofrece: se dice dónde está", async () => {
    cacheMock.clinica = true;
    await render({ esSanitario: true });
    await abrirDetalle();
    expect(container.querySelector('[data-test="cobrar-en-caja"]')).toBeNull();
    const aviso = container.querySelector('[data-test="cobrar-tras-la-sesion"]');
    expect(aviso).not.toBeNull();
    expect(aviso!.textContent).toContain("al cerrar la sesión de hoy");
    // Y la venta suelta sigue existiendo: la línea lo dice.
    expect(aviso!.textContent).toContain("usa la venta");
  });

  it("«Sesión de hoy» es el botón FUERTE en una clínica", async () => {
    cacheMock.clinica = true;
    await render({ esSanitario: true });
    await abrirDetalle();
    const sesion = container.querySelector<HTMLElement>(
      '[data-test="sesion-de-hoy"]',
    );
    expect(sesion).not.toBeNull();
    // El coral pleno del primario, no el suave de antes.
    expect(sesion!.className).toContain("bg-mipiace-coral ");
    expect(sesion!.className).not.toContain("bg-mipiace-coral-soft");
  });

  it("con la sesión YA CERRADA, el cobro vuelve y es el fuerte", async () => {
    cacheMock.clinica = true;
    sesionesPorCobrar = [CITA.id];
    await render({ esSanitario: true });
    await abrirDetalle();
    expect(container.querySelector('[data-test="cobrar-en-caja"]')).not.toBeNull();
    expect(
      container.querySelector('[data-test="cobrar-tras-la-sesion"]'),
    ).toBeNull();
    // Y la sesión deja de competir con él.
    expect(
      container.querySelector<HTMLElement>('[data-test="sesion-de-hoy"]')!.className,
    ).toContain("bg-mipiace-coral-soft");
  });
});
