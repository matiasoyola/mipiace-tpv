import type { HoldedClient } from "./client.js";
import { HoldedSilentRejectError } from "./errors.js";
import type { SilentRejectMismatch } from "./errors.js";

// Payload del salesreceipt (spike §05.A — payload mínimo definitivo).
// `items` en el request, pero la respuesta usa `products` (spike §03.C).
export interface SalesreceiptItem {
  name: string;
  units: number;
  // PRECIO UNITARIO QUE HOLDED LEE DE VERDAD (bloque abonos-holded,
  // probes K/P/Q/S/T del 26-09-2026 contra la cuenta PRUEBAS MIPIACE).
  //
  // Holded IGNORA `price` en el item de un `salesreceipt`. El campo que
  // respeta es `subtotal`, y es el precio de UNA unidad (el `discount`
  // se aplica encima, y `units` multiplica después):
  //
  //   · con `subtotal`                      → price almacenado = subtotal
  //   · sin `subtotal`, con sku/serviceId    → price almacenado = el del
  //                                            CATÁLOGO de Holded
  //   · sin `subtotal` y sin identificador   → price almacenado = 0
  //
  // La tercera fila es el silent_reject de siempre. La SEGUNDA es la
  // trampa silenciosa: un override del cajero o un modificador con
  // recargo se perdía y Holded emitía el documento al precio de catálogo.
  // Por eso `subtotal` es obligatorio aquí.
  subtotal: number;
  // Se sigue mandando con el MISMO valor que `subtotal` aunque Holded hoy
  // lo ignore: es el campo que documenta su API y el que mandábamos desde
  // el MVP. Si algún día lo empieza a leer, los dos dicen lo mismo.
  price: number;
  tax: number;
  discount?: number;
  // SKU canónico Holded del PRODUCTO (spike §05.B). NO enviar `productId`.
  // Ya NO es el que decide el precio —eso lo hace `subtotal`—: sirve para
  // que la línea quede enganchada al producto de Holded (stock, informes).
  // Un sku que allí no resuelve se ignora sin ruido.
  sku?: string;
  // Identificador de la línea de SERVICIO (v1.3-hotfix8; id MongoDB del
  // servicio). Mismo papel que `sku` en un producto: engancha la línea al
  // servicio de Holded. Ambos son exclusivos entre sí.
  //
  // Matiz importante del hotfix8: su diagnóstico ("sin identificador
  // Holded pone price=0") era cierto pero incompleto — lo que faltaba era
  // `subtotal`. Con `subtotal` la línea lleva su precio incluso sin
  // identificador ninguno (probe S). Se sigue mandando el identificador
  // porque el enganche con el catálogo sí depende de él.
  serviceId?: string;
  // Descripción libre del item. B-Bar-Modifiers la usa para mostrar el
  // desglose textual de modificadores ("(Tipo de leche: Desnatada; ...)").
  // Holded la persiste y la imprime debajo del nombre en la factura.
  desc?: string;
}

export interface SalesreceiptPayload {
  approveDoc: true; // Obligatorio para nacer aprobado con docNumber (§05.A).
  date: number; // epoch seconds.
  notes: string; // contiene "TPV-uuid: <externalId>" — única vía confiable.
  items: SalesreceiptItem[];
  // numSerieId opcional: si se omite Holded usa la serie default
  // (spike §04.B — no hay endpoint público para listar series).
  numSerieId?: string;
  // Holded acepta y a veces persiste campos extra. No enviarlos por defecto.
  [extra: string]: unknown;
}

export interface SalesreceiptStored {
  id: string;
  docNumber: string | null;
  approvedAt: number | null;
  draft: boolean | null; // null cuando approveDoc=true (spike §05.C).
  date: number;
  accountingDate?: number;
  total: number;
  subtotal: number;
  tax: number;
  discount: number;
  notes?: string;
  paymentsTotal: number;
  paymentsPending: number;
  paymentsRefunds?: number;
  // Líneas almacenadas (renombradas a `products`).
  products: Array<{
    line_id?: string;
    name: string;
    sku: string | number;
    units: number;
    price: number;
    tax: number;
    taxes?: string[];
    discount?: number;
    [extra: string]: unknown;
  }>;
  [extra: string]: unknown;
}

export interface CreateSalesreceiptResult {
  documentId: string;
  stored: SalesreceiptStored;
}

const SALESRECEIPT_PATH = "/invoicing/v1/documents/salesreceipt";
const TOTAL_TOLERANCE_EUR = 0.05;

export interface CreateSalesreceiptOptions {
  externalId: string; // UUID v4 que aparece en notes para idempotencia local.
  expectedTotal: number; // total con IVA que el TPV calculó.
}

