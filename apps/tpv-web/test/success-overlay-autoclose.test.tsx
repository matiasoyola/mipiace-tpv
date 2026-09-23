// v1.9.2-mesas-concurrencia · Frente 3.1: el modal "Ticket emitido" de
// venta rápida se autocierra a los 4 s (el camarero no debe pensar; las
// acciones QR/PDF/email siguen en Tickets). Test aislado con fake timers.
//
// Sole (23-09-2026) · y el mismo fichero fija lo contrario para la
// peluquería: con `businessType === "SERVICES"` esta pantalla NO se
// cierra sola, porque allí ES la entrega (Ana manda el email o enseña
// el QR a la clienta). Las dos mitades juntas a propósito: el riesgo de
// este cambio no es que SERVICES siga cerrándose, es que hostelería
// deje de hacerlo.

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
const vertical = vi.hoisted(() => ({
  value: "HOSPITALITY" as "HOSPITALITY" | "RETAIL" | "SERVICES",
}));
vi.mock("../src/lib/catalog.js", () => ({
  getCachedBusinessType: () => vertical.value,
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => false,
  // catalogo-local (addendum 3) · default TRUE, como en la caché real:
  // un TPV que no ha refrescado se comporta como antes del bloque.
  getCachedHoldedEnabled: () => true,
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

import { SuccessOverlay } from "../src/pages/CheckoutPage.successOverlay.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vertical.value = "HOSPITALITY";
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

  it("RETAIL también: la tienda se queda como estaba", async () => {
    vertical.value = "RETAIL";
    const onDone = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <SuccessOverlay
          ticketId="t-2"
          internalNumber="000011"
          onDone={onDone}
        />,
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(4500);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("con vuelta que devolver, los 8 s de v1.15 siguen siendo 8 s", async () => {
    const onDone = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <SuccessOverlay
          ticketId="t-3"
          internalNumber="000012"
          cash={{ total: 6.93, received: 10, change: 3.07 }}
          onDone={onDone}
        />,
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(4500);
    });
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("SuccessOverlay · la peluquería de Sole (SERVICES)", () => {
  it("NO se cierra sola: esta pantalla es la entrega, no un trámite", async () => {
    vertical.value = "SERVICES";
    const onDone = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <SuccessOverlay
          ticketId="t-sole"
          internalNumber="000257"
          onDone={onDone}
        />,
      );
    });

    // Cuatro segundos: en un bar ya se habría ido.
    await act(async () => {
      vi.advanceTimersByTime(4500);
    });
    expect(onDone).not.toHaveBeenCalled();

    // Ocho: tampoco, ni siquiera por el camino de la vuelta.
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    expect(onDone).not.toHaveBeenCalled();

    // Dos minutos enseñándole el QR a la clienta y la pantalla sigue ahí.
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("y se cierra con «Nuevo servicio», que es quien manda allí", async () => {
    vertical.value = "SERVICES";
    const onDone = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <SuccessOverlay
          ticketId="t-sole"
          internalNumber="000257"
          onDone={onDone}
        />,
      );
    });

    const boton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Nuevo servicio",
    );
    expect(boton).toBeDefined();
    await act(async () => {
      boton!.click();
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
