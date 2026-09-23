// F1 · lo que se le enseña a la Inspección (ADR-018).
//
// El art. 34.9 del Estatuto de los Trabajadores obliga a conservar el
// registro cuatro años y a tenerlo a disposición del trabajador, de sus
// representantes y de la Inspección de Trabajo. En la práctica eso son
// dos cosas: un PDF que se imprime y se firma, y un CSV que se abre en
// Excel y se cruza con la nómina.
//
// Los dos llevan EXACTAMENTE el mismo contenido, y el mismo que la
// pantalla: los totales salen del servidor (`view.ts`), no se recalculan
// aquí. Si el PDF sumara por su cuenta, el día que discrepara del panel
// ganaría el PDF y nadie sabría por qué.
//
// Las horas van en HORA LOCAL con la zona indicada, y los totales sobre
// instantes: la noche del cambio de hora dura lo que dura, no lo que
// dicen los relojes.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { correctionKind, type TimeCorrectionRow } from "./corrections.js";
import { FICHAJE_TZ, diaLargo, formatDuration, localTime, mesLargo } from "./time.js";
import type { DayView } from "./view.js";

export interface ExportBlock {
  employeeId: string;
  employeeName: string;
  days: DayView[];
  totalMinutes: number;
}

export interface ExportInput {
  tenantName: string;
  legalName: string | null;
  taxId: string | null;
  month: string;
  timeZone: string;
  blocks: ExportBlock[];
  corrections: Array<
    TimeCorrectionRow & { employeeName: string; entryStartedAt: Date }
  >;
  generatedAt: Date;
}

/** La etiqueta de la zona que se imprime al pie: "Europe/Madrid (CEST)". */
export function zoneLabel(at: Date, timeZone: string = FICHAJE_TZ): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(at);
  const nombre = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return nombre ? `${timeZone} (${nombre})` : timeZone;
}

function fechaHoraLarga(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(at);
}

// ── CSV ────────────────────────────────────────────────────────────────

/** Punto y coma y BOM UTF-8: lo abre Excel en español, que es quien lo
 *  abre. Con comas y sin BOM, la mitad de las columnas se juntan y los
 *  acentos salen rotos — y entonces el fichero no sirve para nada. */
export function buildRegistroCsv(input: ExportInput): string {
  const sep = ";";
  const esc = (v: string) =>
    /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const filas: string[][] = [];

  filas.push(["Registro de jornada"]);
  filas.push(["Empresa", input.legalName ?? input.tenantName]);
  filas.push(["NIF", input.taxId ?? ""]);
  filas.push(["Mes", mesLargo(input.month)]);
  filas.push(["Zona horaria", zoneLabel(input.generatedAt, input.timeZone)]);
  filas.push([
    "Generado",
    fechaHoraLarga(input.generatedAt, input.timeZone),
  ]);
  filas.push([]);
  filas.push(["Empleado", "Día", "Entrada", "Salida", "Total", "Observaciones"]);

  for (const b of input.blocks) {
    for (const d of b.days) {
      for (const e of d.entries) {
        const obs: string[] = [];
        if (e.open) obs.push("sin salida");
        if (e.corrected) obs.push("corregido");
        if (e.offline) obs.push("enviado sin conexión");
        if (e.startSource === "PANEL") obs.push("añadido por la empresa");
        filas.push([
          b.employeeName,
          d.date,
          e.startedLocal,
          e.endedLocal ?? "",
          e.minutes === null ? "" : formatDuration(e.minutes),
          obs.join(", "),
        ]);
      }
      filas.push([b.employeeName, d.date, "", "TOTAL DÍA", formatDuration(d.totalMinutes), ""]);
    }
    filas.push([b.employeeName, "", "", "TOTAL MES", formatDuration(b.totalMinutes), ""]);
    filas.push([]);
  }

  // Las correcciones AL FINAL, como pide el bloque: el registro se lee
  // primero y lo que se tocó, después.
  filas.push(["Correcciones del periodo"]);
  if (input.corrections.length === 0) {
    filas.push(["Ninguna"]);
  } else {
    filas.push([
      "Empleado",
      "Día del fichaje",
      "Campo",
      "Antes",
      "Después",
      "Motivo",
      "Autor",
      "Fecha del cambio",
    ]);
    for (const c of input.corrections) {
      const alta = correctionKind(c) === "ALTA";
      filas.push([
        c.employeeName,
        localDay(c.entryStartedAt, input.timeZone),
        c.field === "started_at" ? "Entrada" : "Salida",
        alta ? "(alta manual)" : c.oldValue ? localTime(new Date(c.oldValue)) : "sin poner",
        c.newValue ? localTime(new Date(c.newValue)) : "",
        motivoLargo(c),
        `${c.author}${c.authorKind === "PANEL" ? " (empresa)" : " (el trabajador)"}`,
        fechaHoraLarga(c.createdAt, input.timeZone),
      ]);
    }
  }

  const cuerpo = filas
    .map((f) => f.map((v) => esc(v ?? "")).join(sep))
    .join("\r\n");
  return `﻿${cuerpo}\r\n`;
}

