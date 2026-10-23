// calidad-1 (D-75) · **EL PLAN DE ACCIONES CORRECTIVAS, EN PDF.**
//
// El documento que AENOR pide **en 30 días naturales** desde el informe
// de auditoría, y que hoy Jardín de Gredos redacta en Word copiando a
// mano lo que está en una carpeta. Aquí sale del sistema: por cada no
// conformidad, su clase, su cláusula ISO, el proceso del que cuelga, la
// descripción, la causa, y sus acciones con responsable, plazo y estado.
//
// Y el **informe de no conformidades por periodo**, que es el mismo
// documento con dos secciones más: el recuento por clase y por origen, y
// el ciclo completo de cada una (las verificaciones de eficacia, con su
// resultado). El PAC se manda fuera; el informe se lee dentro.
//
// ── POR QUÉ UN SOLO FICHERO PARA LOS DOS ────────────────────────────
//
// Porque son la misma lista con dos niveles de detalle, y dos
// renderizadores habrían sido dos sitios donde una NC sale en uno y no
// en el otro. Lo que cambia es el `modo`, y un test comprueba que el PAC
// lleva **todas las del filtro y ninguna más** — que es la única
// promesa que de verdad importa de este documento.
//
// ── LO QUE ESTE MÓDULO NO SABE ──────────────────────────────────────
//
// Descifrar. Lo que entra aquí ya viene en claro desde la ruta, que es
// la que tiene la DEK del centro, igual que el informe clínico de
// clinica-4. Y lo que entra puede nombrar a un residente (D-73), así que
// la ruta que lo genera está bajo el mismo contrato de encargado que la
// historia clínica.

import { PDFDocument, StandardFonts } from "pdf-lib";

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
  saneado,
  wrap,
  type Cursor,
} from "./documento-a4.js";

const TITULO = 15;
const SECCION = 10.5;
const CUERPO = 9.5;
const PEQUENA = 8;

/** Una acción correctiva, como se pinta. */
export interface AccionParaPac {
  que: string;
  responsable: string;
  plazo: string;
  estado: string;
  /** Las notas de cierre y las evidencias, en una línea. */
  evidencia: string | null;
}

/** Una verificación de eficacia, como se pinta. Sólo en el informe. */
export interface VerificacionParaPac {
  fecha: string;
  por: string;
  resultado: string;
  nota: string;
}

/** Una no conformidad, con su expediente. */
export interface NcParaPac {
  referencia: string;
  clase: string;
  origen: string;
  origenDetalle: string | null;
  proceso: string;
  clausula: string | null;
  detectada: string;
  estado: string;
  descripcion: string;
  causa: string | null;
  acciones: readonly AccionParaPac[];
  verificaciones: readonly VerificacionParaPac[];
  cerrada: string | null;
}

export interface PacParaPdf {
  /** `PAC` para el que se manda a la certificadora; `INFORME` para el de
   *  dentro, que además lleva el recuento y las verificaciones. */
  modo: "PAC" | "INFORME";
  centro: {
    nombre: string;
    nif: string | null;
    direccion: string | null;
  };
  /** Qué filtro produjo esta lista. **Va impreso**: un PAC que no dice de
   *  qué auditoría es, y entre qué fechas, es un papel que el año que
   *  viene nadie sabe colocar. */
  filtro: string;
  generadoEl: string;
  noConformidades: readonly NcParaPac[];
}

/** Una etiqueta en gris y su valor al lado, en una línea. */
function campo(cursor: Cursor, etiqueta: string, valor: string): void {
  const anchoEtiqueta = 28 * MM;
  const alto = CUERPO + LINE_GAP;
  const lineas = wrap(
    valor,
    cursor.font,
    CUERPO,
    CONTENT_WIDTH - anchoEtiqueta,
  );
  reservar(cursor, alto * lineas.length);
  cursor.page.drawText(saneado(etiqueta), {
    x: MARGIN_X,
    y: cursor.y - CUERPO,
    size: PEQUENA,
    font: cursor.font,
    color: INK_SOFT,
  });
  lineas.forEach((linea, i) => {
    if (i > 0) reservar(cursor, alto);
    cursor.page.drawText(linea, {
      x: MARGIN_X + anchoEtiqueta,
      y: cursor.y - CUERPO,
      size: CUERPO,
      font: cursor.font,
      color: INK,
    });
    cursor.y -= alto;
  });
}

