// clinica-4 · EL PDF DEL INFORME CLÍNICO.
//
// Los cuatro informes (resumen, últimas sesiones, derivación e historia
// completa) salen del MISMO documento: el que `construirInforme` armó en
// `@mipiacetpv/clinica-sesion`. Aquí sólo se pinta.
//
// Eso es lo que hace que lo que se ve en pantalla, lo que se imprime y lo
// que viaja adjunto a un email sean el mismo informe. Con un armador por
// salida, el que se entrega al paciente podría decir algo distinto del que
// se le enseñó en la consulta.
//
// ── Ni un importe, y no por un `if` ──────────────────────────────────
//
// Regla 16: **sin importes en ningún sitio.** Este módulo no podría
// pintar uno aunque quisiera: lo que recibe son títulos, párrafos, filas
// de texto y puntos de dolor. No hay un campo de dinero en el tipo que
// entra por la puerta.
//
// ── La gráfica del dolor son barras, y van en el papel ───────────────
//
// Dibujadas con rectángulos de pdf-lib, sin ninguna librería de gráficos.
// Una gráfica de dolor en un informe que se entrega en papel es la pieza
// que hace que un paciente de 78 años vea que va mejor; una tabla de
// números no lo hace.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import {
  CONTENT_WIDTH,
  INK,
  INK_SOFT,
  LINE_GAP,
  MARGIN_X,
  MARGIN_TOP,
  MM,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  escribirParrafo,
  pieEnTodasLasPaginas,
  raya,
  reservar,
  wrap,
  type Cursor,
} from "./documento-a4.js";

const FONT_SIZE_TITLE = 14;
const FONT_SIZE_SECTION = 8.5;
const FONT_SIZE_BODY = 9.5;
const FONT_SIZE_SMALL = 8;
const SECCION_GAP = 6;
const FILA_ALTO = FONT_SIZE_BODY + LINE_GAP + 2;

/** El coral de la casa, para las barras del dolor. */
const CORAL = rgb(0.914, 0.439, 0.345);

/** La caja de la gráfica. */
const GRAFICA_ALTO = 32 * MM;
const DOLOR_MAXIMO = 10;

export interface SeccionParaPdf {
  titulo: string;
  parrafos: readonly string[];
  filas: readonly (readonly string[])[];
  grafica: readonly { fecha: string; dolor: number }[];
}

export interface InformeParaPdf {
  centro: {
    nombre: string;
    nif: string | null;
    direccion: string | null;
    telefono: string | null;
  };
  profesional: { nombre: string; colegiado: string | null; titulo: string };
  /** La fecha, ya escrita en la zona del centro. */
  fecha: string;
  titulo: string;
  subtitulo: string;
  paciente: { nombre: string; edad: number | null };
  secciones: readonly SeccionParaPdf[];
  /** El aviso de pie propio del informe, si lo tiene (la derivación). */
  piePropio: string | null;
  /** Cómo se escribe una fecha corta en la gráfica («7 sep»). */
  diaCorto: (iso: string) => string;
}

function rotuloDeSeccion(cursor: Cursor, texto: string): void {
  reservar(cursor, FONT_SIZE_SECTION + 10);
  cursor.y -= SECCION_GAP;
  cursor.page.drawText(texto.toUpperCase(), {
    x: MARGIN_X,
    y: cursor.y - FONT_SIZE_SECTION,
    size: FONT_SIZE_SECTION,
    font: cursor.fontBold,
    color: INK_SOFT,
  });
  cursor.y -= FONT_SIZE_SECTION + 4;
}

/**
 * Una tabla de texto, con las columnas repartidas por peso.
 *
 * Los pesos están aquí y no en el armador: cuánto mide una columna es del
 * papel, no del contenido clínico. Y el reparto se hace por número de
 * columnas, así que una tabla de dos (la valoración) y una de cuatro (las
 * visitas) salen las dos legibles sin que nadie declare nada.
 */
