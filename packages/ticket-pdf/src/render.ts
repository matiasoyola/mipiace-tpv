// TicketPdfRenderer: convierte un `TicketDocument` en `Uint8Array`
// (PDF 80mm). Mismo código en Node (worker email) y browser (PWA
// descarga). Sin assets externos: usamos la fuente Courier embebida
// del PDF estándar.
//
// Diseño:
// - Ancho fijo 80mm (~226.77 pt). Alto dinámico: medimos antes y
//   creamos la página con el tamaño exacto. Evita el "ticket cortado"
//   típico de las primeras versiones.
// - Margen 5mm laterales (≈14.17 pt). Cabecera centrada, líneas
//   alineadas a izquierda/derecha, separadores con guiones.
// - Si `qrPngBytes` se pasa, se incrusta como PNG cuadrado de 25mm
//   en el pie con el caption debajo.

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

import { assertTicketDocument, type TicketDocument } from "@mipiacetpv/ticket-model";

const MM = 2.83464567; // 1 mm en puntos
const PAGE_WIDTH = 80 * MM;
const MARGIN_X = 5 * MM;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const LINE_HEIGHT = 11;
const FONT_SIZE_NORMAL = 8.5;
const FONT_SIZE_SMALL = 7.5;
const FONT_SIZE_TITLE = 11;
const FONT_SIZE_TOTAL = 13;
const SEPARATOR = "----------------------------------------";

export interface RenderTicketPdfOptions {
  qrPngBytes?: Uint8Array;
  qrCaption?: string;
}

interface DrawState {
  page: PDFPage;
  y: number;
  font: PDFFont;
  fontBold: PDFFont;
}

function formatEur(n: number): string {
  return n.toFixed(2).replace(".", ",") + " €";
}

function formatDate(d: Date): string {
  const pad = (x: number) => String(x).padStart(2, "0");
  return (
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// Trunca a `maxChars` y añade '…' si excede. Mantiene la línea dentro
// del ancho monoespaciado sin romper el layout.
function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(0, maxChars - 1)) + "…";
}

// Mide el alto total antes de crear la página. Usar el mismo loop que
// el render asegura que ambos cuentan las mismas líneas.
function computeLineCount(doc: TicketDocument): number {
  let lines = 0;
  // v1.3-Thalia Lote 3 · "COPIA — no fiscal" + línea reimpresión arriba
  // del todo, antes incluso de la cabecera fiscal, porque es lo
  // primero que el cliente debe ver al recibir la copia.
  if (doc.ticket.isReprint) {
    lines += 1; // banner COPIA — no fiscal
    lines += 1; // línea "REIMPRESIÓN · ..."
    lines += 1; // separador
  }
  // Cabecera fiscal: legalName, taxId, address (puede partirse), phone
  lines += 1; // legalName
  lines += 1; // taxId
  if (doc.fiscal.address) lines += Math.max(1, Math.ceil(doc.fiscal.address.length / 38));
  if (doc.fiscal.phone) lines += 1;
  lines += 2; // separador + título DEVOLUCION o TICKET
  lines += 1; // store name
  if (doc.store.address) lines += 1;
  lines += 1; // numero + fecha
  lines += 1; // caja + cajero
  if (doc.customer) {
    lines += 1; // separador / cliente
    if (doc.customer.name) lines += 1;
    if (doc.customer.taxId) lines += 1;
  }
  if (doc.refund) {
    lines += 1;
  }
  lines += 2; // separador líneas
  for (const _line of doc.lines) {
    void _line;
    lines += 1; // descripcion
    lines += 1; // cant x precio = subtotal
  }
  lines += 1; // separador
  lines += doc.totals.taxBreakdown.length; // IVA breakdown
  lines += 1; // SUBTOTAL
  lines += 1; // TOTAL (resaltado)
  lines += 1; // metodo pago
  if (doc.payment.change && doc.payment.change > 0) lines += 1;
  lines += 1; // separador
  lines += 2; // footer thanks
  if (doc.footer.returnPolicy) lines += 2;
  if (doc.ticket.publicSlug) lines += 1;
  return lines;
}

