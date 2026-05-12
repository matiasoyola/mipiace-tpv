import type { HoldedClient } from "./client.js";
import { HoldedSilentRejectError } from "./errors.js";
import type { SilentRejectMismatch } from "./errors.js";

// Payload del salesreceipt (spike §05.A — payload mínimo definitivo).
// `items` en el request, pero la respuesta usa `products` (spike §03.C).
export interface SalesreceiptItem {
  name: string;
  units: number;
  price: number;
  tax: number;
  discount?: number;
  sku: string; // SKU canónico Holded (spike §05.B). NO enviar `productId`.
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
//   - total no coincide con `expectedTotal` ± 0.05 €
//   - notes no contiene `externalId`
//   - paymentsPending != stored.total (el doc nace sin cobro)
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
  const storedTotal = Number(stored.total ?? 0);
  if (
    !(storedTotal > 0) ||
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
export async function registerPaymentWithGetBack(
  client: HoldedClient,
  documentId: string,
  payload: PayPayload,
): Promise<SalesreceiptStored> {
  const payPath = `${SALESRECEIPT_PATH}/${documentId}/pay`;
  await client.request<{ status?: number; paymentId?: string }>(payPath, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const stored = await client.request<SalesreceiptStored>(
    `${SALESRECEIPT_PATH}/${documentId}`,
  );
  const pending = Number(stored.paymentsPending ?? -1);
  if (Math.abs(pending) > 0.01) {
    throw new HoldedSilentRejectError(
      "POST salesreceipt/pay",
      payPath,
      [{ field: "paymentsPending", expected: 0, actual: pending }],
      stored,
    );
  }
  return stored;
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
