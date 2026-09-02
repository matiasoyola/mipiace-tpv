// Cobro mixto (v1.10.3-barra · hallazgo #1 de la simulación de hora
// punta del 2026-08-20).
//
// El bug: con una cuenta de 14,00 € se elegía "Mixto", se ponía
// Efectivo 10 y Tarjeta 4, y el modal seguía diciendo "Falta 4,00 €"
// con el botón Cobrar deshabilitado. El reparto vivía en un panel
// montado al final del body scrollable, debajo del pie fijo del modal:
// el cajero no lo veía, nunca pulsaba "Aplicar mixto" y la segunda
// fila de pago no llegaba a crearse.
//
// Estos tests fijan el contrato de la caja registradora:
//   1. "Mixto" crea DOS filas de pago visibles, sin pasos intermedios.
//   2. Al escribir el primer importe, el segundo se completa con el
//      resto (10 → 4) y el modal deja de decir que falta dinero.
//   3. El POST viaja con los dos pagos y Σ pagos == total.
//   4. Un reparto que NO cubre el total sigue bloqueando "Cobrar".
//
// Mismo patrón sin testing-library que checkout-outbox: createRoot +
// act + eventos nativos.

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

import type { CartLine, CartTotals } from "../src/lib/cart.js";
import { __resetOutboxForTests } from "../src/lib/outbox.js";
import { CheckoutOverlay } from "../src/pages/CheckoutPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Cuenta de 14,00 € — la del grupo T4+M3+M5 de la simulación.
const lines: CartLine[] = [
  {
    id: "line-1",
    productId: "p-1",
    variantId: null,
    holdedProductId: null,
    sku: "REFRESCO",
    nameSnapshot: "Refresco",
    units: 4,
    unitPrice: 2.2727,
    unitPriceOverride: null,
    priceGross: 2.5,
    discountPct: 0,
    taxRate: 10,
    modifiers: [],
  },
  {
    id: "line-2",
    productId: "p-2",
    variantId: null,
    holdedProductId: null,
    sku: "CERVEZA",
    nameSnapshot: "Cerveza",
    units: 2,
    unitPrice: 1.6529,
    unitPriceOverride: null,
    priceGross: 2.0,
    discountPct: 0,
    taxRate: 21,
    modifiers: [],
  },
];

const totals: CartTotals = {
  subtotalNet: 12.4,
  tax: 1.6,
  discount: 0,
  total: 14,
} as CartTotals;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await __resetOutboxForTests();
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string) => {
    if (path === "/tickets") {
      return {
        ticket: {
          id: "t-1",
          internalNumber: "000015",
          status: "PAID",
          holdedDocNumber: null,
        },
        syncStatus: "SYNCED",
      };
    }
    throw new Error("GET no esperado: " + path);
  });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderOverlay() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <CheckoutOverlay
        shiftId="shift-1"
        registerId="reg-1"
        lines={lines}
        totals={totals}
        contact={null}
        notes=""
        businessType="RETAIL"
        onClose={vi.fn()}
        onConfirmed={vi.fn()}
      />,
    );
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!btn) throw new Error(`botón "${text}" no encontrado`);
  return btn as HTMLButtonElement;
}

// Inputs de importe: los que llevan aria-label "Importe <método>".
function amountInputs(): HTMLInputElement[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>(
      'input[aria-label^="Importe "]',
    ),
  );
}

// v1.12-manos-de-camarero · los importes ya no se escriben en el
// <input> (es `readOnly` + `inputMode="none"` para que el teclado de
// Android no aparezca nunca). Se teclean con el CashPad del pie: tocar
// el campo lo activa, y las teclas del pad escriben encima. El test
// hace exactamente lo que hace el dedo del camarero.
function padKey(label: string): HTMLButtonElement {
  const pad = container.querySelector('[data-testid="cash-pad"]');
  if (!pad) throw new Error("el CashPad no está abierto");
  const btn = Array.from(pad.querySelectorAll("button")).find(
    (b) =>
      b.textContent?.trim() === label ||
      b.getAttribute("aria-label") === label,
  );
  if (!btn) throw new Error(`tecla "${label}" no encontrada en el pad`);
  return btn as HTMLButtonElement;
}

async function typeAmount(index: number, value: string) {
  await act(async () => {
    amountInputs()[index]!.click();
  });
  // C primero: el pad escribe encima de lo que hubiera.
  await click(padKey("Limpiar importe"));
  for (const ch of value) {
    await click(padKey(ch === "," ? "Coma decimal" : ch));
  }
}

