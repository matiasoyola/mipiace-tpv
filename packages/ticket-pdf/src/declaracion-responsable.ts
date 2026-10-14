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
// clinica-4 · las primitivas del folio (el A4, los márgenes, `wrap`, el
// cursor con su salto de página y el pie) salieron a `documento-a4.ts`:
// las usan también el consentimiento informado y el informe clínico. Tres
// copias de `wrap` son tres sitios donde un renglón se sale del margen y
// sólo uno de los tres lo arregla.
//
// El CONTENIDO no se escribe aquí. Llega ya construido en un
// `DeclaracionResponsable` que sale de las constantes del productor
// (packages/verifactu/src/declaracion.ts). Este módulo sólo sabe de puntos,
// márgenes y saltos de línea.

import { PDFDocument, StandardFonts } from "pdf-lib";

import type {
  ApartadoDeclaracion,
  DeclaracionResponsable,
} from "@mipiacetpv/verifactu";

import {
  CONTENT_WIDTH,
  INK,
  LINE_GAP,
  MARGIN_TOP,
  MARGIN_X,
  MM,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  escribirParrafo,
  pieEnTodasLasPaginas,
  reservar,
  wrap,
  type Cursor,
} from "./documento-a4.js";

const FONT_SIZE_TITLE = 13;
const FONT_SIZE_HEADING = 9.5;
const FONT_SIZE_BODY = 9.5;
const PARAGRAPH_GAP = 3.5; // entre renglones de un mismo valor
const APARTADO_GAP = 7; // entre apartados
const INDENT = 6 * MM; // sangría del valor respecto al rótulo

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

  // Pie en todas las páginas: el nombre del documento y la paginación. Que
  // un folio suelto diga de qué documento salió.
  pieEnTodasLasPaginas(doc, font, declaracion.titulo);

  // Mismo motivo que en `render.ts`: con `useObjectStreams:false` el
  // documento queda con tabla xref clásica y pdf.js (Mozilla / pdf-parse)
  // lo lee sin reventar. El xref stream que genera pdf-lib por defecto no
  // sólo falla al parsearse: deja al pdf.js del proceso en mal estado y
  // tumba el SIGUIENTE parseo (en CI, el del ticket).
  return doc.save({ useObjectStreams: false });
}
