// La huella o «hash» de un registro de facturación.
//
// Fuente: «Detalle de las especificaciones técnicas para generación de la
// huella o hash de los registros de facturación», AEAT, v0.1.2 del
// 27-08-2024, desarrollo del art. 13 de la Orden HAC/1177/2024.
//
// Las tres reglas que hay que respetar al pie de la letra, porque los
// ejemplos oficiales de §6 del documento —que son los tests dorados de
// `test/huella.test.ts`— se caen con cualquier desviación:
//
//   1. El ORDEN de los campos. Es el de su aparición en el diseño de
//      registro, no alfabético ni ninguno otro.
//   2. Un campo sin valor deja el nombre y el `=` y nada detrás
//      (`…&Huella=&FechaHoraHusoGenRegistro=…`). No se omite el campo.
//   3. La salida es hexadecimal en MAYÚSCULAS, 64 caracteres.
//
// Los valores llegan aquí YA FORMATEADOS (importes con dos decimales,
// fechas en dd-mm-yyyy). Formatear aquí dentro invitaría a que alguien
// llamase a esta función con un número y a que la huella dependiera de la
// configuración regional del dispositivo.

/** Nombre del algoritmo en la lista L12 del anexo. Hoy es el único. */
export const TIPO_HUELLA_SHA256 = "01";

export interface HuellaAltaInput {
  /** NIF del obligado a expedir la factura. */
  idEmisorFactura: string;
  /** Nº Serie + Nº Factura, el literal completo. */
  numSerieFactura: string;
  /** `dd-mm-yyyy`. */
  fechaExpedicionFactura: string;
  /** Lista L2: `F2` para la factura simplificada. */
  tipoFactura: string;
  /** Ya formateado con `importeAeat`. */
  cuotaTotal: string;
  /** Ya formateado con `importeAeat`. */
  importeTotal: string;
  /** Huella del registro anterior de ESTA cadena. `null` en el primero. */
  huellaAnterior: string | null;
  /** `YYYY-MM-DDThh:mm:ss±hh:mm`. */
  fechaHoraHusoGenRegistro: string;
}

export interface HuellaAnulacionInput {
  idEmisorFacturaAnulada: string;
  numSerieFacturaAnulada: string;
  /** `dd-mm-yyyy`. */
  fechaExpedicionFacturaAnulada: string;
  huellaAnterior: string | null;
  fechaHoraHusoGenRegistro: string;
}

/** `nombre=valor`, con el valor sin espacios al inicio ni al final y
 *  vacío cuando el campo no está informado (v0.1.2 §3). */
function campo(nombre: string, valor: string | null | undefined): string {
  return `${nombre}=${(valor ?? "").trim()}`;
}

/**
 * Cadena de entrada de la huella de un registro de ALTA.
 *
 * Orden del §3.a del documento:
 *   IDEmisorFactura, NumSerieFactura, FechaExpedicionFactura, TipoFactura,
 *   CuotaTotal, ImporteTotal, Huella, FechaHoraHusoGenRegistro
 */
export function buildHuellaInputAlta(input: HuellaAltaInput): string {
  return [
    campo("IDEmisorFactura", input.idEmisorFactura),
    campo("NumSerieFactura", input.numSerieFactura),
    campo("FechaExpedicionFactura", input.fechaExpedicionFactura),
    campo("TipoFactura", input.tipoFactura),
    campo("CuotaTotal", input.cuotaTotal),
    campo("ImporteTotal", input.importeTotal),
    campo("Huella", input.huellaAnterior),
    campo("FechaHoraHusoGenRegistro", input.fechaHoraHusoGenRegistro),
  ].join("&");
}

/**
 * Cadena de entrada de la huella de un registro de ANULACIÓN.
 *
 * Orden del §3.b: los tres campos de identificación llevan el sufijo
 * `Anulada` —`IDEmisorFacturaAnulada`, `NumSerieFacturaAnulada`,
 * `FechaExpedicionFacturaAnulada`—, y no hay ni TipoFactura ni importes.
 */
export function buildHuellaInputAnulacion(
  input: HuellaAnulacionInput,
): string {
  return [
    campo("IDEmisorFacturaAnulada", input.idEmisorFacturaAnulada),
    campo("NumSerieFacturaAnulada", input.numSerieFacturaAnulada),
    campo("FechaExpedicionFacturaAnulada", input.fechaExpedicionFacturaAnulada),
    campo("Huella", input.huellaAnterior),
    campo("FechaHoraHusoGenRegistro", input.fechaHoraHusoGenRegistro),
  ].join("&");
}

export class WebCryptoNoDisponibleError extends Error {
  constructor() {
    super(
      "Este entorno no expone crypto.subtle: no se puede calcular la huella " +
        "del registro de facturación.",
    );
    this.name = "WebCryptoNoDisponibleError";
  }
}

/** ¿Se puede calcular la huella aquí?
 *
 *  Existe para poder responderlo ANTES de que haya un cliente delante: el
 *  arranque del TPV lo comprueba y avisa, en vez de descubrirlo en el
 *  primer cobro. Node 18+ y toda WebView moderna lo traen; el AP12 no
 *  tiene `crypto.randomUUID` y de ahí no se deduce nada sobre `subtle`.
 */
export function hasWebCrypto(): boolean {
  return typeof globalThis.crypto?.subtle?.digest === "function";
}

/**
 * SHA-256 de la cadena, codificada en UTF-8, en hexadecimal y MAYÚSCULAS.
 *
 * Asíncrona porque `crypto.subtle` lo es. Es la misma función en el
 * servidor y en el dispositivo: si divergieran, la huella que verifica el
 * servidor no sería la que generó la tablet, que es justo lo que la cadena
 * existe para detectar.
 */
export async function huellaSha256(input: string): Promise<string> {
  if (!hasWebCrypto()) throw new WebCryptoNoDisponibleError();
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** ¿La huella declarada es la de esta cadena de entrada? */
export async function huellaCoincide(
  huellaInput: string,
  huella: string,
): Promise<boolean> {
  return (await huellaSha256(huellaInput)) === huella.trim().toUpperCase();
}