export async function renderPacPdf(datos: PacParaPdf): Promise<Uint8Array> {
  const esPac = datos.modo === "PAC";
  const titulo = esPac
    ? "Plan de acciones correctivas"
    : "Informe de no conformidades";

  const doc = await PDFDocument.create();
  doc.setTitle(`${titulo} · ${datos.centro.nombre}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const cursor: Cursor = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: PAGE_HEIGHT - MARGIN_TOP,
    font,
    fontBold,
  };

  // ── La cabecera ───────────────────────────────────────────────────
  cursor.page.drawText(saneado(datos.centro.nombre), {
    x: MARGIN_X,
    y: cursor.y - 11,
    size: 11,
    font: fontBold,
    color: INK,
  });
  const senas = [datos.centro.nif, datos.centro.direccion]
    .filter((x): x is string => !!x && x.trim() !== "")
    .join(" · ");
  if (senas) {
    cursor.page.drawText(saneado(senas), {
      x: MARGIN_X,
      y: cursor.y - 22,
      size: PEQUENA,
      font,
      color: INK_SOFT,
    });
  }
  cursor.y -= 34;

  cursor.page.drawText(saneado(titulo), {
    x: MARGIN_X,
    y: cursor.y - TITULO,
    size: TITULO,
    font: fontBold,
    color: INK,
  });
  cursor.y -= TITULO + 6;

  escribirParrafo(cursor, datos.filtro, {
    font,
    size: CUERPO,
    x: MARGIN_X,
    color: INK_SOFT,
  });
  escribirParrafo(cursor, `Generado el ${datos.generadoEl}.`, {
    font,
    size: PEQUENA,
    x: MARGIN_X,
    color: INK_SOFT,
  });
  cursor.y -= 4;
  raya(cursor, 0.8);
  cursor.y -= 6;

  // ── El recuento, sólo en el informe ───────────────────────────────
  //
  // En el PAC estorba: lo que la certificadora quiere ver es qué se va a
  // hacer con cada hallazgo, no cuántos hay. Dentro, el recuento es lo
  // primero que mira la dirección.
  if (!esPac && datos.noConformidades.length > 0) {
    const porClase = new Map<string, number>();
    const porOrigen = new Map<string, number>();
    const porEstado = new Map<string, number>();
    for (const n of datos.noConformidades) {
      porClase.set(n.clase, (porClase.get(n.clase) ?? 0) + 1);
      porOrigen.set(n.origen, (porOrigen.get(n.origen) ?? 0) + 1);
      porEstado.set(n.estado, (porEstado.get(n.estado) ?? 0) + 1);
    }
    const linea = (m: Map<string, number>): string =>
      [...m.entries()].map(([k, v]) => `${k}: ${v}`).join(" · ");
    cursor.page.drawText(saneado("Resumen del periodo"), {
      x: MARGIN_X,
      y: cursor.y - SECCION,
      size: SECCION,
      font: fontBold,
      color: INK,
    });
    cursor.y -= SECCION + 6;
    campo(cursor, "Total", String(datos.noConformidades.length));
    campo(cursor, "Por clase", linea(porClase));
    campo(cursor, "Por origen", linea(porOrigen));
    campo(cursor, "Por estado", linea(porEstado));
    cursor.y -= 6;
    raya(cursor);
    cursor.y -= 6;
  }

  // ── Y una por una ─────────────────────────────────────────────────
  if (datos.noConformidades.length === 0) {
    // **Se imprime igual.** Un PAC vacío es un documento válido —«no hay
    // hallazgos abiertos de esta auditoría»— y no imprimirlo obligaría a
    // la dirección a explicar de palabra por qué no hay papel, que es
    // exactamente lo que este bloque viene a quitar.
    escribirParrafo(
      cursor,
      "No hay ninguna no conformidad que cumpla este filtro.",
      { font, size: CUERPO, x: MARGIN_X },
    );
  }

  for (const n of datos.noConformidades) {
    reservar(cursor, 40);
    cursor.page.drawText(saneado(`${n.referencia} · ${n.clase}`), {
      x: MARGIN_X,
      y: cursor.y - SECCION,
      size: SECCION,
      font: fontBold,
      color: INK,
    });
    cursor.y -= SECCION + 5;

    campo(cursor, "Proceso", n.proceso);
    campo(cursor, "Cláusula ISO", n.clausula ?? "—");
    campo(
      cursor,
      "Origen",
      n.origenDetalle ? `${n.origen} · ${n.origenDetalle}` : n.origen,
    );
    campo(cursor, "Detectada el", n.detectada);
    campo(cursor, "Estado", n.cerrada ? `${n.estado} (${n.cerrada})` : n.estado);
    campo(cursor, "Descripción", n.descripcion);
    campo(cursor, "Causa", n.causa ?? "Pendiente de analizar");

    // Las acciones, con su plazo y su estado. Es la parte que AENOR lee.
    cursor.y -= 2;
    if (n.acciones.length === 0) {
      campo(cursor, "Acciones", "Ninguna escrita todavía");
    } else {
      n.acciones.forEach((a, i) => {
        campo(cursor, i === 0 ? "Acciones" : "", a.que);
        campo(
          cursor,
          "",
          `Responsable: ${a.responsable} · Plazo: ${a.plazo} · ${a.estado}`,
        );
        if (a.evidencia) campo(cursor, "", `Evidencia: ${a.evidencia}`);
      });
    }

    // La verificación de eficacia **sólo en el informe**: es el control
    // interno, y lo que se manda fuera es el plan. Un «no eficaz» en el
    // PAC que se entrega sería contar el final antes de llegar.
    if (!esPac && n.verificaciones.length > 0) {
      n.verificaciones.forEach((v, i) => {
        campo(
          cursor,
          i === 0 ? "Eficacia" : "",
          `${v.fecha} · ${v.resultado} · ${v.por}`,
        );
        if (v.nota) campo(cursor, "", v.nota);
      });
    }

    cursor.y -= 5;
    raya(cursor);
    cursor.y -= 6;
  }

  pieEnTodasLasPaginas(
    doc,
    font,
    `${titulo} · ${datos.centro.nombre} · ${datos.generadoEl}`,
  );
  return doc.save({ useObjectStreams: false });
}
