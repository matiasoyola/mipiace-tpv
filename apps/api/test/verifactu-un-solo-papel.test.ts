// V1-verifactu · UN SOLO papel.
//
// Decisión de Matías (24-09-2026): «no quiero dos constructores del ticket
// que un test compare, quiero uno solo». El constructor de bytes es
// `buildTicketReceipt`, en `@mipiacetpv/escpos-builder`, y lo llaman los
// dos lados: el servidor (`/escpos`, reimpresiones) y el dispositivo
// (impresión sin red).
//
// Lo que sigue habiendo dos veces es el MAPEO a su entrada, porque los dos
// lados parten de datos distintos: filas de Prisma allí, el carrito aquí.
// Este fichero es la red de seguridad contra que esos dos mapeos se
// separen: misma venta, mismos bytes, byte a byte.
//
// Se pone en rojo si se toca uno de los dos caminos. En el -done va
// saboteado para enseñarlo.

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.SUPER_ADMIN_JWT_SECRET = "s".repeat(48);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import {
  buildLocalTicketInput,
  buildTicketReceipt,
  type VentaLocal,
} from "@mipiacetpv/escpos-builder";
import type { TicketTotals, TicketVerifactu } from "@mipiacetpv/ticket-model";
import { describe, expect, it } from "vitest";

import {
  ticketToEscposInput,
  type TicketForPrint,
} from "../src/tickets/escpos-input.js";

const ISSUED_AT = new Date("2026-09-24T10:30:00Z");
const PUBLIC_BASE = "https://ticket.mipiace.es";
const SLUG = "0123456789abcdef";

const VERIFACTU: TicketVerifactu = {
  numSerieFactura: "C1/000123",
  fechaExpedicion: "24-09-2026",
  qrUrl:
    "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR" +
    "?nif=B45902186&numserie=C1%2F000123&fecha=24-09-2026&importe=15.50",
};

// El desglose que el servidor saca del `TicketDocument` y el dispositivo
// del carrito. Mismos números — es la misma venta.
const BUCKETS = [
  { rate: 21, base: 10, tax: 2.1 },
  { rate: 10, base: 3.09, tax: 0.31 },
];
const SUBTOTAL = 13.09;
const TOTAL = 15.5;

const TOTALS: TicketTotals = {
  subtotal: SUBTOTAL,
  taxBreakdown: BUCKETS,
  total: TOTAL,
};

const TICKET_SERVIDOR: TicketForPrint = {
  id: "66666666-6666-6666-6666-666666666666",
  registerId: "33333333-3333-3333-3333-333333333333",
  internalNumber: "000123",
  publicSlug: SLUG,
  total: { toString: () => "15.50" },
  cashAmount: { toString: () => "20.00" },
  notes: "Con bolsa",
  paidAt: ISSUED_AT,
  createdAt: ISSUED_AT,
  status: "PAID",
  creditPending: null,
  debtorName: null,
  table: { name: "Mesa 7" },
  user: { email: "ana@sole.es", alias: "Ana" },
  register: {
    name: "Caja 1",
    store: {
      name: "Peluquería Sole",
      fiscalAddress: { address: "C/ Mayor 10", city: "Talavera", postalCode: "45600" },
    },
  },
  tenant: {
    name: "PELUQUERÍA SOLE SL",
    receiptFooter: "Gracias por tu visita",
    fiscalProfile: {
      legalName: "PELUQUERÍA SOLE SL",
      taxId: "B45902186",
      address: { address: "C/ Mayor 10", city: "Talavera", postalCode: "45600" },
      phone: "925 000 000",
    },
  },
  lines: [
    {
      nameSnapshot: "Corte de pelo",
      units: { toString: () => "1" },
      unitPrice: { toString: () => "10.00" },
      unitPriceOverride: null,
      taxRate: { toString: () => "21" },
      total: { toString: () => "12.10" },
    },
    {
      nameSnapshot: "Champú",
      units: { toString: () => "1" },
      unitPrice: { toString: () => "3.09" },
      unitPriceOverride: null,
      taxRate: { toString: () => "10" },
      total: { toString: () => "3.40" },
    },
  ],
  payments: [{ method: "CASH", amount: { toString: () => "15.50" } }],
};

