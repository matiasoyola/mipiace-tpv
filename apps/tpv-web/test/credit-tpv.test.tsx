// v1.8-Fiado · UI del TPV (headless, mismo patrón que checkout-outbox):
//   - CheckoutOverlay: botón "Fiado" → POST /tickets con creditSale:true
//     y payments:[]; sin contacto no envía y pide asignar cliente.
//   - DebtsScreen: lista GET /credits y cobra vía POST /credit-payments.
//   - TicketsHistoryPage: badge "Fiado · pendiente X €" en ON_CREDIT.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});
vi.mock("@mipiacetpv/ticket-pdf", () => ({ renderTicketPdf: vi.fn(async () => new Uint8Array()) }));
vi.mock("../src/lib/escposPrint.js", () => ({
  fetchTicketEscposBinary: vi.fn(),
  fetchCreditReceiptEscpos: vi.fn(async () => new Uint8Array()),
  getPairedUsbPrinter: vi.fn(async () => null),
  isWebUsbSupported: () => false,
  pairUsbPrinter: vi.fn(),
  printEscposUsb: vi.fn(),
  printTicketWifi: vi.fn(),
}));
vi.mock("../src/lib/catalog.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/catalog.js")>(
    "../src/lib/catalog.js",
  );
  return { ...actual, getCachedBusinessType: () => "RETAIL" as const };
});
vi.mock("../src/lib/syncNow.js", () => ({ syncNow: vi.fn(async () => undefined) }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,") } }));

import type { CartLine, CartTotals } from "../src/lib/cart.js";
import { __resetOutboxForTests } from "../src/lib/outbox.js";
import { CheckoutOverlay } from "../src/pages/CheckoutPage.js";
import { DebtsScreen } from "../src/pages/DebtsScreen.js";
import { TicketsHistoryPage } from "../src/pages/TicketsHistoryPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const line: CartLine = {
  id: "line-1",
  productId: "p-1",
  variantId: null,
  holdedProductId: null,
  sku: "PIPAS-1",
  nameSnapshot: "Saco pipas",
  units: 1,
  unitPrice: 10,
  unitPriceOverride: null,
  priceGross: 10,
  discountPct: 0,
  taxRate: 0,
  modifiers: [],
};
const totals: CartTotals = { subtotalNet: 10, tax: 0, discount: 0, total: 10 } as CartTotals;
const contact = {
  id: "c1",
  holdedContactId: "h-c1",
  name: "Juan Deudor",
  email: null,
  nif: null,
  phone: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await __resetOutboxForTests();
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  apiMock.apiWithCashier.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function settle(times = 20) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
function buttonByText(pred: (t: string) => boolean): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll("button")).find((b) =>
      pred(b.textContent?.trim() ?? ""),
    ) as HTMLButtonElement | undefined) ?? null
  );
}

describe("CheckoutOverlay · botón Fiado", () => {
  async function renderOverlay(withContact: boolean, onRequestAssignContact = vi.fn()) {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <CheckoutOverlay
          shiftId="shift-1"
          registerId="reg-1"
          lines={[line]}
          totals={totals}
          contact={withContact ? contact : null}
          notes=""
          businessType="RETAIL"
          creditSalesEnabled={true}
          onRequestAssignContact={onRequestAssignContact}
          onClose={vi.fn()}
          onConfirmed={vi.fn()}
        />,
      );
    });
  }

  it("con contacto: POST /tickets creditSale:true y payments vacío", async () => {
    let body: { creditSale?: boolean; payments?: unknown[] } | null = null;
    apiMock.apiWithCashier.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/tickets" && opts?.method === "POST") {
        body = opts.body as typeof body;
        return {
          ticket: { id: "t1", internalNumber: "000001", status: "ON_CREDIT", holdedDocNumber: null },
          syncStatus: "ON_CREDIT",
        };
      }
      throw new Error("offline");
    });

    await renderOverlay(true);
    const fiado = buttonByText((t) => t.startsWith("Fiado"));
    expect(fiado).not.toBeNull();
    await act(async () => fiado!.click());
    await settle();

    expect(body).not.toBeNull();
    expect(body!.creditSale).toBe(true);
    expect(body!.payments).toEqual([]);
  });

  it("sin contacto: no envía y pide asignar cliente", async () => {
    const onAssign = vi.fn();
    await renderOverlay(false, onAssign);
    const fiado = buttonByText((t) => t.startsWith("Fiado"));
    await act(async () => fiado!.click());
    await settle(3);

    const postCalls = apiMock.apiWithCashier.mock.calls.filter(
      (c) => c[0] === "/tickets" && (c[1] as { method?: string } | undefined)?.method === "POST",
    );
    expect(postCalls).toHaveLength(0);
    expect(onAssign).toHaveBeenCalled();
    expect(container.textContent).toContain("necesita un cliente");
  });
});

