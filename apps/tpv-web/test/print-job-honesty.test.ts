// v1.10.2-impresion-honesta · el servicio de impresión no miente.
//
// HALLAZGO QUE ORIGINA EL BLOQUE (Cafetería Sirope, Caja 1, 2026-08-20):
// con CERO impresoras configuradas, "Reimprimir ticket" respondía
// «Enviado a impresora. La copia llevará marca COPIA.». No había
// impresora y no salió papel.
//
// Estos tests fijan el contrato que lo hace imposible:
//   1. Sin impresora configurada → `no-printer`, nunca `printed`.
//   2. Impresora configurada pero apagada → `failed` CON el motivo.
//   3. `printed` sólo si el transporte lo confirmó.
//   4. Ningún camino lanza: un fallo de impresión no puede propagarse.
//   5. Todo fallo de transporte llega a Sentry con transporte y motivo.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── dobles ──────────────────────────────────────────────────────────────
const captured = vi.hoisted(
  () => [] as Array<{ err: unknown; extra?: Record<string, unknown> }>,
);
vi.mock("../src/lib/sentry.js", () => ({
  captureError: (err: unknown, extra?: Record<string, unknown>) => {
    captured.push({ err, extra });
  },
  isSentryEnabled: () => true,
  initSentry: () => true,
}));

const api = vi.hoisted(() => ({
  handler: null as
    | ((path: string, opts?: unknown) => Promise<unknown>)
    | null,
}));
vi.mock("../src/api.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return {
    ...actual,
    apiWithCashier: (path: string, opts?: unknown) => api.handler!(path, opts),
  };
});

const escpos = vi.hoisted(() => ({
  supported: true,
  paired: true,
  fetchBytes: null as null | (() => Promise<Uint8Array>),
  printUsb: null as null | (() => Promise<{ ok: boolean; printedAt: string }>),
  lastFetchOpts: null as { copy?: boolean } | null,
}));
vi.mock("../src/lib/escposPrint.js", () => ({
  isWebUsbSupported: () => escpos.supported,
  getPairedUsbPrinter: async () => escpos.paired,
  syncUsbPairingWithServerConfig: () => undefined,
  fetchTicketEscposBinary: async (_id: string, opts?: { copy?: boolean }) => {
    escpos.lastFetchOpts = opts ?? null;
    return escpos.fetchBytes!();
  },
  printEscposUsb: async () => escpos.printUsb!(),
  // El canal WiFi se ejerce a través de apiWithCashier, mockeado arriba;
  // aquí sólo reproducimos la firma real.
  printTicketWifi: async (
    ticketId: string,
    printerConfigId?: string,
    opts: { copy?: boolean } = {},
  ) => {
    const params = new URLSearchParams({ target: "wifi" });
    if (printerConfigId) params.set("printerConfigId", printerConfigId);
    if (opts.copy) params.set("copy", "true");
    return api.handler!(
      `/tickets/${ticketId}/print/escpos?${params.toString()}`,
      { method: "POST" },
    ) as Promise<{ ok: boolean; printedAt: string }>;
  },
}));

const { ApiError } = await import("../src/api.js");
const { PrinterError } = await import(
  "../src/platform/printer/PrinterTransport.js"
);
const { lookupPrinter, printTicket, NO_PRINTER_MESSAGE } = await import(
  "../src/platform/printer/printJob.js"
);

const USB_PRINTER = {
  configId: "cfg-usb",
  name: "EPSON TM-m30",
  mode: "USB" as const,
};
const WIFI_PRINTER = {
  configId: "cfg-wifi",
  name: "POS-80 Cocina",
  mode: "WIFI" as const,
};

