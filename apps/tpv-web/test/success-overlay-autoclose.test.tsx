// v1.9.2-mesas-concurrencia · Frente 3.1: el modal "Ticket emitido" de
// venta rápida se autocierra a los 4 s (el camarero no debe pensar; las
// acciones QR/PDF/email siguen en Tickets). Test aislado con fake timers.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return {
    ...actual,
    // El overlay hace GET /tickets/:id/digital y polling /tickets/:id;
    // fallan en silencio (offline) → el autocierre no depende de ellos.
    apiWithCashier: vi.fn(async () => {
      throw new Error("offline");
    }),
  };
});
vi.mock("../src/lib/catalog.js", () => ({
  getCachedBusinessType: () => "HOSPITALITY" as const,
}));
vi.mock("../src/lib/escposPrint.js", () => ({
  fetchTicketEscposBinary: vi.fn(),
  getPairedUsbPrinter: vi.fn(async () => null),
  isWebUsbSupported: () => false,
  pairUsbPrinter: vi.fn(),
  printEscposUsb: vi.fn(),
  printTicketWifi: vi.fn(),
  syncUsbPairingWithServerConfig: vi.fn(async () => {}),
}));
vi.mock("@mipiacetpv/ticket-pdf", () => ({
  renderTicketPdf: vi.fn(async () => new Uint8Array()),
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));

import { SuccessOverlay } from "../src/pages/CheckoutPage.successOverlay.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("SuccessOverlay · autocierre venta rápida", () => {
  it("llama onDone a los 4 s sin intervención", async () => {
    const onDone = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <SuccessOverlay
          ticketId="t-1"
          internalNumber="000010"
          onDone={onDone}
        />,
      );
    });

    // Aún no: antes de los 4 s el modal sigue en pantalla.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(onDone).not.toHaveBeenCalled();

    // A los 4 s se cierra solo.
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