describe("DebtsScreen", () => {
  const credits = {
    contacts: [
      {
        contactHoldedId: "h-c1",
        name: "Juan Deudor",
        balance: 10,
        ticketCount: 1,
        tickets: [
          { id: "t1", internalNumber: "000010", total: 10, creditPending: 10, createdAt: "2026-07-03T10:00:00Z" },
        ],
      },
    ],
  };

  async function renderDebts() {
    root = createRoot(container);
    await act(async () => {
      root.render(<DebtsScreen shiftId="shift-1" storeName="Cachictos" onClose={vi.fn()} />);
    });
    await settle(5);
  }

  it("lista la deuda agregada por cliente", async () => {
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      if (path.startsWith("/credits")) return credits;
      throw new Error("offline");
    });
    await renderDebts();
    expect(container.textContent).toContain("Juan Deudor");
    expect(container.textContent).toContain("10,00 €");
  });

  it("cobrar → POST /credit-payments con importe y método", async () => {
    let payBody: { amount?: number; method?: string; shiftId?: string } | null = null;
    apiMock.apiWithCashier.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path.startsWith("/credits")) return credits;
      if (path.includes("/credit-payments") && opts?.method === "POST") {
        payBody = opts.body as typeof payBody;
        return {
          settled: true,
          ticket: { id: "t1", status: "PAID", internalNumber: "000010", creditPending: 0 },
          receipt: {
            debtorName: "Juan Deudor",
            internalNumber: "000010",
            amount: 10,
            method: "CASH",
            remaining: 0,
            collectedAt: "2026-07-03T10:05:00Z",
          },
        };
      }
      throw new Error(`ruta inesperada: ${path}`);
    });

    await renderDebts();
    // Expandir el contacto.
    const contactBtn = buttonByText((t) => t.includes("Juan Deudor"));
    await act(async () => contactBtn!.click());
    await settle(3);
    // Cobrar.
    const cobrar = buttonByText((t) => t === "Cobrar");
    expect(cobrar).not.toBeNull();
    await act(async () => cobrar!.click());
    await settle();

    expect(payBody).not.toBeNull();
    expect(payBody!.amount).toBe(10);
    expect(payBody!.method).toBe("CASH");
    expect(payBody!.shiftId).toBe("shift-1");
    expect(container.textContent).toContain("deuda saldada");
  });
});

describe("TicketsHistoryPage · badge fiado", () => {
  it("un ON_CREDIT muestra Fiado y el importe pendiente", async () => {
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      if (path.startsWith("/tickets?")) {
        return {
          items: [
            {
              id: "t1",
              internalNumber: "000010",
              externalId: "e1",
              status: "ON_CREDIT",
              creditPending: 7.5,
              total: 10,
              totalTax: 0,
              totalDiscount: 0,
              createdAt: "2026-07-03T10:00:00Z",
              holdedDocNumber: null,
              lines: [],
              payments: [],
              refunds: [],
            },
          ],
        };
      }
      throw new Error("offline");
    });

    root = createRoot(container);
    await act(async () => {
      root.render(<TicketsHistoryPage onClose={vi.fn()} />);
    });
    // El historial debouncea la carga 250ms.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 320));
    });
    await settle(5);

    expect(container.textContent).toContain("Fiado");
    expect(container.textContent).toContain("pendiente");
    expect(container.textContent).toContain("7,50 €");
  });
});
