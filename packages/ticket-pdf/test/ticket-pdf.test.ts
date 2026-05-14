// Tests del renderer PDF. Verificamos:
//  - Devuelve un Uint8Array que arranca con %PDF (magic number).
//  - El PDF parseado contiene los strings clave del ticket (cabecera
//    fiscal, descripción de línea, total, "TICKET" / "DEVOLUCIÓN").
//  - Dimensiones de página correctas (80mm de ancho, alto > 0).
//  - El QR opcional se incrusta y la página crece.
//
// No comparamos hash binario porque pdf-lib usa timestamps internos
// y genera diffs irrelevantes. Extracción con `pdf-parse`.

import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
// pdf-parse expone el binario CJS por defecto sin tipos ESM, usamos
// require dinámico para no atarnos a una resolución concreta.
import { createRequire } from "node:module";

import { renderTicketPdf } from "../src/index.js";
import { buildTicketDocument, type BuildTicketDocumentInput } from "@mipiacetpv/ticket-model";

const require = createRequire(import.meta.url);
const pdfParse: (data: Uint8Array | Buffer) => Promise<{ text: string }> =
  require("pdf-parse/lib/pdf-parse.js");

function input(): BuildTicketDocumentInput {
  return {
    tenant: {
      name: "Bar Thalia",
      fiscalProfile: {
        legalName: "Thalia SL",
        taxId: "B12345678",
        address: "Calle Mayor 10, Madrid",
        phone: "+34 911 234 567",
      },
    },
    store: {
      name: "Bar Thalia Centro",
      fiscalAddress: { address: "Calle Mayor 10" },
    },
    register: { name: "Caja 1" },
    cashier: { email: "ana@thalia.es", name: "Ana" },
    ticket: {
      internalNumber: "000123",
      publicSlug: "slug0123456789ab",
      paidAt: new Date("2026-05-14T10:30:00Z"),
      createdAt: new Date("2026-05-14T10:30:00Z"),
      cashAmount: 10,
      total: 6.93,
      lines: [
        {
          nameSnapshot: "Cafe con leche",
          sku: "CAFE-1",
          units: 2,
          unitPrice: 1.5,
          discountPct: 0,
          taxRate: 10,
        },
        {
          nameSnapshot: "Cana",
          sku: "CANA-1",
          units: 1,
          unitPrice: 3,
          discountPct: 0,
          taxRate: 21,
        },
      ],
      payments: [{ method: "CASH", amount: 10 }],
    },
  };
}

const MM = 2.83464567;

describe("renderTicketPdf", () => {
  it("genera un PDF válido (magic number %PDF) con ancho 80mm", async () => {
    const doc = buildTicketDocument(input());
    const bytes = await renderTicketPdf(doc);
    expect(bytes).toBeInstanceOf(Uint8Array);
    const head = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
    expect(head).toBe("%PDF");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
    const page = loaded.getPage(0);
    expect(page.getWidth()).toBeCloseTo(80 * MM, 1);
    expect(page.getHeight()).toBeGreaterThan(80);
  });

  it("incrusta los strings clave del ticket en el contenido", async () => {
    const doc = buildTicketDocument(input());
    const bytes = await renderTicketPdf(doc);
    const parsed = await pdfParse(Buffer.from(bytes));
    expect(parsed.text).toContain("Thalia SL");
    expect(parsed.text).toContain("000123");
    expect(parsed.text).toContain("Caja 1");
    expect(parsed.text).toContain("TOTAL");
    expect(parsed.text).toContain("Cafe");
  });

  it("marca TICKET en venta y DEVOLUCIÓN en refund", async () => {
    const inp = input();
    const ticket = await renderTicketPdf(buildTicketDocument(inp));
    const txtTicket = (await pdfParse(Buffer.from(ticket))).text;
    expect(txtTicket).toMatch(/TICKET/);

    inp.refund = { originalTicketNumber: "000100", reason: "Cafe frio" };
    const refundBytes = await renderTicketPdf(buildTicketDocument(inp));
    const txtRefund = (await pdfParse(Buffer.from(refundBytes))).text;
    expect(txtRefund).toMatch(/DEVOLUCI/);
    expect(txtRefund).toContain("000100");
  });

  it("incrusta QR PNG cuando se pasa qrPngBytes", async () => {
    const doc = buildTicketDocument(input());
    // PNG mínimo 1x1 generado offline.
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );
    const bytes = await renderTicketPdf(doc, {
      qrPngBytes: new Uint8Array(tinyPng),
      qrCaption: "Escanea para tu ticket",
    });
    expect(bytes.length).toBeGreaterThan(0);
    const parsed = await pdfParse(Buffer.from(bytes));
    expect(parsed.text).toContain("Escanea");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPage(0).getHeight()).toBeGreaterThan(150);
  });

  it("crece la página verticalmente con más líneas", async () => {
    const single = await renderTicketPdf(buildTicketDocument(input()));
    const heavyInput = input();
    for (let i = 0; i < 20; i++) {
      heavyInput.ticket.lines.push({
        nameSnapshot: `Producto ${i}`,
        sku: `P-${i}`,
        units: 1,
        unitPrice: 1,
        discountPct: 0,
        taxRate: 10,
      });
    }
    heavyInput.ticket.total = 26.93;
    heavyInput.ticket.payments = [{ method: "CASH", amount: 27 }];
    const heavy = await renderTicketPdf(buildTicketDocument(heavyInput));
    const heightSingle = (await PDFDocument.load(single)).getPage(0).getHeight();
    const heightHeavy = (await PDFDocument.load(heavy)).getPage(0).getHeight();
    expect(heightHeavy).toBeGreaterThan(heightSingle + 100);
  });
});