function drawCenteredText(
  s: DrawState,
  text: string,
  fontSize: number,
  bold = false,
): void {
  const font = bold ? s.fontBold : s.font;
  const width = font.widthOfTextAtSize(text, fontSize);
  const x = MARGIN_X + (CONTENT_WIDTH - width) / 2;
  s.page.drawText(text, { x, y: s.y, size: fontSize, font, color: rgb(0, 0, 0) });
  s.y -= LINE_HEIGHT;
}

function drawText(
  s: DrawState,
  text: string,
  fontSize = FONT_SIZE_NORMAL,
  bold = false,
): void {
  const font = bold ? s.fontBold : s.font;
  s.page.drawText(text, {
    x: MARGIN_X,
    y: s.y,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
  });
  s.y -= LINE_HEIGHT;
}

function drawTwoColumn(
  s: DrawState,
  left: string,
  right: string,
  fontSize = FONT_SIZE_NORMAL,
  bold = false,
): void {
  const font = bold ? s.fontBold : s.font;
  s.page.drawText(left, {
    x: MARGIN_X,
    y: s.y,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
  });
  const rightWidth = font.widthOfTextAtSize(right, fontSize);
  s.page.drawText(right, {
    x: MARGIN_X + CONTENT_WIDTH - rightWidth,
    y: s.y,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
  });
  s.y -= LINE_HEIGHT;
}

function drawSeparator(s: DrawState): void {
  drawText(s, SEPARATOR, FONT_SIZE_SMALL);
}

