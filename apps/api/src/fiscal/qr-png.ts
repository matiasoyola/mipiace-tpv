// El QR tributario, rasterizado.
//
// `@mipiacetpv/ticket-pdf` no genera códigos QR —no tiene dependencias más
// allá de `pdf-lib`— así que quien llama le pasa el PNG. Este helper existe
// para que los dos sitios que renderizan el PDF en el servidor (el email y
// el PDF público) no escriban cada uno sus propias opciones: el nivel de
// corrección de errores es una exigencia de la norma, no una preferencia.

import type { TicketDocument } from "@mipiacetpv/ticket-model";
import { QR_NIVEL_CORRECCION } from "@mipiacetpv/verifactu";
import QRCode from "qrcode";

/**
 * PNG del QR tributario de este documento, o `undefined` si no lleva parte
 * fiscal (comercio que factura con Holded) o si la librería falla.
 *
 * Que un fallo devuelva `undefined` en vez de lanzar es deliberado: el PDF
 * se entrega igual. Un documento sin QR es un problema que hay que ver en
 * los logs; un documento que no se entrega es un cliente sin su factura.
 */
export async function renderQrTributarioPng(
  doc: TicketDocument,
  onError?: (err: unknown) => void,
): Promise<Uint8Array | undefined> {
  if (!doc.verifactu) return undefined;
  try {
    const buf = await QRCode.toBuffer(doc.verifactu.qrUrl, {
      type: "png",
      // Art. 21.1 de la Orden HAC/1177/2024: nivel M.
      errorCorrectionLevel: QR_NIVEL_CORRECCION,
      // 512 px para que a 33 mm impresos no se vea pixelado.
      width: 512,
      margin: 1,
    });
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (err) {
    onError?.(err);
    return undefined;
  }
}
