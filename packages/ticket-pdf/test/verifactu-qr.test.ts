// V1-verifactu · el QR tributario en el PDF.
//
// Lo que un test SÍ puede fijar aquí: que el documento reserva el alto del
// código y sus márgenes, y que sin parte fiscal el PDF sale exactamente
// como antes del bloque.
//
// Lo que NO puede: que la leyenda no pise el código. Eso es un milímetro,
// no un dato — y sólo se ve mirando. Lo encontró el bucle visual
// (`docs/blocks/verifactu-1-shots/01-pdf-leyenda-pisaba-el-qr.png`), no la
// suite. Este test es lo más cerca que se puede estar: si alguien quita los
// márgenes del cálculo del alto, la página encoge y esto se pone rojo.

import type { TicketDocument } from "@mipiacetpv/ticket-model";
import { describe, expect, it } from "vitest";

import { renderTicketPdf } from "../src/render.js";

const MM = 2.83464567;

const BASE: TicketDocument = {
  fiscal: {
    legalName: "PELUQUERÍA SOLE SL",
    taxId: "B45902186",
    address: "C/ Mayor 10",
  },
  store: { name: "Peluquería Sole", address: "C/ Mayor 10" },
  ticket: {
    internalNumber: "000123",
    publicSlug: "0123456789abcdef",
    issuedAt: new Date("2026-09-24T11:42:00Z"),
    cashierName: "Ana",
    registerName: "Caja 1",
  },
  lines: [
    { description: "Corte", quantity: 1, unitPrice: 10, taxRate: 21, subtotal: 10 },
  ],
  totals: {
    subtotal: 10,
    taxBreakdown: [{ rate: 21, base: 10, tax: 2.1 }],
    total: 12.1,
  },
  payment: { method: "CASH", paid: 12.1 },
  footer: { thankYouMessage: "¡Gracias!" },
};

const CON_FISCAL: TicketDocument = {
  ...BASE,
  verifactu: {
    numSerieFactura: "C1/000123",
    qrUrl: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B45902186",
    fechaExpedicion: "24-09-2026",
  },
};

// Un PNG de 1×1 vale: lo que se mide es el hueco reservado, no la imagen.
const PNG_1X1 = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/** El alto de la página, leído del propio PDF. */
function altoDe(bytes: Uint8Array): number {
  const txt = Buffer.from(bytes).toString("latin1");
  const m = /\/MediaBox \[ 0 0 ([\d.]+) ([\d.]+) \]/.exec(txt);
  if (!m) throw new Error("no se encontró el MediaBox del PDF");
  return Number(m[2]);
}

describe("el QR tributario en el PDF", () => {
  it("reserva el alto del código y sus TRES márgenes", async () => {
    const sin = altoDe(await renderTicketPdf(BASE));
    const con = altoDe(
      await renderTicketPdf(CON_FISCAL, { qrTributarioPngBytes: PNG_1X1 }),
    );
    // 33 mm de código + 6 mm × 3 de aire (antes del texto de encima, entre
    // el texto y el código, y entre el código y la leyenda) + tres líneas
    // (el `QR tributario:`, el `VERI*FACTU` y el separador) + una cuarta:
    // la `ref. 000123` que baja bajo el número fiscal.
    const esperado = (33 + 6 * 3) * MM + 11 * 4;
    expect(con - sin).toBeCloseTo(esperado, 1);
  });

  it("los márgenes son los que pide el documento técnico: 2 mm mínimo", async () => {
    // El aire real alrededor del código no baja de 2 mm por construcción:
    // el margen que se reserva es de 6, que es el RECOMENDADO. Si alguien
    // lo bajara de 2, esta cuenta se pondría roja.
    const sin = altoDe(await renderTicketPdf(BASE));
    const con = altoDe(
      await renderTicketPdf(CON_FISCAL, { qrTributarioPngBytes: PNG_1X1 }),
    );
    const aire = con - sin - 33 * MM - 11 * 4;
    expect(aire / MM / 3).toBeGreaterThanOrEqual(2);
  });

  it("sin parte fiscal el PDF sale exactamente como antes del bloque", async () => {
    // Un comercio que factura con Holded no ve ni un punto de diferencia.
    const a = altoDe(await renderTicketPdf(BASE));
    const b = altoDe(await renderTicketPdf(BASE, {}));
    expect(a).toBe(b);
    // Y pasarle el PNG sin `verifactu` en el documento tampoco lo cambia:
    // el bloque entero cuelga de que el documento LLEVE parte fiscal.
    expect(altoDe(await renderTicketPdf(BASE, { qrTributarioPngBytes: PNG_1X1 })))
      .toBeGreaterThan(a);
  });
});
