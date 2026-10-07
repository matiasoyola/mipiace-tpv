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

import {
  assertTicketDocument,
  cuadrarDesglose,
  cuadrarLineasImpresas,
  leyendaExencion,
  type TicketDocument,
} from "@mipiacetpv/ticket-model";
import {
  LEYENDA_ENCIMA_DEL_QR,
  LEYENDA_VERIFACTU,
} from "@mipiacetpv/verifactu";

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
  // V1-verifactu (ADR-019) · el QR TRIBUTARIO, ya rasterizado. Se pasa
  // como PNG porque este paquete no genera códigos QR: lo hace quien
  // llama (la API con `qrcode`, el TPV con el mismo paquete).
  //
  // Va ARRIBA DEL TODO y a 33 mm, no en el pie a 25: el art. 21.1 de la
  // Orden exige entre 30×30 y 40×40 mm, y el documento técnico (§3) que
  // se sitúe «al principio de la factura, antes de que empiece el
  // contenido de ésta». El QR del ticket digital se queda en el pie.
  qrTributarioPngBytes?: Uint8Array;
}

// Tamaño del QR tributario (art. 21.1: entre 30 y 40 mm) y el blanco que
// hay que dejarle alrededor (§3: mínimo 2 mm, recomendado 6).
const QR_TRIBUTARIO_MM = 33;
const QR_TRIBUTARIO_MARGEN_MM = 6;

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
  if (doc.verifactu) lines += 1; // ref. interna bajo el número fiscal
  lines += 1; // caja + cajero
  // v1.3-Servicios-Pinta · Lote 3: línea extra "Atendido por: X" en SERVICES.
  if (doc.ticket.businessType === "SERVICES" && doc.ticket.attendedBy) {
    lines += 1;
  }
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
  // bloque iva-exento-sanitario · el desglose cambia de alto cuando hay
  // tramo exento: un renglón por tramo exento, DOS por cada tramo sujeto
  // («Base X %» y «IVA X %») y ninguno de «Subtotal». Si se cuenta mal,
  // el ticket sale cortado por abajo — es el bug que `computeLineCount`
  // existe para no tener.
  const hayExento = doc.totals.taxBreakdown.some((b) => b.exemptionCause);
  if (hayExento) {
    const exentos = doc.totals.taxBreakdown.filter((b) => b.exemptionCause);
    const sujetos = doc.totals.taxBreakdown.filter((b) => !b.exemptionCause);
    lines += exentos.length;
    lines += sujetos.length === 0 ? 1 : sujetos.length * 2;
  } else {
    lines += doc.totals.taxBreakdown.length; // IVA breakdown
    lines += 1; // SUBTOTAL
  }
  lines += 1; // TOTAL (resaltado)
  lines += 1; // metodo pago
  // v1.15-la-vuelta-existe §3 · Entregado + Cambio.
  if (doc.payment.change && doc.payment.change > 0) {
    lines += doc.payment.received != null ? 2 : 1;
  }
  lines += 1; // separador
  // La leyenda de la exención: el hueco de antes, los renglones del
  // recuadro (el título puede partirse) y el hueco de después más su
  // separador. Se cuenta con el MISMO `wrapText` que el render: contarlo
  // mal deja el pie del ticket fuera del papel.
  if (hayExento) {
    const leyenda = leyendaExencion(doc.lines);
    if (leyenda) lines += wrapText(leyenda.titulo, 36).length + 4;
  }
  if (doc.creditNotice) lines += 5; // v1.8-Fiado · bloque PENDIENTE DE PAGO
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
  // El QR tributario, su leyenda de encima, la de debajo y su blanco.
  const qrTributarioHeight = opts.qrTributarioPngBytes
    ? (QR_TRIBUTARIO_MM + QR_TRIBUTARIO_MARGEN_MM * 3) * MM + LINE_HEIGHT * 3
    : 0;
  const pageHeight = baseHeight + qrHeight + qrTributarioHeight;

  const page = pdf.addPage([PAGE_WIDTH, pageHeight]);
  const s: DrawState = {
    page,
    y: pageHeight - 5 * MM - LINE_HEIGHT,
    font,
    fontBold,
  };

  // ── QR tributario (V1-verifactu) ─────────────────────────────────
  //
  // Lo primero de la página, antes incluso de la marca de copia: el
  // documento de la AEAT no admite que nada del contenido de la factura
  // vaya por delante, y en un papel de 80 mm «arriba» es literal.
  if (opts.qrTributarioPngBytes && doc.verifactu) {
    s.y -= QR_TRIBUTARIO_MARGEN_MM * MM;
    drawCenteredText(s, LEYENDA_ENCIMA_DEL_QR, FONT_SIZE_SMALL);
    // El blanco de encima: `drawCenteredText` ya ha bajado una línea, pero
    // los descendentes del texto se meterían en los 2 mm que el documento
    // técnico (§3) exige dejar libres alrededor del código.
    s.y -= QR_TRIBUTARIO_MARGEN_MM * MM;
    const qr = await pdf.embedPng(opts.qrTributarioPngBytes);
    const size = QR_TRIBUTARIO_MM * MM;
    page.drawImage(qr, {
      x: MARGIN_X + (CONTENT_WIDTH - size) / 2,
      y: s.y - size,
      width: size,
      height: size,
    });
    // Y el de debajo. Con los 4 pt que había aquí, la línea base de
    // `VERI*FACTU` caía tan pegada que las mayúsculas SE METÍAN DENTRO del
    // QR — se vio en la captura del bucle visual, no en un test.
    s.y -= size + QR_TRIBUTARIO_MARGEN_MM * MM;
    drawCenteredText(s, LEYENDA_VERIFACTU, FONT_SIZE_NORMAL, true);
    drawSeparator(s);
  }

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
  // v1.3-Servicios-Pinta · Lote 2: vertical determina el título de
  // cabecera. SERVICES rotula "COMPROBANTE" para que un ticket de
  // peluquería/clínica/taller no diga literalmente "TICKET DE VENTA".
  // RETAIL/HOSPITALITY y fixtures legacy sin businessType siguen con
  // el copy de hoy.
  const isServices = doc.ticket.businessType === "SERVICES";
  const headerTitle = doc.refund
    ? isServices
      ? "ANULACIÓN"
      : "DEVOLUCIÓN"
    : isServices
      ? "COMPROBANTE"
      : "TICKET DE VENTA";
  drawCenteredText(s, headerTitle, FONT_SIZE_TITLE, true);

  // ── Store + ticket meta ──────────────────────────────────────────
  drawText(s, truncate(doc.store.name, 38), FONT_SIZE_NORMAL, true);
  if (doc.store.address) drawText(s, truncate(doc.store.address, 38), FONT_SIZE_SMALL);
  // V1-verifactu · con factura propia manda el NÚMERO FISCAL; es el que
  // el cliente teclea para cotejar y el que identifica la factura ante la
  // AEAT. `internalNumber` baja a referencia operativa, que es lo que
  // siempre fue.
  if (doc.verifactu) {
    drawTwoColumn(
      s,
      `Factura ${doc.verifactu.numSerieFactura}`,
      formatDate(doc.ticket.issuedAt),
      FONT_SIZE_NORMAL,
      true,
    );
    drawText(s, `ref. ${doc.ticket.internalNumber}`, FONT_SIZE_SMALL);
  } else {
    drawTwoColumn(
      s,
      `Nº ${doc.ticket.internalNumber}`,
      formatDate(doc.ticket.issuedAt),
      FONT_SIZE_NORMAL,
    );
  }
  drawTwoColumn(
    s,
    truncate(doc.ticket.registerName, 18),
    truncate(doc.ticket.cashierName, 18),
    FONT_SIZE_SMALL,
  );

  // v1.3-Servicios-Pinta · Lote 3: profesional que atendió, sólo en
  // SERVICES. Estilo discreto (fuente pequeña) y línea propia entre
  // cabecera y líneas para que el cliente pueda decir "pregunta por
  // María" sin tener que descifrar el ticket. Si falta el campo o el
  // tenant no es SERVICES, no se imprime.
  if (isServices && doc.ticket.attendedBy) {
    drawText(s, `Atendido por: ${truncate(doc.ticket.attendedBy, 30)}`, FONT_SIZE_SMALL);
  }

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
  //
  // bloque ticket-con-iva · unitario y total de línea CON IVA, y la
  // columna de la derecha suma el TOTAL. Hasta este bloque el PDF era el
  // peor de los tres papeles: pintaba el unitario NETO *y* el importe de
  // línea NETO (`line.subtotal`), así que ninguna de sus dos columnas
  // tenía nada que ver con el total que el cliente había pagado.
  drawSeparator(s);
  const lineTotalsImpresos = cuadrarLineasImpresas(
    doc.lines.map((l) => l.totalGross),
    doc.totals.total,
  );
  doc.lines.forEach((line, i) => {
    drawText(s, truncate(line.description, 38), FONT_SIZE_NORMAL);
    const left = `${formatQuantity(line.quantity)} x ${formatEur(line.unitPriceGross)}` +
      (line.discount ? ` -${line.discount}%` : "");
    drawTwoColumn(
      s,
      left,
      formatEur(lineTotalsImpresos[i] ?? line.totalGross),
      FONT_SIZE_SMALL,
    );
  });
  drawSeparator(s);

  // ── Desglose IVA ─────────────────────────────────────────────────
  // v1.9.4 · cuadramos los importes IMPRESOS contra el TOTAL con el método
  // del resto mayor, para que sumar el papel a mano dé exactamente el TOTAL.
  //
  // bloque ticket-con-iva · el cuadre sale de `cuadrarDesglose`, el MISMO
  // del térmico y del registro de facturación. Este bloque llamaba por su
  // cuenta a `allocateRoundingRemainder` con la lista de componentes
  // montada aquí: dos implementaciones de la misma regla fiscal, y al
  // cambiarla una se habría quedado atrás. La base imponible impresa es
  // ahora un único valor (Σ bases === Subtotal).
  const cuadrado = cuadrarDesglose({
    subtotal: doc.totals.subtotal,
    buckets: doc.totals.taxBreakdown,
    total: doc.totals.total,
  });

  // bloque iva-exento-sanitario · las dos formas del desglose, las mismas
  // que el térmico y por las mismas razones (ver
  // `escpos-builder/src/ticket.ts`): sin tramo exento el papel no cambia
  // ni un carácter, y con tramo exento se imprime «Exento», luego «Base
  // X %» / «IVA X %» por tramo sujeto —o un «IVA 0,00 €» si no hay
  // ninguno— y NO se imprime «Subtotal», porque Σ bases mezclaría una
  // base imponible con el importe de una operación exenta.
  const exentos = cuadrado.buckets.filter((b) => b.exemptionCause != null);
  const sujetos = cuadrado.buckets.filter((b) => b.exemptionCause == null);
  if (exentos.length === 0) {
    sujetos.forEach((bucket) => {
      drawTwoColumn(
        s,
        `IVA ${bucket.rate}% s/${formatEur(bucket.base)}`,
        formatEur(bucket.tax),
        FONT_SIZE_SMALL,
      );
    });
    drawTwoColumn(s, "Subtotal", formatEur(cuadrado.subtotal), FONT_SIZE_NORMAL);
  } else {
    exentos.forEach((bucket) => {
      drawTwoColumn(
        s,
        exentos.length > 1 ? `Exento (${bucket.exemptionCause})` : "Exento",
        formatEur(bucket.base),
        FONT_SIZE_NORMAL,
      );
    });
    if (sujetos.length === 0) {
      drawTwoColumn(s, "IVA", formatEur(0), FONT_SIZE_NORMAL);
    } else {
      sujetos.forEach((bucket) => {
        drawTwoColumn(
          s,
          `Base ${bucket.rate} %`,
          formatEur(bucket.base),
          FONT_SIZE_SMALL,
        );
        drawTwoColumn(
          s,
          `IVA ${bucket.rate} %`,
          formatEur(bucket.tax),
          FONT_SIZE_SMALL,
        );
      });
    }
  }
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
  // v1.15-la-vuelta-existe §3 · la vuelta, en el papel. Hasta v1.14.1
  // esta línea salía por accidente (el ticket llevaba dentro el error de
  // B1: `Σ payments − total` daba la vuelta porque `payments[].amount`
  // era el billete). Ahora sale del cálculo correcto —entregado menos
  // aplicado en efectivo— y va acompañada de lo que puso el cliente.
  if (doc.payment.change && doc.payment.change > 0) {
    if (doc.payment.received != null) {
      drawTwoColumn(
        s,
        "Entregado",
        formatEur(doc.payment.received),
        FONT_SIZE_SMALL,
      );
    }
    drawTwoColumn(s, "Cambio", formatEur(doc.payment.change), FONT_SIZE_SMALL);
  }

  drawSeparator(s);

  // ── bloque iva-exento-sanitario · la leyenda de la exención ───────
  //
  // El MISMO texto que el térmico, redactado una sola vez en
  // `leyendaExencion`. Aquí el recuadro sí puede ser un rectángulo de
  // verdad (`drawRectangle`) en vez de dos filas de asteriscos: es un PDF
  // y no una impresora de 42 columnas. Lo que no puede diferir es la
  // frase.
  const leyenda = leyendaExencion(doc.lines);
  if (leyenda) {
    // ── EL RECUADRO SE DIBUJA ALREDEDOR DEL TEXTO, NO «POR AHÍ» ──────
    //
    // La primera versión ponía el borde en `s.y - LINE_HEIGHT + 2` con un
    // alto fijo de dos renglones. En la captura del bucle visual (el
    // ticket mixto de `docs/qa/2026-10-07-iva-exento-sanitario`) se vio lo
    // que eso da: el borde de arriba pisaba el separador anterior y el
    // de abajo CORTABA POR LA MITAD la línea del precepto. Ningún test lo
    // veía — `pdf-parse` lee el texto y el texto estaba.
    //
    // Ahora el rectángulo se calcula de los renglones que va a contener:
    // `y` es su BASE en pdf-lib, así que se parte del último renglón y se
    // sube. `FONT_SIZE_NORMAL` por arriba cubre el ascendente de las
    // mayúsculas y los 4 pt de abajo el descendente de la «p» de
    // «operación».
    const renglones = [...wrapText(leyenda.titulo, 36), leyenda.referencia];
    const PADDING = 5;
    // Un hueco antes: el separador de los pagos queda a su distancia y el
    // recuadro no parece parte de él.
    s.y -= PADDING;
    const primeraBase = s.y;
    const ultimaBase = primeraBase - (renglones.length - 1) * LINE_HEIGHT;
    const arriba = primeraBase + FONT_SIZE_NORMAL + PADDING;
    const abajo = ultimaBase - 4 - PADDING;
    page.drawRectangle({
      x: MARGIN_X,
      y: abajo,
      width: CONTENT_WIDTH,
      height: arriba - abajo,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    for (const l of wrapText(leyenda.titulo, 36)) {
      drawCenteredText(s, l, FONT_SIZE_NORMAL, true);
    }
    drawCenteredText(s, leyenda.referencia, FONT_SIZE_SMALL, true);
    // Y el cursor baja hasta el borde de abajo, para que lo siguiente no
    // se meta dentro del recuadro.
    s.y = abajo - LINE_HEIGHT;
    drawSeparator(s);
  }

  // ── v1.8-Fiado · leyenda PENDIENTE DE PAGO ────────────────────────
  // Venta a crédito con deuda viva. Bloque destacado: no es el documento
  // fiscal (no lleva numeración Holded — aún no existe).
  if (doc.creditNotice) {
    drawCenteredText(s, "PENDIENTE DE PAGO", FONT_SIZE_TOTAL, true);
    if (doc.creditNotice.debtorName) {
      drawCenteredText(s, `Deudor: ${doc.creditNotice.debtorName}`, FONT_SIZE_NORMAL, true);
    }
    drawCenteredText(
      s,
      `Importe adeudado: ${formatEur(doc.creditNotice.amountDue)}`,
      FONT_SIZE_NORMAL,
      true,
    );
    drawCenteredText(s, "Este ticket no es el justificante fiscal.", FONT_SIZE_SMALL);
    drawSeparator(s);
  }

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