// Renderiza un ticket completo. Devuelve el PDF serializado como
// `Uint8Array`. Si `opts.qrPngBytes` viene poblado, se incrusta en el
// pie como bloque cuadrado de 25mm de lado.
export async function renderTicketPdf(
  doc: TicketDocument,
  opts: RenderTicketPdfOptions = {},
): Promise<Uint8Array> {
  // Validamos primero — si falta un campo, mejor reventar aquí que
  // pintar un PDF con "undefined".
  assertTicketDocument(doc);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);
  const fontBold = await pdf.embedFont(StandardFonts.CourierBold);

  const lineCount = computeLineCount(doc);
  const baseHeight = lineCount * LINE_HEIGHT + 10 * MM; // margen vertical
  const qrHeight = opts.qrPngBytes ? 30 * MM + LINE_HEIGHT * 2 : 0;
  const pageHeight = baseHeight + qrHeight;

  const page = pdf.addPage([PAGE_WIDTH, pageHeight]);
  const s: DrawState = {
    page,
    y: pageHeight - 5 * MM - LINE_HEIGHT,
    font,
    fontBold,
  };

  // ── Marca COPIA — no fiscal (sólo si es reimpresión) ────────────
  if (doc.ticket.isReprint) {
    drawCenteredText(s, "*** COPIA — no fiscal ***", FONT_SIZE_TITLE, true);
    drawCenteredText(
      s,
      `REIMPRESIÓN · ${formatDate(doc.ticket.issuedAt)} · ${truncate(doc.ticket.cashierName, 16)}`,
      FONT_SIZE_SMALL,
    );
    drawSeparator(s);
  }

  // ── Cabecera fiscal centrada ─────────────────────────────────────
  drawCenteredText(s, truncate(doc.fiscal.legalName, 38), FONT_SIZE_TITLE, true);
  drawCenteredText(s, `NIF: ${doc.fiscal.taxId}`, FONT_SIZE_NORMAL);
  if (doc.fiscal.address) {
    const addressLines = wrapText(doc.fiscal.address, 38);
    for (const l of addressLines) drawCenteredText(s, l, FONT_SIZE_SMALL);
  }
  if (doc.fiscal.phone) {
    drawCenteredText(s, `Tel. ${doc.fiscal.phone}`, FONT_SIZE_SMALL);
  }

  drawSeparator(s);
  drawCenteredText(
    s,
    doc.refund ? "DEVOLUCIÓN" : "TICKET",
    FONT_SIZE_TITLE,
    true,
  );

  // ── Store + ticket meta ──────────────────────────────────────────
  drawText(s, truncate(doc.store.name, 38), FONT_SIZE_NORMAL, true);
  if (doc.store.address) drawText(s, truncate(doc.store.address, 38), FONT_SIZE_SMALL);
  drawTwoColumn(
    s,
    `Nº ${doc.ticket.internalNumber}`,
    formatDate(doc.ticket.issuedAt),
    FONT_SIZE_NORMAL,
  );
  drawTwoColumn(
    s,
    truncate(doc.ticket.registerName, 18),
    truncate(doc.ticket.cashierName, 18),
    FONT_SIZE_SMALL,
  );

  if (doc.customer) {
    drawSeparator(s);
    if (doc.customer.name) drawText(s, `Cliente: ${truncate(doc.customer.name, 30)}`);
    if (doc.customer.taxId) drawText(s, `NIF: ${doc.customer.taxId}`);
  }

  if (doc.refund) {
    drawText(
      s,
      `Ref. ticket original: ${doc.refund.originalTicketNumber}`,
      FONT_SIZE_SMALL,
    );
  }

  // ── Líneas ───────────────────────────────────────────────────────
  drawSeparator(s);
  for (const line of doc.lines) {
    drawText(s, truncate(line.description, 38), FONT_SIZE_NORMAL);
    const left = `${formatQuantity(line.quantity)} x ${formatEur(line.unitPrice)}` +
      (line.discount ? ` -${line.discount}%` : "");
    drawTwoColumn(s, left, formatEur(line.subtotal), FONT_SIZE_SMALL);
  }
  drawSeparator(s);

  // ── Desglose IVA ─────────────────────────────────────────────────
  for (const bucket of doc.totals.taxBreakdown) {
    drawTwoColumn(
      s,
      `IVA ${bucket.rate}% s/${formatEur(bucket.base)}`,
      formatEur(bucket.tax),
      FONT_SIZE_SMALL,
    );
  }

  drawTwoColumn(s, "Subtotal", formatEur(doc.totals.subtotal), FONT_SIZE_NORMAL);
  drawTwoColumn(
    s,
    "TOTAL",
    formatEur(doc.totals.total),
    FONT_SIZE_TOTAL,
    true,
  );

  drawText(
    s,
    `Pago: ${labelPayment(doc.payment.method)} · ${formatEur(doc.payment.paid)}`,
    FONT_SIZE_SMALL,
  );
  if (doc.payment.change && doc.payment.change > 0) {
    drawTwoColumn(s, "Cambio", formatEur(doc.payment.change), FONT_SIZE_SMALL);
  }

  drawSeparator(s);

  // ── Footer ───────────────────────────────────────────────────────
  drawCenteredText(s, doc.footer.thankYouMessage, FONT_SIZE_NORMAL, true);
  if (doc.footer.returnPolicy) {
    for (const l of wrapText(doc.footer.returnPolicy, 38)) {
      drawCenteredText(s, l, FONT_SIZE_SMALL);
    }
  }
  if (doc.ticket.publicSlug) {
    drawCenteredText(s, `Ticket: ${doc.ticket.publicSlug}`, FONT_SIZE_SMALL);
  }

  // ── QR opcional ──────────────────────────────────────────────────
  if (opts.qrPngBytes) {
    const qr = await pdf.embedPng(opts.qrPngBytes);
    const qrSize = 25 * MM;
    const qrX = MARGIN_X + (CONTENT_WIDTH - qrSize) / 2;
    s.y -= 4;
    page.drawImage(qr, {
      x: qrX,
      y: s.y - qrSize,
      width: qrSize,
      height: qrSize,
    });
    s.y -= qrSize + 4;
    if (opts.qrCaption) {
      drawCenteredText(s, truncate(opts.qrCaption, 38), FONT_SIZE_SMALL);
    }
  }

  // useObjectStreams:false hace que pdf.js (Mozilla / pdf-parse) lea
  // el documento sin reventar. La diferencia de tamaño es marginal
  // (<5%) y a cambio nos damos compatibilidad con visores estrictos.
  return await pdf.save({ useObjectStreams: false });
}

function formatQuantity(q: number): string {
  return Number.isInteger(q) ? q.toString() : q.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function labelPayment(method: string): string {
  if (method === "CASH") return "Efectivo";
  if (method === "CARD") return "Tarjeta";
  if (method === "TRANSFER") return "Bizum/Transf.";
  return "Otro";
}

// Reparte un texto largo en líneas que respeten un ancho máximo
// (medido en caracteres, válido para fuente monoespaciada).
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const w of words) {
    if (current.length === 0) {
      current = w;
    } else if (current.length + 1 + w.length <= maxChars) {
      current += " " + w;
    } else {
      out.push(current);
      current = w;
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}
