// auditoria-sirope · la hoja de cobro del 18-10.
//
//   #2 · pasar de Efectivo a otro método arrastraba el importe tecleado:
//        con 10 € sobre una cuenta de 3 €, tocar Tarjeta dejaba «Sobran
//        7 €» y «Cobrar» en gris. (Capturas 16, 17.)
//   #3 · los billetes SUSTITUÍAN en vez de sumar: 5 y luego 10 dejaba 10.
//   #1 · el cambio a devolver iba a 15 px mientras el TOTAL iba a 30.
//
// Las filas de la tabla de sabotajes que viven aquí:
//
//   | `pickMethod` conserva el importe al pasar a Tarjeta
//   | El segundo billete sustituye en vez de sumar
//   | El cambio vuelve a 15 px

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

// La cuenta de la captura: una tostada de 3,00 €.
const lines: CartLine[] = [
  {
    id: "line-1",
    productId: "p-1",
    variantId: null,
    holdedProductId: null,
    sku: "TOS1",
    nameSnapshot: "Tostada con tomate",
    units: 1,
    unitPrice: 2.7273,
    unitPriceOverride: null,
    priceGross: 3,
    discountPct: 0,
    taxRate: 10,
    modifiers: [],
  },
];

const totals: CartTotals = {
  subtotalNet: 2.73,
  tax: 0.27,
  discount: 0,
  total: 3,
} as CartTotals;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await __resetOutboxForTests();
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async () => ({
    ticket: {
      id: "t-1",
      internalNumber: "000026",
      status: "PAID",
      holdedDocNumber: null,
    },
    syncStatus: "SYNCED",
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  try {
    await act(async () => root.unmount());
  } catch {
    /* ya desmontado */
  }
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
        businessType="HOSPITALITY"
        onClose={vi.fn()}
        onConfirmed={vi.fn()}
      />,
    );
  });
}

async function click(el: Element | null | undefined) {
  if (!el) throw new Error("elemento no encontrado");
  await act(async () => {
    (el as HTMLButtonElement).click();
  });
}

const $ = <T extends HTMLElement>(sel: string): T | null =>
  container.querySelector<T>(sel);

function botonPorTexto(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!btn) throw new Error(`botón "${text}" no encontrado`);
  return btn as HTMLButtonElement;
}

/** El importe de la primera fila de pago, como número. */
function importeEfectivo(): number {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label^="Importe "]',
  );
  if (!input) throw new Error("no hay fila de pago");
  return Number(input.value.replace(/\./g, "").replace(",", "."));
}

describe("#2 · cambiar de método vuelve al total", () => {
  it("con 10 € de efectivo tecleados, pasar a Tarjeta deja 3,00 €", async () => {
    await renderOverlay();
    // El cliente saca un billete de 10 sobre una cuenta de 3.
    await click($('[data-testid="billete-10"]'));
    expect(importeEfectivo()).toBeCloseTo(10, 2);

    // Y al final paga con tarjeta.
    await click(botonPorTexto("Tarjeta"));
    expect(importeEfectivo()).toBeCloseTo(3, 2);
    // Y «Cobrar» no se queda gris por un importe de otro cobro.
    expect(container.textContent).not.toMatch(/Sobran/i);
  });

  it("volver a Efectivo arranca en el total, no en lo de antes", async () => {
    await renderOverlay();
    await click($('[data-testid="billete-20"]'));
    await click(botonPorTexto("Tarjeta"));
    await click(botonPorTexto("Efectivo"));
    expect(importeEfectivo()).toBeCloseTo(3, 2);
  });
});

describe("#3 · los billetes suman", () => {
  it("el primero sustituye el importe exacto: 3,00 → 5", async () => {
    await renderOverlay();
    expect(importeEfectivo()).toBeCloseTo(3, 2);
    await click($('[data-testid="billete-5"]'));
    expect(importeEfectivo()).toBeCloseTo(5, 2);
  });

  it("el segundo SUMA: 5 + 10 = 15", async () => {
    await renderOverlay();
    await click($('[data-testid="billete-5"]'));
    await click($('[data-testid="billete-10"]'));
    expect(importeEfectivo()).toBeCloseTo(15, 2);
  });

  it("«C» deja el importe a cero y vuelve a empezar", async () => {
    await renderOverlay();
    await click($('[data-testid="billete-5"]'));
    await click($('[data-testid="billete-10"]'));
    await click($('[data-testid="billete-limpiar"]'));
    expect(importeEfectivo()).toBeCloseTo(0, 2);
    await click($('[data-testid="billete-20"]'));
    expect(importeEfectivo()).toBeCloseTo(20, 2);
  });

  it("«Importe exacto» vuelve a ser un importe de la casa: el billete siguiente sustituye", async () => {
    await renderOverlay();
    await click($('[data-testid="billete-50"]'));
    await click($('[data-testid="importe-exacto"]'));
    expect(importeEfectivo()).toBeCloseTo(3, 2);
    await click($('[data-testid="billete-5"]'));
    expect(importeEfectivo()).toBeCloseTo(5, 2);
  });
});
