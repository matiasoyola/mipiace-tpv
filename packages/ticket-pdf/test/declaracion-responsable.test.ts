// El PDF de la declaración responsable.
//
// Los tests leen el TEXTO EXTRAÍDO del PDF, no el objeto que se le pasó al
// render. Es la diferencia entre comprobar que los datos existen y comprobar
// que salen impresos: un apartado que el maquetador se deja fuera, o que se
// pinta fuera del margen de una página que nunca se crea, aquí se ve.
//
// Sabotajes que este fichero pone en rojo (tabla del done):
//   · dejar de pintar un apartado (p. ej. saltarse el 1.g))
//   · pintar los apartados en otro orden
//   · perder el texto que no cabe en la primera página en vez de saltar
//   · tragarse el anexo

import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { buildDeclaracionResponsable } from "@mipiacetpv/verifactu";

import { renderDeclaracionResponsablePdf } from "../src/declaracion-responsable.js";

// Mismo patrón que `ticket-pdf.test.ts`: pdf-parse es CJS y su index arranca
// un modo debug que lee un PDF de ejemplo del disco, así que se pide el
// módulo interno por `createRequire`.
const require = createRequire(import.meta.url);
const pdfParse: (
  data: Uint8Array | Buffer,
) => Promise<{ text: string; numpages: number }> = require(
  "pdf-parse/lib/pdf-parse.js",
);

const DECLARACION = buildDeclaracionResponsable({
  versionServidor: "2310f6e",
  versionApk: { versionName: "1.19.0", versionCode: "11900" },
  fechaSuscripcion: "2026-09-27",
  emailSoporte: "soporte@mipiacetpv.com",
});

async function textoDelPdf(): Promise<string> {
  const bytes = await renderDeclaracionResponsablePdf(DECLARACION);
  const { text } = await pdfParse(Buffer.from(bytes));
  // El wrap parte las frases en renglones; para buscar por contenido nos
  // interesa el texto continuo.
  return text.replace(/\s+/g, " ");
}

describe("el PDF de la declaración responsable", () => {
  it("es un PDF de verdad", async () => {
    const bytes = await renderDeclaracionResponsablePdf(DECLARACION);
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("lleva el título literal", async () => {
    expect(await textoDelPdf()).toContain(
      "DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN",
    );
  });

  it("lleva los doce apartados, en orden", async () => {
    const texto = await textoDelPdf();
    const claves = [
      "1.a)",
      "1.b)",
      "1.c)",
      "1.d)",
      "1.e)",
      "1.f)",
      "1.g)",
      "1.h)",
      "1.i)",
      "1.j)",
      "1.k)",
      "1.l)",
      "2.a)",
      "2.b)",
    ];
    let cursor = -1;
    for (const clave of claves) {
      const pos = texto.indexOf(clave, cursor + 1);
      expect(pos, `el PDF no imprime ${clave} (o va desordenado)`).toBeGreaterThan(
        cursor,
      );
      cursor = pos;
    }
  });

  it("imprime los valores, no sólo los rótulos", async () => {
    const texto = await textoDelPdf();
    for (const esperado of [
      "mipiacetpv",
      "MP",
      "2310f6e (servidor)",
      "1.19.0 (11900) (app Android)",
      "S - Sí",
      "MI PIACE INTERNET SOLUTIONS SL",
      "B45902186",
      "45634 Buenaventura (Toledo)",
      "artículo 29.2.j) de la Ley 58/2003",
      "Real Decreto 1007/2023",
      "Orden HAC/1177/2024",
      "27 de septiembre de 2026",
      "soporte@mipiacetpv.com",
      "https://mipiacetpv.com",
    ]) {
      expect(texto, `el PDF no imprime «${esperado}»`).toContain(esperado);
    }
  });

  it("el ANEXO no se queda fuera", async () => {
    expect(await textoDelPdf()).toContain("ANEXO");
  });

  it("pagina en vez de perder texto", async () => {
    const bytes = await renderDeclaracionResponsablePdf(DECLARACION);
    const { numpages } = await pdfParse(Buffer.from(bytes));
    expect(numpages).toBeGreaterThanOrEqual(2);
    // Y el último apartado, que es el que caería por el borde, está impreso.
    expect(await textoDelPdf()).toContain("Sitio web");
  });

  it("cada folio dice de qué documento salió", async () => {
    const texto = await textoDelPdf();
    const bytes = await renderDeclaracionResponsablePdf(DECLARACION);
    const { numpages } = await pdfParse(Buffer.from(bytes));
    expect(texto).toContain(`1 de ${numpages}`);
    expect(texto).toContain(`${numpages} de ${numpages}`);
  });

  it("sin fecha horneada el PDF lo dice, no inventa una", async () => {
    const sinFecha = buildDeclaracionResponsable({
      versionServidor: "2310f6e",
      fechaSuscripcion: null,
      emailSoporte: "soporte@mipiacetpv.com",
    });
    const bytes = await renderDeclaracionResponsablePdf(sinFecha);
    const { text } = await pdfParse(Buffer.from(bytes));
    expect(text.replace(/\s+/g, " ")).toContain("no disponible en esta build");
  });
});
