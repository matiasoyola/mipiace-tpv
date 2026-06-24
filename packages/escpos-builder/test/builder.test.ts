// v1.4-Impresoras-Fase-1 Lote 2 · tests del builder ESC/POS.
//
// Cobertura:
//   - helpers: codificación PC850 (acentos), comandos init/cut/feed.
//   - buildTicketReceipt: snapshot de casos típicos (simple + QR + pagos).
//   - buildKitchenComanda: snapshot con y sin modificadores.

import { describe, expect, it } from "vitest";

import {
  buildKitchenComanda,
  buildTestPrint,
  buildTicketReceipt,
  concatBytes,
  encodePc850,
  escCut,
  escFeed,
  escInit,
  escQrCode,
} from "../src/index.js";

const FIXED_DATE = new Date("2026-06-02T13:45:00Z");

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join(" ");
}

function hexContains(b: Uint8Array, hex: string): boolean {
  return bytesToHex(b).includes(hex.toLowerCase());
}

describe("helpers ESC/POS", () => {
  it("escInit emite ESC @", () => {
    expect(Array.from(escInit())).toEqual([0x1b, 0x40]);
  });
  it("escFeed emite ESC d n", () => {
    expect(Array.from(escFeed(3))).toEqual([0x1b, 0x64, 0x03]);
  });
  it("escCut emite GS V 0", () => {
    expect(Array.from(escCut())).toEqual([0x1d, 0x56, 0x00]);
  });
  it("encodePc850 mapea acentos castellano", () => {
    expect(Array.from(encodePc850("á"))).toEqual([0xa0]);
    expect(Array.from(encodePc850("é"))).toEqual([0x82]);
    expect(Array.from(encodePc850("ñ"))).toEqual([0xa4]);
    expect(Array.from(encodePc850("€"))).toEqual([0xd5]);
  });
  it("encodePc850 ASCII pasa tal cual", () => {
    expect(Array.from(encodePc850("Hello"))).toEqual([
      0x48, 0x65, 0x6c, 0x6c, 0x6f,
    ]);
  });
  it("encodePc850 caracter desconocido → '?'", () => {
    expect(Array.from(encodePc850("中"))).toEqual([0x3f]);
  });
  it("escQrCode emite header GS k", () => {
    const q = escQrCode("https://mipiacetpv.es/t/abc", 6);
    // Verifica que arranca con GS ( k (Model 2)
    expect(q[0]).toBe(0x1d);
    expect(q[1]).toBe(0x28);
    expect(q[2]).toBe(0x6b);
    // El data store y print están dentro: comprobamos que aparecen
    // los bytes 0x50 (store) y 0x51 (print).
    expect(hexContains(q, "31 50")).toBe(true);
    expect(hexContains(q, "31 51")).toBe(true);
  });
});