function tabla(cursor: Cursor, filas: readonly (readonly string[])[]): void {
  const columnas = Math.max(...filas.map((f) => f.length));
  // La primera columna es la fecha o la pregunta: estrecha cuando hay
  // varias, ancha cuando sólo son dos.
  const pesos =
    columnas <= 2
      ? [0.58, 0.42]
      : columnas === 3
        ? [0.18, 0.52, 0.3]
        : [0.14, 0.3, 0.38, 0.18];
  const anchos = pesos.slice(0, columnas).map((p) => p * CONTENT_WIDTH);

  for (const fila of filas) {
    // Se mide la fila ENTERA antes de pintar nada: una fila partida entre
    // dos páginas, con la fecha arriba y lo que se hizo abajo, es la
    // lectura difícil que un informe clínico no se puede permitir.
    const celdas = fila.map((texto, i) =>
      wrap(texto ?? "", cursor.font, FONT_SIZE_BODY, (anchos[i] ?? 0) - 4),
    );
    const altoFila =
      Math.max(...celdas.map((c) => c.length)) * (FONT_SIZE_BODY + LINE_GAP) + 3;
    reservar(cursor, altoFila);

    let x = MARGIN_X;
    celdas.forEach((lineas, i) => {
      lineas.forEach((linea, j) => {
        cursor.page.drawText(linea, {
          x,
          y: cursor.y - FONT_SIZE_BODY - j * (FONT_SIZE_BODY + LINE_GAP),
          size: FONT_SIZE_BODY,
          font: i === 0 ? cursor.fontBold : cursor.font,
          color: INK,
        });
      });
      x += anchos[i] ?? 0;
    });
    cursor.y -= altoFila;
  }
}

/** Las barras del dolor, 0–10, con su fecha debajo. */
function grafica(
  cursor: Cursor,
  puntos: readonly { fecha: string; dolor: number }[],
  diaCorto: (iso: string) => string,
): void {
  if (puntos.length === 0) return;
  reservar(cursor, GRAFICA_ALTO + 14);
  const base = cursor.y - GRAFICA_ALTO;
  const huecoTotal = CONTENT_WIDTH;
  const anchoPorPunto = huecoTotal / puntos.length;
  const anchoBarra = Math.min(anchoPorPunto * 0.5, 14 * MM);

  // La línea de base, para que una barra de dolor 0 se vea como un cero y
  // no como «no se midió».
  cursor.page.drawLine({
    start: { x: MARGIN_X, y: base },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: base },
    thickness: 0.5,
    color: INK_SOFT,
  });

  puntos.forEach((p, i) => {
    const centro = MARGIN_X + anchoPorPunto * (i + 0.5);
    const alto = (Math.max(0, Math.min(DOLOR_MAXIMO, p.dolor)) / DOLOR_MAXIMO) *
      (GRAFICA_ALTO - 10);
    cursor.page.drawRectangle({
      x: centro - anchoBarra / 2,
      y: base,
      width: anchoBarra,
      height: alto,
      color: CORAL,
    });
    const etiqueta = String(p.dolor);
    const anchoEtiqueta = cursor.fontBold.widthOfTextAtSize(
      etiqueta,
      FONT_SIZE_SMALL,
    );
    cursor.page.drawText(etiqueta, {
      x: centro - anchoEtiqueta / 2,
      y: base + alto + 2,
      size: FONT_SIZE_SMALL,
      font: cursor.fontBold,
      color: INK,
    });
    const fecha = diaCorto(p.fecha);
    const anchoFecha = cursor.font.widthOfTextAtSize(fecha, FONT_SIZE_SMALL);
    cursor.page.drawText(fecha, {
      x: centro - anchoFecha / 2,
      y: base - 9,
      size: FONT_SIZE_SMALL,
      font: cursor.font,
      color: INK_SOFT,
    });
  });

  cursor.y = base - 14;
}

