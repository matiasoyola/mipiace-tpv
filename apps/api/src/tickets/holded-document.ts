// Qué hacer con un documento de Holded que YA tenemos guardado
// (bloque abonos-holded, 26-09-2026).
//
// Desde este bloque, un `silent_reject` del POST guarda el
// `holdedDocumentId`: el documento existe en Holded, aprobado y numerado,
// y perderle el id era lo que dejaba huérfanos los seis abonos de
// Peluquería Sole. Guardarlo tiene una consecuencia: el siguiente
// reintento se encuentra un id en la base y NO puede limitarse a seguir
// como si el documento estuviera bien. Hay tres casos y los tres importan:
//
//   · `usable`         → el documento está y su total cuadra. El reintento
//                        salta el POST y va al /pay. Cero documentos
//                        nuevos: esto es lo que hace que un reintento no
//                        duplique.
//   · `gone`           → Holded ya no lo tiene (lo borró el propietario al
//                        regularizar: `DELETE` sobre un salesreceipt
//                        aprobado funciona, probado el 26-09-2026). Se
//                        olvida el id y se vuelve a crear el documento
//                        bueno. Éste es el camino de la regularización
//                        desde el panel.
//   · `total_mismatch` → el documento está pero su total no es el nuestro
//                        (el caso de los 0 €). NO se toca: ni POST nuevo
//                        ni /pay sobre un documento equivocado. Se queda
//                        en SYNC_FAILED con el id y el número delante para
//                        que el propietario lo anule en Holded.

import {
  HoldedApiError,
  getSalesreceipt,
  type HoldedClient,
  type SalesreceiptStored,
} from "@mipiacetpv/holded-client";

// Misma tolerancia que `createSalesreceiptApproved` (5 céntimos, drift de
// float64 entre nuestro cálculo y el de Holded).
const TOTAL_TOLERANCE_EUR = 0.05;

export type ExistingDocumentVerdict =
  | { kind: "usable"; stored: SalesreceiptStored }
  | { kind: "gone" }
  | {
      kind: "total_mismatch";
      documentId: string;
      docNumber: string | null;
      storedTotal: number;
      expectedTotal: number;
    };

// Holded contesta al GET de un documento borrado con 400 y
// `{"status":0,"info":"not found"}` — no con 404. Comprobado el
// 26-09-2026 borrando un salesreceipt aprobado de PRUEBAS MIPIACE.
export function isDocumentGoneError(err: unknown): boolean {
  if (!(err instanceof HoldedApiError)) return false;
  if (err.status === 404) return true;
  if (err.status !== 400) return false;
  const info = (err.body as { info?: unknown } | null)?.info;
  return typeof info === "string" && /not found/i.test(info);
}

export async function inspectExistingDocument(
  client: HoldedClient,
  documentId: string,
  expectedTotal: number,
): Promise<ExistingDocumentVerdict> {
  let stored: SalesreceiptStored;
  try {
    stored = await getSalesreceipt(client, documentId);
  } catch (err) {
    if (isDocumentGoneError(err)) return { kind: "gone" };
    throw err;
  }
  const storedTotal = Number(stored.total ?? 0);
  if (
    Math.sign(storedTotal) !== Math.sign(expectedTotal) ||
    Math.abs(storedTotal - expectedTotal) > TOTAL_TOLERANCE_EUR
  ) {
    return {
      kind: "total_mismatch",
      documentId,
      docNumber: stored.docNumber ?? null,
      storedTotal,
      expectedTotal,
    };
  }
  return { kind: "usable", stored };
}

// El texto que lee el propietario en la bandeja de errores. Se guarda en
// `syncError` para que el panel no tenga que reconstruirlo.
//
// No dice "bórralo" a secas: qué se hace con un documento que Holded dejó
// con otro total es una decisión de contabilidad, no del TPV. Con los seis
// abonos de Peluquería Sole se decidió CONSERVAR los documentos de 0 € —
// borrarlos deja huecos en la numeración de la serie— y anotarlos al
// asesor (ver `docs/blocks/abonos-holded-done.md` §2). Lo que el mensaje sí
// tiene que dejar claro es lo único que es nuestro: que Reintentar no va a
// crear otro documento mientras ése exista, y por qué.
export function describeMismatchedDocument(v: {
  docNumber: string | null;
  documentId: string;
  storedTotal: number;
  expectedTotal: number;
}): string {
  const name = v.docNumber ?? v.documentId;
  return (
    `Holded creó el documento ${name} con total ${v.storedTotal.toFixed(2)} € ` +
    `en vez de ${v.expectedTotal.toFixed(2)} €. Mientras ese documento exista, ` +
    `Reintentar no crea otro, para no duplicar el abono. Anótalo con el asesor: ` +
    `si se decide borrarlo en Holded, al reintentar se crea el bueno solo; si se ` +
    `conserva, hay que emitir el abono a mano allí y marcar esto como resuelto.`
  );
}