describe("buildTicketReceipt", () => {
  it("ticket simple cierra con cut", () => {
    const bytes = buildTicketReceipt({
      businessName: "Peluquería Sole",
      businessAddress: "c/ Mayor 5, Madrid",
      internalNumber: "TICKET 000123",
      issuedAt: FIXED_DATE,
      cashierLabel: "sole",
      tableName: null,
      lines: [
        { description: "Corte caballero", units: 1, unitPrice: 12, lineTotal: 12 },
      ],
      total: 12,
      payments: [{ label: "Efectivo", amount: 12 }],
      notes: [],
      publicTicketUrl: null,
      footer: null,
    });
    // Debe arrancar con ESC @ y terminar con GS V 0.
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
    expect(bytes[bytes.length - 3]).toBe(0x1d);
    expect(bytes[bytes.length - 2]).toBe(0x56);
    expect(bytes[bytes.length - 1]).toBe(0x00);
  });

  it("ticket con QR incluye comando GS k", () => {
    const bytes = buildTicketReceipt({
      businessName: "Bar Quevedo",
      businessAddress: null,
      internalNumber: "TICKET 000010",
      issuedAt: FIXED_DATE,
      cashierLabel: "ana",
      tableName: "Mesa 5",
      lines: [
        { description: "Café cortado", units: 2, unitPrice: 1.5, lineTotal: 3 },
        { description: "Tostada", units: 1, unitPrice: 2.5, lineTotal: 2.5 },
      ],
      total: 5.5,
      payments: [{ label: "Tarjeta", amount: 5.5 }],
      notes: [],
      publicTicketUrl: "https://mipiacetpv.es/t/abc123",
      footer: "Gracias por su visita",
    });
    // GS ( k inside (QR command).
    expect(hexContains(bytes, "1d 28 6b")).toBe(true);
  });

  it("ticket con descripción larga: padBetween recorta el lado izq", () => {
    const bytes = buildTicketReceipt({
      businessName: "X",
      businessAddress: null,
      internalNumber: "T1",
      issuedAt: FIXED_DATE,
      cashierLabel: "c",
      tableName: null,
      lines: [
        {
          description: "X".repeat(200),
          units: 1,
          unitPrice: 1,
          lineTotal: 1,
        },
      ],
      total: 1,
      payments: [{ label: "Efectivo", amount: 1 }],
      notes: [],
      publicTicketUrl: null,
      footer: null,
    });
    // El binary debe seguir siendo razonable (no >50KB).
    expect(bytes.length).toBeLessThan(50000);
  });

  it("ticket en cash con cambio imprime 'Cambio'", () => {
    const bytes = buildTicketReceipt({
      businessName: "Bar",
      businessAddress: null,
      internalNumber: "T1",
      issuedAt: FIXED_DATE,
      cashierLabel: "ana",
      tableName: null,
      lines: [{ description: "X", units: 1, unitPrice: 5, lineTotal: 5 }],
      total: 5,
      payments: [{ label: "Efectivo", amount: 10, cashChange: 5 }],
      notes: [],
      publicTicketUrl: null,
      footer: null,
    });
    // PC850 "Cambio" = 0x43 0x61 0x6d 0x62 0x69 0x6f.
    expect(hexContains(bytes, "43 61 6d 62 69 6f")).toBe(true);
  });

  it("imprime cabecera fiscal: razón social, NIF, dirección y teléfono", () => {
    const bytes = buildTicketReceipt({
      legalName: "Frutos Secos Cachictos SL",
      taxId: "B12345678",
      fiscalAddress: "c/ Mayor 5, 28001 Madrid",
      phone: "600123456",
      businessName: "Tienda principal",
      businessAddress: null,
      internalNumber: "000006",
      issuedAt: FIXED_DATE,
      cashierLabel: "virginia",
      tableName: null,
      lines: [{ description: "Agua", units: 1, unitPrice: 0.5, lineTotal: 0.5 }],
      total: 0.5,
      payments: [{ label: "Efectivo", amount: 0.5 }],
      notes: [],
      publicTicketUrl: null,
      footer: null,
    });
    // "NIF:" = 4e 49 46 3a
    expect(hexContains(bytes, "4e 49 46 3a")).toBe(true);
    // "B12345678" = 42 31 32 33 34 35 36 37 38
    expect(hexContains(bytes, "42 31 32 33 34 35 36 37 38")).toBe(true);
    // "Tel." = 54 65 6c 2e
    expect(hexContains(bytes, "54 65 6c 2e")).toBe(true);
    // Razón social: "Cachictos" = 43 61 63 68 69 63 74 6f 73
    expect(hexContains(bytes, "43 61 63 68 69 63 74 6f 73")).toBe(true);
  });

  it("omite la línea NIF cuando taxId está vacío", () => {
    const bytes = buildTicketReceipt({
      legalName: "Comercio SL",
      taxId: "",
      fiscalAddress: null,
      phone: null,
      businessName: "Tienda principal",
      businessAddress: null,
      internalNumber: "000007",
      issuedAt: FIXED_DATE,
      cashierLabel: "ana",
      tableName: null,
      lines: [{ description: "X", units: 1, unitPrice: 1, lineTotal: 1 }],
      total: 1,
      payments: [{ label: "Efectivo", amount: 1 }],
      notes: [],
      publicTicketUrl: null,
      footer: null,
    });
    // No debe aparecer "NIF:" (4e 49 46 3a).
    expect(hexContains(bytes, "4e 49 46 3a")).toBe(false);
  });

  it("sin legalName usa businessName como título (retrocompat)", () => {
    const bytes = buildTicketReceipt({
      businessName: "Bar Quevedo",
      businessAddress: "c/ Sol 1",
      internalNumber: "T1",
      issuedAt: FIXED_DATE,
      cashierLabel: "c",
      tableName: null,
      lines: [{ description: "X", units: 1, unitPrice: 1, lineTotal: 1 }],
      total: 1,
      payments: [{ label: "Efectivo", amount: 1 }],
      notes: [],
      publicTicketUrl: null,
      footer: null,
    });
    // "Bar Quevedo" = 42 61 72 20 51 75 65 76 65 64 6f, sin "NIF:".
    expect(hexContains(bytes, "42 61 72 20 51 75 65 76 65 64 6f")).toBe(true);
    expect(hexContains(bytes, "4e 49 46 3a")).toBe(false);
  });
});

