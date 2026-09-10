// B-reservas-5 · el cobro de una CITA en el SalePage, con la API mockeada.
//
// Es el gemelo de `table-sale-flow.test.tsx`, y existe por la misma razón
// por la que aquel existe: el camino de la cita ahora es un DRAFT del
// servidor y hay que fijar que se comporta como tal.
//
//   - el carrito es la proyección del borrador, no un carrito local
//   - cobrar → POST /tickets/:id/checkout (NUNCA POST /tickets: eso es
//     exactamente el bug que este bloque viene a matar)
//   - el body no lleva líneas: viven en el servidor
//   - "Ticket emitido" SÍ se muestra (decisión P1 del bloque): en mesa se
//     salta, pero ahí v1.15 escondería la vuelta y en peluquería el
//     efectivo manda
//   - al confirmarse el cobro se avisa para marcar la cita COMPLETED
//   - la cabecera dice de QUIÉN es la cita
//   - "Fiado" no está, y se explica por qué
//
// Mismo patrón sin testing-library: createRoot + act + eventos nativos.

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
vi.mock("../src/lib/catalog.js", () => {
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
  return {
    findByBarcode: () => null,
    fuzzySearch: () => [CORTE],
    getCachedBusinessType: () => "SERVICES" as const,
    getCachedCrmEnabled: () => true,
    getCachedAgendaEnabled: () => true,
    // El tenant SÍ tiene fiado activado: es la única forma de comprobar
    // que en contexto de cita se explica por qué no está.
    getCachedCreditSalesEnabled: () => true,
    getCachedIconPreset: () => null,
    getCachedTagAliases: () => ({}),
    getCachedTenantId: () => null,
    loadCatalogFromCache: async () => [CORTE],
    loadWildcards: async () => [],
    productImageUrl: () => null,
    refreshCatalog: async () => [CORTE],
  };
});
vi.mock("../src/lib/modifiers.js", () => ({
  loadModifierGroups: async () => [],
  buildGroupsByProduct: () => new Map(),
}));
vi.mock("../src/hooks/useStoreEventStream.js", () => ({
  useStoreEventStream: () => "open",
}));
vi.mock("@mipiacetpv/ticket-pdf", () => ({
  renderTicketPdf: vi.fn(async () => new Uint8Array()),
}));
vi.mock("../src/lib/escposPrint.js", () => ({
  fetchTicketEscposBinary: vi.fn(),
  getPairedUsbPrinter: vi.fn(async () => null),
  isWebUsbSupported: () => false,
  pairUsbPrinter: vi.fn(),
  printEscposUsb: vi.fn(),
  printTicketWifi: vi.fn(),
  openCashDrawerIfAvailable: vi.fn(),
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));

import { __resetOutboxForTests, outboxList } from "../src/lib/outbox.js";
import { mapServerDraftLines, type ServerDraftLine } from "../src/lib/tableDraft.js";
import { SalePage, type AppointmentContext } from "../src/pages/SalePage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CITA = "00000000-0000-0000-0000-0000000000c1";
const TICKET = "00000000-0000-0000-0000-0000000000t9";

const appointmentContext: AppointmentContext = {
  appointmentId: CITA,
  activeTicketId: TICKET,
  clientName: "Rosa Marín",
  serviceLabel: "Corte de pelo",
};

function serverLine(): ServerDraftLine {
  return {
    id: "00000000-0000-0000-0000-0000000000l9",
    productId: "00000000-0000-0000-0000-0000000000p1",
    variantId: null,
    holdedProductId: "h-corte",
    sku: "SVC-CORTE",
    nameSnapshot: "Corte de pelo",
    units: "1",
    unitPrice: "14.876",
    discountPct: "0",
    taxRate: "21",
    subtotal: "14.876",
    total: "18",
    modifiers: null,
  };
}

function backgroundRoutes(path: string): unknown | undefined {
  if (path === "/tpv/health/holded") {
    return {
      level: "ok",
      reason: "",
      hasHoldedKey: true,
      lastIncrementalSyncAt: null,
      lastSyncAgeMs: null,
      blockedAt: null,
      pendingSyncCount: 0,
      syncFailedCount: 0,
    };
  }
  if (path === "/shift/current") return { shift: null };
  if (path === "/tpv/tables") {
    return { storeId: "store-1", registerId: "reg-1", tables: [] };
  }
  return undefined;
}

let container: HTMLDivElement;
let root: Root;
const onAppointmentPaid = vi.fn();
const onBackToAgenda = vi.fn();

beforeEach(async () => {
  await __resetOutboxForTests();
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  apiMock.apiWithCashier.mockReset();
  onAppointmentPaid.mockReset();
  onBackToAgenda.mockReset();
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderCita() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SalePage
        shiftId="shift-1"
        cashierLabel="Sole"
        cashierRole="CASHIER"
        registerName="Caja 1"
        registerId="reg-1"
        storeName="Peluquería Sole"
        appointmentContext={appointmentContext}
        initialDraftLines={mapServerDraftLines([serverLine()])}
        onAppointmentPaid={onAppointmentPaid}
        onBackToAgenda={onBackToAgenda}
        onLogoutCashier={vi.fn()}
        onCloseShift={vi.fn()}
      />,
    );
  });
  await settle();
}

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function buttonByText(text: string, exact = true): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => {
    const t = b.textContent?.trim() ?? "";
    return exact ? t === text : t.startsWith(text);
  });
  if (!btn) throw new Error(`no hay botón "${text}"`);
  return btn as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

