// v1.4-Impresoras-Fase-1 Lote 3 · helpers de impresión ESC/POS en el TPV.
// A1-Android · Frente 1 · refactor a `PrinterRegistry`.
//
// Dos rutas:
//   - USB: pasa por el `PrinterTransport` del canal USB registrado para
//          la plataforma actual (WebUSB en navegador, USB Host nativo en
//          la app Android). El cajero empareja una vez; el transporte
//          persiste el device y lo reabre en impresiones sucesivas. Antes
//          este archivo llamaba a WebUSB directamente; ahora delega en el
//          registry para que la app Android use el transporte nativo sin
//          tocar las pantallas. Comportamiento en navegador IDÉNTICO.
//   - WIFI: llamamos al endpoint backend que abre TCP a la IP de la
//          impresora (server-mediated, `ticketId`). No usa el registry
//          de bytes — se conserva tal cual (regresión cero).
//
// USB requiere HTTPS en producción en navegador (Chrome bloquea WebUSB en
// HTTP); en la app Android el permiso lo concede el sistema por device.

import { apiWithCashier, ApiError } from "../api.js";
import { usbTransport } from "../platform/printer/bootstrap.js";
import {
  PrinterError,
  type PrintResult,
} from "../platform/printer/PrinterTransport.js";

// Guard común: el transporte USB de la plataforma. En navegador siempre
// está registrado (WebUsbTransport); si faltara, error accionable.
function requireUsbTransport() {
  const t = usbTransport();
  if (!t) {
    throw new PrinterError(
      "No hay transporte USB disponible en esta plataforma.",
      "UNSUPPORTED",
    );
  }
  return t;
}

// ¿La plataforma soporta impresión USB? (WebUSB en navegador; USB Host
// en Android.) El nombre se conserva por compatibilidad con las pantallas
// que ya lo importan.
export function isWebUsbSupported(): boolean {
  return usbTransport()?.isSupported() ?? false;
}

export async function forgetPairedUsbPrinter(): Promise<void> {
  await usbTransport()?.forget();
}

// v1.0-pilotos · Lote 5 (#19): propaga el borrado server-side al estado
// local. Si el register ya no tiene impresora USB configurada (borrada
// desde el admin, o cambiada a WIFI), el emparejamiento guardado es un
// residuo: hacía "reaparecer" la impresora borrada. Llamar con el
// resultado de GET /tpv/printer-info.
export function syncUsbPairingWithServerConfig(
  printer: { mode: "USB" | "WIFI" } | null,
): void {
  if (!printer || printer.mode !== "USB") {
    void forgetPairedUsbPrinter();
  }
}

// Pide al usuario que seleccione la impresora USB. Hay que invocar esta
// función desde un handler de interacción (click) — WebUSB rechaza el
// diálogo fuera de eventos de usuario; el permiso USB nativo también.
export async function pairUsbPrinter(): Promise<void> {
  await requireUsbTransport().pair();
}

// ¿Hay una impresora USB emparejada y localizable sin diálogo? Antes
// devolvía el `USBDevice`; ahora un booleano (los callers sólo miran la
// veracidad para decidir si ofrecer "Emparejar").
export async function getPairedUsbPrinter(): Promise<boolean> {
  const t = usbTransport();
  if (!t) return false;
  return t.isPaired();
}

// Envía un binary ESC/POS a la impresora USB emparejada. Si no hay
// ninguna, lanza `PrinterError("NOT_PAIRED")` que el caller convierte en
// "empareja primero".
//
// v1.10.2-impresion-honesta · devuelve el `PrintResult` del transporte en
// vez de `void`. La UI no puede pintar "impreso" con lo que ella supone:
// tiene que pintar lo que el transporte confirma (y `printedAt` es esa
// confirmación). Ensancha el tipo, no rompe callers.
export async function printEscposUsb(bytes: Uint8Array): Promise<PrintResult> {
  return requireUsbTransport().print(bytes);
}

// Abre el cajón portamonedas por la impresora USB (pulso kick ESC/POS).
export async function openUsbCashDrawer(): Promise<void> {
  await requireUsbTransport().openCashDrawer();
}

// A1 · Frente 3 · abre el cajón SÓLO si hay impresora USB emparejada.
// Best-effort: el cajón NUNCA debe bloquear ni romper el cobro. Si no hay
// transporte USB (WiFi-only), no hay impresora emparejada, o el pulso
// falla, se ignora en silencio. Se llama al cerrar una venta en efectivo.
export async function openCashDrawerIfAvailable(): Promise<void> {
  const t = usbTransport();
  if (!t || !t.isSupported()) return;
  try {
    if (!(await t.isPaired())) return;
    await t.openCashDrawer();
  } catch {
    // el cajón es accesorio; el cobro ya está hecho.
  }
}

// Pide el binary ESC/POS al backend (genera buildTicketReceipt sobre
// el ticket persistido) y lo manda a la impresora USB.
export async function printTicketUsb(
  ticketId: string,
  opts: { copy?: boolean } = {},
): Promise<PrintResult> {
  const bytes = await fetchTicketEscposBinary(ticketId, opts);
  return printEscposUsb(bytes);
}

// Llama al endpoint backend que abre TCP a la impresora WIFI configurada
// para el register. El backend gestiona los reintentos / errores y
// devuelve `{ok}`. Si la impresora no está configurada, devuelve 409.
// v1.10.2-impresion-honesta · devuelve el `{ok, printedAt}` del backend
// (antes lo descartaba). El backend responde 502 si el socket TCP a la
// impresora falla y 409 si no hay impresora WIFI activa: ambos llegan al
// caller como `ApiError`, que es lo que permite decir el motivo.
export async function printTicketWifi(
  ticketId: string,
  printerConfigId?: string,
  opts: { copy?: boolean } = {},
): Promise<{ ok: boolean; printedAt: string }> {
  const params = new URLSearchParams({ target: "wifi" });
  if (printerConfigId) params.set("printerConfigId", printerConfigId);
  if (opts.copy) params.set("copy", "true");
  return apiWithCashier<{ ok: boolean; printedAt: string }>(
    `/tickets/${ticketId}/print/escpos?${params.toString()}`,
    { method: "POST" },
  );
}

// Pide al backend el binary ESC/POS del ticket. Recibe octet-stream.
export async function fetchTicketEscposBinary(
  ticketId: string,
  opts: { copy?: boolean } = {},
): Promise<Uint8Array> {
  const params = new URLSearchParams({ target: "usb" });
  if (opts.copy) params.set("copy", "true");
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