// POST salesreceipt + GET-back validando invariantes ADR-010.
// Lanza HoldedSilentRejectError si:
//   - docNumber es null (documento no aprobado)
//   - approvedAt es null
//   - total no coincide con `expectedTotal` ± 0.05 € (EN SIGNO Y EN VALOR:
//     un abono nace con total negativo y eso es lo correcto)
//   - notes no contiene `externalId`
//   - paymentsPending != stored.total (el doc nace sin cobro)
//
// IMPORTANTE (bloque abonos-holded): cuando el POST sí creó el documento
// y es el GET-back el que falla, el error lleva `document` con el id y el
// número. El documento EXISTE en Holded, aprobado y numerado; el caller
// tiene que guardar ese id antes de marcar el fallo o queda huérfano.
export async function createSalesreceiptApproved(
  client: HoldedClient,
  payload: SalesreceiptPayload,
  options: CreateSalesreceiptOptions,
): Promise<CreateSalesreceiptResult> {
  if (!payload.notes.includes(options.externalId)) {
    throw new Error(
      "createSalesreceiptApproved: payload.notes debe contener el externalId",
    );
  }
  const postResponse = await client.request<{ id?: string; status?: number; info?: string }>(
    SALESRECEIPT_PATH,
    { method: "POST", body: JSON.stringify(payload) },
  );
  const documentId = typeof postResponse.id === "string" ? postResponse.id : null;
  if (!documentId) {
    throw new HoldedSilentRejectError(
      "POST salesreceipt",
      SALESRECEIPT_PATH,
      [{ field: "id", expected: "<string>", actual: postResponse.id }],
      postResponse,
    );
  }

  const stored = await client.request<SalesreceiptStored>(
    `${SALESRECEIPT_PATH}/${documentId}`,
  );

  const mismatches: SilentRejectMismatch[] = [];
  if (stored.docNumber == null || stored.docNumber === "") {
    mismatches.push({ field: "docNumber", expected: "<string>", actual: stored.docNumber });
  }
  if (stored.approvedAt == null) {
    mismatches.push({ field: "approvedAt", expected: "<epoch>", actual: stored.approvedAt });
  }
  if (stored.draft === true) {
    mismatches.push({ field: "draft", expected: "null|false", actual: stored.draft });
  }
  // El total tiene que coincidir en VALOR y en SIGNO. La comprobación
  // anterior era `!(storedTotal > 0)`, que daba por roto TODO abono: un
  // salesreceipt de devolución nace con total negativo (units negativas,
  // confirmado contra Holded el 26-09-2026: total -9.68, paymentsPending
  // -9.68, y el /pay con amount negativo lo deja a 0).
  const storedTotal = Number(stored.total ?? 0);
  if (
    Math.sign(storedTotal) !== Math.sign(options.expectedTotal) ||
    Math.abs(storedTotal - options.expectedTotal) > TOTAL_TOLERANCE_EUR
  ) {
    mismatches.push({
      field: "total",
      expected: options.expectedTotal,
      actual: storedTotal,
    });
  }
  if (!stored.notes || !stored.notes.includes(options.externalId)) {
    mismatches.push({
      field: "notes",
      expected: `<contains "${options.externalId}">`,
      actual: stored.notes,
    });
  }
  const paymentsPending = Number(stored.paymentsPending ?? -1);
  if (Math.abs(paymentsPending - storedTotal) > 0.01) {
    mismatches.push({
      field: "paymentsPending",
      expected: storedTotal,
      actual: paymentsPending,
    });
  }

  if (mismatches.length > 0) {
    throw new HoldedSilentRejectError(
      "POST salesreceipt",
      `${SALESRECEIPT_PATH}/${documentId}`,
      mismatches,
      stored,
      { id: documentId, docNumber: stored.docNumber ?? null },
    );
  }

  return { documentId, stored };
}

export interface PayPayload {
  date: number; // epoch seconds; obligatorio (spike §04.E).
  amount: number;
  desc?: string;
  treasury?: string; // bankId del paymentmethod; opcional (§06.A).
}