async function click(btn: HTMLButtonElement) {
  await act(async () => {
    btn.click();
  });
}

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe("v1.10.3-barra · cobro mixto", () => {
  it("al abrir hay UNA fila con el total y el reparto cuadra", async () => {
    await renderOverlay();
    const rows = amountInputs();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe("14,00");
    expect(container.textContent).toContain("cuadra");
    expect(container.textContent).not.toContain("Falta");
    expect(buttonByText("Cobrar").disabled).toBe(false);
  });

  it("«Mixto» abre DOS filas de pago sin pasos intermedios", async () => {
    await renderOverlay();
    await click(buttonByText("Mixto"));
    const rows = amountInputs();
    expect(rows).toHaveLength(2);
    // Primaria vacía (la teclea el cajero), secundaria con el resto.
    expect(rows[0]!.value).toBe("");
    expect(rows[1]!.value).toBe("14,00");
    // Ya no existe ningún paso "Aplicar mixto" escondido en el body.
    const labels = Array.from(container.querySelectorAll("button")).map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).not.toContain("Aplicar mixto");
  });

  it("Efectivo 10 + Tarjeta 4 = 14: cuadra y Cobrar se habilita", async () => {
    await renderOverlay();
    await click(buttonByText("Mixto"));

    await typeAmount(0, "10");

    const rows = amountInputs();
    expect(rows[0]!.value).toBe("10");
    // El resto se reparte solo en la última fila.
    expect(rows[1]!.value).toBe("4,00");
    expect(container.textContent).toContain("Efectivo + Tarjeta");
    expect(container.textContent).toContain("14,00 € · cuadra");
    expect(container.textContent).not.toContain("Falta");
    expect(buttonByText("Cobrar").disabled).toBe(false);
  });

  it("el POST lleva los dos pagos y Σ pagos == total", async () => {
    await renderOverlay();
    await click(buttonByText("Mixto"));
    await typeAmount(0, "10");
    await click(buttonByText("Cobrar"));
    await settle();

    const call = apiMock.apiWithCashier.mock.calls.find(
      (c) => c[0] === "/tickets",
    );
    expect(call).toBeTruthy();
    const payments = (
      call![1] as { body: { payments: { method: string; amount: number }[] } }
    ).body.payments;
    expect(payments).toHaveLength(2);
    expect(payments.map((p) => p.method)).toEqual(["CASH", "CARD"]);
    expect(payments.map((p) => p.amount)).toEqual([10, 4]);
    const sum = payments.reduce((acc, p) => acc + p.amount, 0);
    expect(sum).toBeCloseTo(totals.total, 2);
  });

  it("el segundo importe escrito a mano manda y también suma", async () => {
    await renderOverlay();
    await click(buttonByText("Mixto"));
    // El cajero escribe las DOS filas: 6 en efectivo, 8 con tarjeta.
    await typeAmount(1, "8");
    await typeAmount(0, "6");
    const rows = amountInputs();
    // La última fila queda fijada: no se recalcula por debajo.
    expect(rows[1]!.value).toBe("8");
    expect(container.textContent).toContain("14,00 € · cuadra");
    expect(buttonByText("Cobrar").disabled).toBe(false);
  });

  it("un reparto que no llega al total dice cuánto falta y bloquea Cobrar", async () => {
    await renderOverlay();
    await click(buttonByText("Mixto"));
    await typeAmount(1, "4");
    await typeAmount(0, "6");
    expect(container.textContent).toContain("Falta 4,00 €");
    expect(buttonByText("Cobrar").disabled).toBe(true);
  });

  it("volver a pulsar «Mixto» deja una sola fila con el total", async () => {
    await renderOverlay();
    await click(buttonByText("Mixto"));
    await typeAmount(0, "10");
    await click(buttonByText("Mixto"));
    const rows = amountInputs();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe("14,00");
    expect(buttonByText("Cobrar").disabled).toBe(false);
  });

  it("los importes se pintan con coma, no con punto", async () => {
    await renderOverlay();
    expect(container.textContent).toContain("14,00 €");
    expect(container.textContent).not.toContain("14.00");
    expect(container.textContent).not.toMatch(/\d\.\d{2}\s*€/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Addendum de la review (2026-08-26): el exceso.
//
// El server sólo rechaza que Σ pagos sea MENOR que el total (400
// PAYMENTS_MISMATCH). Todo lo que sobra pasa. Con una sola fila eso era
// el cambio en efectivo de toda la vida; desde que el mixto funciona de
// verdad, también deja cobrar de más con la tarjeta —que no devuelve
// cambio— y deja colar filas de 0,00 €.
describe("v1.10.3-addendum · el exceso", () => {
  it("15 € en TARJETA sobre 14 € no se cobra: no hay de dónde devolver 1 €", async () => {
    await renderOverlay();
    await click(buttonByText("Mixto"));
    // El cajero escribe de más en la fila de tarjeta y deja la de
    // efectivo vacía.
    await typeAmount(1, "15");
    expect(container.textContent).toContain("Sobran 1,00 €");
    expect(container.textContent).toContain("baja el importe");
    expect(buttonByText("Cobrar").disabled).toBe(true);
  });

  it("20 € en efectivo sobre 14 € sí se cobra: son 6 € de cambio", async () => {
    await renderOverlay();
    await click(buttonByText("Mixto"));
    await typeAmount(0, "20");
    expect(container.textContent).toContain("Cambio");
    expect(container.textContent).not.toContain("baja el importe");
    expect(buttonByText("Cobrar").disabled).toBe(false);
  });

  it("la fila que el reparto deja en 0,00 € NO viaja en el POST", async () => {
    await renderOverlay();
    await click(buttonByText("Mixto"));
    // 20 en efectivo sobre 14: el reparto deja la tarjeta en 0,00 €.
    await typeAmount(0, "20");
    expect(amountInputs()[1]!.value).toBe("0,00");

    await click(buttonByText("Cobrar"));
    await settle();

    const call = apiMock.apiWithCashier.mock.calls.find(
      (c) => c[0] === "/tickets",
    );
    const payments = (
      call![1] as { body: { payments: { method: string; amount: number }[] } }
    ).body.payments;
    // Un cobro con tarjeta de 0,00 € no existió: ni en el ticket, ni en
    // el desglose del Z, ni en el recibo de Holded.
    expect(payments).toHaveLength(1);
    // v1.15-la-vuelta-existe §1 · y el efectivo viaja topeado al total:
    // el billete de 20 se cobró contra una cuenta de 14. Los 6 € de
    // vuelta viven sólo en `cashAmount`.
    expect(payments[0]).toMatchObject({ method: "CASH", amount: 14 });
    const cashAmount = (call![1] as { body: { cashAmount?: number } }).body
      .cashAmount;
    expect(cashAmount).toBe(20);
  });
});

