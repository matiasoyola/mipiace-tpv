// El PDF de la declaración responsable del SIF (art. 15 de la Orden
// HAC/1177/2024).
//
// Vive en este paquete y no en uno nuevo por una razón concreta: aquí ya
// está `pdf-lib` y el patrón de «medir primero, pintar después» del ticket.
// Añadir otra librería de PDF por un documento de dos páginas sería meter
// un segundo motor de render en el bundle para nada.
//
// Diferencias con `render.ts`, que son las del documento:
//   - A4 vertical, no 80 mm: esto se imprime en papel y se entrega al
//     cliente o al distribuidor, no sale de una impresora térmica.
//   - Helvetica, no Courier: es un documento, no un ticket. Ambas son
//     fuentes estándar del PDF, así que seguimos sin embarcar assets.
//   - Alto fijo con salto de página: el texto de los apartados es largo y
//     variable, y una página A4 no se estira.
//
// El CONTENIDO no se escribe aquí. Llega ya construido en un
// `DeclaracionResponsable` que sale de las constantes del productor
// (packages/verifactu/src/declaracion.ts). Este módulo sólo sabe de puntos,
// márgenes y saltos de línea.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

import type {
  ApartadoDeclaracion,
  DeclaracionResponsable,
} from "@mipiacetpv/verifactu";

const MM = 2.83464567; // 1 mm en puntos
const PAGE_WIDTH = 210 * MM; // A4
const PAGE_HEIGHT = 297 * MM;
const MARGIN_X = 20 * MM;
const MARGIN_TOP = 18 * MM;
const MARGIN_BOTTOM = 18 * MM;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const FONT_SIZE_TITLE = 13;
const FONT_SIZE_HEADING = 9.5;
const FONT_SIZE_BODY = 9.5;
const LINE_GAP = 3.2; // interlineado extra sobre el alto de la fuente
const PARAGRAPH_GAP = 3.5; // entre renglones de un mismo valor
const APARTADO_GAP = 7; // entre apartados
const INDENT = 6 * MM; // sangría del valor respecto al rótulo

const INK = rgb(0.09, 0.11, 0.16);
const INK_SOFT = rgb(0.35, 0.39, 0.45);

/**
 * Parte un texto en renglones que caben en `maxWidth`.
 *
 * Por palabras, y si una sola palabra no cabe (una URL larga) se corta a
 * caracteres: preferimos un corte feo a una línea que se sale del margen y
 * queda ilegible en el papel — que es justo lo que el art. 15 pide evitar.
 */
function wrap(
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

interface Cursor {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  fontBold: PDFFont;
}

function nuevaPagina(cursor: Cursor): void {
  cursor.page = cursor.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  cursor.y = PAGE_HEIGHT - MARGIN_TOP;
}

/** Reserva `alto` puntos; si no caben, salta de página. */
function reservar(cursor: Cursor, alto: number): void {
  if (cursor.y - alto < MARGIN_BOTTOM) nuevaPagina(cursor);
}

function escribirParrafo(
  cursor: Cursor,
  texto: string,
  opts: { font: PDFFont; size: number; x: number; color?: typeof INK },
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

function escribirApartado(cursor: Cursor, apartado: ApartadoDeclaracion): void {
  // El rótulo y su clave no se separan del primer renglón del valor: un
  // apartado que empieza con «1.f)» al pie de una página y sigue con su
  // respuesta en la siguiente es exactamente la lectura difícil que el
  // art. 15 prohíbe. Reservamos rótulo + una línea de valor.
  const anchoRotulo = CONTENT_WIDTH;
  const lineasRotulo = wrap(
    `${apartado.clave} ${apartado.rotulo}:`,
    cursor.fontBold,
    FONT_SIZE_HEADING,
    anchoRotulo,
  );
  const altoBloqueMinimo =
    lineasRotulo.length * (FONT_SIZE_HEADING + LINE_GAP) +
    (FONT_SIZE_BODY + LINE_GAP);
  reservar(cursor, altoBloqueMinimo);

  for (const linea of lineasRotulo) {
    cursor.page.drawText(linea, {
      x: MARGIN_X,
      y: cursor.y - FONT_SIZE_HEADING,
      size: FONT_SIZE_HEADING,
      font: cursor.fontBold,
      color: INK,
    });
    cursor.y -= FONT_SIZE_HEADING + LINE_GAP;
  }
  cursor.y -= 1.5;

  apartado.valor.forEach((parrafo, i) => {
    if (i > 0) cursor.y -= PARAGRAPH_GAP;
    escribirParrafo(cursor, parrafo, {
      font: cursor.font,
      size: FONT_SIZE_BODY,
      x: MARGIN_X + INDENT,
    });
  });
  cursor.y -= APARTADO_GAP;
}

/**
 * La declaración responsable como PDF A4.
 *
 * Sin assets externos ni fuentes embebidas: corre igual en el worker de la
 * API y en el navegador.
 */
export async function renderDeclaracionResponsablePdf(
  declaracion: DeclaracionResponsable,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(declaracion.titulo);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const cursor: Cursor = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: PAGE_HEIGHT - MARGIN_TOP,
    font,
    fontBold,
  };

  // Título, centrado y en dos líneas si hace falta.
  for (const linea of wrap(
    declaracion.titulo,
    fontBold,
    FONT_SIZE_TITLE,
    CONTENT_WIDTH,
  )) {
    const ancho = fontBold.widthOfTextAtSize(linea, FONT_SIZE_TITLE);
    cursor.page.drawText(linea, {
      x: MARGIN_X + (CONTENT_WIDTH - ancho) / 2,
      y: cursor.y - FONT_SIZE_TITLE,
      size: FONT_SIZE_TITLE,
      font: fontBold,
      color: INK,
    });
    cursor.y -= FONT_SIZE_TITLE + LINE_GAP;
  }
  cursor.y -= 8 * MM;

  for (const apartado of declaracion.apartados) {
    escribirApartado(cursor, apartado);
  }

  if (declaracion.anexo.length > 0) {
    reservar(cursor, 20 * MM);
    cursor.y -= 3 * MM;
    const anchoAnexo = fontBold.widthOfTextAtSize("ANEXO", FONT_SIZE_TITLE);
    cursor.page.drawText("ANEXO", {
      x: MARGIN_X + (CONTENT_WIDTH - anchoAnexo) / 2,
      y: cursor.y - FONT_SIZE_TITLE,
      size: FONT_SIZE_TITLE,
      font: fontBold,
      color: INK,
    });
    cursor.y -= FONT_SIZE_TITLE + LINE_GAP + 5 * MM;
    for (const apartado of declaracion.anexo) {
      escribirApartado(cursor, apartado);
    }
  }

  // Pie en todas las páginas: el nombre del sistema y la paginación. Que un
  // folio suelto diga de qué documento salió.
  const paginas = doc.getPages();
  paginas.forEach((page, i) => {
    const texto = `${declaracion.titulo} · ${i + 1} de ${paginas.length}`;
    const size = 7.5;
    const ancho = font.widthOfTextAtSize(texto, size);
    page.drawText(texto, {
      x: MARGIN_X + (CONTENT_WIDTH - ancho) / 2,
      y: MARGIN_BOTTOM - 6 * MM > 0 ? MARGIN_BOTTOM - 6 * MM : 6,
      size,
      font,
      color: INK_SOFT,
    });
  });

  return doc.save();
}
