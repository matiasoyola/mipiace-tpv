// v1.12-manos-de-camarero · el arqueo se teclea con nuestro pad
// (hallazgos H2 y H7 del 2026-08-27).
//
// El arqueo Z pide 15 denominaciones. En el terminal, cada una abría el
// teclado de Android encima del modal y desplazaba el contenido; en ese
// baile el turno se cerró SIN que nadie pulsara "Cerrar turno"
// deliberadamente, con 104,00 € contados frente a 104,50 € esperados.
//
// Aquí se fija que:
//   1. Los campos de cantidad no piden teclado del sistema.
//   2. Se cuentan unidades, no euros: el pad va sin coma.
//   3. "Cerrar turno" no queda en la zona donde caen los dedos: va
//      ANTES del pad en el documento, no debajo.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});
vi.mock("../src/lib/outbox.js", () => ({
  outboxAdd: vi.fn(),
  outboxCounts: vi.fn(async () => ({ pending: 0, rejected: 0 })),
  outboxList: vi.fn(async () => []),
}));
vi.mock("../src/lib/offlineShift.js", () => ({
  getLocalShift: vi.fn(async () => null),
  closeLocalShift: vi.fn(async () => undefined),
}));

import { CloseShiftModal } from "../src/pages/CloseShiftModal.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  apiMock.apiWithCashier.mockReset();
  // El modal arranca pidiendo el resumen del turno; sin él cae a la
  // tabla de denominaciones, que es justo la fase que queremos.
  apiMock.apiWithCashier.mockRejectedValue(new Error("sin resumen"));
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderModal() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <CloseShiftModal
        shiftId="shift-1"
        cashierRole="MANAGER"
        requireCashCountOnClose
        onClose={vi.fn()}
        onClosed={vi.fn()}
      />,
    );
  });
  // Deja resolver el GET del resumen.
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function countField(label: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(
    `input[aria-label="Cantidad de ${label}"]`,
  );
  if (!el) throw new Error(`no encuentro el campo de ${label}`);
  return el;
}

function pad(): HTMLElement | null {
  return container.querySelector('[data-testid="cash-pad"]');
}

function padKey(label: string): HTMLButtonElement {
  const p = pad();
  if (!p) throw new Error("el CashPad no está abierto");
  const btn = Array.from(p.querySelectorAll("button")).find(
    (b) =>
      b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
  if (!btn) throw new Error(`tecla "${label}" no encontrada`);
  return btn as HTMLButtonElement;
}

function buttonWith(text: string): HTMLButtonElement {
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

describe("v1.12 · el arqueo no abre el teclado del sistema", () => {
  it("las 15 denominaciones son campos de sólo lectura", async () => {
    await renderModal();
    const fields = container.querySelectorAll<HTMLInputElement>(
      'input[aria-label^="Cantidad de "]',
    );
    expect(fields.length).toBe(15);
    for (const f of fields) {
      expect(f.readOnly).toBe(true);
      expect(f.getAttribute("inputmode")).toBe("none");
    }
  });

  it("el pad se abre sobre la denominación tocada y cuenta unidades", async () => {
    await renderModal();
    expect(pad()).toBeNull();
    await click(countField("20 €"));
    expect(pad()).not.toBeNull();
    expect(container.textContent).toContain("Contando 20 €");

    await click(padKey("3"));
    expect(countField("20 €").value).toBe("3");
    // 3 billetes de 20 son 60 € contados.
    expect(container.textContent).toContain("60,00 €");
  });

  it("sin coma: son unidades, no euros", async () => {
    await renderModal();
    await click(countField("50 €"));
    expect(() => padKey("Coma decimal")).toThrow();
    expect(padKey("0").className).toContain("col-span-2");
  });

  it("el pad escribe sobre una denominación cada vez", async () => {
    await renderModal();
    await click(countField("10 €"));
    await click(padKey("2"));
    await click(countField("5 €"));
    await click(padKey("4"));
    expect(countField("10 €").value).toBe("2");
    expect(countField("5 €").value).toBe("4");
    // 2×10 + 4×5 = 40 €.
    expect(container.textContent).toContain("40,00 €");
  });
});

describe("v1.12 · «Cerrar turno» fuera de la zona de tecleo (H7)", () => {
  it("el botón destructivo va ANTES del pad, no debajo", async () => {
    await renderModal();
    await click(countField("20 €"));
    const cerrar = buttonWith("Cerrar turno");
    const position = cerrar.compareDocumentPosition(pad()!);
    // El pad viene DESPUÉS de "Cerrar turno": el dedo que teclea nunca
    // pasa por encima del botón que cierra el día.
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("«Listo» cierra el pad y deja el recuento intacto", async () => {
    await renderModal();
    await click(countField("20 €"));
    await click(padKey("3"));
    await click(buttonWith("Listo"));
    expect(pad()).toBeNull();
    expect(countField("20 €").value).toBe("3");
  });
});
