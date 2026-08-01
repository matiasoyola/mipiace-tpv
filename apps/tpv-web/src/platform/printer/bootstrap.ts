// A1 · Frente 1 · bootstrap de transportes de impresión.
//
// Puebla el `printerRegistry` según la plataforma efectiva (getPlatform):
//   - web:     WebUsbTransport   + WifiBackendTransport
//   - android: UsbNativeTransport + WifiBackendTransport  (Frente 2)
//
// Idempotente: se llama explícitamente desde `main.tsx` al arrancar, pero
// también `ensurePrintersBootstrapped()` lo dispara de forma perezosa
// desde `lib/escposPrint.ts` para que cualquier entrada (o un test) tenga
// el registry poblado sin acoplarse al orden de imports.

import { getPlatform } from "../index.js";
import { printerRegistry } from "./registry.js";
import type { PrinterTransport } from "./PrinterTransport.js";
import { WebUsbTransport } from "./WebUsbTransport.js";
import { WifiBackendTransport } from "./WifiBackendTransport.js";

let bootstrapped = false;

export function bootstrapPrinters(): void {
  const platform = getPlatform();

  // WiFi es idéntico en ambas plataformas (petición HTTP al backend).
  printerRegistry.register(new WifiBackendTransport());

  // Canal USB: WebUSB en navegador, USB Host nativo dentro de Capacitor.
  // El transporte nativo (UsbNativeTransport) lo añade el Frente 2; hasta
  // entonces Android sólo tiene WiFi.
  if (platform !== "android") {
    printerRegistry.register(new WebUsbTransport());
  }

  bootstrapped = true;
}

/** Bootstrap perezoso e idempotente. */
export function ensurePrintersBootstrapped(): void {
  if (!bootstrapped) bootstrapPrinters();
}

/** Transporte del canal USB de la plataforma actual (o null). */
export function usbTransport(): PrinterTransport | null {
  ensurePrintersBootstrapped();
  return printerRegistry.get("usb");
}

/** Transporte del canal WiFi (o null). */
export function wifiTransport(): PrinterTransport | null {
  ensurePrintersBootstrapped();
  return printerRegistry.get("wifi");
}
