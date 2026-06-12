// Contrato de transporte de impresión para mipiacetpv.
//
// PROBLEMA QUE RESUELVE: en la PWA web, `tpv-web/src/lib/escposPrint.ts`
// imprime por WebUSB (USB) o por backend TCP (WiFi). WebUSB NO existe en
// el WebView de Android, así que la rama USB se rompe dentro de la app.
//
// SOLUCIÓN: el TPV no debe saber si está en navegador o en Capacitor.
// Toda impresión pasa por un `PrinterTransport`. Cada plataforma
// registra su implementación al arrancar:
//
//   - Navegador (Chrome/PWA):  WebUsbTransport  + WifiBackendTransport
//   - Android (Capacitor):     BluetoothTransport / UsbNativeTransport
//                              + WifiBackendTransport (idéntico a web)
//
// El builder de bytes (`@mipiacetpv/escpos-builder`) NO cambia: genera el
// mismo binario ESC/POS; solo cambia QUIÉN lo entrega a la impresora.
//
// ADR-011: solo protocolos estándar (ESC/POS sobre BT/USB/TCP). Prohibido
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
   * depende del canal: MAC en BT, vendor:product:serial en USB,
   * host:port en WiFi. El TPV la persiste y la vuelve a pasar.
   */
  address: string;
}

export interface PrintResult {
  ok: boolean;
  /** ISO timestamp del momento en que la impresora aceptó el binario. */
  printedAt: string;
}

/** Error de impresión con causa accionable por la UI del TPV. */
export class PrinterError extends Error {
  constructor(
    message: string,
    /** Código estable para que la UI decida el mensaje al cajero. */
    public readonly code:
      | "NOT_PAIRED"
      | "UNREACHABLE"
      | "PERMISSION_DENIED"
      | "TIMEOUT"
      | "UNSUPPORTED"
      | "UNKNOWN",
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
 *    El transporte NO construye contenido, solo lo entrega.
 *  - Los errores se lanzan como `PrinterError` con `code` accionable.
 *  - `openCashDrawer()` por defecto manda el pulso "kick" ESC/POS por la
 *    misma impresora; un transporte puede sobrescribirlo si su hardware
 *    lo expone de otra forma.
 */
export interface PrinterTransport {
  readonly channel: PrinterChannel;

  /** ¿Está disponible en esta plataforma? (p.ej. WebUSB en navegador). */
  isSupported(): boolean;

  /**
   * Empareja/selecciona una impresora. En BT/USB puede abrir un diálogo
   * nativo (debe llamarse desde un gesto de usuario). Persistir el
   * descriptor es responsabilidad del caller.
   */
  pair(): Promise<PrinterDescriptor>;

  /** Reconecta a una impresora ya conocida, sin diálogo. */
  connect(descriptor: PrinterDescriptor): Promise<void>;

  /** Entrega el binario ESC/POS a la impresora conectada. */
  print(bytes: Uint8Array): Promise<PrintResult>;

  /** Abre el cajón portamonedas (pulso kick ESC/POS por defecto). */
  openCashDrawer(): Promise<void>;

  /** Libera recursos (cierra socket/interface/GATT). */
  disconnect(): Promise<void>;
}

/**
 * Registro global de transportes. El bootstrap de plataforma
 * (tpv-web/src/platform) registra los que apliquen; el TPV pide uno por
 * canal sin saber en qué plataforma corre.
 */
export interface PrinterRegistry {
  register(transport: PrinterTransport): void;
  get(channel: PrinterChannel): PrinterTransport | null;
  available(): PrinterChannel[];
}
