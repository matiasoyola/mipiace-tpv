// v1.4-Impresoras-Fase-1 Lote 3 · helpers de impresión ESC/POS en el TPV.
//
// Dos rutas:
//   - USB: usamos WebUSB API. El cajero empareja una vez con la
//          impresora (selección nativa del navegador), guardamos
//          vendor/product/serial en localStorage para reusarla, y en
//          impresiones sucesivas la abrimos directamente.
//   - WIFI: llamamos al endpoint backend que abre TCP a la IP de la
//           impresora. No necesitamos WebUSB.
//
// Requiere HTTPS en producción (Chrome bloquea WebUSB en HTTP). En
// desarrollo localhost también funciona.

import { apiWithCashier, ApiError } from "../api.js";

const STORAGE_KEY = "mipiacetpv-tpv-printer-usb";

// Clase USB 7 = Printer. Filtramos por esta clase para que el diálogo
// de selección sólo muestre impresoras y no se confunda con otros
// devices del cable OTG (lectores de tarjetas, hubs).
const USB_PRINTER_CLASS_FILTER: USBDeviceFilter = { classCode: 7 };

interface StoredUsbDevice {
  vendorId: number;
  productId: number;
  serialNumber: string | null;
}

export function isWebUsbSupported(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as { usb?: USB }).usb;
}

function getUsb(): USB | null {
  return (navigator as { usb?: USB }).usb ?? null;
}

function readStoredDevice(): StoredUsbDevice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredUsbDevice;
  } catch {
    return null;
  }
}

