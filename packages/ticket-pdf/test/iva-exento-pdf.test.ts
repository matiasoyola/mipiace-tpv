// bloque iva-exento-sanitario · el TICKET DIGITAL de una venta exenta.
//
// Es el segundo de los tres caminos que pintan un ticket: el PDF que va
// por email y el que se ve en la pantalla post-cobro y detrás del QR del
// papel. Tiene test propio y aquí —y no en `apps/api/test`— porque es el
// único sitio donde vive `pdf-parse`: lo que se comprueba es el TEXTO QUE
// SE VE, extraído del PDF, no una estructura intermedia.
//
// Y tiene que decir LO MISMO que el térmico, con las mismas palabras. Una
// paciente que recibe su factura por email y la compara con el papel que
// se llevó no puede encontrar dos leyendas distintas de la misma
// exención.

import { createRequire } from "node:module";

import {
  buildTicketDocument,
  type BuildTicketDocumentInput,
} from "@mipiacetpv/ticket-model";
import { describe, expect, it } from "vitest";

import { renderTicketPdf } from "../src/index.js";

const require = createRequire(import.meta.url);
const pdfParseCrudo: (data: Uint8Array | Buffer) => Promise<{ text: string }> =
  require("pdf-parse/lib/pdf-parse.js");
// Misma precaución que `ticket-pdf.test.ts`: un Uint8Array propio (offset
// 0) para que pdf.js no lea del pool compartido de Node.
const pdfParse: typeof pdfParseCrudo = (data) => pdfParseCrudo(new Uint8Array(data));

const ISSUED_AT = new Date("2026-10-07T08:42:00Z");

function doc(
  lines: BuildTicketDocumentInput["ticket"]["lines"],
  total: number,
) {
  return buildTicketDocument({
    tenant: {
      name: "PODOLOGIA ROSARIO",
      fiscalProfile: {
        legalName: "PODOLOGÍA ROSARIO",
        taxId: "00000000T",
        address: "C/ Ejemplo 1, 45600 Talavera de la Reina",
      },
      businessType: "SERVICES",
    },
    store: { name: "Podología Rosario", fiscalAddress: { address: "C/ Ejemplo 1" } },
    register: { name: "Caja 1" },
    cashier: { email: "rosario@podologia.es", name: "Rosario" },
    ticket: {
      internalNumber: "000042",
      publicSlug: "0123456789abcdef",
      paidAt: ISSUED_AT,
      createdAt: ISSUED_AT,
      total,
      lines,
      payments: [{ method: "CARD", amount: total }],
    },
  });
}

/** La quiropodia exenta: 35,00 € que paga la paciente, sin IVA dentro.
 *  `taxRate: 0` Y causa — el par que la base garantiza con un CHECK. */
const QUIROPODIA = {
  nameSnapshot: "Quiropodia",
  sku: "LOC-QUIRO",
  units: 1,
  unitPrice: 35,
  taxRate: 0,
  exemptionCause: "E1",
  subtotal: 35,
  total: 35,
};

/** La crema del mostrador, al 21 %. Neto de 4 decimales, como lo persiste
 *  el catálogo (`netoDesdeBruto(12, 21)`). */
const CREMA = {
  nameSnapshot: "Crema urea 20%",
  sku: "LOC-CREMA",
  units: 1,
  unitPrice: 9.9174,
  taxRate: 21,
  subtotal: 9.92,
  total: 12,
};

