// El QR tributario del PDF, rasterizado en el navegador.
//
// Hermano exacto de `apps/api/src/fiscal/qr-png.ts`: existe para que los
// dos sitios del TPV que renderizan el PDF (la descarga y el preview) no
// escriban cada uno sus opciones. El nivel de corrección de errores no es
// una preferencia, es el art. 21.1 de la Orden HAC/1177/2024.

import type { TicketDocument } from "@mipiacetpv/ticket-model";
import { QR_NIVEL_CORRECCION } from "@mipiacetpv/verifactu";
import QRCode from "qrcode";

/** PNG del QR tributario, o `undefined` si el documento no lleva parte
 *  fiscal o si la librería falla. Un fallo NO tumba el PDF: un documento
 *  sin QR es un problema; un documento que no se entrega es un cliente sin
 *  su factura. */
export async function qrTributarioPng(
  doc: TicketDocument,
): Promise<Uint8Array | undefined> {
  if (!doc.verifactu) return undefined;
  try {
    const dataUrl = await QRCode.toDataURL(doc.verifactu.qrUrl, {
      errorCorrectionLevel: QR_NIVEL_CORRECCION,
      width: 512,
      margin: 1,
    });
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}
