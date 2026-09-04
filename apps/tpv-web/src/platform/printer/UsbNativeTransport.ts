// A1-Android · Frente 2 · transporte USB nativo (USB Host de Android).
//
// WebUSB no existe en el WebView de Capacitor, así que el canal USB
// dentro de la app habla con un plugin nativo Java (`UsbPrinterPlugin`,
// ver apps/tpv-android/.../UsbPrinterPlugin.java) a través del bridge de
// Capacitor. Este archivo es el lado JS: implementa `PrinterTransport`
// encapsulando el plugin — NINGÚN componente de pantalla toca el plugin.
//
// Reparto de responsabilidades (idéntico algoritmo que WebUSB, ya
// resuelto en WebUsbTransport):
//   - filtro de clase 7 (impresora) para no listar hubs/lectores,
//   - selección del endpoint bulk OUT,
//   - transferOut del binario ESC/POS.
// Todo eso vive en el plugin Java (UsbManager/UsbDeviceConnection); aquí
// sólo serializamos bytes → base64 y mapeamos errores a PrinterError.
//
// Persistencia: el plugin nativo guarda vendor/product/serial en
// SharedPreferences y reabre el device autorizado sin diálogo (paralelo
// a como WebUsbTransport usa localStorage + getDevices()).

import { getCapacitor } from "../index.js";
import {
  PrinterError,
  type PrinterDescriptor,
  type PrinterErrorCode,
  type PrinterTransport,
  type PrintResult,
} from "./PrinterTransport.js";

// Contrato del plugin nativo (lo que expone UsbPrinterPlugin.java).
interface NativeDescriptor {
  vendorId: number;
  productId: number;
  serialNumber: string | null;
  productName: string | null;
}
interface UsbPrinterPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  pair(): Promise<NativeDescriptor>;
  isPaired(): Promise<{ paired: boolean }>;
  print(options: { data: string }): Promise<{ ok: boolean }>;
  openCashDrawer(): Promise<void>;
  forget(): Promise<void>;
}

// Códigos que el plugin usa en call.reject(msg, code). Se mapean 1:1 a
// PrinterErrorCode; cualquier otro cae a UNKNOWN.
const NATIVE_ERROR_CODES: readonly PrinterErrorCode[] = [
  "NOT_PAIRED",
  "UNREACHABLE",
  "PERMISSION_DENIED",
  "TIMEOUT",
  "UNSUPPORTED",
  "UNKNOWN",
];

function mapError(err: unknown, fallbackMsg: string): PrinterError {
  const code = (err as { code?: string } | null)?.code;
  const message =
    err instanceof Error && err.message ? err.message : fallbackMsg;
  const mapped = NATIVE_ERROR_CODES.includes(code as PrinterErrorCode)
    ? (code as PrinterErrorCode)
    : "UNKNOWN";
  return new PrinterError(message, mapped, err);
}

// Uint8Array → base64 (el bridge de Capacitor sólo pasa JSON/strings).
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export class UsbNativeTransport implements PrinterTransport {
  readonly channel = "usb" as const;

  private plugin: UsbPrinterPlugin | null = null;

  // El bridge nativo de Capacitor NO expone `registerPlugin` en el global
  // `Capacitor`: esa función vive en el paquete `@capacitor/core`, que este
  // bundle no importa a propósito (regresión cero en la PWA). Lo que el
  // bridge SÍ inyecta es `Capacitor.Plugins.<Nombre>` ya construido.
  //
  // Comprobado en el AP12 de Sole el 2026-09-04: dentro de la APK,
  // `getPlatform()` = "android", `isNativePlatform()` = true y el plugin Java
  // aparece en logcat como "Registering plugin instance: UsbPrinter", pero
  // `typeof Capacitor.registerPlugin === "undefined"`. Con el guard viejo
  // `getPlugin()` devolvía null SIEMPRE → `isSupported()` false → el TPV
  // contestaba "Este dispositivo no puede imprimir por USB" en un terminal
  // con la impresora perfectamente enumerada. La impresión USB nativa no
  // había funcionado nunca desde A1.
  private getPlugin(): UsbPrinterPlugin | null {
    if (this.plugin) return this.plugin;
    const cap = getCapacitor();
    if (!cap) return null;

    // 1) Camino real dentro de la APK.
    const fromBridge = cap.Plugins?.["UsbPrinter"] as UsbPrinterPlugin | undefined;
    if (fromBridge) {
      this.plugin = fromBridge;
      return this.plugin;
    }

    // 2) Si algún día este bundle sí carga @capacitor/core, el global trae
    //    registerPlugin y este camino sigue valiendo.
    if (typeof cap.registerPlugin === "function") {
      this.plugin = cap.registerPlugin<UsbPrinterPlugin>("UsbPrinter");
      return this.plugin;
    }

    return null;
  }

  private requirePlugin(): UsbPrinterPlugin {
    const p = this.getPlugin();
    if (!p) {
      throw new PrinterError(
        "El plugin USB nativo no está disponible (¿fuera de la app Android?).",
        "UNSUPPORTED",
      );
    }
    return p;
  }

  // Sólo dentro de Capacitor con el plugin presente. isAvailable del
  // plugin comprueba además que el hardware tenga USB Host, pero eso es
  // async; isSupported es síncrono (contrato) → basta con "hay plugin".
  isSupported(): boolean {
    return this.getPlugin() != null;
  }

  async pair(): Promise<PrinterDescriptor> {
    const plugin = this.requirePlugin();
    let native: NativeDescriptor;
    try {
      native = await plugin.pair();
    } catch (err) {
      throw mapError(err, "No se pudo emparejar la impresora USB.");
    }
    return {
      channel: "usb",
      label: native.productName ?? "Impresora USB",
      address: `${native.vendorId}:${native.productId}:${native.serialNumber ?? ""}`,
    };
  }

  async connect(descriptor: PrinterDescriptor): Promise<void> {
    // El plugin reabre el device autorizado por sus prefs; sólo
    // verificamos que sigue emparejado y que coincide el canal.
    if (descriptor.channel !== "usb") {
      throw new PrinterError("Descriptor de canal incorrecto.", "UNSUPPORTED");
    }
    if (!(await this.isPaired())) {
      throw new PrinterError("Impresora USB no emparejada.", "NOT_PAIRED");
    }
  }

  async isPaired(): Promise<boolean> {
    const plugin = this.getPlugin();
    if (!plugin) return false;
    try {
      return (await plugin.isPaired()).paired;
    } catch {
      return false;
    }
  }

  async print(bytes: Uint8Array): Promise<PrintResult> {
    const plugin = this.requirePlugin();
    try {
      const res = await plugin.print({ data: toBase64(bytes) });
      return { ok: res.ok, printedAt: new Date().toISOString() };
    } catch (err) {
      throw mapError(err, "Error al imprimir por USB.");
    }
  }

  async openCashDrawer(): Promise<void> {
    const plugin = this.requirePlugin();
    try {
      await plugin.openCashDrawer();
    } catch (err) {
      throw mapError(err, "No se pudo abrir el cajón.");
    }
  }

  async forget(): Promise<void> {
    try {
      await this.getPlugin()?.forget();
    } catch {
      // best-effort.
    }
  }

  async disconnect(): Promise<void> {
    // El plugin cierra la conexión tras cada print (no mantiene el
    // interface reclamado); nada que liberar aquí.
  }
}
