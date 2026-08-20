// v1.10.2-impresion-honesta · el dinero manda (ADR-010).
//
// Regla que YA se cumplía y que este bloque preserva explícitamente: si
// la impresión falla, el ticket sigue cobrado. Lo que cambia es que el
// cajero se entera, en vez de leer "Enviado a impresora" y suponer que
// el papel salió.
//
// El overlay "Ticket emitido" es el punto donde ambas cosas conviven: el
// cobro ya está hecho (el ticket tiene número interno y el flujo digital
// funciona) y la impresión es un paso posterior que puede fallar. Este
// test monta el overlay con una impresora que falla y comprueba que:
//
//   1. El cobro sigue en pie: el número interno se sigue mostrando y no
//      se dispara ninguna llamada de anulación/devolución.
//   2. NO aparece "Enviado a impresora" ni ningún mensaje de éxito.
//   3. Aparece el motivo del fallo y un botón de reintentar.
//   4. El overlay NO se autocierra encima del aviso.
//
// Y el caso del hallazgo: caja sin impresora → estado vacío honesto.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  printer: null as { id: string; name: string; mode: "USB" | "WIFI" } | null,
  calls: [] as string[],
}));

vi.mock("../src/api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return {
    ...actual,
    apiWithCashier: vi.fn(async (path: string) => {
      server.calls.push(path);
      if (path.startsWith("/tpv/printer-info")) {
        return { printer: server.printer };
      }
      // El resto (digital, polling Holded) falla en silencio: el overlay
      // ya está diseñado para funcionar offline y no es lo que se mide.
      throw new actual.ApiError(0, "offline");
    }),
  };
});

const printing = vi.hoisted(() => ({
  usbSupported: true,
  paired: true,
  fail: null as null | (() => never),
}));

vi.mock("../src/lib/escposPrint.js", () => ({
  fetchTicketEscposBinary: vi.fn(async () => new Uint8Array([0x1b, 0x40])),
  getPairedUsbPrinter: vi.fn(async () => printing.paired),
  isWebUsbSupported: () => printing.usbSupported,
  pairUsbPrinter: vi.fn(),
  printEscposUsb: vi.fn(async () => {
    if (printing.fail) printing.fail();
    return { ok: true, printedAt: "2026-08-20T10:00:00.000Z" };
  }),
  printTicketWifi: vi.fn(async () => {
    if (printing.fail) printing.fail();
    return { ok: true, printedAt: "2026-08-20T10:00:00.000Z" };
  }),
  syncUsbPairingWithServerConfig: vi.fn(),
  openCashDrawerIfAvailable: vi.fn(),
}));

vi.mock("../src/lib/catalog.js", () => ({
  getCachedBusinessType: () => "HOSPITALITY" as const,
  getCachedCrmEnabled: () => false,
  getCachedAgendaEnabled: () => false,
}));
vi.mock("@mipiacetpv/ticket-pdf", () => ({
  renderTicketPdf: vi.fn(async () => new Uint8Array()),
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,") },
}));
vi.mock("../src/lib/sentry.js", () => ({
  captureError: vi.fn(),
  isSentryEnabled: () => false,
  initSentry: () => false,
}));

const { PrinterError } = await import(
  "../src/platform/printer/PrinterTransport.js"
);
const { SuccessOverlay } = await import(
  "../src/pages/CheckoutPage.successOverlay.js"
);

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(onDone = vi.fn()) {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SuccessOverlay ticketId="t-14" internalNumber="000014" onDone={onDone} />,
    );
  });
  // Deja resolver el lookup de impresora del useEffect.
  await act(async () => {
    await Promise.resolve();
  });
  return onDone;
}

function text() {
  return container.textContent ?? "";
}

beforeEach(() => {
  server.printer = null;
  server.calls = [];
  printing.usbSupported = true;
  printing.paired = true;
  printing.fail = null;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("caja SIN impresora configurada (el hallazgo de Sirope)", () => {
  it("dice que no hay impresora y no ofrece imprimir", async () => {
    server.printer = null;
    await mount();

    expect(
      container.querySelector('[data-testid="print-no-printer"]'),
    ).not.toBeNull();
    expect(text()).toContain("no tiene impresora configurada");
    // El botón de imprimir no se ofrece: no hay a dónde imprimir.
    expect(container.querySelector('[data-testid="action-print"]')).toBeNull();
    // Y por encima de todo: nada afirma que se haya impreso.
    expect(text()).not.toContain("Enviado a impresora");
    expect(text()).not.toContain("Ticket impreso");
  });

  it("el cobro sigue en pie: el ticket emitido se sigue mostrando", async () => {
    server.printer = null;
    await mount();
    expect(text()).toContain("000014");
    expect(text()).toContain("emitido");
  });
});

describe("impresora configurada pero apagada", () => {
  it("dice que falló, con el motivo, y ofrece reintentar", async () => {
    server.printer = { id: "cfg-1", name: "EPSON TM-m30", mode: "USB" };
    printing.fail = () => {
      throw new PrinterError("The device was disconnected.", "UNREACHABLE");
    };
    await mount();

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="action-print"]',
    );
    expect(button).not.toBeNull();
    await act(async () => {
      button!.click();
    });

    expect(container.querySelector('[data-testid="print-error"]')).not.toBeNull();
    expect(text()).toContain("No se pudo imprimir");
    expect(text()).toContain("Comprueba que está encendida");
    expect(text()).toContain("Reintentar");
    expect(text()).not.toContain("Enviado a impresora");
    expect(container.querySelector('[data-testid="print-done"]')).toBeNull();
  });

  it("el cobro no se toca: ninguna llamada de anulación ni devolución", async () => {
    server.printer = { id: "cfg-1", name: "EPSON TM-m30", mode: "USB" };
    printing.fail = () => {
      throw new PrinterError("sin papel", "UNREACHABLE");
    };
    await mount();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="action-print"]')!
        .click();
    });

    // El ticket cobrado sigue ahí…
    expect(text()).toContain("000014");
    // …y el fallo de impresión no ha disparado nada contra el cobro.
    for (const path of server.calls) {
      expect(path).not.toContain("/void");
      expect(path).not.toContain("/refund");
      expect(path).not.toContain("/checkout");
    }
  });

  it("el overlay no se autocierra encima del aviso de fallo", async () => {
    vi.useFakeTimers();
    server.printer = { id: "cfg-1", name: "POS-80", mode: "WIFI" };
    printing.fail = () => {
      throw new PrinterError("ECONNREFUSED", "UNREACHABLE");
    };
    const onDone = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root.render(
        <SuccessOverlay
          ticketId="t-14"
          internalNumber="000014"
          onDone={onDone}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="action-print"]')!
        .click();
    });
    expect(container.querySelector('[data-testid="print-error"]')).not.toBeNull();

    // El autocierre de venta rápida es de 4 s; con un fallo en pantalla
    // se pausa, porque un aviso que desaparece solo no es un aviso.
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="print-error"]')).not.toBeNull();
  });
});

describe("impresora que sí imprime", () => {
  it("sólo entonces aparece 'Ticket impreso'", async () => {
    server.printer = { id: "cfg-1", name: "EPSON TM-m30", mode: "USB" };
    await mount();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="action-print"]')!
        .click();
    });
    expect(container.querySelector('[data-testid="print-done"]')).not.toBeNull();
    expect(text()).toContain("Ticket impreso");
  });
});
