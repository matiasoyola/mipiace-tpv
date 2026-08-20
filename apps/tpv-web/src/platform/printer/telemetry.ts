// v1.10.2-impresion-honesta · telemetría de fallos de impresión.
//
// Antes de este bloque no había una sola llamada a `captureException` en
// toda la carpeta `platform/printer/`: cuando una impresora se quedaba
// sin papel, cambiaba de IP o estaba apagada, el fallo moría en el
// `catch` de la pantalla y nadie se enteraba nunca. Sin esto no podemos
// saber cuántas veces le ha pasado a un cliente real.
//
// Un único punto de reporte: lo llama `printJob.ts`, que es donde TODO
// intento de impresión se resuelve. Los transportes se limitan a lanzar
// `PrinterError` con su `code`; si reportaran ellos además tendríamos
// eventos duplicados por cada fallo.

import { captureError } from "../../lib/sentry.js";
import { PrinterError } from "./PrinterTransport.js";

/** En qué punto del TPV se estaba imprimiendo. */
export type PrintOperation =
  | "ticket" // overlay de éxito tras el cobro
  | "reprint" // reimpresión desde el detalle de ticket
  | "kitchen" // comanda a cocina/barra/salón
  | "credit-receipt" // justificante de cobro de deuda
  | "pair"; // emparejamiento USB

export interface PrinterFailureContext {
  operation: PrintOperation;
  /** Canal por el que se intentó entregar el binario. */
  transport: "usb" | "wifi" | "unknown";
  ticketId?: string;
  printerName?: string;
  /** Sección de la comanda, si aplica. */
  section?: string;
}

/**
 * Manda el fallo a Sentry con transporte y motivo. No lanza: la
 * telemetría no puede tumbar una impresión (ni, por extensión, nada de
 * lo que cuelgue de ella). Sin DSN configurado, `captureError` es no-op.
 */
export function reportPrinterFailure(
  err: unknown,
  ctx: PrinterFailureContext,
): void {
  try {
    // Para un `PrinterError` es su `code` (UNREACHABLE, TIMEOUT…); para
    // un `ApiError` del canal WiFi es el slug del backend
    // (PRINT_FAILED), que agrupa mejor en Sentry que un genérico.
    const code =
      err instanceof PrinterError
        ? err.code
        : typeof (err as { code?: unknown } | null)?.code === "string"
          ? (err as { code: string }).code
          : "UNKNOWN";
    captureError(err, {
      printerOperation: ctx.operation,
      printerTransport: ctx.transport,
      printerErrorCode: code,
      ...(ctx.ticketId ? { ticketId: ctx.ticketId } : {}),
      ...(ctx.printerName ? { printerName: ctx.printerName } : {}),
      ...(ctx.section ? { printerSection: ctx.section } : {}),
    });
  } catch {
    // Reportar el fallo no puede provocar otro.
  }
}