function storeDevice(d: USBDevice): void {
  const payload: StoredUsbDevice = {
    vendorId: d.vendorId,
    productId: d.productId,
    serialNumber: d.serialNumber ?? null,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function forgetPairedUsbPrinter(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// v1.0-pilotos · Lote 5 (#19): propaga el borrado server-side al
// estado local. Si el register ya no tiene impresora USB configurada
// (borrada desde el admin, o cambiada a WIFI), el emparejamiento WebUSB
// guardado en localStorage es un residuo: hacía "reaparecer" la
// impresora borrada y dejaba pairings huérfanos que confundían la
// re-alta. Llamar con el resultado de GET /tpv/printer-info.
export function syncUsbPairingWithServerConfig(
  printer: { mode: "USB" | "WIFI" } | null,
): void {
  if (!printer || printer.mode !== "USB") {
    forgetPairedUsbPrinter();
  }
}

// Pide al usuario que seleccione la impresora USB. Hay que invocar
// esta función desde un handler de interacción (click) — el browser
// rechaza requestDevice fuera de eventos de usuario.
export async function pairUsbPrinter(): Promise<USBDevice> {
  const usb = getUsb();
  if (!usb) {
    throw new Error("WebUSB no soportado en este navegador.");
  }
  const device = await usb.requestDevice({
    filters: [USB_PRINTER_CLASS_FILTER],
  });
  storeDevice(device);
  return device;
}

// Busca el USBDevice ya autorizado (sin diálogo). Devuelve null si
// no hay ninguno emparejado o el usuario lo desconectó.
async function resolvePairedDevice(): Promise<USBDevice | null> {
  const usb = getUsb();
  if (!usb) return null;
  const stored = readStoredDevice();
  if (!stored) return null;
  const all = await usb.getDevices();
  for (const d of all) {
    if (
      d.vendorId === stored.vendorId &&
      d.productId === stored.productId &&
      (stored.serialNumber == null ||
        d.serialNumber === stored.serialNumber)
    ) {
      return d;
    }
  }
  return null;
}

export async function getPairedUsbPrinter(): Promise<USBDevice | null> {
  return resolvePairedDevice();
}

// Localiza el interface "OUT" (impresora) y devuelve su número de
// endpoint. Las ESC/POS USB siempre exponen un único Bulk OUT en su
// alternate 0 — escogemos el primero que matche.
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
  throw new Error("La impresora no expone un endpoint bulk OUT.");
}

// Envía un binary ESC/POS a la impresora USB emparejada. Si no hay
// ninguna, lanza un error que el caller convierte en "empareja primero".
export async function printEscposUsb(bytes: Uint8Array): Promise<void> {
  const usb = getUsb();
  if (!usb) {
    throw new Error("WebUSB no soportado en este navegador.");
  }
  const device = await resolvePairedDevice();
  if (!device) {
    throw new Error("Impresora USB no emparejada.");
  }
  if (!device.opened) {
    await device.open();
  }
  if (device.configuration == null) {
    await device.selectConfiguration(1);
  }
  const { interfaceNumber, endpointNumber } = findBulkOutEndpoint(device);
  try {
    await device.claimInterface(interfaceNumber);
    // BufferSource en lib DOM exige ArrayBuffer; clonamos para evitar
    // el cast a SharedArrayBuffer del Uint8Array original.
    const buf = new ArrayBuffer(bytes.length);
    new Uint8Array(buf).set(bytes);
    const result = await device.transferOut(endpointNumber, buf);
    if (result.status !== "ok") {
      throw new Error(`transferOut status: ${result.status}`);
    }
  } finally {
    try {
      await device.releaseInterface(interfaceNumber);
    } catch {
      // best-effort; algunos hubs no liberan limpio.
    }
  }
}

// Pide el binary ESC/POS al backend (genera buildTicketReceipt sobre
// el ticket persistido) y lo manda a la impresora USB.
export async function printTicketUsb(ticketId: string): Promise<void> {
  const bytes = await fetchTicketEscposBinary(ticketId);
  await printEscposUsb(bytes);
}

// Llama al endpoint backend que abre TCP a la impresora WIFI configurada
// para el register. El backend gestiona los reintentos / errores y
// devuelve `{ok}`. Si la impresora no está configurada, devuelve 409.
export async function printTicketWifi(
  ticketId: string,
  printerConfigId?: string,
): Promise<void> {
  const params = new URLSearchParams({ target: "wifi" });
  if (printerConfigId) params.set("printerConfigId", printerConfigId);
  await apiWithCashier<{ ok: boolean; printedAt: string }>(
    `/tickets/${ticketId}/print/escpos?${params.toString()}`,
    { method: "POST" },
  );
}

// Pide al backend el binary ESC/POS del ticket. Recibe octet-stream.
export async function fetchTicketEscposBinary(
  ticketId: string,
): Promise<Uint8Array> {
  const params = new URLSearchParams({ target: "usb" });
  const session = readSession();
  if (!session) {
    throw new ApiError(401, "Sin sesión de cajero", "UNAUTHENTICATED");
  }
  const base = readBaseUrl();
  const res = await fetch(
    `${base}/tickets/${ticketId}/print/escpos?${params.toString()}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${session}` },
    },
  );
  if (!res.ok) {
    const text = await res.text();
    let parsed: { error?: string; message?: string } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // no es JSON
    }
    throw new ApiError(
      res.status,
      parsed?.message ?? res.statusText ?? "fetch failed",
      parsed?.error,
      parsed,
    );
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// v1.8-Fiado · bytes ESC/POS del justificante de cobro de deuda. Igual
// que fetchTicketEscposBinary pero para el recibo no fiscal del cobro,
// identificado por el externalId del pago.
export async function fetchCreditReceiptEscpos(
  ticketId: string,
  paymentExternalId: string,
): Promise<Uint8Array> {
  const session = readSession();
  if (!session) {
    throw new ApiError(401, "Sin sesión de cajero", "UNAUTHENTICATED");
  }
  const base = readBaseUrl();
  const res = await fetch(`${base}/tickets/${ticketId}/credit-receipt/escpos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ paymentExternalId }),
  });
  if (!res.ok) {
    const text = await res.text();
    let parsed: { error?: string; message?: string } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // no es JSON
    }
    throw new ApiError(
      res.status,
      parsed?.message ?? res.statusText ?? "fetch failed",
      parsed?.error,
      parsed,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

function readSession(): string | null {
  // Reusamos el getter sync de storage — leemos el campo del JSON
  // serializado tal como hace api.ts.
  try {
    const raw = localStorage.getItem("mipiacetpv-cashier-session");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sessionToken?: string };
    return parsed.sessionToken ?? null;
  } catch {
    return null;
  }
}

function readBaseUrl(): string {
  const envBase = (
    import.meta as unknown as { env?: { VITE_API_URL?: string } }
  ).env?.VITE_API_URL;
  return ((envBase ?? "/api") as string).replace(/\/$/, "");
}
