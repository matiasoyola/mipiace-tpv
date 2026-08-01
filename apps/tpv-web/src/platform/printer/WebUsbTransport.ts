// A1 · Frente 1 · transporte USB para el navegador (WebUSB).
//
// Es la EXTRACCIÓN literal de la lógica que vivía en `lib/escposPrint.ts`
// (rama WebUSB): mismo filtro de clase 7, misma resolución de endpoint
// bulk OUT, mismo transferOut. Comportamiento en navegador IDÉNTICO
// (regresión cero) — en particular conserva la MISMA clave y forma de
// localStorage para que una impresora ya emparejada siga funcionando sin
// re-emparejar tras el refactor.
//
// Persistencia: el contrato de A0 decía "persistir es del caller", pero
// A1 la encapsula aquí (donde vive el conocimiento WebUSB) para no
// filtrar la forma legacy del storage. Documentado en A1-done.md.

import {
  PrinterError,
  type PrinterDescriptor,
  type PrinterTransport,
  type PrintResult,
} from "./PrinterTransport.js";

// Clave y forma HEREDADAS de lib/escposPrint.ts — no cambiar: entradas
// ya guardadas en tablets de pilotos deben seguir resolviendo.
const STORAGE_KEY = "mipiacetpv-tpv-printer-usb";

// Clase USB 7 = Printer. El diálogo de selección sólo muestra impresoras
// y no se confunde con otros devices del cable OTG (lectores, hubs).
const USB_PRINTER_CLASS_FILTER: USBDeviceFilter = { classCode: 7 };

interface StoredUsbDevice {
  vendorId: number;
  productId: number;
  serialNumber: string | null;
  // A1: nombre legible opcional (las entradas legacy no lo traen → label
  // cae a "Impresora USB"). Aditivo, no rompe el parseo del formato viejo.
  productName?: string | null;
}

function getUsb(): USB | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as { usb?: USB }).usb ?? null;
}

function readStored(): StoredUsbDevice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredUsbDevice;
  } catch {
    return null;
  }
}

