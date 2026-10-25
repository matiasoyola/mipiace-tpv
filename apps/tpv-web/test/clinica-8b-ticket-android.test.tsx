// clinica-8 (fase B, 18) · «VER TICKET» NO SE ABRE EN BLANCO.
//
// Auditoría del 18-10, punto 19. No es un fallo del ticket ni del
// generador: el modal pinta el PDF con `<embed type="application/pdf">`
// sobre un `blob:`, y **el WebView de Android no trae visor de PDF**. No
// hay plugin, no hay fallback y no hay error: el `<embed>` se queda en un
// rectángulo blanco de 70vh. Lo mismo en Chrome para Android.
//
// Donde el navegador sí sabe (escritorio, iPad) no cambia nada: se sigue
// viendo el PDF, que es el documento de verdad. Donde no sabe, se LEE el
// mismo `TicketDocument`. Lo que este banco fija es que la lectura dice
// los mismos números y no se inventa ninguno.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TicketDocument } from "@mipiacetpv/ticket-model";

vi.mock("../src/lib/catalog.js", () => ({
  getCachedBusinessType: () => "SERVICES" as const,
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => false,
  getCachedHoldedEnabled: () => false,
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
vi.mock("@mipiacetpv/ticket-pdf", () => ({
  renderTicketPdf: vi.fn(async () => new Uint8Array()),
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));

import { LecturaDelTicket } from "../src/pages/CheckoutPage.successOverlay.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// El cobro del 18-10: una quiropodia completa de 26 €, exenta (E1), en
// efectivo con vuelta.
const TICKET: TicketDocument = {
  fiscal: {
    legalName: "MI PIACE INTERNET SOLUTIONS SL",
    taxId: "B45902186",
    address: "Carretera CM-5100 km 30,500",
  } as unknown as TicketDocument["fiscal"],
  store: { name: "Clínica demo", address: "Buenaventura" },
  ticket: {
    internalNumber: "000123",
    publicSlug: "abc",
    issuedAt: new Date("2026-10-19T08:35:00.000Z"),
    cashierName: "Rosa",
    registerName: "Caja 1",
    businessType: "SERVICES",
    attendedBy: "Rosa Martín",
  },
  lines: [
    {
      description: "Quiropodia completa",
      sku: "POD-003",
      quantity: 1,
      unitPrice: 26,
      unitPriceGross: 26,
      taxRate: 0,
      subtotal: 26,
      totalGross: 26,
      exemptionCause: "E1",
    },
    {
      description: "Órtesis de silicona pequeña",
      sku: "POD-012",
      quantity: 2,
      unitPrice: 15,
      unitPriceGross: 15,
      taxRate: 0,
      subtotal: 30,
      totalGross: 30,
      exemptionCause: "E1",
    },
  ],
  totals: {
    subtotal: 56,
    taxBreakdown: [{ rate: 0, base: 56, tax: 0, exemptionCause: "E1" }],
    total: 56,
  },
  payment: { method: "CASH", paid: 56, received: 60, change: 4 },
  footer: { legal: "" } as unknown as TicketDocument["footer"],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function pintar(doc: TicketDocument = TICKET) {
  root = createRoot(container);
  await act(async () => {
    root.render(<LecturaDelTicket document={doc} />);
  });
}

function texto(): string {
  return container.textContent ?? "";
}

describe("clinica-8 (18) · la lectura del ticket en pantalla", () => {
  it("dice de quién es, su número y su hora", async () => {
    await pintar();
    expect(texto()).toContain("Clínica demo");
    expect(texto()).toContain("000123");
    expect(texto()).toContain("19/10/2026");
    // Y quién atendió, que en una clínica es parte del ticket.
    expect(texto()).toContain("Atiende Rosa Martín");
  });

  it("las líneas, con sus unidades y SU importe, no uno recalculado", async () => {
    await pintar();
    expect(texto()).toContain("Quiropodia completa");
    expect(texto()).toContain("26,00");
    // Dos órtesis: las unidades se dicen y el importe es el de la línea.
    expect(texto()).toContain("2×");
    expect(texto()).toContain("30,00");
  });

  it("el tramo EXENTO se dice exento, no «IVA 0 %»", async () => {
    // No es lo mismo y el papel tampoco lo dice igual: en Rosario los 17
    // servicios son E1, así que ésta es la línea de todos los días.
    await pintar();
    expect(texto()).toContain("Exento (E1)");
    expect(texto()).not.toContain("IVA 0 %");
  });

  it("el total y la vuelta son los del documento", async () => {
    await pintar();
    expect(texto()).toContain("56,00");
    expect(texto()).toContain("Efectivo");
    expect(texto()).toContain("Cambio");
    expect(texto()).toContain("4,00");
  });

  it("y DICE que es una lectura: el PDF sigue siendo el documento", async () => {
    await pintar();
    expect(texto()).toContain("no sabe abrir PDF");
    expect(texto()).toContain("desde el histórico");
  });

  it("sin vuelta no se pinta una línea de cambio a 0", async () => {
    await pintar({
      ...TICKET,
      payment: { method: "CARD", paid: 56 },
    });
    expect(texto()).toContain("Tarjeta");
    expect(texto()).not.toContain("Cambio");
  });
});
