// clinica-4 · EL PDF DEL CONSENTIMIENTO INFORMADO.
//
// Lo que se firma con el dedo en la consulta y queda en la historia. Un
// folio A4 que tiene que poder leerse, imprimirse y entregarse — y que
// dentro de cinco años tiene que contestar cinco preguntas:
//
//   **quién firmó · qué texto · cuándo · delante de quién · y si alguien
//   lo ha cambiado desde entonces.**
//
// Las cuatro primeras se escriben en el papel. La quinta la contesta la
// huella SHA-256 que la fila guarda del fichero, y por eso el PDF también
// la imprime: un folio fotocopiado que lleva su propia huella se puede
// comparar con la fila sin tener el fichero delante.
//
// ── El contenido NO se escribe aquí ───────────────────────────────────
//
// Llega armado (la plantilla versionada del paquete `consentimientos`, el
// firmante, el informante y la fecha). Este módulo sólo sabe de puntos,
// márgenes y saltos de línea — la misma separación que
// `declaracion-responsable.ts`, y por el mismo motivo: el texto de un
// consentimiento se cambia sacando una versión nueva de la plantilla, no
// tocando un renderizador.
//
// ── La firma es una imagen, y va con su marco ────────────────────────
//
// El PNG que sale del `<canvas>` donde el paciente firmó con el dedo. Se
// pinta dentro de una caja con la línea y el rótulo debajo, como en el
// papel: una firma suelta en medio de un folio no se lee como una firma.

import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  CONTENT_WIDTH,
  INK,
  INK_SOFT,
  LINE_GAP,
  MARGIN_TOP,
  MARGIN_X,
  MM,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  escribirCentrado,
  escribirParrafo,
  pieEnTodasLasPaginas,
  raya,
  reservar,
  type Cursor,
} from "./documento-a4.js";

const FONT_SIZE_TITLE = 14;
const FONT_SIZE_HEADING = 10;
const FONT_SIZE_BODY = 10;
const FONT_SIZE_SMALL = 8;
const PARRAFO_GAP = 5;

/** La caja de la firma: lo bastante grande para una firma de dedo. */
const FIRMA_ANCHO = 70 * MM;
const FIRMA_ALTO = 28 * MM;

export interface ConsentimientoParaPdf {
  /** La cabecera del centro: nombre, NIF, dirección, teléfono. */
  centro: {
    nombre: string;
    nif: string | null;
    direccion: string | null;
    telefono: string | null;
  };
  /** El título y los párrafos de la plantilla, tal cual. */
  titulo: string;
  parrafos: readonly string[];
  /** La plantilla y su versión, impresas: identifican el texto exacto. */
  plantillaId: string;
  plantillaVersion: number;
  /** La huella del texto canónico de esa plantilla. */
  textoSha256: string;
  paciente: { nombre: string; documento: string | null };
  /** Quién firma. Con representante, su nombre y su relación. */
  firmante: {
    clase: "PACIENTE" | "REPRESENTANTE";
    nombre: string | null;
    relacion: string | null;
  };
  /** Quién informó: nombre y nº de colegiado si lo tiene. */
  informante: { nombre: string; colegiado: string | null };
  /** La fecha, ya escrita en la zona del centro. */
  fecha: string;
  /** El PNG de la firma del dedo. `null` = hueco para firmar a mano. */
  firmaPng: Uint8Array | null;
  /** Lo que la plantilla tiene pendiente de validar, si lo tiene. */
  avisoDePlantilla: string | null;
}

/**
 * El consentimiento, en A4.
 *
 * Devuelve el PDF. Quien llama calcula su huella, lo guarda y escribe la
 * fila — en ese orden, que es el de `ficheros.ts`.
 */
