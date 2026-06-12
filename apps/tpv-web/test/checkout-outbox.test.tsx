// CheckoutOverlay + outbox (v1.5-consistencia-C).
//
// Verifica el contrato de "cero ventas perdidas" a nivel de UI:
//   1. Red OK: el payload se persiste en el outbox ANTES de lanzar el
//      POST (se comprueba DENTRO del mock del POST) y se borra al 2xx.
//   2. Red caída: la pantalla de éxito en modo "pendiente de enviar"
//      aparece igualmente, el item queda pending, y cuando el reenvío
//      confirma, la pantalla pasa sola al SuccessOverlay completo.
//   3. 422 interactivo: error inline, sin item residual en el outbox
//      (el cajero está delante; corrige y recobra).
//
// Mismo patrón sin testing-library que shift-force-close-sync-pending:
// createRoot + act + eventos nativos. Los módulos pesados que arrastra
// SuccessOverlay (pdf, ESC/POS, QR) van mockeados — aquí sólo importa
// el flujo del outbox.

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
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));

import { ApiError } from "../src/api.js";
import type { CartLine, CartTotals } from "../src/lib/cart.js";
import {
  __resetOutboxForTests,
  flushOutbox,
  outboxList,
} from "../src/lib/outbox.js";
import { CheckoutOverlay } from "../src/pages/CheckoutPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const line: CartLine = {
  id: "line-1",
  productId: "p-1",
  variantId: null,
  holdedProductId: null,
  sku: "CAFE-1",
  nameSnapshot: "Café",
  units: 1,
  unitPrice: 1.4,
  unitPriceOverride: null,
  priceGross: 1.54,
  discountPct: 0,
  taxRate: 10,
  modifiers: [],
};

const totals: CartTotals = {
  subtotalNet: 1.4,
  tax: 0.14,
  discount: 0,
  total: 1.54,
} as CartTotals;

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

async function renderOverlay(onConfirmed = vi.fn()) {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <CheckoutOverlay
        shiftId="shift-1"
        registerId="reg-1"
        lines={[line]}
        totals={totals}
        contact={null}
        notes=""
        businessType="RETAIL"
        onClose={vi.fn()}
        onConfirmed={onConfirmed}
      />,
    );
  });
  return onConfirmed;
}

// El click dispara submit() async cuyas escrituras IDB (fake-indexeddb)
// resuelven en macrotareas posteriores: drenamos varios turnos dentro
// de act para que React procese los setState resultantes.
async function clickCobrarAndSettle() {
  await act(async () => {
    cobrarButton().click();
  });
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function cobrarButton(): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Cobrar",
  );
  if (!btn) throw new Error("botón Cobrar no encontrado");
  return btn as HTMLButtonElement;
}

// Respuestas para los GET que dispara SuccessOverlay (polling Holded,
// payload digital, printer-info). Sin red o irrelevantes para estos
// tests — el overlay los tolera.
function routeSuccessOverlayGets(path: string): unknown {
  if (path.includes("/digital")) throw new Error("offline");
  if (path.includes("printer-info")) throw new Error("offline");
  if (path.startsWith("/tickets/")) {
    return { ticket: { holdedDocNumber: null, status: "PENDING_SYNC" } };
  }
  throw new Error(`ruta inesperada: ${path}`);
}

describe("CheckoutOverlay · outbox offline", () => {
  it("red OK: persiste en outbox ANTES del POST y borra al confirmar", async () => {
    let outboxSizeAtPostTime = -1;
    apiMock.apiWithCashier.mockImplementation(
      async (path: string, opts?: { method?: string; body?: { externalId?: string } }) => {
        if (path === "/tickets" && opts?.method === "POST") {
          const items = await outboxList();
          outboxSizeAtPostTime = items.filter(
            (i) => i.externalId === opts.body?.externalId,
          ).length;
          return {
            ticket: {
              id: "t1",
              internalNumber: "000001",
              status: "PENDING_SYNC",
              holdedDocNumber: null,
            },
            syncStatus: "PENDING",
          };
        }
        return routeSuccessOverlayGets(path);
      },
    );

    await renderOverlay();
    await clickCobrarAndSettle();

    expect(outboxSizeAtPostTime).toBe(1);
    expect(container.textContent).toContain("Ticket emitido");
    expect(await outboxList()).toHaveLength(0);
  });

  it("red caída: 'Venta guardada — pendiente de enviar' y el item queda pending; al confirmar el reenvío pasa al éxito completo", async () => {
    apiMock.apiWithCashier.mockRejectedValue(new TypeError("Failed to fetch"));

    await renderOverlay();
    await clickCobrarAndSettle();

    expect(
      container.querySelector('[data-testid="pending-sale-pending"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Venta guardada");
    expect(container.textContent).toContain("Pendiente de enviar");

    const items = await outboxList();
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe("pending");
    expect(items[0]!.lockedAt).toBeNull();

    // Vuelve la red: el flush confirma y la pantalla se actualiza sola.
    apiMock.apiWithCashier.mockImplementation(
      async (path: string, opts?: { method?: string }) => {
        if (path === "/tickets" && opts?.method === "POST") {
          return {
            ticket: {
              id: "t1",
              internalNumber: "000001",
              status: "PENDING_SYNC",
              holdedDocNumber: null,
            },
            syncStatus: "PENDING",
          };
        }
        return routeSuccessOverlayGets(path);
      },
    );
    await act(async () => {
      await flushOutbox();
    });

    expect(container.textContent).toContain("Ticket emitido");
    expect(container.textContent).toContain("#000001");
    expect(await outboxList()).toHaveLength(0);
  });

  it("422 interactivo: error inline, sin item residual y sin pantalla de éxito", async () => {
    apiMock.apiWithCashier.mockRejectedValue(
      new ApiError(422, "IVA inválido", "VALIDATION_ERROR"),
    );

    await renderOverlay();
    await clickCobrarAndSettle();

    expect(container.textContent).toContain("IVA inválido");
    expect(container.textContent).not.toContain("Venta guardada");
    expect(cobrarButton()).not.toBeNull();
    expect(await outboxList()).toHaveLength(0);
  });
});