describe("cobro de una cita · contexto de borrador", () => {
  it("cobrar cita → POST /tickets/:id/checkout, NO POST /tickets", async () => {
    const llamadas: string[] = [];
    let checkoutBody: Record<string, unknown> | null = null;
    apiMock.apiWithCashier.mockImplementation(
      async (
        path: string,
        opts?: { method?: string; body?: Record<string, unknown> },
      ) => {
        if (opts?.method === "POST") llamadas.push(path);
        if (path === `/tickets/${TICKET}/checkout` && opts?.method === "POST") {
          checkoutBody = opts.body!;
          return {
            ticket: {
              id: TICKET,
              internalNumber: "000042",
              status: "PENDING_SYNC",
              holdedDocNumber: null,
            },
            syncStatus: "PENDING_SYNC",
          };
        }
        if (path.includes("/digital")) throw new Error("offline");
        if (path.includes("printer-info")) throw new Error("offline");
        if (path === `/tickets/${TICKET}` && (!opts?.method || opts.method === "GET")) {
          return { ticket: { holdedDocNumber: null, status: "PENDING_SYNC" } };
        }
        const bg = backgroundRoutes(path);
        if (bg !== undefined) return bg;
        throw new Error(`ruta inesperada: ${path}`);
      },
    );

    await renderCita();
    await click(buttonByText("Cobrar", false));
    // En SERVICES el botón de confirmar del modal se llama "Cerrar
    // servicio" (v1.3-Servicios-Pinta), no "Cobrar".
    await click(buttonByText("Cerrar servicio"));

    // EL PUNTO DEL BLOQUE: se paga el borrador que ya existe.
    expect(llamadas).toContain(`/tickets/${TICKET}/checkout`);
    expect(llamadas).not.toContain("/tickets");
    // Y sin líneas en el body: viven en el servidor.
    expect(checkoutBody).not.toBeNull();
    expect(checkoutBody!.lines).toBeUndefined();
    expect(checkoutBody!.payments).toEqual([{ method: "CASH", amount: 18 }]);
    expect(typeof checkoutBody!.externalId).toBe("string");
    // 2xx confirmado → outbox limpio.
    expect(await outboxList()).toHaveLength(0);
  });

  it("tras cobrar se enseña 'Ticket emitido' (P1) y se avisa para COMPLETED", async () => {
    apiMock.apiWithCashier.mockImplementation(
      async (
        path: string,
        opts?: { method?: string; body?: Record<string, unknown> },
      ) => {
        if (path === `/tickets/${TICKET}/checkout` && opts?.method === "POST") {
          return {
            ticket: {
              id: TICKET,
              internalNumber: "000042",
              status: "PENDING_SYNC",
              holdedDocNumber: null,
            },
            syncStatus: "PENDING_SYNC",
          };
        }
        if (path.includes("/digital")) throw new Error("offline");
        if (path.includes("printer-info")) throw new Error("offline");
        if (path === `/tickets/${TICKET}` && (!opts?.method || opts.method === "GET")) {
          return { ticket: { holdedDocNumber: null, status: "PENDING_SYNC" } };
        }
        const bg = backgroundRoutes(path);
        if (bg !== undefined) return bg;
        throw new Error(`ruta inesperada: ${path}`);
      },
    );

    await renderCita();
    await click(buttonByText("Cobrar", false));
    // En SERVICES el botón de confirmar del modal se llama "Cerrar
    // servicio" (v1.3-Servicios-Pinta), no "Cobrar".
    await click(buttonByText("Cerrar servicio"));

    // A diferencia de la mesa, la cita SÍ pasa por "Ticket emitido": es
    // donde v1.15 puso la vuelta, y en peluquería el efectivo manda.
    expect(container.textContent).toContain("000042");
    // Y la cita se marca finalizada: el aviso sube a quien manda en la
    // agenda, con el id de la cita.
    expect(onAppointmentPaid).toHaveBeenCalledWith(CITA);
  });

  it("la cabecera dice de quién es la cita, y el fiado se explica", async () => {
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      const bg = backgroundRoutes(path);
      if (bg !== undefined) return bg;
      throw new Error(`ruta inesperada: ${path}`);
    });
    await renderCita();

    // Quién, no "Ticket de venta".
    expect(container.querySelector("h2")?.textContent).toBe("Rosa Marín");

    await click(buttonByText("Cobrar", false));
    // El tenant tiene fiado activado, pero en un borrador no cabe: no
    // desaparece en silencio.
    expect(container.textContent).toContain("no se pueden fiar");
    expect(
      Array.from(container.querySelectorAll("button")).some((b) =>
        (b.textContent ?? "").trim().startsWith("Fiado"),
      ),
    ).toBe(false);
  });

  it("'Volver a la agenda' no destruye el borrador", async () => {
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      const bg = backgroundRoutes(path);
      if (bg !== undefined) return bg;
      throw new Error(`ruta inesperada: ${path}`);
    });
    await renderCita();

    await click(buttonByText("Más", false));
    await click(buttonByText("Volver a la agenda", false));

    expect(onBackToAgenda).toHaveBeenCalled();
    // Ni un DELETE, ni un vaciado: el borrador se queda como está.
    const destructivas = apiMock.apiWithCashier.mock.calls.filter(
      ([, opts]) =>
        (opts as { method?: string } | undefined)?.method === "DELETE",
    );
    expect(destructivas).toHaveLength(0);
  });
});
