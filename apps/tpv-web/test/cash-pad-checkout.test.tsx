// v1.12-manos-de-camarero · el teclado de Android no aparece en el
// cobro (hallazgo H2 del 2026-08-27, el peor de la sesión).
//
// En el terminal, tocar el importe abría el teclado del sistema: tapaba
// el 52 % inferior de la pantalla —métodos de pago y botón Cobrar
// incluidos—, sacaba el menú nativo "Cortar / Copiar / Seleccionar
// todo" sobre el ticket y encima salía el de símbolos, no un pad de
// caja. Aquí se fija que los campos de importe llevan la coraza que
// impide que eso vuelva a pasar, y que quien escribe es nuestro pad.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

const lines: CartLine[] = [
  {
    id: "line-1",
    productId: "p-1",
    nameSnapshot: "Café solo",
    priceGross: 1.5,
    taxRate: 10,
    units: 2,
    discountPct: 0,
    modifiers: [],
    modifierSelections: [],
  } as unknown as CartLine,
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
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  await __resetOutboxForTests();
  apiMock.apiWithCashier.mockReset();
  apiMock.apiWithCashier.mockImplementation(async (path: string) => {
    if (path === "/tickets") {
      return {
        ticket: {
          id: "t-1",
          internalNumber: "000001",
          status: "PAID",
          holdedDocNumber: null,
        },
        syncStatus: "SYNCED",
      };
    }
    throw new Error("llamada no esperada: " + path);
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderOverlay() {
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

function amountInputs(): HTMLInputElement[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[aria-label^="Importe "]'),
  );
}

function pad(): HTMLElement | null {
  return container.querySelector('[data-testid="cash-pad"]');
}

function padKey(label: string): HTMLButtonElement {
  const p = pad();
  if (!p) throw new Error("el CashPad no está abierto");
  const btn = Array.from(p.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
  if (!btn) throw new Error(`tecla "${label}" no encontrada`);
  return btn as HTMLButtonElement;
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!btn) throw new Error(`botón "${text}" no encontrado`);
  return btn as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

describe("v1.12 · la hoja de cobro no abre el teclado del sistema", () => {
  it("el campo de importe es de sólo lectura y no pide teclado", async () => {
    await renderOverlay();
    const input = amountInputs()[0]!;
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute("inputmode")).toBe("none");
    // Y no queda ni un `inputMode` de los que abrían el IME en el resto
    // de la hoja de cobro.
    expect(
      container.querySelectorAll('[inputmode="decimal"], [inputmode="numeric"]'),
    ).toHaveLength(0);
  });

  it("si algo intenta enfocarlo, se quita el foco solo", async () => {
    await renderOverlay();
    const input = amountInputs()[0]!;
    await act(async () => {
      input.focus();
    });
    expect(document.activeElement).not.toBe(input);
  });

  it("mata el menú nativo de Cortar / Copiar / Seleccionar todo", async () => {
    await renderOverlay();
    const input = amountInputs()[0]!;
    expect(input.style.userSelect).toBe("none");
    // Las variantes con prefijo (`-webkit-user-select`,
    // `-webkit-touch-callout`) son las que de verdad matan el menú en el
    // WebKit de Android, pero jsdom descarta las propiedades que no
    // conoce, así que aquí no se pueden leer del DOM. Se comprueban
    // sobre el componente y se verifican en navegador en el bucle
    // visual del bloque.
    const source = readFileSync(
      resolve(process.cwd(), "apps/tpv-web/src/components/AmountField.tsx"),
      "utf8",
    );
    expect(source).toContain('WebkitUserSelect: "none"');
    expect(source).toContain('WebkitTouchCallout: "none"');
  });
});

describe("v1.12 · el CashPad de la hoja de cobro", () => {
  it("está cerrado al abrir y aparece al tocar el importe", async () => {
    await renderOverlay();
    expect(pad()).toBeNull();
    await click(amountInputs()[0]!);
    expect(pad()).not.toBeNull();
  });

  it("escribe sobre el campo activo y «Cobrar» sigue en pantalla", async () => {
    await renderOverlay();
    await click(amountInputs()[0]!);
    await click(padKey("Limpiar importe"));
    await click(padKey("5"));
    await click(padKey("Coma decimal"));
    await click(padKey("0"));
    await click(padKey("0"));
    expect(amountInputs()[0]!.value).toBe("5,00");
    // El pad convive con el botón primario: no lo tapa ni lo desplaza
    // fuera del árbol.
    expect(buttonByText("Cobrar")).toBeTruthy();
    // Y el pad va DESPUÉS del campo y ANTES del botón, que es el reparto
    // que fija el bloque: cabecera + total, campo activo, pad, botón.
    const order = container.querySelector('[data-testid="cash-pad"]')!
      .compareDocumentPosition(buttonByText("Cobrar"));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("«Listo» cierra el pad sin tocar el importe", async () => {
    await renderOverlay();
    await click(amountInputs()[0]!);
    await click(padKey("Limpiar importe"));
    await click(padKey("9"));
    await click(buttonByText("Listo"));
    expect(pad()).toBeNull();
    expect(amountInputs()[0]!.value).toBe("9");
  });

  it("campo vacío ≠ 0,00: sin importe no se cobra", async () => {
    await renderOverlay();
    await click(amountInputs()[0]!);
    await click(padKey("Limpiar importe"));
    expect(amountInputs()[0]!.value).toBe("");
    expect(container.textContent).toContain("Falta 3,00 €");
    expect(buttonByText("Cobrar").disabled).toBe(true);
  });

  it("el importe tecleado con el pad llega al POST en euros", async () => {
    await renderOverlay();
    await click(amountInputs()[0]!);
    await click(padKey("Limpiar importe"));
    await click(padKey("5"));
    await click(buttonByText("Listo"));
    await click(buttonByText("Cobrar"));
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    const call = apiMock.apiWithCashier.mock.calls.find((c) => c[0] === "/tickets");
    const payments = (
      call![1] as { body: { payments: { method: string; amount: number }[] } }
    ).body.payments;
    expect(payments).toEqual([{ method: "CASH", amount: 5 }]);
  });
});

describe("v1.12 · higiene de la hoja de cobro", () => {
  it("email y ticket regalo se pliegan tras «Más opciones»", async () => {
    await renderOverlay();
    expect(container.textContent).toContain("Imprimir ticket");
    expect(container.textContent).not.toContain("Ticket regalo");
    expect(container.textContent).not.toContain("Enviar por email");

    await click(buttonByText("Más opciones"));
    expect(container.textContent).toContain("Ticket regalo");
    expect(container.textContent).toContain("Enviar por email");
  });
});
