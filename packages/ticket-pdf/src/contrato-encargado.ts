// clinica-7 · EL PDF DEL CONTRATO DE ENCARGADO DEL TRATAMIENTO.
//
// El documento del art. 28 RGPD entre Mi Piace (encargado) y la clínica
// (responsable). Lo descarga la dueña desde el panel, y tiene que contestar
// dentro de cinco años a las mismas preguntas que el consentimiento de
// clinica-4:
//
//   **qué texto, qué versión, quién lo aceptó, cuándo, y si alguien lo ha
//   cambiado desde entonces.**
//
// Las cuatro primeras se escriben en el papel. La quinta la contesta la
// huella SHA-256 del texto canónico, y por eso el folio la imprime: un PDF
// guardado en el ordenador de un abogado lleva su propia huella y se puede
// comparar con la fila sin tener el programa delante.
//
// ── El contenido NO se escribe aquí ───────────────────────────────────
//
// Llega armado desde `@mipiacetpv/contrato-encargado`, que es donde vive
// el texto versionado. Este módulo sólo sabe de puntos, márgenes y saltos
// de línea — la misma separación que `consentimiento.ts` y
// `declaracion-responsable.ts`, y por el mismo motivo: el texto de un
// contrato se cambia sacando una versión nueva, no tocando un
// renderizador.
//
// ── Y no hay firma de dedo ────────────────────────────────────────────
//
// Al contrario que el consentimiento. Aquí no firma un paciente con la
// tablet delante: lo acepta la dueña con su sesión, y lo que vale como
// firma es la fila de `clinical_processor_agreements` — con su usuario, su
// fecha, su aparato, su IP y su user-agent. El pie del folio imprime eso,
// que es la prueba de verdad.

import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  INK_SOFT,
  MARGIN_TOP,
  MARGIN_X,
  MM,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  escribirCentrado,
  escribirParrafo,
  pieEnTodasLasPaginas,
  raya,
  type Cursor,
} from "./documento-a4.js";

const FONT_SIZE_TITLE = 14;
const FONT_SIZE_HEADING = 10;
const FONT_SIZE_APARTADO = 10.5;
const FONT_SIZE_BODY = 10;
const FONT_SIZE_SMALL = 8;
const PARRAFO_GAP = 4;
const APARTADO_GAP = 5;

export interface ApartadoParaPdf {
  encabezado: string;
  parrafos: readonly string[];
}

export interface ContratoEncargadoParaPdf {
  /** La cabecera del centro: nombre, NIF, dirección, teléfono. */
  centro: {
    nombre: string;
    nif: string | null;
    direccion: string | null;
    telefono: string | null;
  };
  titulo: string;
  apartados: readonly ApartadoParaPdf[];
  version: number;
  /** La huella del texto canónico de esa versión. */
  textoSha256: string;
  /**
   * Quién lo aceptó y cuándo. `null` cuando la versión todavía no se ha
   * aceptado — y entonces el folio es «el texto que se va a aceptar», y el
   * pie lo dice en vez de dejar un hueco que se lee como una firma que
   * falta.
   */
  aceptacion: { cuando: string; quien: string } | null;
  /** Lo que el texto tiene pendiente de validar, si lo tiene. */
  avisoDePlantilla: string | null;
}

/**
 * El contrato, en A4.
 *
 * Varias páginas sin problema: `escribirParrafo` y `pieEnTodasLasPaginas`
 * ya saben pasar de hoja, y este texto son ocho letras del art. 28.3 — no
 * cabe en un folio y no debe comprimirse para que quepa.
 */
export async function renderContratoEncargadoPdf(
  datos: ContratoEncargadoParaPdf,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${datos.titulo} · v${datos.version}`);
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

  // ── El título y la versión ─────────────────────────────────────────
  escribirCentrado(cursor, datos.titulo, {
    font: fontBold,
    size: FONT_SIZE_TITLE,
  });
  cursor.y -= 2 * MM;
  escribirCentrado(cursor, `Versión ${datos.version}`, {
    font,
    size: FONT_SIZE_SMALL,
    color: INK_SOFT,
  });
  cursor.y -= 5 * MM;

  // ── El aviso de texto pendiente, ARRIBA ────────────────────────────
  //
  // Arriba y no en el pie: lo que esto dice es «no se lo des a un abogado
  // como si estuviera revisado», y eso tiene que leerse antes del texto, no
  // después.
  if (datos.avisoDePlantilla) {
    escribirParrafo(cursor, datos.avisoDePlantilla.toUpperCase(), {
      font: fontBold,
      size: FONT_SIZE_SMALL,
      x: MARGIN_X,
      color: INK_SOFT,
    });
    cursor.y -= 4 * MM;
  }

  // ── Los apartados ──────────────────────────────────────────────────
  for (const apartado of datos.apartados) {
    escribirParrafo(cursor, apartado.encabezado, {
      font: fontBold,
      size: FONT_SIZE_APARTADO,
      x: MARGIN_X,
    });
    cursor.y -= 1.5 * MM;
    for (const parrafo of apartado.parrafos) {
      escribirParrafo(cursor, parrafo, {
        font,
        size: FONT_SIZE_BODY,
        x: MARGIN_X,
      });
      cursor.y -= PARRAFO_GAP;
    }
    cursor.y -= APARTADO_GAP;
  }

  // ── La aceptación, que es la firma ─────────────────────────────────
  cursor.y -= 4 * MM;
  raya(cursor);
  cursor.y -= 4 * MM;
  if (datos.aceptacion) {
    escribirParrafo(
      cursor,
      `Aceptado por ${datos.aceptacion.quien} el ${datos.aceptacion.cuando}.`,
      { font: fontBold, size: FONT_SIZE_BODY, x: MARGIN_X },
    );
    cursor.y -= 2 * MM;
    escribirParrafo(
      cursor,
      "La aceptación quedó registrada en el programa con el usuario, la fecha, el aparato y la dirección desde la que se hizo. Esa fila no se puede editar ni borrar.",
      { font, size: FONT_SIZE_SMALL, x: MARGIN_X, color: INK_SOFT },
    );
  } else {
    escribirParrafo(
      cursor,
      "Este texto todavía NO se ha aceptado. Lo acepta la dueña del centro desde el programa, y al aceptarlo queda registrado quién, cuándo y desde dónde.",
      { font, size: FONT_SIZE_BODY, x: MARGIN_X },
    );
  }

  // ── La huella, para poder comparar sin el programa delante ─────────
  cursor.y -= 4 * MM;
  escribirParrafo(cursor, `Huella del texto (SHA-256): ${datos.textoSha256}`, {
    font,
    size: FONT_SIZE_SMALL,
    x: MARGIN_X,
    color: INK_SOFT,
  });

  pieEnTodasLasPaginas(
    doc,
    font,
    `${datos.titulo} · v${datos.version} · ${datos.centro.nombre}`,
  );

  return doc.save();
}
