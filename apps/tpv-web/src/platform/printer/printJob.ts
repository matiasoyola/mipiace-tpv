// v1.10.2-impresion-honesta · servicio de impresión del TPV.
//
// HALLAZGO QUE LO MOTIVA (Cafetería Sirope, Caja 1, 2026-08-20): con
// CERO impresoras configuradas, "Reimprimir ticket" respondía «Enviado a
// impresora. La copia llevará marca COPIA.». No había impresora, no
// salió papel, y el TPV afirmó haber impreso. Un TPV que miente sobre si
// ha impreso es peor que uno que no imprime: el cajero da el ticket por
// entregado y nadie se entera hasta la reclamación.
//
// La causa no estaba en una pantalla suelta: cada punto de impresión
// resolvía a su manera si había impresora y cuándo pintar el éxito. Este
// módulo centraliza las TRES decisiones para los tres puntos (overlay de
// cobro, reimpresión desde el detalle, comanda de cocina):
//
//   1. ¿Hay impresora configurada en esta caja?  → `lookupPrinter`
//   2. ¿El transporte confirmó la entrega?       → `printTicket`
//   3. Si no, ¿por qué?                          → `PrintOutcome.message`
//
// CONTRATO: ninguna función de este módulo lanza. Devuelven un
// `PrintOutcome` que la UI pinta tal cual. Eso hace imposible el bug de
// origen (pintar éxito sin esperar al transporte) y también protege la
// regla del ADR-010: el dinero manda — un fallo de impresión no puede
// propagarse hasta el camino de cobro, porque no se propaga a ningún
// sitio.

import { ApiError, apiWithCashier } from "../../api.js";
import {
  fetchTicketEscposBinary,
  getPairedUsbPrinter,
  isWebUsbSupported,
  printEscposUsb,
  printTicketWifi,
  syncUsbPairingWithServerConfig,
} from "../../lib/escposPrint.js";
import { PrinterError, type PrinterErrorCode } from "./PrinterTransport.js";
import { reportPrinterFailure, type PrintOperation } from "./telemetry.js";

/** Secciones que entiende `GET /tpv/printer-info`. */
export type PrinterSection = "ticket" | "barra" | "cocina" | "salon";

export interface ConfiguredPrinter {
  configId: string;
  name: string;
  mode: "USB" | "WIFI";
}

/**
 * Resultado de preguntar por la impresora de la caja.
 *
 * `none` y `unknown` NO son lo mismo y no deben colapsarse: "esta caja
 * no tiene impresora" es un hecho; "no pude preguntarlo" (PWA sin red)
 * no lo es. Confundirlos volvería a producir un mensaje que afirma más
 * de lo que sabemos.
 */
export type PrinterLookup =
  | { status: "configured"; printer: ConfiguredPrinter }
  | { status: "none" }
  | { status: "unknown"; message: string };

/**
 * Resultado real de un intento de impresión. `printed` sólo se emite
 * después de que el transporte (USB) o el backend (WiFi) haya
 * confirmado la entrega.
 */
export type PrintOutcome =
  | { status: "printed"; printedAt: string; printerName: string }
  | { status: "no-printer"; message: string }
  | { status: "needs-pairing"; printerName: string; message: string }
  | {
      status: "failed";
      code: PrinterErrorCode | "BACKEND" | "LOOKUP";
      message: string;
      printerName: string | null;
    };

/** Copy único del estado vacío. Los tres puntos de impresión lo comparten. */
export const NO_PRINTER_MESSAGE =
  "Esta caja no tiene impresora configurada.";

/**
 * Pregunta al backend qué impresora tiene la caja para una sección.
 * `ticket` = impresora del ticket de cobro (section IS NULL).
 *
 * De paso limpia el emparejamiento USB local si el admin borró la
 * impresora o la pasó a WiFi (comportamiento heredado de v1.0-pilotos
 * Lote 5: sin esto, la impresora borrada "reaparecía" en el device).
 */
export async function lookupPrinter(
  section: PrinterSection = "ticket",
): Promise<PrinterLookup> {
  try {
    const res = await apiWithCashier<{
      printer: { id: string; name: string; mode: "USB" | "WIFI" } | null;
    }>(`/tpv/printer-info?section=${section}`);
    syncUsbPairingWithServerConfig(res.printer);
    if (!res.printer) return { status: "none" };
    return {
      status: "configured",
      printer: {
        configId: res.printer.id,
        name: res.printer.name,
        mode: res.printer.mode,
      },
    };
  } catch (err) {
    return {
      status: "unknown",
      message:
        err instanceof ApiError
          ? err.message
          : "No se pudo consultar la impresora de esta caja.",
    };
  }
}

/**
 * ¿Está la impresora USB emparejada y localizable sin diálogo? Devuelve
 * `false` también cuando la plataforma no soporta USB — el caller ya
 * distingue ese caso antes de llegar aquí.
 */
async function usbReady(): Promise<boolean> {
  try {
    return await getPairedUsbPrinter();
  } catch {
    return false;
  }
}

/**
 * Imprime (o reimprime) un ticket y devuelve QUÉ pasó de verdad.
 *
 * `copy: true` marca el papel como "COPIA - no fiscal" — es la
 * reimpresión desde el detalle de ticket. Antes ese botón llamaba a
 * `POST /tickets/:id/reprint`, que sólo crea un `PrintIntent` PENDING
 * para un bridge (B5) que nunca se llegó a montar: de ahí que el TPV
 * dijera "enviado" sin que existiera impresora. Ahora va por el mismo
 * camino ESC/POS que el resto, que sí entrega papel y sí falla en voz
 * alta.
 */
