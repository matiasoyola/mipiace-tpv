// Las primitivas de un documento A4: medir, partir en renglones, saltar
// de página y escribir.
//
// Nacieron dentro de `declaracion-responsable.ts` (verifactu) y salen aquí
// con clinica-4, cuando pasaron a hacer falta en tres documentos: la
// declaración responsable del SIF, el consentimiento informado y el
// informe clínico. Tres copias de `wrap` son tres sitios donde un
// renglón se sale del margen y sólo uno de los tres lo arregla.
//
// Lo que NO viene aquí es el contenido ni el tamaño de la letra de cada
// documento: eso es de cada uno. Aquí viven el folio, los márgenes y la
// mecánica de «medir primero, pintar después».

import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";

export const MM = 2.83464567; // 1 mm en puntos
export const PAGE_WIDTH = 210 * MM; // A4
export const PAGE_HEIGHT = 297 * MM;
export const MARGIN_X = 20 * MM;
export const MARGIN_TOP = 18 * MM;
export const MARGIN_BOTTOM = 18 * MM;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

/** Interlineado extra sobre el alto de la fuente. */
export const LINE_GAP = 3.2;

export const INK = rgb(0.09, 0.11, 0.16);
export const INK_SOFT = rgb(0.35, 0.39, 0.45);
export const LINEA = rgb(0.75, 0.78, 0.82);

/**
 * Parte un texto en renglones que caben en `maxWidth`.
 *
 * Por palabras, y si una sola palabra no cabe (una URL larga, un nº de
 * colegiado pegado a un guion) se corta a caracteres: preferimos un corte
 * feo a una línea que se sale del margen y queda ilegible en el papel.
 */
export function wrap(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of text.split(/\s+/).filter(Boolean)) {
    const tentativa = actual ? `${actual} ${palabra}` : palabra;
    if (font.widthOfTextAtSize(tentativa, size) <= maxWidth) {
      actual = tentativa;
      continue;
    }
    if (actual) {
      lineas.push(actual);
      actual = "";
    }
    if (font.widthOfTextAtSize(palabra, size) <= maxWidth) {
      actual = palabra;
      continue;
    }
    // Palabra más ancha que la caja: se trocea.
    let resto = palabra;
    while (font.widthOfTextAtSize(resto, size) > maxWidth && resto.length > 1) {
      let corte = resto.length - 1;
      while (
        corte > 1 &&
        font.widthOfTextAtSize(resto.slice(0, corte), size) > maxWidth
      ) {
        corte--;
      }
      lineas.push(resto.slice(0, corte));
      resto = resto.slice(corte);
    }
    actual = resto;
  }
  if (actual) lineas.push(actual);
  return lineas.length > 0 ? lineas : [""];
}

export interface Cursor {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  fontBold: PDFFont;
}

export function nuevaPagina(cursor: Cursor): void {
  cursor.page = cursor.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  cursor.y = PAGE_HEIGHT - MARGIN_TOP;
}

/** Reserva `alto` puntos; si no caben, salta de página. */
export function reservar(cursor: Cursor, alto: number): void {
  if (cursor.y - alto < MARGIN_BOTTOM) nuevaPagina(cursor);
}

export function escribirParrafo(
  cursor: Cursor,
  texto: string,
  opts: {
    font: PDFFont;
    size: number;
    x: number;
    color?: ReturnType<typeof rgb>;
  },
): void {
  const ancho = PAGE_WIDTH - MARGIN_X - opts.x;
  const altoLinea = opts.size + LINE_GAP;
  for (const linea of wrap(texto, opts.font, opts.size, ancho)) {
    reservar(cursor, altoLinea);
    cursor.page.drawText(linea, {
      x: opts.x,
      y: cursor.y - opts.size,
      size: opts.size,
      font: opts.font,
      color: opts.color ?? INK,
    });
    cursor.y -= altoLinea;
  }
}

/** Un texto centrado en el ancho de contenido, en una o más líneas. */
export function escribirCentrado(
  cursor: Cursor,
  texto: string,
  opts: { font: PDFFont; size: number; color?: ReturnType<typeof rgb> },
): void {
  for (const linea of wrap(texto, opts.font, opts.size, CONTENT_WIDTH)) {
    reservar(cursor, opts.size + LINE_GAP);
    const ancho = opts.font.widthOfTextAtSize(linea, opts.size);
    cursor.page.drawText(linea, {
      x: MARGIN_X + (CONTENT_WIDTH - ancho) / 2,
      y: cursor.y - opts.size,
      size: opts.size,
      font: opts.font,
      color: opts.color ?? INK,
    });
    cursor.y -= opts.size + LINE_GAP;
  }
}

/** Una raya horizontal de margen a margen. */
export function raya(cursor: Cursor, grosor = 0.5): void {
  reservar(cursor, 4);
  cursor.page.drawLine({
    start: { x: MARGIN_X, y: cursor.y },
    end: { x: PAGE_WIDTH - MARGIN_X, y: cursor.y },
    thickness: grosor,
    color: LINEA,
  });
  cursor.y -= 4;
}

/**
 * El pie en TODAS las páginas: de qué documento salió este folio y qué
 * número es. Que un folio suelto se pueda devolver a su sitio.
 */
export function pieEnTodasLasPaginas(
  doc: PDFDocument,
  font: PDFFont,
  texto: string,
): void {
  const paginas = doc.getPages();
  paginas.forEach((page, i) => {
    const linea = `${texto} · ${i + 1} de ${paginas.length}`;
    const size = 7.5;
    const ancho = font.widthOfTextAtSize(linea, size);
    page.drawText(linea, {
      x: MARGIN_X + (CONTENT_WIDTH - ancho) / 2,
      y: MARGIN_BOTTOM - 6 * MM > 0 ? MARGIN_BOTTOM - 6 * MM : 6,
      size,
      font,
      color: INK_SOFT,
    });
  });
}
