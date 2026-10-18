// clinica-8 · EN UNA CLÍNICA SE ENTRA POR LA AGENDA, NO POR LA CAJA.
//
// Decisión de producto de Matías (18-10), no re-debatida: en una clínica
// todo va con cita previa; al cerrar la sesión el ticket sale hecho y quien
// cobra sólo lo confirma. A la vista de cajero se va **para añadir algo
// aparte** (unas plantillas, un producto), no para empezar.
//
// Lo que este banco fija es lo que decide dónde abre el TPV y, sobre todo,
// que **los catorce comercios sin historia clínica abren donde abrían
// ayer**: la venta.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
vi.mock("../src/api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

const cacheMock = vi.hoisted(() => ({ clinica: false }));
vi.mock("../src/lib/catalog.js", () => ({
  findByBarcode: () => null,
  fuzzySearch: () => [],
  getCachedBusinessType: () => "SERVICES" as const,
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => true,
  getCachedHoldedEnabled: () => false,
  getCachedCreditSalesEnabled: () => false,
  getCachedIconPreset: () => null,
  getCachedTagAliases: () => ({}),
  getCachedTenantId: () => null,
  getCachedEnsayo: () => false,
  // LA pieza: la caché del catálogo, la misma que ya decide si hay mesas
  // y si la cuenta está en ensayo.
  getCachedClinicaEnabled: () => cacheMock.clinica,
  loadCatalogFromCache: async () => [],
  loadWildcards: async () => [],
  productImageUrl: () => null,
  refreshCatalog: async () => [],
}));
vi.mock("../src/lib/clients.js", () => ({
  clientFullName: () => "",
  loadClientsFromCache: async () => [],
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
vi.mock("../src/lib/modifiers.js", () => ({
  loadModifierGroups: async () => [],
  buildGroupsByProduct: () => new Map(),
}));
vi.mock("../src/hooks/useStoreEventStream.js", () => ({
  useStoreEventStream: () => "open",
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));

import { TpvHome } from "../src/App.js";
import { __resetOutboxForTests } from "../src/lib/outbox.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  await __resetOutboxForTests();
  cacheMock.clinica = false;
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string) => {
    if (path.startsWith("/agenda?")) {
      return {
        staff: [],
        appointments: [],
        slotMinutes: 15,
        days: [],
        valoracionesPendientes: [],
        sesionesPorCobrar: [],
      };
    }
    if (path === "/agenda/availability") return { slots: [] };
    if (path === "/agenda/health")
      return { generatedAt: new Date().toISOString(), cards: [] };
    return {};
  });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function montar() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <TpvHome
        cashier={{
          userId: "u-1",
          email: "rosa@clinicademo.es",
          alias: "Rosa",
          role: "OWNER",
          isClinician: true,
          sessionTtlMinutes: 720,
        }}
        shiftId="shift-1"
        registerName="Caja 1"
        registerId="reg-1"
        storeName="Clínica demo"
        onLogoutCashier={vi.fn()}
        onCloseShift={vi.fn()}
      />,
    );
  });
  await settle();
}

/** ¿Está la agenda montada? Su cabecera lleva el título «Agenda». */
function agendaAbierta(): boolean {
  return [...container.querySelectorAll("h1")].some(
    (h) => h.textContent?.trim() === "Agenda",
  );
}

describe("clinica-8 · dónde abre el TPV", () => {
  it("en una CLÍNICA abre en la agenda", async () => {
    cacheMock.clinica = true;
    await montar();
    expect(agendaAbierta()).toBe(true);
  });

  it("y en un comercio sin historia clínica abre donde abría ayer", async () => {
    // La garantía que protege a los catorce: ni una pantalla cambia.
    cacheMock.clinica = false;
    await montar();
    expect(agendaAbierta()).toBe(false);
  });

  it("la agenda se puede cerrar: la venta sigue debajo, entera", async () => {
    // No es una cárcel. Es la vista inicial.
    cacheMock.clinica = true;
    await montar();
    const volver = [...container.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Volver",
    );
    expect(volver).not.toBeNull();
    await act(async () => {
      volver!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(agendaAbierta()).toBe(false);
  });
});