const VENTA_DISPOSITIVO: VentaLocal = {
  cabecera: {
    legalName: "PELUQUERÍA SOLE SL",
    taxId: "B45902186",
    address: "C/ Mayor 10, 45600 Talavera",
    phone: "925 000 000",
    businessName: "Peluquería Sole",
    businessAddress: "C/ Mayor 10, 45600 Talavera",
    registerName: "Caja 1",
    receiptFooter: "Gracias por tu visita",
  },
  cashierLabel: "Ana",
  tableName: "Mesa 7",
  issuedAt: ISSUED_AT,
  lines: [
    // bloque ticket-con-iva · el unitario del papel va CON IVA. El
    // servidor lo deriva del neto persistido y del `taxRate` de la línea;
    // el dispositivo, del carrito (`unitPriceGrossOf`). Que los dos den lo
    // mismo es parte de lo que guarda este test: 10,00 € al 21 % son
    // 12,10 € y 3,09 € al 10 % son 3,40 €.
    { description: "Corte de pelo", units: 1, unitPriceGross: 12.1, lineTotal: 12.1 },
    { description: "Champú", units: 1, unitPriceGross: 3.4, lineTotal: 3.4 },
  ],
  payments: [{ method: "CASH", amount: 15.5 }],
  cashAmount: 20,
  buckets: BUCKETS,
  subtotal: SUBTOTAL,
  total: TOTAL,
  notes: "Con bolsa",
  internalNumber: "000123",
  publicTicketUrl: `${PUBLIC_BASE}/tickets/${SLUG}/pdf`,
  verifactu: {
    numSerieFactura: VERIFACTU.numSerieFactura,
    qrUrl: VERIFACTU.qrUrl,
  },
};

function bytesServidor(): Uint8Array {
  return buildTicketReceipt(
    ticketToEscposInput(TICKET_SERVIDOR, PUBLIC_BASE, TOTALS, false, VERIFACTU),
  );
}

function bytesDispositivo(): Uint8Array {
  return buildTicketReceipt(buildLocalTicketInput(VENTA_DISPOSITIVO));
}

describe("el mismo papel por los dos caminos", () => {
  it("SABOTAJE · los bytes son IDÉNTICOS, byte a byte", () => {
    const servidor = bytesServidor();
    const dispositivo = bytesDispositivo();
    expect(dispositivo.length).toBe(servidor.length);
    expect(Buffer.from(dispositivo).equals(Buffer.from(servidor))).toBe(true);
  });

  it("las dos entradas son el mismo objeto de entrada", () => {
    // Comparar las entradas además de los bytes da un diff legible cuando
    // algo se separa: con sólo los bytes, el fallo es «5342 ≠ 5337».
    expect(buildLocalTicketInput(VENTA_DISPOSITIVO)).toEqual(
      ticketToEscposInput(
        TICKET_SERVIDOR,
        PUBLIC_BASE,
        TOTALS,
        false,
        VERIFACTU,
      ),
    );
  });
});

// bloque ticket-con-iva · el agujero que este invariante no veía.
//
// `TicketLine.unitPrice` es el precio BASE y los deltas de los
// modificadores viven en el snapshot `modifiers` (B-Bar-Modifiers). El
// dispositivo arma su unitario del carrito, con los deltas dentro; el
// servidor lo armaba del `unitPrice` persistido, sin ellos. Mientras los
// dos imprimían NETO el fallo era de un dígito perdido entre dos columnas
// que no cuadraban de todas formas; con el unitario en bruto es un café
// con leche con avena anunciado a 1,60 € y cobrado a 2,10 €.
//
// La fixture de arriba no lleva modificadores, así que el byte-a-byte no
// lo cogía. Ésta sí.
describe("un modificador con precio también va en el unitario", () => {
  const CON_AVENA: TicketForPrint = {
    ...TICKET_SERVIDOR,
    total: { toString: () => "3.70" },
    cashAmount: null,
    notes: null,
    lines: [
      {
        nameSnapshot: "Cafe con leche",
        units: { toString: () => "1" },
        unitPrice: { toString: () => "1.4545" },
        unitPriceOverride: null,
        taxRate: { toString: () => "10" },
        // +0,50 € de leche de avena, en céntimos y por unidad.
        modifiers: [
          {
            groupId: "g1",
            groupName: "Leche",
            modifierId: "m1",
            label: "De avena",
            priceDeltaCents: 50,
          },
        ],
        total: { toString: () => "2.20" },
      },
      {
        nameSnapshot: "Tostada",
        units: { toString: () => "1" },
        unitPrice: { toString: () => "1.3636" },
        unitPriceOverride: null,
        taxRate: { toString: () => "10" },
        total: { toString: () => "1.50" },
      },
    ],
    payments: [{ method: "CASH", amount: { toString: () => "3.70" } }],
  };

  it("SABOTAJE · el unitario del servidor lleva el delta, como el del carrito", () => {
    const input = ticketToEscposInput(CON_AVENA, PUBLIC_BASE, null, false, null);
    // 1,4545 + 0,50 = 1,9545 netos; al 10 %, 2,15 €. Y la línea se cobró a
    // 2,20 €... que es lo que `computeTicket` saca de 1,9545 × 1,1 = 2,14995
    // → 2,15. La fixture dice 2,20 a propósito: así el test también mira que
    // el bruto de LÍNEA sigue siendo el persistido y no uno derivado aquí.
    expect(input.lines[0]!.unitPriceGross).toBe(2.15);
    expect(input.lines[0]!.lineTotal).toBe(2.2);
    // La segunda línea no tiene modificadores y no cambia.
    expect(input.lines[1]!.unitPriceGross).toBe(1.5);
  });

  it("y el papel lo imprime", () => {
    const t = Buffer.from(
      buildTicketReceipt(
        ticketToEscposInput(CON_AVENA, PUBLIC_BASE, null, false, null),
      ),
    )
      .toString("latin1")
      .replace(/[\x00-\x09\x0b-\x1f]/g, " ");
    expect(t).toContain("1 x 2,15");
    expect(t).not.toContain("1 x 1,60");
  });
});