export async function printTicket(opts: {
  ticketId: string;
  operation: PrintOperation;
  /** Si ya se resolvió antes (el overlay lo cachea al montar). */
  printer?: ConfiguredPrinter;
  copy?: boolean;
}): Promise<PrintOutcome> {
  let printer = opts.printer;
  if (!printer) {
    const lookup = await lookupPrinter("ticket");
    if (lookup.status === "none") {
      return { status: "no-printer", message: NO_PRINTER_MESSAGE };
    }
    if (lookup.status === "unknown") {
      return {
        status: "failed",
        code: "LOOKUP",
        message: lookup.message,
        printerName: null,
      };
    }
    printer = lookup.printer;
  }

  const transport = printer.mode === "USB" ? "usb" : "wifi";

  if (printer.mode === "USB") {
    if (!isWebUsbSupported()) {
      const err = new PrinterError(
        "Este dispositivo no puede imprimir por USB.",
        "UNSUPPORTED",
      );
      reportPrinterFailure(err, {
        operation: opts.operation,
        transport,
        ticketId: opts.ticketId,
        printerName: printer.name,
      });
      return {
        status: "failed",
        code: "UNSUPPORTED",
        message: err.message,
        printerName: printer.name,
      };
    }
    if (!(await usbReady())) {
      return {
        status: "needs-pairing",
        printerName: printer.name,
        message: `Empareja la impresora ${printer.name} antes de imprimir.`,
      };
    }
  }

  try {
    if (printer.mode === "USB") {
      const bytes = await fetchTicketEscposBinary(opts.ticketId, {
        copy: opts.copy === true,
      });
      const result = await printEscposUsb(bytes);
      return {
        status: "printed",
        printedAt: result?.printedAt ?? new Date().toISOString(),
        printerName: printer.name,
      };
    }
    const result = await printTicketWifi(opts.ticketId, printer.configId, {
      copy: opts.copy === true,
    });
    return {
      status: "printed",
      printedAt: result?.printedAt ?? new Date().toISOString(),
      printerName: printer.name,
    };
  } catch (err) {
    // 409 del backend WiFi: la caja tiene un PrinterConfig, pero no uno
    // WIFI activo para el ticket de cobro. Para el cajero es el mismo
    // hecho que "no hay impresora": no hay a dónde imprimir.
    if (err instanceof ApiError && err.code === "PRINTER_NOT_CONFIGURED") {
      return { status: "no-printer", message: NO_PRINTER_MESSAGE };
    }
    reportPrinterFailure(err, {
      operation: opts.operation,
      transport,
      ticketId: opts.ticketId,
      printerName: printer.name,
    });
    return {
      status: "failed",
      code: printerErrorCode(err),
      message: describePrintFailure(err),
      printerName: printer.name,
    };
  }
}

/**
 * Manda un binario ESC/POS ya construido a la impresora USB emparejada
 * (justificantes de cobro de deuda). Mismo contrato: no lanza, y el
 * motivo real llega al cajero y a Sentry.
 */
export async function printUsbBytes(opts: {
  bytes: () => Promise<Uint8Array>;
  operation: PrintOperation;
  ticketId?: string;
}): Promise<PrintOutcome> {
  if (!isWebUsbSupported()) {
    return {
      status: "failed",
      code: "UNSUPPORTED",
      message: "Este dispositivo no puede imprimir por USB.",
      printerName: null,
    };
  }
  if (!(await usbReady())) {
    return {
      status: "needs-pairing",
      printerName: "USB",
      message: "No hay impresora USB emparejada en este dispositivo.",
    };
  }
  try {
    const result = await printEscposUsb(await opts.bytes());
    return {
      status: "printed",
      printedAt: result?.printedAt ?? new Date().toISOString(),
      printerName: "USB",
    };
  } catch (err) {
    reportPrinterFailure(err, {
      operation: opts.operation,
      transport: "usb",
      ticketId: opts.ticketId,
    });
    return {
      status: "failed",
      code: printerErrorCode(err),
      message: describePrintFailure(err),
      printerName: null,
    };
  }
}

function printerErrorCode(err: unknown): PrinterErrorCode | "BACKEND" {
  if (err instanceof PrinterError) return err.code;
  if (err instanceof ApiError) return "BACKEND";
  return "UNKNOWN";
}

/**
 * Traduce el fallo a algo que un cajero pueda accionar detrás de la
 * barra. El motivo crudo (`ECONNREFUSED`, `NetworkError`) no le dice
 * nada; "no responde: comprueba que está encendida" sí.
 */
export function describePrintFailure(err: unknown): string {
  if (err instanceof PrinterError) {
    switch (err.code) {
      case "NOT_PAIRED":
        return "La impresora no está emparejada con este dispositivo.";
      case "UNREACHABLE":
        return "La impresora no responde. Comprueba que está encendida, con papel y conectada.";
      case "TIMEOUT":
        return "La impresora no respondió a tiempo.";
      case "PERMISSION_DENIED":
        return "El sistema denegó el acceso a la impresora.";
      case "UNSUPPORTED":
      case "UNKNOWN":
      default:
        return err.message;
    }
  }
  if (err instanceof ApiError) {
    // 502 PRINT_FAILED del endpoint WiFi trae el error real del socket.
    if (err.status === 502) {
      return `La impresora no respondió: ${err.message}`;
    }
    return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return "No se pudo imprimir.";
}
