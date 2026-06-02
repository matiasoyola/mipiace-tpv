// v1.4-Bar-Operativa-MVP Lote 2 · renderer de comanda (kitchen ticket).
//
// @deprecated v1.4-Impresoras-Fase-1 Lote 4: la generación PDF ha sido
// reemplazada por ESC/POS plano en `packages/escpos-builder`
// (`buildKitchenComanda`). Razón: rasterizar PDF satura el buffer de
// las impresoras térmicas baratas (spike 2026-06-02 con POS-80 V6.16F).
// Este renderer se mantiene como red de seguridad para el endpoint
// `POST /tickets/:id/send-to-kitchen?fallback=pdf` mientras se
// despliegan impresoras WIFI en los pilotos. Eliminar en una fase
// posterior cuando todos los pilotos tengan PrinterConfig.

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

const MM = 2.83464567;
const PAGE_WIDTH = 80 * MM;
const MARGIN_X = 5 * MM;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const LINE_HEIGHT = 12;
const FONT_SIZE_HEADER = 16;
const FONT_SIZE_TITLE = 13;
const FONT_SIZE_NORMAL = 11;
const FONT_SIZE_MOD = 9;
const SEPARATOR = "----------------------------------------";

export type KitchenSection = "BARRA" | "COCINA" | "SALON";

export interface KitchenLine {
  units: number;
  // Lo que se imprime grande en la línea ("Café cortado").
  description: string;
  // Strings adicionales debajo de la línea, en pequeño y con sangría.
  // Se rellenan con los modificadores (estructurados o legacy) +
  // la nota de la línea si la hay ("sin lactosa").
  notes: string[];
}

export interface KitchenTicketDocument {
  section: KitchenSection;
  // Nombre amigable de la mesa ("Mesa 7", "Barra B2"). El ticket
  // rápido sin mesa queda como `null` — la cocina aún imprime la
  // comanda con "Venta rápida" en cabecera.
  tableName: string | null;
  // Comanda nº dentro del ticket (1ª, 2ª, …). Útil cuando una mesa
  // pide más después: la cocina ve "Comanda 2" y entiende que el
  // ticket está fraccionado.
  revision: number;
  // Hora local del envío. La impresora térmica no tiene reloj
  // sincronizado: tomamos la del servidor para que la cocina pueda
  // ordenar los papeles si llegan varios a la vez.
  issuedAt: Date;
  // Email del cajero, en pequeño bajo la mesa.
  cashierLabel: string;
  // Para el equipo de sala: comensales y observaciones libres del
  // ticket completo. Optional (RETAIL no abre mesa con diners).
  diners: number | null;
  // Notas del ticket completo (no de una línea). Se imprime al pie.
  ticketNotes: string | null;
  lines: KitchenLine[];
}

const SECTION_LABEL: Record<KitchenSection, string> = {
  BARRA: "BARRA",
  COCINA: "COCINA",
  SALON: "SALÓN",
};

