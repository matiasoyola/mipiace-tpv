// A1 · Frente 1 · transporte WiFi (mediado por backend).
//
// El canal WiFi es DISTINTO al USB por diseño: el binario ESC/POS lo
// construye y lo manda por TCP el BACKEND (`POST /tickets/:id/print/escpos
// ?target=wifi` → `sendOverTcp` a ip:port). El cliente sólo dispara la
// impresión por `ticketId`, no entrega bytes. Ya funciona y NO es el foco
// de A1; se conserva idéntico (regresión cero) y se registra aquí para
// que el registry sea uniforme y `available()` reporte "wifi".
//
// Por eso `print(bytes)` NO aplica a este canal (el backend genera sus
// propios bytes desde el ticket): lanza UNSUPPORTED con un mensaje claro.
// La ruta real WiFi del TPV sigue en `lib/escposPrint.ts::printTicketWifi`,
// que llama al endpoint por `ticketId`. Es idéntico en web y en Android
// (una petición HTTP), de ahí que se registre igual en ambas plataformas.

import {
  PrinterError,
  type PrinterDescriptor,
  type PrinterTransport,
  type PrintResult,
} from "./PrinterTransport.js";

const WIFI_DESCRIPTOR: PrinterDescriptor = {
  channel: "wifi",
  label: "Impresora WiFi (backend)",
  address: "backend",
};

export class WifiBackendTransport implements PrinterTransport {
  readonly channel = "wifi" as const;

  // Siempre disponible: es una petición HTTP al backend, sin hardware
  // local ni permisos.
  isSupported(): boolean {
    return true;
  }

  // No hay emparejamiento client-side: la impresora WiFi se configura en
  // el admin (ip:port) y vive en el backend.
  async pair(): Promise<PrinterDescriptor> {
    return WIFI_DESCRIPTOR;
  }

  async connect(): Promise<void> {
    // No-op: no hay recurso local que abrir.
  }

  async isPaired(): Promise<boolean> {
    // La configuración vive server-side; el TPV no puede saberlo sin
    // consultar. Reportamos "sí" y dejamos que el backend responda 409 si
    // no hay impresora activa (comportamiento actual de printTicketWifi).
    return true;
  }

  async print(_bytes: Uint8Array): Promise<PrintResult> {
    throw new PrinterError(
      "El canal WiFi imprime por ticketId desde el backend, no por bytes " +
        "del cliente. Usa printTicketWifi(ticketId).",
      "UNSUPPORTED",
    );
  }

  async openCashDrawer(): Promise<void> {
    // El pulso del cajón por WiFi iría también server-side; fuera del
    // alcance de A1 (los pilotos usan USB).
    throw new PrinterError(
      "Abrir cajón por WiFi no está soportado en A1 (canal USB es el foco).",
      "UNSUPPORTED",
    );
  }

  async forget(): Promise<void> {
    // Nada que olvidar en el cliente.
  }

  async disconnect(): Promise<void> {
    // No-op.
  }
}
