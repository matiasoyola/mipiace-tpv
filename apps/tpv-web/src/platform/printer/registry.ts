// A1 · Frente 1 · implementación del registro de transportes.
//
// Un Map por canal. `register()` sobreescribe si ya había uno para el
// canal (permite que un test o un re-bootstrap sustituya el transporte
// sin duplicar). El TPV pide `get(channel)`; si no hay, null → el caller
// decide (mostrar "sin impresora", caer a otro canal, etc.).

import type {
  PrinterChannel,
  PrinterRegistry,
  PrinterTransport,
} from "./PrinterTransport.js";

export class DefaultPrinterRegistry implements PrinterRegistry {
  private readonly transports = new Map<PrinterChannel, PrinterTransport>();

  register(transport: PrinterTransport): void {
    this.transports.set(transport.channel, transport);
  }

  get(channel: PrinterChannel): PrinterTransport | null {
    return this.transports.get(channel) ?? null;
  }

  available(): PrinterChannel[] {
    return [...this.transports.keys()];
  }

  /** Sólo para tests: deja el registro vacío. */
  clear(): void {
    this.transports.clear();
  }
}

/**
 * Singleton del proceso. El bootstrap lo puebla una vez; el resto del
 * TPV lo consume vía los helpers de `bootstrap.ts`.
 */
export const printerRegistry = new DefaultPrinterRegistry();