// POST .../pay + GET-back validando paymentsPending == 0.
//
// v1.3-hotfix10 — idempotencia. Antes de postear, hacemos un GET-back
// del doc para ver si ya está pagado. Si `paymentsPending` ya está
// dentro de tolerancia, devolvemos el `stored` SIN volver a postear el
// pay. Esto cubre el escenario en que un ticket se quedó SYNC_FAILED
// tras el primer pay (silent_reject de tolerancia, por ejemplo) y al
// reintentar el documentId ya existe en BD: la fase salesreceipt salta
// y solo se ejecuta `registerPaymentWithGetBack`. Sin idempotencia, el
// reintento duplicaba el cobro en Holded (caso real: ticket #000006
// Peluquería Sole acabó con paymentsPending=-68.98 tras doble pay).
export async function registerPaymentWithGetBack(
  client: HoldedClient,
  documentId: string,
  payload: PayPayload,
): Promise<SalesreceiptStored> {
  const payPath = `${SALESRECEIPT_PATH}/${documentId}/pay`;
  const PAY_TOLERANCE_EUR = 0.05;

  // Pre-check idempotente: si el doc ya está pagado, no posteamos.
  const preCheck = await client.request<SalesreceiptStored>(
    `${SALESRECEIPT_PATH}/${documentId}`,
  );
  const prePending = Number(preCheck.paymentsPending ?? -1);
  // `paymentsTotal` de un abono ya cobrado es NEGATIVO (-9.68 en el
  // ensayo del 26-09-2026), así que la condición va en valor absoluto.
  // Con `> 0` el pre-check no disparaba nunca en una devolución y el
  // reintento duplicaba el pago negativo.
  if (Math.abs(Number(preCheck.paymentsTotal ?? 0)) > 0 && Math.abs(prePending) <= PAY_TOLERANCE_EUR) {
    // Ya pagado en un intento previo. Devolvemos el estado actual; el
    // caller no distingue entre "acabo de pagar" y "ya estaba pagado".
    return preCheck;
  }

  await client.request<{ status?: number; paymentId?: string }>(payPath, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const stored = await client.request<SalesreceiptStored>(
    `${SALESRECEIPT_PATH}/${documentId}`,
  );
  const pending = Number(stored.paymentsPending ?? -1);
  // v1.3-hotfix9 · tolerancia 5 céntimos (igual que TOTAL_TOLERANCE_EUR).
  // Antes era 0.01 estrictamente: diferencias de redondeo de 1 céntimo
  // entre nuestro cálculo (line.price * units con IVA 21%) y el de
  // Holded provocaban silent_reject de pay (caso real: ticket #000006
  // Peluquería Sole, 68.99 €, pending=0.0100000000000005 por float64).
  if (Math.abs(pending) > 0.05) {
    throw new HoldedSilentRejectError(
      "POST salesreceipt/pay",
      payPath,
      [{ field: "paymentsPending", expected: 0, actual: pending }],
      stored,
    );
  }
  return stored;
}

// GET de un salesreceipt almacenado por id (v1.5-consistencia-B Lote 4
// · conciliación diaria). Mismo GET-back que usa createSalesreceipt-
// Approved, expuesto suelto para leer documentos ya subidos. 404 →
// HoldedApiError(status=404) — el caller lo interpreta como "documento
// desaparecido de Holded".
export async function getSalesreceipt(
  client: HoldedClient,
  documentId: string,
): Promise<SalesreceiptStored> {
  return client.request<SalesreceiptStored>(`${SALESRECEIPT_PATH}/${documentId}`);
}

// GET /pdf devuelve JSON `{status, data: base64}` pese al content-type
// mentiroso (spike §06.B). El cliente base ya lanza si Content-Type no
// es JSON — pero Holded en este endpoint manda `text/html` con cuerpo
// JSON, así que hay que hacer la petición a pelo. Por eso este helper
// usa `fetch` directamente con la API key.
export async function getReceiptPdf(
  apiKey: string,
  documentId: string,
  options: {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<Buffer> {
  const baseUrl = options.baseUrl ?? "https://api.holded.com/api";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `${baseUrl}${SALESRECEIPT_PATH}/${documentId}/pdf`;
  const res = await fetchImpl(url, {
    headers: { key: apiKey, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`getReceiptPdf: ${res.status} on ${url}: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(text) as { status?: number; data?: string; info?: string };
  if (parsed.status !== 1 || typeof parsed.data !== "string") {
    throw new Error(
      `getReceiptPdf: respuesta sin pdf (status=${parsed.status}, info=${parsed.info})`,
    );
  }
  const buffer = Buffer.from(parsed.data, "base64");
  // El base64 decodificado lleva headers HTTP en texto seguidos del PDF
  // binario. Buscar el header "%PDF" para encontrar el inicio del binario.
  const pdfMarker = Buffer.from("%PDF", "utf8");
  const pdfStart = buffer.indexOf(pdfMarker);
  if (pdfStart < 0) {
    throw new Error("getReceiptPdf: no se encontró el header %PDF en el cuerpo");
  }
  return buffer.subarray(pdfStart);
}