describe("iva-exento-sanitario · el ticket digital de la sesión", () => {
  it("lleva «Exento» con su importe, un «IVA 0,00 €» y NINGÚN «Subtotal»", async () => {
    const bytes = await renderTicketPdf(doc([QUIROPODIA], 35));
    const { text } = await pdfParse(bytes);
    expect(text).toContain("Exento");
    expect(text).toContain("35,00 €");
    expect(text).toContain("IVA");
    expect(text).toContain("0,00 €");
    // «Subtotal» es LA BASE IMPONIBLE del documento (ticket-con-iva), y
    // una operación exenta no tiene base imponible. El mockup validado
    // tampoco la lleva.
    expect(text).not.toContain("Subtotal");
    // Y no el «IVA 0% s/35,00» del 0 % sujeto, que es otra operación.
    expect(text).not.toContain("s/35,00");
  });

  it("y la leyenda del precepto, con las MISMAS palabras que el papel", async () => {
    const bytes = await renderTicketPdf(doc([QUIROPODIA], 35));
    const { text } = await pdfParse(bytes);
    expect(text).toContain("Operación exenta de IVA");
    expect(text).toContain("art. 20.Uno.3º Ley 37/1992");
  });

  it("en venta mixta: «Exento», «Base 21 %», «IVA 21 %» y el nombre delante", async () => {
    const bytes = await renderTicketPdf(doc([QUIROPODIA, CREMA], 47));
    const { text } = await pdfParse(bytes);
    for (const t of [
      "Exento",
      "Base 21 %",
      "IVA 21 %",
      "9,92 €",
      "2,08 €",
      "Quiropodia: operación exenta de IVA",
      "art. 20.Uno.3º Ley 37/1992",
    ]) {
      expect(text, t).toContain(t);
    }
    expect(text).not.toContain("Subtotal");
  });

  it("un ticket SIN exención sale exactamente como antes del bloque", async () => {
    // Los otros catorce tenants. «IVA 21% s/9,92» + «Subtotal», que es lo
    // que ticket-con-iva dejó el 06-10, y sin leyenda ninguna.
    const bytes = await renderTicketPdf(doc([CREMA], 12));
    const { text } = await pdfParse(bytes);
    expect(text).toContain("IVA 21% s/9,92 €");
    expect(text).toContain("Subtotal");
    expect(text).not.toContain("Exento");
    expect(text).not.toContain("exenta de IVA");
  });

  it("y la página NO sale cortada: el alto cuenta las filas nuevas", async () => {
    // `computeLineCount` mide antes de crear la página. Con tramo exento
    // el desglose cambia de alto (un renglón por exento, DOS por sujeto, y
    // ninguno de «Subtotal») y encima entra la leyenda: contarlo mal deja
    // el pie del ticket fuera del papel. Lo que se comprueba es que lo
    // ÚLTIMO del documento sigue estando dentro.
    const bytes = await renderTicketPdf(doc([QUIROPODIA, CREMA], 47));
    const { text } = await pdfParse(bytes);
    expect(text).toContain("¡Gracias por tu visita!");
    expect(text).toContain("Ticket: 0123456789abcdef");
  });

  it("el recuadro crece con el TÍTULO, no con un alto fijo", async () => {
    // LO ENCONTRÓ EL BUCLE VISUAL, NO LA SUITE.
    //
    // La primera versión dibujaba el borde con un alto FIJO de dos
    // renglones. En la captura del ticket mixto se vio lo que eso daba: el
    // borde de arriba pisaba el separador y el de abajo cortaba por la
    // mitad la línea del precepto. `pdf-parse` no lo veía porque el TEXTO
    // estaba — lo que estaba mal era dónde se pintaba la caja.
    //
    // Este test cubre la mitad que un test puede cubrir: que el alto
    // RESERVADO depende de cuántos renglones ocupa el título. Con tres
    // líneas exentas de dos causas el título es «Operaciones exentas:
    // operación exenta de IVA», que se parte en dos; con una, no.
    const { PDFDocument } = await import("pdf-lib");
    const altoDe = async (lineas: BuildTicketDocumentInput["ticket"]["lines"], total: number) => {
      const pdf = await PDFDocument.load(await renderTicketPdf(doc(lineas, total)));
      return pdf.getPage(0).getSize().height;
    };
    // Dos tickets con las MISMAS líneas y el mismo total: lo único que
    // cambia es la causa de la segunda, y con ella el título de la
    // leyenda (de «Quiropodia: …», que cabe, a «Operaciones exentas: …»,
    // que se parte).
    const unaCausa = await altoDe(
      [QUIROPODIA, { ...QUIROPODIA, nameSnapshot: "Vendaje", sku: "LOC-V" }, CREMA],
      82,
    );
    const dosCausas = await altoDe(
      [
        QUIROPODIA,
        { ...QUIROPODIA, nameSnapshot: "Vendaje", sku: "LOC-V", exemptionCause: "E5" },
        CREMA,
      ],
      82,
    );
    expect(dosCausas).toBeGreaterThan(unaCausa);
  });

  it("el PDF exento es MÁS ALTO que el mismo ticket sin exención", async () => {
    // Dos líneas iguales, una exenta y la otra no: la diferencia de alto
    // es la leyenda. Si fueran iguales, la leyenda se estaría pintando
    // encima de otra cosa.
    const { PDFDocument } = await import("pdf-lib");
    const altoDe = async (lineas: BuildTicketDocumentInput["ticket"]["lines"], total: number) => {
      const pdf = await PDFDocument.load(await renderTicketPdf(doc(lineas, total)));
      return pdf.getPage(0).getSize().height;
    };
    const conExencion = await altoDe([QUIROPODIA], 35);
    const sinExencion = await altoDe(
      [{ ...QUIROPODIA, exemptionCause: null }],
      35,
    );
    expect(conExencion).toBeGreaterThan(sinExencion);
  });
});