export async function renderKitchenTicketPdf(
  doc: KitchenTicketDocument,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);
  const fontBold = await pdf.embedFont(StandardFonts.CourierBold);

  // Pre-cálculo del alto: cabecera (4) + separador + líneas (cada
  // una toma 1 + N notas) + pie (3). Sobredimensionamos un poco
  // para no cortar; usar `useObjectStreams:false` no exige tamaño
  // exacto pero quedar corto sí.
  let lineCount = 0;
  lineCount += 1; // sección
  lineCount += 1; // mesa
  lineCount += 1; // comanda nº + hora
  lineCount += 1; // cajero / diners
  lineCount += 2; // separador + título
  for (const l of doc.lines) {
    lineCount += 1;
    lineCount += l.notes.length;
  }
  lineCount += 1; // separador final
  if (doc.ticketNotes) lineCount += 3;

  const pageHeight = lineCount * LINE_HEIGHT + 12 * MM;
  const page = pdf.addPage([PAGE_WIDTH, pageHeight]);
  const s: DrawState = {
    page,
    y: pageHeight - 5 * MM - LINE_HEIGHT,
    font,
    fontBold,
  };

  // ── Cabecera: sección enorme y centrada ──────────────────────────
  drawCentered(s, `*** ${SECTION_LABEL[doc.section]} ***`, FONT_SIZE_HEADER, true);

  // ── Mesa ──────────────────────────────────────────────────────────
  drawCentered(
    s,
    doc.tableName ? truncate(doc.tableName, 26) : "VENTA RÁPIDA",
    FONT_SIZE_TITLE,
    true,
  );

  // ── Comanda nº + hora ────────────────────────────────────────────
  drawTwoCol(
    s,
    `Comanda nº ${doc.revision}`,
    formatTime(doc.issuedAt),
    FONT_SIZE_NORMAL,
  );

  // ── Cajero + comensales ──────────────────────────────────────────
  const meta: string[] = [];
  if (doc.diners != null && doc.diners > 0) {
    meta.push(`${doc.diners} pax`);
  }
  meta.push(truncate(doc.cashierLabel, 22));
  drawText(s, meta.join(" · "), FONT_SIZE_MOD);

  drawSep(s);
  drawText(s, "PEDIDO", FONT_SIZE_TITLE, true);

  // ── Líneas ───────────────────────────────────────────────────────
  for (const l of doc.lines) {
    const qty = formatQty(l.units);
    drawText(s, `${qty} x ${truncate(l.description, 30)}`, FONT_SIZE_NORMAL, true);
    for (const note of l.notes) {
      drawText(s, `   · ${truncate(note, 34)}`, FONT_SIZE_MOD);
    }
  }

  drawSep(s);

  // ── Notas globales del ticket ────────────────────────────────────
  if (doc.ticketNotes) {
    drawText(s, "Notas:", FONT_SIZE_MOD, true);
    for (const wrapped of wrap(doc.ticketNotes, 38)) {
      drawText(s, wrapped, FONT_SIZE_MOD);
    }
  }

  return await pdf.save({ useObjectStreams: false });
}

interface DrawState {
  page: PDFPage;
  y: number;
  font: PDFFont;
  fontBold: PDFFont;
}

function drawText(s: DrawState, text: string, size = FONT_SIZE_NORMAL, bold = false) {
  const f = bold ? s.fontBold : s.font;
  s.page.drawText(text, { x: MARGIN_X, y: s.y, size, font: f, color: rgb(0, 0, 0) });
  s.y -= LINE_HEIGHT;
}

function drawCentered(s: DrawState, text: string, size: number, bold = false) {
  const f = bold ? s.fontBold : s.font;
  const w = f.widthOfTextAtSize(text, size);
  const x = MARGIN_X + (CONTENT_WIDTH - w) / 2;
  s.page.drawText(text, { x, y: s.y, size, font: f, color: rgb(0, 0, 0) });
  s.y -= LINE_HEIGHT;
}

function drawTwoCol(s: DrawState, left: string, right: string, size: number) {
  s.page.drawText(left, { x: MARGIN_X, y: s.y, size, font: s.font, color: rgb(0, 0, 0) });
  const w = s.font.widthOfTextAtSize(right, size);
  s.page.drawText(right, {
    x: MARGIN_X + CONTENT_WIDTH - w,
    y: s.y,
    size,
    font: s.font,
    color: rgb(0, 0, 0),
  });
  s.y -= LINE_HEIGHT;
}

function drawSep(s: DrawState) {
  drawText(s, SEPARATOR, FONT_SIZE_MOD);
}

function truncate(t: string, max: number): string {
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + "…";
}

function formatQty(q: number): string {
  if (Number.isInteger(q)) return q.toString();
  return q.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatTime(d: Date): string {
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur.length === 0) cur = w;
    else if (cur.length + 1 + w.length <= max) cur += " " + w;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}