function store(d: USBDevice): void {
  const payload: StoredUsbDevice = {
    vendorId: d.vendorId,
    productId: d.productId,
    serialNumber: d.serialNumber ?? null,
    productName: d.productName ?? null,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function descriptorFor(d: StoredUsbDevice): PrinterDescriptor {
  return {
    channel: "usb",
    label: d.productName ?? "Impresora USB",
    address: `${d.vendorId}:${d.productId}:${d.serialNumber ?? ""}`,
  };
}

// Localiza el interface "OUT" (impresora) y devuelve su endpoint bulk
// OUT. Las ESC/POS USB exponen un único Bulk OUT en su alternate 0.
function findBulkOutEndpoint(device: USBDevice): {
  interfaceNumber: number;
  endpointNumber: number;
} {
  for (const iface of device.configuration?.interfaces ?? []) {
    for (const alt of iface.alternates) {
      for (const ep of alt.endpoints) {
        if (ep.direction === "out" && ep.type === "bulk") {
          return {
            interfaceNumber: iface.interfaceNumber,
            endpointNumber: ep.endpointNumber,
          };
        }
      }
    }
  }
  throw new PrinterError(
    "La impresora no expone un endpoint bulk OUT.",
    "UNSUPPORTED",
  );
}

export class WebUsbTransport implements PrinterTransport {
  readonly channel = "usb" as const;

  isSupported(): boolean {
    return getUsb() != null;
  }

  // Busca el USBDevice ya autorizado (sin diálogo). Null si no hay
  // ninguno emparejado o el usuario lo desconectó.
  private async resolvePaired(): Promise<USBDevice | null> {
    const usb = getUsb();
    if (!usb) return null;
    const stored = readStored();
    if (!stored) return null;
    const all = await usb.getDevices();
    for (const d of all) {
      if (
        d.vendorId === stored.vendorId &&
        d.productId === stored.productId &&
        (stored.serialNumber == null || d.serialNumber === stored.serialNumber)
      ) {
        return d;
      }
    }
    return null;
  }

  async pair(): Promise<PrinterDescriptor> {
    const usb = getUsb();
    if (!usb) {
      throw new PrinterError(
        "WebUSB no soportado en este navegador.",
        "UNSUPPORTED",
      );
    }
    let device: USBDevice;
    try {
      device = await usb.requestDevice({ filters: [USB_PRINTER_CLASS_FILTER] });
    } catch (err) {
      // requestDevice rechaza si el usuario cierra el diálogo sin elegir.
      throw new PrinterError(
        "No se seleccionó ninguna impresora.",
        "NOT_PAIRED",
        err,
      );
    }
    store(device);
    return descriptorFor({
      vendorId: device.vendorId,
      productId: device.productId,
      serialNumber: device.serialNumber ?? null,
      productName: device.productName ?? null,
    });
  }

  async connect(descriptor: PrinterDescriptor): Promise<void> {
    // WebUSB no reabre "por descriptor" arbitrario: sólo puede resolver
    // entre los ya autorizados. Verificamos que el emparejado coincide.
    const device = await this.resolvePaired();
    if (!device) {
      throw new PrinterError(
        "Impresora USB no emparejada.",
        "NOT_PAIRED",
      );
    }
    const addr = `${device.vendorId}:${device.productId}:${device.serialNumber ?? ""}`;
    if (addr !== descriptor.address) {
      throw new PrinterError(
        "La impresora emparejada no coincide con la solicitada.",
        "NOT_PAIRED",
      );
    }
  }

  async isPaired(): Promise<boolean> {
    return (await this.resolvePaired()) != null;
  }

  async print(bytes: Uint8Array): Promise<PrintResult> {
    const device = await this.resolvePaired();
    if (!device) {
      throw new PrinterError("Impresora USB no emparejada.", "NOT_PAIRED");
    }
    return this.transferTo(device, bytes);
  }

  // Pulso kick estándar ESC/POS por la impresora (mismo binario que el
  // helper del builder). Cajón conectado al conector RJ11 de la impresora.
  async openCashDrawer(): Promise<void> {
    const device = await this.resolvePaired();
    if (!device) {
      throw new PrinterError("Impresora USB no emparejada.", "NOT_PAIRED");
    }
    // ESC p 0 25 250 — pin 2, on=50ms, off=500ms (valores de fábrica).
    await this.transferTo(device, new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]));
  }

  async forget(): Promise<void> {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage puede fallar en modo privado — best-effort.
    }
  }

  async disconnect(): Promise<void> {
    const device = await this.resolvePaired();
    if (device?.opened) {
      try {
        await device.close();
      } catch {
        // best-effort.
      }
    }
  }

  // Núcleo de entrega: abre, reclama interface, transfiere, libera.
  // Idéntico al printEscposUsb original, con errores mapeados a
  // PrinterError.
  private async transferTo(
    device: USBDevice,
    bytes: Uint8Array,
  ): Promise<PrintResult> {
    if (!device.opened) {
      await device.open();
    }
    if (device.configuration == null) {
      await device.selectConfiguration(1);
    }
    const { interfaceNumber, endpointNumber } = findBulkOutEndpoint(device);
    try {
      await device.claimInterface(interfaceNumber);
      // BufferSource en lib DOM exige ArrayBuffer; clonamos para evitar el
      // cast a SharedArrayBuffer del Uint8Array original.
      const buf = new ArrayBuffer(bytes.length);
      new Uint8Array(buf).set(bytes);
      const result = await device.transferOut(endpointNumber, buf);
      if (result.status !== "ok") {
        throw new PrinterError(
          `La impresora rechazó el envío (status: ${result.status}).`,
          "UNREACHABLE",
        );
      }
      return { ok: true, printedAt: new Date().toISOString() };
    } catch (err) {
      if (err instanceof PrinterError) throw err;
      throw new PrinterError(
        err instanceof Error ? err.message : "Error al imprimir por USB.",
        "UNREACHABLE",
        err,
      );
    } finally {
      try {
        await device.releaseInterface(interfaceNumber);
      } catch {
        // best-effort; algunos hubs no liberan limpio.
      }
    }
  }
}