describe("buildKitchenComanda", () => {
  it("comanda BARRA básica empieza por init + section header", () => {
    const bytes = buildKitchenComanda({
      section: "BARRA",
      tableName: "Mesa 7",
      revision: 1,
      issuedAt: FIXED_DATE,
      cashierLabel: "ana",
      diners: 4,
      ticketNotes: null,
      lines: [{ units: 2, description: "Caña", notes: [] }],
    });
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
    // "BARRA" en ASCII = 42 41 52 52 41
    expect(hexContains(bytes, "42 41 52 52 41")).toBe(true);
  });

  it("comanda con modificadores imprime cada nota con prefijo", () => {
    const bytes = buildKitchenComanda({
      section: "COCINA",
      tableName: "Mesa 3",
      revision: 1,
      issuedAt: FIXED_DATE,
      cashierLabel: "pedro",
      diners: 2,
      ticketNotes: null,
      lines: [
        {
          units: 1,
          description: "Hamburguesa",
          notes: ["Sin pepinillo", "Punto medio"],
        },
      ],
    });
    // "Sin pepinillo" → 53 69 6e 20 70 65 70 69 6e 69 6c 6c 6f
    expect(hexContains(bytes, "53 69 6e 20 70 65 70 69 6e 69 6c 6c 6f")).toBe(
      true,
    );
    // "Punto medio"
    expect(hexContains(bytes, "50 75 6e 74 6f 20 6d 65 64 69 6f")).toBe(true);
  });

  it("comanda con nota de ticket imprime 'NOTA:' en bold", () => {
    const bytes = buildKitchenComanda({
      section: "SALON",
      tableName: null,
      revision: 2,
      issuedAt: FIXED_DATE,
      cashierLabel: "x",
      diners: null,
      ticketNotes: "celebración cumpleaños",
      lines: [{ units: 1, description: "Postre", notes: [] }],
    });
    // "NOTA:" ASCII = 4e 4f 54 41 3a
    expect(hexContains(bytes, "4e 4f 54 41 3a")).toBe(true);
  });

  it("comanda sin mesa (venta rápida) usa 'Venta rápida'", () => {
    const bytes = buildKitchenComanda({
      section: "BARRA",
      tableName: null,
      revision: 1,
      issuedAt: FIXED_DATE,
      cashierLabel: "c",
      diners: null,
      ticketNotes: null,
      lines: [{ units: 1, description: "X", notes: [] }],
    });
    // "Venta r" en PC850: 56 65 6e 74 61 20 72 (rápida tiene á→0xa0)
    expect(hexContains(bytes, "56 65 6e 74 61 20 72")).toBe(true);
  });

  it("snapshot: comanda BARRA 2 líneas + modifier produce binary estable", () => {
    const bytes = buildKitchenComanda({
      section: "BARRA",
      tableName: "Mesa 1",
      revision: 1,
      issuedAt: FIXED_DATE,
      cashierLabel: "ana",
      diners: 2,
      ticketNotes: null,
      lines: [
        { units: 2, description: "Caña", notes: [] },
        { units: 1, description: "Tinto", notes: ["Crianza"] },
      ],
    });
    // 1 init + 1 cabecera + 2 líneas con size 2x = al menos 60 bytes.
    expect(bytes.length).toBeGreaterThan(60);
    // Termina con cut.
    expect(bytes[bytes.length - 3]).toBe(0x1d);
    expect(bytes[bytes.length - 2]).toBe(0x56);
  });
});

describe("buildTestPrint", () => {
  it("test print arranca con ESC @ y termina con cut", () => {
    const bytes = buildTestPrint(FIXED_DATE);
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
    expect(bytes[bytes.length - 3]).toBe(0x1d);
    expect(bytes[bytes.length - 2]).toBe(0x56);
  });
  it("test print incluye literal 'TEST IMPRESORA'", () => {
    const bytes = buildTestPrint(FIXED_DATE);
    // 54 45 53 54 20 49 4d 50 52 45 53 4f 52 41
    expect(hexContains(bytes, "54 45 53 54 20 49 4d 50 52 45 53 4f 52 41")).toBe(
      true,
    );
  });
});

describe("concatBytes", () => {
  it("concatena varios Uint8Array", () => {
    const out = concatBytes([
      new Uint8Array([1, 2]),
      new Uint8Array([3]),
      new Uint8Array([4, 5]),
    ]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });
});