describe("lo que el papel dice cuando la factura es propia", () => {
  const texto = () =>
    Buffer.from(bytesDispositivo())
      .toString("latin1")
      // Los comandos ESC/POS son bytes de control; nos quedamos con lo
      // imprimible para poder buscar frases.
      .replace(/[\x00-\x09\x0b-\x1f]/g, " ");

  it("lleva el QR tributario ANTES de la cabecera del comercio", () => {
    const t = texto();
    const iQr = t.indexOf("QR tributario:");
    // Sin la Í: el texto va codificado en PC850 y el acento no es latin-1.
    const iRazon = t.indexOf("PELUQUER");
    expect(iQr).toBeGreaterThanOrEqual(0);
    expect(iRazon).toBeGreaterThanOrEqual(0);
    expect(iQr).toBeLessThan(iRazon);
  });

  it("lleva la leyenda VERI*FACTU justo debajo del QR", () => {
    const t = texto();
    expect(t).toContain("VERI*FACTU");
    expect(t.indexOf("QR tributario:")).toBeLessThan(t.indexOf("VERI*FACTU"));
  });

  it("el QR lleva la URL de cotejo con sus cuatro parámetros", () => {
    const t = texto();
    expect(t).toContain("nif=B45902186");
    expect(t).toContain("numserie=C1%2F000123");
    expect(t).toContain("fecha=24-09-2026");
    expect(t).toContain("importe=15.50");
  });

  it("el QR tributario va a nivel M de corrección de errores", () => {
    // GS ( k 03 00 31 45 <nivel>, con 0x31 = M (art. 21.1 de la Orden).
    // 0x30 sería L, que es lo que imprimía antes de este bloque.
    const bytes = bytesDispositivo();
    const i = Buffer.from(bytes).indexOf(
      Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45]),
    );
    expect(i).toBeGreaterThanOrEqual(0);
    expect(bytes[i + 7]).toBe(0x31);
  });

  it("el número que manda es el FISCAL, con el interno como referencia", () => {
    const t = texto();
    expect(t).toContain("Factura C1/000123");
    expect(t).toContain("(ref. 000123)");
  });

  it("imprime el desglose de IVA, que el art. 7.1.f no deja opcional", () => {
    const t = texto();
    expect(t).toContain("IVA 21%");
    expect(t).toContain("IVA 10%");
    expect(t).toContain("Subtotal");
  });
});

describe("un comercio con Holded imprime lo de siempre", () => {
  it("sin parte fiscal no hay QR tributario ni leyenda", () => {
    const bytes = buildTicketReceipt(
      ticketToEscposInput(TICKET_SERVIDOR, PUBLIC_BASE, TOTALS, false, null),
    );
    const t = Buffer.from(bytes).toString("latin1");
    expect(t).not.toContain("QR tributario:");
    expect(t).not.toContain("VERI*FACTU");
    // Y el número sigue siendo el interno, tal cual.
    expect(t).toContain("000123");
    expect(t).not.toContain("Factura C1/");
  });
});