export async function renderInformeClinicoPdf(
  datos: InformeParaPdf,
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

  // ── La cabecera: el centro a la izquierda, el informe a la derecha ──
  const yCabecera = cursor.y;
  cursor.page.drawText(datos.centro.nombre, {
    x: MARGIN_X,
    y: yCabecera - FONT_SIZE_TITLE,
    size: 11,
    font: fontBold,
    color: INK,
  });
  const senasDelCentro = [
    datos.centro.nif,
    datos.centro.direccion,
    datos.centro.telefono,
  ]
    .filter((x): x is string => !!x && x.trim() !== "")
    .join(" · ");
  cursor.page.drawText(
    `${datos.profesional.nombre} · ${datos.profesional.titulo}${datos.profesional.colegiado ? ` · Col. ${datos.profesional.colegiado}` : ""}`,
    {
      x: MARGIN_X,
      y: yCabecera - FONT_SIZE_TITLE - 11,
      size: FONT_SIZE_SMALL,
      font,
      color: INK_SOFT,
    },
  );
  if (senasDelCentro) {
    cursor.page.drawText(senasDelCentro, {
      x: MARGIN_X,
      y: yCabecera - FONT_SIZE_TITLE - 21,
      size: FONT_SIZE_SMALL,
      font,
      color: INK_SOFT,
    });
  }
  const derecha = (texto: string, dy: number, bold = false) => {
    const f = bold ? fontBold : font;
    const size = bold ? 9.5 : FONT_SIZE_SMALL;
    const ancho = f.widthOfTextAtSize(texto, size);
    cursor.page.drawText(texto, {
      x: MARGIN_X + CONTENT_WIDTH - ancho,
      y: yCabecera - FONT_SIZE_TITLE - dy,
      size,
      font: f,
      color: bold ? INK : INK_SOFT,
    });
  };
  derecha(datos.titulo, 0, true);
  derecha(datos.fecha, 12);

  cursor.y = yCabecera - FONT_SIZE_TITLE - 30;
  raya(cursor);
  cursor.y -= 4 * MM;

  // ── El paciente, y qué es este informe ─────────────────────────────
  escribirParrafo(
    cursor,
    `${datos.paciente.nombre}${datos.paciente.edad != null ? ` · ${datos.paciente.edad} años` : ""}`,
    { font: fontBold, size: 11, x: MARGIN_X },
  );
  escribirParrafo(cursor, datos.subtitulo, {
    font,
    size: FONT_SIZE_SMALL,
    x: MARGIN_X,
    color: INK_SOFT,
  });

  // ── Las secciones, en el orden que decidió el armador ──────────────
  for (const seccion of datos.secciones) {
    rotuloDeSeccion(cursor, seccion.titulo);
    for (const parrafo of seccion.parrafos) {
      escribirParrafo(cursor, parrafo, {
        font,
        size: FONT_SIZE_BODY,
        x: MARGIN_X,
      });
    }
    if (seccion.filas.length > 0) tabla(cursor, seccion.filas);
    if (seccion.grafica.length > 0) {
      cursor.y -= 4;
      grafica(cursor, seccion.grafica, datos.diaCorto);
    }
  }

  // ── La firma del profesional ───────────────────────────────────────
  cursor.y -= 10 * MM;
  reservar(cursor, 24 * MM);
  rotuloDeSeccion(cursor, "Firma");
  escribirParrafo(
    cursor,
    `${datos.profesional.nombre} · ${datos.profesional.titulo}${datos.profesional.colegiado ? ` · Nº de colegiado ${datos.profesional.colegiado}` : ""}`,
    { font, size: FONT_SIZE_BODY, x: MARGIN_X },
  );
  escribirParrafo(cursor, datos.centro.nombre, {
    font,
    size: FONT_SIZE_SMALL,
    x: MARGIN_X,
    color: INK_SOFT,
  });

  if (datos.piePropio) {
    cursor.y -= 4 * MM;
    escribirParrafo(cursor, datos.piePropio, {
      font,
      size: FONT_SIZE_SMALL,
      x: MARGIN_X,
      color: INK_SOFT,
    });
  }

  pieEnTodasLasPaginas(doc, font, `${datos.titulo} · ${datos.paciente.nombre}`);

  return doc.save({ useObjectStreams: false });
}

export const ALTO_DE_LA_GRAFICA = GRAFICA_ALTO;
export const ALTO_DE_FILA = FILA_ALTO;