export async function renderConsentimientoPdf(
  datos: ConsentimientoParaPdf,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(datos.titulo);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const cursor: Cursor = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: PAGE_HEIGHT - MARGIN_TOP,
    font,
    fontBold,
  };

  // ── La cabecera del centro ─────────────────────────────────────────
  escribirParrafo(cursor, datos.centro.nombre, {
    font: fontBold,
    size: FONT_SIZE_HEADING,
    x: MARGIN_X,
  });
  const senas = [datos.centro.nif, datos.centro.direccion, datos.centro.telefono]
    .filter((x): x is string => !!x && x.trim() !== "")
    .join(" · ");
  if (senas) {
    escribirParrafo(cursor, senas, {
      font,
      size: FONT_SIZE_SMALL,
      x: MARGIN_X,
      color: INK_SOFT,
    });
  }
  cursor.y -= 3 * MM;
  raya(cursor);
  cursor.y -= 4 * MM;

  // ── El título ──────────────────────────────────────────────────────
  escribirCentrado(cursor, datos.titulo, {
    font: fontBold,
    size: FONT_SIZE_TITLE,
  });
  cursor.y -= 5 * MM;

  // ── Quién ──────────────────────────────────────────────────────────
  escribirParrafo(
    cursor,
    `Paciente: ${datos.paciente.nombre}${datos.paciente.documento ? ` · ${datos.paciente.documento}` : ""}`,
    { font: fontBold, size: FONT_SIZE_BODY, x: MARGIN_X },
  );
  cursor.y -= 3 * MM;

  // ── El texto que se firma ──────────────────────────────────────────
  for (const parrafo of datos.parrafos) {
    escribirParrafo(cursor, parrafo, {
      font,
      size: FONT_SIZE_BODY,
      x: MARGIN_X,
    });
    cursor.y -= PARRAFO_GAP;
  }

  if (datos.firmante.clase === "REPRESENTANTE") {
    cursor.y -= 2 * MM;
    escribirParrafo(
      cursor,
      `Firma en nombre del paciente ${datos.firmante.nombre} (${datos.firmante.relacion}), por no poder hacerlo el paciente por sí mismo.`,
      { font, size: FONT_SIZE_BODY, x: MARGIN_X },
    );
    cursor.y -= PARRAFO_GAP;
  }

  // ── La revocación, dicha en el propio documento ────────────────────
  //
  // Ley 41/2002 art. 8.5: el consentimiento es revocable en cualquier
  // momento. Decirlo en el papel y no sólo en el programa es la mitad que
  // de verdad llega al paciente.
  cursor.y -= 2 * MM;
  escribirParrafo(
    cursor,
    "Puedo retirar este consentimiento en cualquier momento, sin dar explicaciones y sin que eso cambie la atención que recibo. La retirada queda registrada con su fecha.",
    { font, size: FONT_SIZE_SMALL, x: MARGIN_X, color: INK_SOFT },
  );

  // ── La firma ───────────────────────────────────────────────────────
  cursor.y -= 8 * MM;
  reservar(cursor, FIRMA_ALTO + 26 * MM);

  const xFirma = MARGIN_X;
  const yCaja = cursor.y - FIRMA_ALTO;

  if (datos.firmaPng) {
    const png = await doc.embedPng(datos.firmaPng);
    // Se escala para caber DENTRO de la caja sin deformarse: una firma
    // estirada no es la firma de nadie.
    const escala = Math.min(
      FIRMA_ANCHO / png.width,
      FIRMA_ALTO / png.height,
      1,
    );
    cursor.page.drawImage(png, {
      x: xFirma,
      y: yCaja + (FIRMA_ALTO - png.height * escala) / 2,
      width: png.width * escala,
      height: png.height * escala,
    });
  }

  cursor.page.drawLine({
    start: { x: xFirma, y: yCaja - 2 },
    end: { x: xFirma + FIRMA_ANCHO, y: yCaja - 2 },
    thickness: 0.7,
    color: INK,
  });
  cursor.page.drawText(
    datos.firmante.clase === "REPRESENTANTE"
      ? `Firma de ${datos.firmante.nombre} (${datos.firmante.relacion})`
      : "Firma del paciente",
    {
      x: xFirma,
      y: yCaja - 12,
      size: FONT_SIZE_SMALL,
      font,
      color: INK_SOFT,
    },
  );

  // Y a la derecha, el informante: la ley pide que informe el
  // profesional, así que el papel dice quién fue y con qué número.
  const xInf = MARGIN_X + CONTENT_WIDTH - FIRMA_ANCHO;
  cursor.page.drawLine({
    start: { x: xInf, y: yCaja - 2 },
    end: { x: xInf + FIRMA_ANCHO, y: yCaja - 2 },
    thickness: 0.7,
    color: INK,
  });
  cursor.page.drawText(
    `Informa: ${datos.informante.nombre}${datos.informante.colegiado ? ` · Col. ${datos.informante.colegiado}` : ""}`,
    { x: xInf, y: yCaja - 12, size: FONT_SIZE_SMALL, font, color: INK_SOFT },
  );

  cursor.y = yCaja - 20;
  cursor.y -= 6 * MM;
  escribirParrafo(cursor, `Fecha: ${datos.fecha}`, {
    font,
    size: FONT_SIZE_BODY,
    x: MARGIN_X,
  });

  // ── El pie técnico: qué texto fue, exactamente ─────────────────────
  cursor.y -= 4 * MM;
  escribirParrafo(
    cursor,
    `Plantilla ${datos.plantillaId} v${datos.plantillaVersion} · huella del texto ${datos.textoSha256}`,
    { font, size: FONT_SIZE_SMALL, x: MARGIN_X, color: INK_SOFT },
  );
  if (datos.avisoDePlantilla) {
    escribirParrafo(cursor, datos.avisoDePlantilla, {
      font,
      size: FONT_SIZE_SMALL,
      x: MARGIN_X,
      color: INK_SOFT,
    });
  }

  pieEnTodasLasPaginas(doc, font, datos.titulo);

  // `useObjectStreams: false` por lo mismo que `render.ts` y la
  // declaración responsable: con el xref stream por defecto, pdf.js no
  // sólo falla al parsear este documento — se queda en mal estado y tumba
  // el siguiente parseo del proceso (en CI, el del ticket).
  return doc.save({ useObjectStreams: false });
}

export const ALTO_DE_LA_CAJA_DE_FIRMA = FIRMA_ALTO;
export const ANCHO_DE_LA_CAJA_DE_FIRMA = FIRMA_ANCHO;
export { LINE_GAP as INTERLINEADO_DEL_CONSENTIMIENTO };
