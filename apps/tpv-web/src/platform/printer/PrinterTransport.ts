// Contrato de transporte de impresión del TPV — CANÓNICO.
//
// A0 dejó este contrato en `apps/tpv-android/src/printer/PrinterTransport.ts`
// como artefacto de diseño. A1 lo MUEVE aquí, a `tpv-web`, porque el
// código JS que lo implementa (registry + transportes) viaja en el bundle
// de `tpv-web` y corre EN AMBOS entornos: el navegador y el WebView de
// Capacitor. `tpv-android` es sólo el shell nativo; su copia del contrato
// queda como puntero a esta (ver ese archivo).
//
// PROBLEMA QUE RESUELVE: en la PWA, `lib/escposPrint.ts` imprimía por
// WebUSB (USB) o por backend TCP (WiFi). WebUSB NO existe en el WebView
// de Android, así que la rama USB se rompe dentro de la app.
//
// SOLUCIÓN: el TPV no sabe si corre en navegador o en Capacitor. Toda
// impresión pasa por un `PrinterTransport`. Cada plataforma registra su
// implementación al arrancar (ver `bootstrap.ts`):
//
//   - Navegador (Chrome/PWA):  WebUsbTransport   + WifiBackendTransport
//   - Android (Capacitor):     UsbNativeTransport + WifiBackendTransport
//
// El builder de bytes (`@mipiacetpv/escpos-builder`) NO cambia: genera el
// mismo binario ESC/POS; sólo cambia QUIÉN lo entrega a la impresora.
//
// ADR-011: sólo protocolos estándar (ESC/POS sobre USB/TCP). Prohibido
// acoplar a un SDK de fabricante.

/** Tipo de conexión física con la impresora. */
export type PrinterChannel = "bluetooth" | "usb" | "wifi";

/** Identifica una impresora ya emparejada/configurada, para reusarla. */
export interface PrinterDescriptor {
  channel: PrinterChannel;
  /** Nombre legible para la UI ("EPSON TM-m30", "POS-80"). */
  label: string;
  /**
   * Clave estable para reconectar sin volver a emparejar. Su forma
   * depende del canal: MAC en BT, `vendor:product:serial` en USB,
   * host:port en WiFi. El transporte la persiste y la vuelve a resolver.
   */
  address: string;
}

export interface PrintResult {
  ok: boolean;
  /** ISO timestamp del momento en que la impresora aceptó el binario. */
  printedAt: string;
}

/** Códigos de error accionables por la UI del TPV. */
export type PrinterErrorCode =
  | "NOT_PAIRED"
  | "UNREACHABLE"
  | "PERMISSION_DENIED"
  | "TIMEOUT"
  | "UNSUPPORTED"
  | "UNKNOWN";

/** Error de impresión con causa accionable por la UI del TPV. */
export class PrinterError extends Error {
  constructor(
    message: string,
    /** Código estable para que la UI decida el mensaje al cajero. */
    public readonly code: PrinterErrorCode,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PrinterError";
  }
}

/**
 * Contrato único de impresión. Cada plataforma implementa esto.
 *
 * Reglas de implementación:
 *  - `print()` recibe los bytes ESC/POS YA construidos por el builder.
 *    El transporte NO construye contenido, sólo lo entrega.
 *  - Los errores se lanzan como `PrinterError` con `code` accionable.
 *  - `openCashDrawer()` por defecto manda el pulso "kick" ESC/POS por la
 *    misma impresora; un transporte puede sobrescribirlo si su hardware
 *    lo expone de otra forma.
 *
 * A1 añade `isPaired()` y `forget()` sobre el contrato de A0: el TPV
 * necesita saber "¿hay impresora lista sin diálogo?" (para no ofrecer el
 * botón Emparejar de más) y "olvida el emparejamiento" (cuando el admin
 * borra o cambia la impresora server-side). Ambos son universales: WiFi
 * los resuelve trivialmente (config vive en backend).
 */
export interface PrinterTransport {
  readonly channel: PrinterChannel;

  /** ¿Está disponible en esta plataforma? (p.ej. WebUSB en navegador). */
  isSupported(): boolean;

  /**
   * Empareja/selecciona una impresora. En USB abre un diálogo nativo
   * (debe llamarse desde un gesto de usuario). El transporte persiste el
   * descriptor internamente para reconexiones sin diálogo.
   */
  pair(): Promise<PrinterDescriptor>;

  /** Reconecta a una impresora ya conocida, sin diálogo. */
  connect(descriptor: PrinterDescriptor): Promise<void>;

  /** ¿Hay una impresora emparejada y localizable sin diálogo? */
  isPaired(): Promise<boolean>;

  /** Entrega el binario ESC/POS a la impresora conectada. */
  print(bytes: Uint8Array): Promise<PrintResult>;

  /** Abre el cajón portamonedas (pulso kick ESC/POS por defecto). */
  openCashDrawer(): Promise<void>;

  /** Olvida el emparejamiento persistido (no lanza si no había). */
  forget(): Promise<void>;

  /** Libera recursos (cierra socket/interface). */
  disconnect(): Promise<void>;
}

/**
 * Registro de transportes. El bootstrap de plataforma registra los que
 * apliquen; el TPV pide uno por canal sin saber en qué plataforma corre.
 */
export interface PrinterRegistry {
  register(transport: PrinterTransport): void;
  get(channel: PrinterChannel): PrinterTransport | null;
  available(): PrinterChannel[];
}