beforeEach(() => {
  captured.length = 0;
  escpos.supported = true;
  escpos.paired = true;
  escpos.lastFetchOpts = null;
  escpos.fetchBytes = async () => new Uint8Array([0x1b, 0x40]);
  escpos.printUsb = async () => ({
    ok: true,
    printedAt: "2026-08-20T10:00:00.000Z",
  });
  api.handler = async () => ({ printer: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("sin impresora configurada ≠ enviado", () => {
  it("printer-info devuelve null → no-printer, y NUNCA printed", async () => {
    api.handler = async () => ({ printer: null });
    const outcome = await printTicket({
      ticketId: "t-14",
      operation: "reprint",
      copy: true,
    });
    expect(outcome.status).toBe("no-printer");
    expect(outcome).toMatchObject({ message: NO_PRINTER_MESSAGE });
    // El bug original en una línea: esto no puede volver a pasar.
    expect(outcome.status).not.toBe("printed");
  });

  it("no intenta imprimir nada cuando no hay impresora", async () => {
    api.handler = async () => ({ printer: null });
    escpos.fetchBytes = async () => {
      throw new Error("no debería pedirse el binario");
    };
    const outcome = await printTicket({ ticketId: "t-14", operation: "ticket" });
    expect(outcome.status).toBe("no-printer");
  });

  it("el backend WiFi responde 409 PRINTER_NOT_CONFIGURED → no-printer", async () => {
    api.handler = async (path: string) => {
      if (path.startsWith("/tpv/printer-info")) {
        return { printer: { id: "cfg-wifi", name: "POS-80", mode: "WIFI" } };
      }
      throw new ApiError(
        409,
        "Falta configurar una impresora WIFI activa...",
        "PRINTER_NOT_CONFIGURED",
      );
    };
    const outcome = await printTicket({ ticketId: "t-14", operation: "ticket" });
    expect(outcome.status).toBe("no-printer");
  });

  it("lookupPrinter distingue 'no hay' de 'no pude preguntarlo'", async () => {
    api.handler = async () => ({ printer: null });
    expect((await lookupPrinter()).status).toBe("none");

    api.handler = async () => {
      throw new ApiError(0, "Failed to fetch");
    };
    const offline = await lookupPrinter();
    expect(offline.status).toBe("unknown");
    // Sin red no podemos afirmar que la caja no tiene impresora.
    expect(offline.status).not.toBe("none");
  });
});

describe("impresora configurada pero apagada → falla, con motivo", () => {
  it("USB inalcanzable → failed con motivo accionable, no printed", async () => {
    escpos.printUsb = async () => {
      throw new PrinterError(
        "The device was disconnected.",
        "UNREACHABLE",
      );
    };
    const outcome = await printTicket({
      ticketId: "t-14",
      operation: "ticket",
      printer: USB_PRINTER,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome).toMatchObject({ code: "UNREACHABLE" });
    if (outcome.status !== "failed") throw new Error("unreachable");
    expect(outcome.message).toContain("no responde");
    expect(outcome.message.toLowerCase()).not.toContain("enviado a impresora");
  });

  it("WiFi 502 del backend → failed arrastrando el error del socket", async () => {
    api.handler = async () => {
      throw new ApiError(502, "connect ECONNREFUSED 192.168.1.50:9100", "PRINT_FAILED");
    };
    const outcome = await printTicket({
      ticketId: "t-14",
      operation: "ticket",
      printer: WIFI_PRINTER,
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("unreachable");
    expect(outcome.message).toContain("ECONNREFUSED");
  });

  it("USB sin emparejar → needs-pairing (no es un fallo de la impresora)", async () => {
    escpos.paired = false;
    const outcome = await printTicket({
      ticketId: "t-14",
      operation: "ticket",
      printer: USB_PRINTER,
    });
    expect(outcome.status).toBe("needs-pairing");
  });

  it("plataforma sin USB → failed UNSUPPORTED", async () => {
    escpos.supported = false;
    const outcome = await printTicket({
      ticketId: "t-14",
      operation: "ticket",
      printer: USB_PRINTER,
    });
    expect(outcome).toMatchObject({ status: "failed", code: "UNSUPPORTED" });
  });
});

describe("'impreso' sólo cuando el transporte lo confirma", () => {
  it("USB ok → printed con el printedAt que devolvió el transporte", async () => {
    const outcome = await printTicket({
      ticketId: "t-14",
      operation: "ticket",
      printer: USB_PRINTER,
    });
    expect(outcome).toEqual({
      status: "printed",
      printedAt: "2026-08-20T10:00:00.000Z",
      printerName: "EPSON TM-m30",
    });
  });

  it("la reimpresión pide el binario marcado como copia", async () => {
    await printTicket({
      ticketId: "t-14",
      operation: "reprint",
      printer: USB_PRINTER,
      copy: true,
    });
    expect(escpos.lastFetchOpts).toEqual({ copy: true });
  });

  it("la impresión tras el cobro NO va marcada como copia", async () => {
    await printTicket({
      ticketId: "t-14",
      operation: "ticket",
      printer: USB_PRINTER,
    });
    expect(escpos.lastFetchOpts).toEqual({ copy: false });
  });
});

describe("el dinero manda: un fallo de impresión no se propaga", () => {
  // ADR-010 · regla que ya se cumplía y que este bloque fija por
  // escrito: si la impresión falla, el ticket sigue cobrado. Lo que
  // cambia en v1.10.2 es que el cajero se entera. El mecanismo que lo
  // garantiza es que `printTicket` NUNCA lanza: no hay excepción que
  // pueda subir hasta el camino de cobro y abortarlo.
  const boom = [
    ["PrinterError", () => new PrinterError("kaput", "UNKNOWN")],
    ["ApiError", () => new ApiError(500, "boom", "INTERNAL")],
    ["Error pelado", () => new Error("boom")],
    ["algo que no es Error", () => "boom" as unknown],
  ] as const;

  for (const [label, make] of boom) {
    it(`${label} en el transporte → resuelve failed, no lanza`, async () => {
      escpos.printUsb = async () => {
        throw make();
      };
      const outcome = await printTicket({
        ticketId: "t-14",
        operation: "ticket",
        printer: USB_PRINTER,
      });
      expect(outcome.status).toBe("failed");
    });
  }

  it("si falla hasta la consulta de impresora, tampoco lanza", async () => {
    api.handler = async () => {
      throw new Error("network down");
    };
    const outcome = await printTicket({ ticketId: "t-14", operation: "ticket" });
    expect(outcome.status).toBe("failed");
  });

  it("el binario no llega a pedirse y aun así resuelve", async () => {
    escpos.fetchBytes = async () => {
      throw new ApiError(404, "Ticket no encontrado", "TICKET_NOT_FOUND");
    };
    const outcome = await printTicket({
      ticketId: "t-14",
      operation: "ticket",
      printer: USB_PRINTER,
    });
    expect(outcome).toMatchObject({ status: "failed", code: "BACKEND" });
  });
});

describe("telemetría: los fallos de transporte llegan a Sentry", () => {
  it("reporta el fallo con transporte, operación y código", async () => {
    escpos.printUsb = async () => {
      throw new PrinterError("sin papel", "UNREACHABLE");
    };
    await printTicket({
      ticketId: "t-14",
      operation: "reprint",
      printer: USB_PRINTER,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.extra).toMatchObject({
      printerOperation: "reprint",
      printerTransport: "usb",
      printerErrorCode: "UNREACHABLE",
      ticketId: "t-14",
      printerName: "EPSON TM-m30",
    });
  });

  it("el canal WiFi se reporta como wifi", async () => {
    api.handler = async () => {
      throw new ApiError(502, "ECONNREFUSED", "PRINT_FAILED");
    };
    await printTicket({
      ticketId: "t-14",
      operation: "ticket",
      printer: WIFI_PRINTER,
    });
    // El código que llega a Sentry es el slug real del backend, más
    // útil para agrupar que el genérico "BACKEND" que ve la UI.
    expect(captured[0]!.extra).toMatchObject({
      printerTransport: "wifi",
      printerErrorCode: "PRINT_FAILED",
    });
  });

  it("no reporta cuando no hay impresora (no es un fallo, es config)", async () => {
    api.handler = async () => ({ printer: null });
    await printTicket({ ticketId: "t-14", operation: "ticket" });
    expect(captured).toHaveLength(0);
  });

  it("no reporta un éxito", async () => {
    await printTicket({
      ticketId: "t-14",
      operation: "ticket",
      printer: USB_PRINTER,
    });
    expect(captured).toHaveLength(0);
  });
});
