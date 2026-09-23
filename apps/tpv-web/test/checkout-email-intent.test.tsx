// Sole · el campo "Enviar por email" de la hoja de cobro.
//
// Lo que cierra: el 17-09-2026 Ana tecleó "abc", el TPV lo aceptó y lo
// mandó. Aquí se fija la regla entera de ese campo, que tiene DOS mitades
// y las dos importan:
//
//   1. Avisa de que el email no vale, al lado del campo.
//   2. Y NO bloquea el cobro. Si el email no vale, la venta entra igual
//      y sale sin `emailIntent`. Una invariante rota nunca tumba una
//      venta — el dinero ya ha cambiado de manos.
//
// El aviso aparece al SALIR del campo, no con cada tecla: a la tercera
// letra de "ana@…" ningún email es válido todavía, y un aviso que
// aparece mientras escribes enseña a ignorar los avisos.

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
  syncUsbPairingWithServerConfig: vi.fn(async () => {}),
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));
// La peluquería de Sole. El overlay lee la vertical de la caché, no de
// la prop; de ahí sale "Nuevo servicio". El título sigue siendo "Ticket
// emitido" a propósito: `vocab.ts:39-45` lo fija con el feedback de la
// propia Sole del 25-05-2026 — el cajero asocia "Ticket" al acto de
// venta aunque la vertical sea servicios.
vi.mock("../src/lib/catalog.js", () => ({
  getCachedBusinessType: () => "SERVICES" as const,
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => false,
  getCachedHoldedEnabled: () => true,
}));

import type { CartLine, CartTotals } from "../src/lib/cart.js";
import { __resetOutboxForTests } from "../src/lib/outbox.js";
import { CheckoutOverlay } from "../src/pages/CheckoutPage.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// El servicio del 000257: 42,40 € con IVA.
const line: CartLine = {
  id: "line-1",
  productId: "p-1",
  variantId: null,
  holdedProductId: null,
  sku: "SRV-COLOR",
  nameSnapshot: "Corte + color",
  units: 1,
  unitPrice: 35.04,
  unitPriceOverride: null,
  priceGross: 42.4,
  discountPct: 0,
  taxRate: 21,
  modifiers: [],
};

const totals: CartTotals = {
  subtotalNet: 35.04,
  tax: 7.36,
  discount: 0,
  total: 42.4,
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

async function renderOverlay() {
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
        businessType="SERVICES"
        onClose={vi.fn()}
        onConfirmed={vi.fn()}
      />,
    );
  });
}

function byText(text: string): HTMLElement {
  const el = Array.from(container.querySelectorAll("button, div, span")).find(
    (n) => n.textContent?.trim() === text,
  );
  if (!el) throw new Error(`no encuentro "${text}"`);
  return el as HTMLElement;
}

function testId<T extends HTMLElement>(id: string): T | null {
  return container.querySelector(`[data-testid="${id}"]`) as T | null;
}

/** Abre "Más opciones" y marca "Enviar por email". */
async function abrirCampoEmail() {
  await act(async () => {
    byText("Más opciones").click();
  });
  const label = Array.from(container.querySelectorAll("label")).find((l) =>
    l.textContent?.includes("Enviar por email"),
  );
  if (!label) throw new Error("no encuentro el checkbox de email");
  const checkbox = label.querySelector(
    'input[type="checkbox"]',
  ) as HTMLInputElement;
  await act(async () => {
    checkbox.click();
  });
}

async function escribirEmail(valor: string) {
  const input = testId<HTMLInputElement>("email-intent-input")!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

async function salirDelCampo(input: HTMLInputElement) {
  // React escucha `focusout` delegado en la raíz para su `onBlur`: un
  // "blur" nativo no burbujea y no llegaría nunca al handler.
  await act(async () => {
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function cobrarButton(): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    // En SERVICES el botón se llama "Cerrar servicio".
    ["Cobrar", "Cerrar servicio"].includes(b.textContent?.trim() ?? ""),
  );
  if (!btn) throw new Error("botón de cobro no encontrado");
  return btn as HTMLButtonElement;
}

async function cobrarYEsperar() {
  await act(async () => {
    cobrarButton().click();
  });
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Captura el body del POST /tickets y responde como el servidor. */
function mockCobro(opts: { emailIntentRejected?: unknown } = {}) {
  const bodies: Array<Record<string, unknown>> = [];
  apiMock.apiWithCashier.mockImplementation(
    async (
      path: string,
      init?: { method?: string; body?: Record<string, unknown> },
    ) => {
      if (path === "/tickets" && init?.method === "POST") {
        bodies.push(init.body!);
        return {
          ticket: {
            id: "t-000257",
            internalNumber: "000257",
            status: "PAID",
            holdedDocNumber: null,
          },
          syncStatus: "PAID",
          emailIntentRejected: opts.emailIntentRejected ?? null,
        };
      }
      // Lo que pide el SuccessOverlay después: offline, no importa aquí.
      if (path.includes("/digital")) throw new Error("offline");
      if (path.includes("printer-info")) throw new Error("offline");
      if (path.startsWith("/tickets/")) {
        return { ticket: { holdedDocNumber: null, status: "PAID" } };
      }
      throw new Error(`ruta inesperada: ${path}`);
    },
  );
  return bodies;
}

describe("CheckoutOverlay · el campo de email (Sole)", () => {
  it("el 000257 · 'abc' avisa al salir del campo", async () => {
    mockCobro();
    await renderOverlay();
    await abrirCampoEmail();

    const input = await escribirEmail("abc");
    // Mientras teclea, nada: "ab" tampoco es un email y no se le grita
    // a nadie por ir por la mitad.
    expect(testId("email-intent-aviso")).toBeNull();

    await salirDelCampo(input);
    const aviso = testId("email-intent-aviso");
    expect(aviso).not.toBeNull();
    expect(aviso!.textContent).toContain("no es válido");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("el 000257 · con 'abc' el cobro ENTRA y sale sin emailIntent", async () => {
    const bodies = mockCobro({
      emailIntentRejected: { reason: "INVALID_EMAIL", value: "abc" },
    });
    await renderOverlay();
    await abrirCampoEmail();
    await escribirEmail("abc");

    await cobrarYEsperar();

    // La venta entró — ésta es la mitad que no se puede romper.
    expect(bodies).toHaveLength(1);
    // Y salió sin email: el TPV no manda lo que la API va a descartar.
    expect(bodies[0]!.emailIntent).toBeUndefined();
    expect(container.textContent).toContain("Ticket emitido");
  });

  it("un email bueno viaja recortado y sin aviso", async () => {
    const bodies = mockCobro();
    await renderOverlay();
    await abrirCampoEmail();
    const input = await escribirEmail("  ana@ejemplo.com  ");
    await salirDelCampo(input);

    expect(testId("email-intent-aviso")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("false");

    await cobrarYEsperar();
    expect(bodies[0]!.emailIntent).toBe("ana@ejemplo.com");
  });

  it("dejar el campo vacío no avisa de nada y cobra sin email", async () => {
    const bodies = mockCobro();
    await renderOverlay();
    await abrirCampoEmail();
    const input = testId<HTMLInputElement>("email-intent-input")!;
    await salirDelCampo(input);

    expect(testId("email-intent-aviso")).toBeNull();

    await cobrarYEsperar();
    expect(bodies[0]!.emailIntent).toBeUndefined();
  });
});
