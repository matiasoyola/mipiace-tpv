// clinica-8 · LA FICHA DEL CLIENTE: EL ESTADO DE LA CITA Y LA HISTORIA.
//
// Dos cosas que la auditoría del 18-10 se encontró en la misma pantalla:
//
//   1. **El historial pintaba «Cita» a secas.** La cita del lunes estaba
//      CANCELADA —por eso había salido de la agenda y su hora volvía a
//      ofrecerse— y aquí seguía apareciendo como una cita cualquiera, con
//      su día y su hora. Era el único sitio donde aparecía, y aparecía
//      como si estuviera viva: de ahí la lectura de que «la agenda había
//      perdido una cita».
//   2. **La historia salía DENTRO del cajón lateral**, cortada y con el
//      mapa de los dos pies desbordándose (capturas 77–80). Desde la cita
//      abría a pantalla completa desde clinica-6; desde la ficha, no.

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

const clinicaMock = vi.hoisted(() => ({ encendida: true }));
vi.mock("../src/lib/catalog.js", () => ({
  getCachedClinicaEnabled: () => clinicaMock.encendida,
  loadCatalogFromCache: async () => [],
  productImageUrl: () => null,
}));

// La historia viva tiene su propio banco (clinica-6). Aquí lo único que
// importa es DÓNDE se monta, así que un doble reconocible basta — y
// además deja este test sin depender de la forma de su respuesta.
vi.mock("../src/clinica/HistoriaViva.js", () => ({
  HistoriaViva: ({ clientId }: { clientId: string }) => (
    <div data-test="historia-viva-montada">historia de {clientId}</div>
  ),
}));
vi.mock("../src/clinica/ValoracionSanitario.js", () => ({
  ValoracionSanitario: () => <div>valoración</div>,
}));

const clientesMock = vi.hoisted(() => ({ historial: [] as unknown[] }));
vi.mock("../src/lib/clients.js", async () => {
  const carmen = {
    id: "cl-carmen",
    externalId: null,
    firstName: "Carmen",
    lastName: "Prueba Demo",
    phone: "600000001",
    email: "carmen@clinicademo.local",
    birthdate: null,
    holdedContactId: null,
    marketingOptIn: false,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    clientFullName: (c: { firstName: string; lastName: string }) =>
      `${c.firstName} ${c.lastName}`.trim(),
    loadClientsFromCache: async () => [carmen],
    refreshClients: async () => [carmen],
    searchClientsLocal: (all: unknown[]) => all,
    getClientDetail: async () => ({
      client: carmen,
      consents: [],
      technicalNotes: [],
      technicalNotesHidden: false,
    }),
    getClientHistory: async () => ({
      entries: clientesMock.historial,
      appointments: [],
    }),
    addClientConsent: async () => undefined,
    addClientTechnicalNote: async () => undefined,
  };
});

import { ClientsPage } from "../src/pages/ClientsPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function citaEnElHistorial(status: string) {
  return {
    kind: "APPOINTMENT" as const,
    id: "ap-carmen",
    at: "2026-10-19T08:00:00.000Z",
    end: "2026-10-19T08:30:00.000Z",
    status,
    ticketId: null,
    serviceIds: ["svc-1"],
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  clinicaMock.encendida = true;
  clientesMock.historial = [citaEnElHistorial("CONFIRMED")];
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockResolvedValue({});
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render(esSanitario = true) {
  root = createRoot(container);
  await act(async () => {
    root.render(<ClientsPage onClose={() => {}} esSanitario={esSanitario} />);
  });
  await settle();
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

/** Busca en TODO el documento: la historia abre con un portal a `body`. */
function porTextoEnDocumento(txt: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>("button")].find(
      (b) => (b.textContent ?? "").trim() === txt,
    ) ?? null
  );
}

async function abrirFicha() {
  const fila = [...container.querySelectorAll<HTMLElement>("button")].find((b) =>
    (b.textContent ?? "").includes("Carmen Prueba Demo"),
  );
  if (!fila) throw new Error("la clienta no está en la lista");
  await click(fila);
}

describe("clinica-8 · el historial dice el estado de la cita", () => {
  it("una CANCELADA lo dice: es la que no está en la agenda", async () => {
    clientesMock.historial = [citaEnElHistorial("CANCELLED")];
    await render();
    await abrirFicha();
    expect(container.textContent).toContain("Cita · cancelada");
  });

  it("una confirmada NO lleva etiqueta: es el estado de casi todas", async () => {
    // Escribirlo en cada línea sería ruido, y lo que hay que poder leer de
    // un vistazo es lo que NO es normal.
    await render();
    await abrirFicha();
    expect(container.textContent).toContain("Cita");
    expect(container.textContent).not.toContain("Cita · confirmada");
  });

  it("y los demás estados también se nombran", async () => {
    clientesMock.historial = [
      citaEnElHistorial("NO_SHOW"),
      { ...citaEnElHistorial("COMPLETED"), id: "ap-2" },
    ];
    await render();
    await abrirFicha();
    expect(container.textContent).toContain("Cita · no vino");
    expect(container.textContent).toContain("Cita · hecha");
  });
});

describe("clinica-8 · la historia, a pantalla completa", () => {
  it("se abre FUERA del cajón: portal a body y overlay a pantalla completa", async () => {
    await render(true);
    await abrirFicha();
    await click(porTextoEnDocumento("Historia")!);
    const pantalla = document.querySelector<HTMLElement>(
      '[data-test="historia-pantalla-completa"]',
    );
    expect(pantalla).not.toBeNull();
    // El sabotaje que esto caza: volver a pintarla dentro del panel. El
    // cajón vive DENTRO del contenedor de la página; el overlay, no.
    expect(container.contains(pantalla!)).toBe(false);
    const overlay = pantalla!.parentElement!;
    expect(overlay.className).toContain("fixed");
    expect(overlay.className).toContain("inset-0");
    expect(
      document.querySelector('[data-test="historia-viva-montada"]'),
    ).not.toBeNull();
  });

  it("y se vuelve a la ficha sin perderla", async () => {
    await render(true);
    await abrirFicha();
    await click(porTextoEnDocumento("Historia")!);
    const volver = [...document.querySelectorAll<HTMLElement>("button")].find(
      (b) => b.getAttribute("aria-label") === "Volver a la ficha",
    );
    expect(volver).not.toBeNull();
    await click(volver!);
    expect(
      document.querySelector('[data-test="historia-pantalla-completa"]'),
    ).toBeNull();
    expect(container.textContent).toContain("Carmen Prueba Demo");
  });

  it("a quien no es sanitario no se le ofrece la pestaña", async () => {
    // La recepcionista sigue viendo «Valoración», que es la decisión de
    // clinica-2: ahí usa los dos botones que SÍ puede usar.
    await render(false);
    await abrirFicha();
    expect(porTextoEnDocumento("Historia")).toBeNull();
    expect(porTextoEnDocumento("Valoración")).not.toBeNull();
  });
});