function localDay(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
}

function motivoLargo(c: TimeCorrectionRow): string {
  const base =
    c.reasonCode === "OLVIDO"
      ? "Olvido"
      : c.reasonCode === "ERROR_HORA"
        ? "Error de hora"
        : "Otro";
  return c.reasonText ? `${base}: ${c.reasonText}` : base;
}

// ── PDF ────────────────────────────────────────────────────────────────

const A4 = { w: 595.28, h: 841.89 };
const M = 48; // margen
const INK = rgb(0.12, 0.16, 0.22);
const SOFT = rgb(0.45, 0.5, 0.56);
const LINE = rgb(0.85, 0.87, 0.89);
const CORAL = rgb(0.914, 0.439, 0.345);

export async function buildRegistroPdf(input: ExportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;

  const nuevaPagina = () => {
    page = doc.addPage([A4.w, A4.h]);
    y = A4.h - M;
  };
  // Reserva sobre el pie. 34 pt: el pie vive en y=28 y necesita aire, pero
  // más que eso deja media página en blanco en cada corte — lo enseñó el
  // bucle visual sobre el PDF de septiembre.
  const espacio = (n: number) => {
    if (y - n < M + 34) nuevaPagina();
  };
  const texto = (
    s: string,
    x: number,
    size = 9.5,
    f = font,
    color = INK,
  ) => {
    page.drawText(s, { x, y, size, font: f, color });
  };
  const linea = () => {
    page.drawLine({
      start: { x: M, y: y },
      end: { x: A4.w - M, y: y },
      thickness: 0.5,
      color: LINE,
    });
  };

  // ── cabecera ─────────────────────────────────────────────────────────
  texto("Registro de jornada", M, 18, bold);
  y -= 22;
  texto(input.legalName ?? input.tenantName, M, 11, bold);
  y -= 14;
  if (input.taxId) {
    texto(`NIF ${input.taxId}`, M, 9.5, font, SOFT);
    y -= 13;
  }
  texto(mesLargo(input.month), M, 11, bold);
  y -= 13;
  texto(
    `Horas en hora local · ${zoneLabel(input.generatedAt, input.timeZone)}`,
    M,
    8.5,
    font,
    SOFT,
  );
  y -= 10;
  linea();
  y -= 18;

  // ── el registro, por empleado ────────────────────────────────────────
  for (const b of input.blocks) {
    espacio(90);
    texto(b.employeeName, M, 12, bold);
    const totalTxt = formatDuration(b.totalMinutes);
    page.drawText(totalTxt, {
      x: A4.w - M - bold.widthOfTextAtSize(totalTxt, 11),
      y,
      size: 11,
      font: bold,
      color: INK,
    });
    y -= 16;

    // Cabecera de la tabla.
    const COL = { dia: M, ent: M + 210, sal: M + 285, tot: M + 360, obs: M + 430 };
    texto("Día", COL.dia, 8, bold, SOFT);
    texto("Entrada", COL.ent, 8, bold, SOFT);
    texto("Salida", COL.sal, 8, bold, SOFT);
    texto("Total", COL.tot, 8, bold, SOFT);
    texto("Observaciones", COL.obs, 8, bold, SOFT);
    y -= 6;
    linea();
    y -= 12;

    for (const d of b.days) {
      for (const [i, e] of d.entries.entries()) {
        espacio(28);
        // El día se repite en CADA tramo, también en el segundo de un día
        // partido. En pantalla la cabecera de grupo basta; en un papel que
        // se lee en diagonal, una fila sin fecha flota y no se sabe de
        // cuándo es. Lo enseñó el bucle visual sobre el PDF.
        texto(diaLargo(d.date, input.timeZone), COL.dia, 9.5, font, i === 0 ? INK : SOFT);
        texto(e.startedLocal, COL.ent);
        texto(e.endedLocal ?? "—", COL.sal, 9.5, font, e.open ? CORAL : INK);
        texto(e.minutes === null ? "—" : formatDuration(e.minutes), COL.tot);
        const obs: string[] = [];
        if (e.open) obs.push("sin salida");
        if (e.corrected) obs.push("corregido");
        if (e.offline) obs.push("sin conexión");
        if (e.startSource === "PANEL") obs.push("alta de la empresa");
        texto(obs.join(", "), COL.obs, 8, font, SOFT);
        y -= 14;
      }
      if (d.entries.length > 1) {
        espacio(20);
        texto("", COL.dia);
        texto("Total del día", COL.sal, 8, font, SOFT);
        texto(formatDuration(d.totalMinutes), COL.tot, 8.5, bold);
        y -= 14;
      }
    }

    espacio(26);
    y -= 2;
    linea();
    y -= 13;
    texto("Total del mes", COL.sal, 9, bold);
    texto(formatDuration(b.totalMinutes), COL.tot, 9.5, bold);
    y -= 26;
  }

  // ── las correcciones, al final ───────────────────────────────────────
  espacio(120);
  y -= 4;
  texto("Correcciones del periodo", M, 12, bold);
  y -= 16;
  if (input.corrections.length === 0) {
    texto("Ninguna.", M, 9.5, font, SOFT);
    y -= 16;
  } else {
    // Dos columnas, "Antes" y "Después", y NO una flecha: `→` (U+2192) no
    // existe en WinAnsi, que es la codificación de las fuentes estándar de
    // PDF, y pdf-lib revienta al escribirla. Lo cazó el e2e, no la
    // revisión: el CSV sí la aguantaba.
    const C = { emp: M, dia: M + 100, campo: M + 200, antes: M + 250, desp: M + 300, mot: M + 355 };
    texto("Empleado", C.emp, 8, bold, SOFT);
    texto("Día", C.dia, 8, bold, SOFT);
    texto("Campo", C.campo, 8, bold, SOFT);
    texto("Antes", C.antes, 8, bold, SOFT);
    texto("Después", C.desp, 8, bold, SOFT);
    texto("Motivo y autor", C.mot, 8, bold, SOFT);
    y -= 6;
    linea();
    y -= 12;
    for (const c of input.corrections) {
      espacio(30);
      const alta = correctionKind(c) === "ALTA";
      texto(c.employeeName, C.emp, 8.5);
      texto(diaLargo(localDay(c.entryStartedAt, input.timeZone), input.timeZone), C.dia, 8.5);
      texto(c.field === "started_at" ? "Entrada" : "Salida", C.campo, 8.5);
      const antes = alta
        ? "(alta manual)"
        : c.oldValue
          ? localTime(new Date(c.oldValue))
          : "sin poner";
      const despues = c.newValue
        ? localTime(new Date(c.newValue))
        : "—";
      texto(alta ? "—" : antes, C.antes, 8.5, font, alta ? SOFT : INK);
      texto(despues, C.desp, 8.5);
      texto(motivoLargo(c), C.mot, 8.5);
      y -= 11;
      // El autor y la fecha, a ANCHO COMPLETO desde el margen. En la
      // columna de motivo se salían de la página por la derecha y la frase
      // se cortaba a media palabra — y en un documento que se le enseña a
      // la Inspección, "quién y cuándo" es justo lo que no puede cortarse.
      texto(
        `${c.author}${c.authorKind === "PANEL" ? " (empresa)" : " (el trabajador)"} · ${fechaHoraLarga(c.createdAt, input.timeZone)}`,
        C.emp + 10,
        7.5,
        font,
        SOFT,
      );
      y -= 15;
    }
  }

  // ── la firma ─────────────────────────────────────────────────────────
  //
  // Un hueco de verdad, no una línea de cortesía: en la práctica el
  // registro mensual se firma en papel y se archiva.
  espacio(110);
  y -= 14;
  texto("Conforme el trabajador", M, 9, bold);
  y -= 6;
  page.drawRectangle({
    x: M,
    y: y - 58,
    width: 240,
    height: 58,
    borderColor: LINE,
    borderWidth: 0.75,
  });
  page.drawText("Firma", {
    x: M + 8,
    y: y - 52,
    size: 7.5,
    font,
    color: SOFT,
  });
  page.drawText("Fecha", {
    x: M + 260,
    y: y - 14,
    size: 7.5,
    font,
    color: SOFT,
  });
  page.drawLine({
    start: { x: M + 260, y: y - 24 },
    end: { x: M + 400, y: y - 24 },
    thickness: 0.75,
    color: LINE,
  });
  y -= 70;

  // ── pie en todas las páginas ─────────────────────────────────────────
  const pie = `Generado el ${fechaHoraLarga(input.generatedAt, input.timeZone)} · mipiacetpv · Art. 34.9 del Estatuto de los Trabajadores`;
  const paginas = doc.getPages();
  for (const [i, p] of paginas.entries()) {
    p.drawText(pie, { x: M, y: 28, size: 7, font, color: SOFT });
    const n = `${i + 1} / ${paginas.length}`;
    p.drawText(n, {
      x: A4.w - M - font.widthOfTextAtSize(n, 7),
      y: 28,
      size: 7,
      font,
      color: SOFT,
    });
  }

  return doc.save();
}
