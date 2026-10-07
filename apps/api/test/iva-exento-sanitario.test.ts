// bloque iva-exento-sanitario · la cadena entera y los sabotajes.
//
// Vive en `apps/api/test` por lo mismo que `ticket-con-iva.test.ts`: es el
// único sitio del repo desde el que se recorre la venta COMPLETA con las
// funciones de verdad y sin mockear nada —
//
//   validateLocalProduct     (la ficha del catálogo)
//     → computeTicket        (el cobro)
//     → buildTicketDocument  (el documento, con el tramo exento)
//     → cuadrarDesglose      (la base única)
//     → buildRegistroAlta    (el registro VERI*FACTU con OperacionExenta)
//     → buildTicketReceipt   (el papel térmico)
//     → renderTicketPdf      (el ticket digital / email)
//
// Los dos tickets del mockup validado el 07-10 son los dos casos de
// cabecera: «Sólo sesión» (35,00 € exentos) y «Sesión + crema» (35,00 €
// exentos + 12,00 € al 21 %).

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";

import { buildTicketReceipt } from "@mipiacetpv/escpos-builder";
import {
  buildTicketDocument,
  type BuildTicketLineInput,
  type CausaExencion,
  cuadrarDesglose,
  grossToNet,
  esCausaExencion as esCausaExencionExportada,
  leyendaExencion,
  PRESENTACION,
  round2,
  type TicketDocument,
} from "@mipiacetpv/ticket-model";
import {
  buildRegistroAlta,
  type BucketDesglose,
  type DetalleDesglose,
} from "@mipiacetpv/verifactu";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  type LocalProductInput,
  validateLocalProduct,
} from "../src/catalog/local-product-rules.js";
import {
  ticketToEscposInput,
  type TicketForPrint,
} from "../src/tickets/escpos-input.js";
import { computeTicket, type TicketLineInput } from "../src/tickets/totals.js";

const E1: CausaExencion = "E1";
const ISSUED_AT = new Date("2026-10-07T08:42:00Z");

// ── El catálogo de Rosario ─────────────────────────────────────────────

/** Una ficha del catálogo, dada de alta por el camino de verdad: el mismo
 *  `validateLocalProduct` que usan `POST /catalog/products` y la carga de
 *  fichero del super-admin. De aquí sale el NETO de cuatro decimales que
 *  se persiste en `products.base_price`. */
function alta(input: LocalProductInput) {
  const r = validateLocalProduct(input);
  if (!r.ok) throw new Error(`${r.field}: ${r.message}`);
  return r.fields;
}

const QUIROPODIA = alta({
  name: "Quiropodia",
  sku: "LOC-QUIRO",
  priceGross: 35,
  taxRate: 0,
  exemptionCause: E1,
  kind: "SERVICE",
});

const CREMA = alta({
  name: "Crema urea 20%",
  sku: "LOC-CREMA",
  priceGross: 12,
  taxRate: 21,
});

// ── La venta, de punta a punta ─────────────────────────────────────────

interface LineaDeVenta {
  nombre: string;
  /** Precio que paga el paciente. Con exento ES el precio; con IVA es el
   *  de la etiqueta. */
  precio: number;
  units: number;
  taxRate: number;
  exemptionCause?: CausaExencion | null;
  discountPct?: number;
}

const quiropodia = (units = 1): LineaDeVenta => ({
  nombre: QUIROPODIA.name,
  precio: 35,
  units,
  taxRate: QUIROPODIA.taxRate,
  exemptionCause: QUIROPODIA.exemptionCause,
});

const crema = (): LineaDeVenta => ({
  nombre: CREMA.name,
  precio: 12,
  units: 1,
  taxRate: CREMA.taxRate,
});

interface VentaCobrada {
  lineas: LineaDeVenta[];
  persistido: {
    total: number;
    lines: Array<{
      nameSnapshot: string;
      units: number;
      unitPriceNeto: number;
      discountPct: number;
      taxRate: number;
      exemptionCause: CausaExencion | null;
      subtotal: number;
      total: number;
    }>;
  };
  doc: TicketDocument;
}

/** Cobra igual que `POST /tickets`: el precio que paga el paciente entra
 *  en neto de cuatro decimales (`grossToNet`, el mismo camino que el alta
 *  del catálogo) y `computeTicket` agrega POR TRAMO (tasa, causa). */
function cobrar(lineas: LineaDeVenta[]): VentaCobrada {
  const entrada: TicketLineInput[] = lineas.map((l) => ({
    units: l.units,
    unitPrice: grossToNet(l.precio, l.taxRate),
    discountPct: l.discountPct ?? 0,
    taxRate: l.taxRate,
    exemptionCause: l.exemptionCause ?? null,
  }));
  const totals = computeTicket(entrada);
  const lines = lineas.map((l, i) => ({
    nameSnapshot: l.nombre,
    units: l.units,
    unitPriceNeto: entrada[i]!.unitPrice,
    discountPct: entrada[i]!.discountPct,
    taxRate: l.taxRate,
    exemptionCause: l.exemptionCause ?? null,
    subtotal: totals.lines[i]!.subtotal,
    total: totals.lines[i]!.total,
  }));
  const docLines: BuildTicketLineInput[] = lines.map((l) => ({
    nameSnapshot: l.nameSnapshot,
    units: l.units,
    unitPrice: l.unitPriceNeto,
    discountPct: l.discountPct,
    taxRate: l.taxRate,
    exemptionCause: l.exemptionCause,
    subtotal: l.subtotal,
    total: l.total,
  }));
  const doc = buildTicketDocument({
    tenant: {
      name: "PODOLOGIA ROSARIO",
      fiscalProfile: {
        legalName: "PODOLOGÍA ROSARIO",
        taxId: "00000000T",
        address: "C/ Ejemplo 1, 45600 Talavera de la Reina",
      },
      businessType: "SERVICES",
    },
    store: {
      name: "Podología Rosario",
      fiscalAddress: { address: "C/ Ejemplo 1" },
    },
    register: { name: "Caja 1" },
    cashier: { email: "rosario@podologia.es", name: "Rosario" },
    ticket: {
      internalNumber: "000042",
      publicSlug: "0123456789abcdef",
      paidAt: ISSUED_AT,
      createdAt: ISSUED_AT,
      total: totals.total,
      lines: docLines,
      payments: [{ method: "CARD", amount: totals.total }],
    },
  });
  return { lineas, persistido: { total: totals.total, lines }, doc };
}

/** El registro de ALTA de esta venta, por el camino del dispositivo
 *  (`generarRegistroDeVenta` arma estos mismos `desglose` y `cuotaTotal`
 *  desde el MISMO `cuadrarDesglose` que imprime el papel). */
async function registro(venta: VentaCobrada) {
  const cuadrado = cuadrarDesglose({
    subtotal: venta.doc.totals.subtotal,
    buckets: venta.doc.totals.taxBreakdown,
    total: venta.persistido.total,
  });
  const desglose: BucketDesglose[] = cuadrado.buckets.map((b) => ({
    tipoImpositivo: b.rate,
    baseImponible: b.base,
    cuotaRepercutida: b.tax,
    ...(b.exemptionCause ? { causaExencion: b.exemptionCause } : {}),
  }));
  return buildRegistroAlta({
    version: "1.0.0-test",
    numeroInstalacion: "CAJA-1",
    idEmisorFactura: "00000000T",
    nombreRazonEmisor: "PODOLOGÍA ROSARIO",
    numSerieFactura: "C1/000042",
    fechaExpedicion: "2026-10-07",
    descripcionOperacion: "Prestación de servicios",
    desglose,
    cuotaTotal: cuadrado.cuotaTotal,
    importeTotal: venta.persistido.total,
    cabeza: null,
    fechaHoraHusoGenRegistro: "2026-10-07T10:42:00+02:00",
  });
}

/** El papel térmico, por el camino del servidor (el mismo que reimprime
 *  el histórico). */
function papel(venta: VentaCobrada): string {
  const ticket: TicketForPrint = {
    id: "66666666-6666-6666-6666-666666666666",
    registerId: "33333333-3333-3333-3333-333333333333",
    internalNumber: "000042",
    publicSlug: "0123456789abcdef",
    total: { toString: () => venta.persistido.total.toFixed(2) },
    cashAmount: null,
    notes: null,
    paidAt: ISSUED_AT,
    createdAt: ISSUED_AT,
    status: "PAID",
    creditPending: null,
    debtorName: null,
    table: null,
    user: { email: "rosario@podologia.es", alias: "Rosario" },
    register: {
      name: "Caja 1",
      store: {
        name: "Podología Rosario",
        fiscalAddress: { address: "C/ Ejemplo 1" },
      },
    },
    tenant: {
      name: "PODOLOGIA ROSARIO",
      receiptFooter: null,
      fiscalProfile: {
        legalName: "PODOLOGÍA ROSARIO",
        taxId: "00000000T",
        address: "C/ Ejemplo 1",
      },
    },
    lines: venta.persistido.lines.map((l) => ({
      nameSnapshot: l.nameSnapshot,
      units: { toString: () => String(l.units) },
      unitPrice: { toString: () => String(l.unitPriceNeto) },
      unitPriceOverride: null,
      taxRate: { toString: () => String(l.taxRate) },
      exemptionCause: l.exemptionCause,
      total: { toString: () => l.total.toFixed(2) },
    })),
    payments: [
      {
        method: "CARD",
        amount: { toString: () => venta.persistido.total.toFixed(2) },
      },
    ],
  };
  const bytes = buildTicketReceipt(
    ticketToEscposInput(ticket, "https://ticket.mipiace.es", venta.doc.totals, false, {
      numSerieFactura: "C1/000042",
      qrUrl: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=00000000T",
      fechaExpedicion: "07-10-2026",
    }),
  );
  return descifrarPapel(bytes);
}

// La TABLA INVERSA de `encodePc850` (`packages/escpos-builder/src/helpers.ts`).
//
// `ticket-con-iva.test.ts` sólo deshacía el «€» porque sus asserts eran de
// importes. Aquí los asserts son de TEXTO LEGAL —«Operación exenta de IVA
// / art. 20.Uno.3º Ley 37/1992»— y en PC850 eso sale como «Operaci¢n» y
// «20.Uno.3§». Un test que buscara la versión sin acentos pasaría también
// con un papel que imprimiera «?» donde van las tildes, que es lo que
// `encodePc850` hace con un carácter fuera de tabla.
const PC850_INVERSA: Record<number, string> = {
  0xa0: "á",
  0x82: "é",
  0xa1: "í",
  0xa2: "ó",
  0xa3: "ú",
  0xb5: "Á",
  0x90: "É",
  0xd6: "Í",
  0xe0: "Ó",
  0xe9: "Ú",
  0xa4: "ñ",
  0xa5: "Ñ",
  0x81: "ü",
  0x9a: "Ü",
  0x87: "ç",
  0x80: "Ç",
  0xa8: "¿",
  0xad: "¡",
  0xd5: "€",
  0xfa: "·",
  0xa6: "ª",
  0xa7: "º",
};

/** El texto imprimible del papel, por renglones. Los comandos ESC/POS son
 *  bytes de control (se vuelven espacios, menos el salto de línea, que es
 *  el que separa renglones) y los acentos se devuelven de PC850.
 *
 *  Ojo al leer los asserts: los ARGUMENTOS de los comandos sí son bytes
 *  imprimibles (ESC ! 1 deja un "!" y un "1" sueltos), así que un renglón
 *  en negrita arrastra basura por delante. Los renglones se buscan por su
 *  final, que es donde está el importe. */
function descifrarPapel(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    if (b === 0x0a) out += "\n";
    else if (b < 0x20) out += " ";
    else if (b < 0x80) out += String.fromCharCode(b);
    else out += PC850_INVERSA[b] ?? "?";
  }
  return out;
}

function renglon(txt: string, etiqueta: string): string | null {
  const l = txt
    .split("\n")
    .map((x) => x.trimEnd())
    .find((x) => x.trimStart().startsWith(etiqueta));
  return l ?? null;
}

// ═══ 1 · El ticket «Sólo sesión» del mockup ════════════════════════════

describe("iva-exento-sanitario · sólo sesión (35,00 € exentos)", () => {
  const venta = cobrar([quiropodia()]);

  it("el total es el precio: con exento no hay IVA que sumar", () => {
    expect(venta.persistido.total).toBe(35);
    // Y el neto persistido es el mismo número, no un neto de cuatro
    // decimales: `grossToNet(35, 0)` divide por 1.
    expect(venta.persistido.lines[0]!.unitPriceNeto).toBe(35);
  });

  it("hay UN tramo y es exento, con su causa", () => {
    expect(venta.doc.totals.taxBreakdown).toEqual([
      { rate: 0, base: 35, tax: 0, exemptionCause: "E1" },
    ]);
  });

  it("la base única se mantiene: subtotal === Σ bases === total", () => {
    const c = cuadrarDesglose({
      subtotal: venta.doc.totals.subtotal,
      buckets: venta.doc.totals.taxBreakdown,
      total: venta.persistido.total,
    });
    expect(c.subtotal).toBe(35);
    expect(round2(c.buckets.reduce((a, b) => a + b.base, 0))).toBe(c.subtotal);
    expect(round2(c.subtotal + c.cuotaTotal)).toBe(35);
    expect(c.cuotaTotal).toBe(0);
  });

  it("el papel dice «Exento 35,00 €» y «IVA 0,00 €», y NO «Subtotal»", () => {
    const txt = papel(venta);
    expect(renglon(txt, "Exento")).toMatch(/Exento\s+35,00 €$/);
    expect(renglon(txt, "IVA")).toMatch(/^IVA\s+0,00 €$/);
    // Ni «Subtotal» ni «IVA 0% s/35,00»: no hay base imponible que
    // imprimir en una operación exenta, y un «IVA 0 %» con tipo sería el
    // 0 % sujeto, que es otra operación.
    expect(txt).not.toContain("Subtotal");
    expect(txt).not.toContain("s/35,00");
  });

  it("y lleva la leyenda del precepto, en recuadro", () => {
    const txt = papel(venta);
    expect(txt).toContain("Operación exenta de IVA");
    expect(txt).toContain("art. 20.Uno.3º Ley 37/1992");
    // Sin nombre delante: la factura ENTERA está exenta, así que no hace
    // falta decir qué lo está.
    expect(txt).not.toContain("Quiropodia: operación exenta");
    // El recuadro, que es lo que pide el mockup.
    expect(txt).toMatch(/\*{42}/);
  });

  it("el registro declara OperacionExenta E1 y NADA más de la forma sujeta", async () => {
    const { registro: r } = await registro(venta);
    const detalle = r.Desglose.DetalleDesglose;
    expect(detalle).toHaveLength(1);
    const d = detalle[0]!;
    expect(d).toEqual({
      Impuesto: "01",
      ClaveRegimen: "01",
      OperacionExenta: "E1",
      BaseImponibleOimporteNoSujeto: "35.00",
    });
    // Las claves AUSENTES, no a `undefined`: lo que se guarda en
    // `fiscal_records.payload` es lo que V2 serializará a XML sin volver a
    // tocarlo. Validaciones §15.5 y el `<choice>` del XSD.
    expect(Object.keys(d).sort()).toEqual([
      "BaseImponibleOimporteNoSujeto",
      "ClaveRegimen",
      "Impuesto",
      "OperacionExenta",
    ]);
    expect(r.CuotaTotal).toBe("0.00");
    expect(r.ImporteTotal).toBe("35.00");
  });

  it("y el registro sobrevive al viaje por JSON sin que reaparezca ningún campo", async () => {
    // `fiscal_records.payload` es `jsonb`: lo que no está no vuelve. Esto
    // fija que el registro que se remite es el que se generó.
    const { registro: r } = await registro(venta);
    const ida = JSON.parse(JSON.stringify(r)) as typeof r;
    const d = ida.Desglose.DetalleDesglose[0]!;
    expect("CalificacionOperacion" in d).toBe(false);
    expect("TipoImpositivo" in d).toBe(false);
    expect("CuotaRepercutida" in d).toBe(false);
  });

  it("§17 se cumple EXACTAMENTE: ImporteTotal = Σ (base + cuota)", async () => {
    const { registro: r } = await registro(venta);
    const suma = r.Desglose.DetalleDesglose.reduce(
      (acc, d) =>
        acc +
        Number(d.BaseImponibleOimporteNoSujeto) +
        Number(d.CuotaRepercutida ?? 0),
      0,
    );
    // Sin gastar nada del margen de ±10,00 € que admite el §17: en una
    // factura íntegramente exenta no hay cuota que absorba un céntimo, así
    // que el importe declarado TIENE que ser el cobrado.
    expect(round2(suma)).toBe(Number(r.ImporteTotal));
  });

  // El TERCER y el CUARTO camino —el ticket digital y la vista del
  // histórico— tienen su test en su propio sitio, donde están las
  // herramientas para leerlos:
  //   · `packages/ticket-pdf/test/iva-exento-pdf.test.ts` (pdf-parse)
  //   · `apps/tpv-web/test/iva-exento-historico.test.tsx` (jsdom)
});

// ═══ 2 · El ticket «Sesión + crema» del mockup ═════════════════════════

describe("iva-exento-sanitario · sesión + crema (venta mixta)", () => {
  const venta = cobrar([quiropodia(), crema()]);

  it("el total son los 47,00 € del mockup", () => {
    expect(venta.persistido.total).toBe(47);
  });

  it("hay DOS tramos y el exento va primero", () => {
    const c = cuadrarDesglose({
      subtotal: venta.doc.totals.subtotal,
      buckets: venta.doc.totals.taxBreakdown,
      total: venta.persistido.total,
    });
    expect(c.buckets).toEqual([
      { rate: 0, base: 35, tax: 0, exemptionCause: "E1" },
      { rate: 21, base: 9.92, tax: 2.08 },
    ]);
    // Los números del mockup, al céntimo.
    expect(c.subtotal).toBe(44.92);
    expect(c.cuotaTotal).toBe(2.08);
    expect(round2(c.subtotal + c.cuotaTotal)).toBe(47);
  });

  it("el céntimo residual NUNCA cae en el tramo exento", () => {
    // Una venta construida para que el reparto tenga trabajo: tres líneas
    // al 21 % con precios que no caen en céntimos exactos, más la
    // quiropodia exenta.
    const mixta = cobrar([
      quiropodia(),
      { nombre: "Plantilla", precio: 7.77, units: 3, taxRate: 21 },
      { nombre: "Apósito", precio: 2.35, units: 7, taxRate: 21 },
      { nombre: "Venda", precio: 1.95, units: 5, taxRate: 10 },
    ]);
    const c = cuadrarDesglose({
      subtotal: mixta.doc.totals.subtotal,
      buckets: mixta.doc.totals.taxBreakdown,
      total: mixta.persistido.total,
    });
    const exento = c.buckets.find((b) => b.exemptionCause)!;
    // El importe exento es EXACTAMENTE lo que se cobró por la quiropodia.
    expect(exento.base).toBe(35);
    expect(exento.tax).toBe(0);
    // Y el papel cuadra igual.
    expect(round2(c.buckets.reduce((a, b) => a + b.base, 0))).toBe(c.subtotal);
    expect(round2(c.subtotal + c.cuotaTotal)).toBe(mixta.persistido.total);
  });

  it("el papel lleva «Exento», «Base 21 %» y «IVA 21 %»", () => {
    const txt = papel(venta);
    expect(renglon(txt, "Exento")).toMatch(/Exento\s+35,00 €$/);
    expect(renglon(txt, "Base 21 %")).toMatch(/Base 21 %\s+9,92 €$/);
    expect(renglon(txt, "IVA 21 %")).toMatch(/IVA 21 %\s+2,08 €$/);
    // No el «IVA 0,00 €» del caso sin tramos sujetos.
    expect(txt).not.toMatch(/^IVA\s+0,00 €$/m);
  });

  it("y la leyenda va PRECEDIDA del nombre de lo exento", () => {
    const txt = papel(venta);
    // Con una crema al 21 % en el mismo papel, una leyenda sin sujeto
    // diría que el ticket entero está exento.
    expect(txt).toContain("Quiropodia: operación exenta de IVA");
    expect(txt).toContain("art. 20.Uno.3º Ley 37/1992");
  });

  it("con MÁS de una línea exenta la leyenda agrupa", () => {
    const dos = cobrar([
      quiropodia(),
      {
        nombre: "Vendaje funcional",
        precio: 15,
        units: 1,
        taxRate: 0,
        exemptionCause: E1,
      },
      crema(),
    ]);
    const txt = papel(dos);
    // Enumerar tres nombres de tratamiento en 42 columnas no cabe, y
    // recortarlos miente más que agruparlos.
    //
    // El título va PARTIDO en dos renglones porque mide 45 caracteres y el
    // recuadro tiene 38 de ancho útil: se parte por palabras
    // (`wrapText`), no se recorta. Un «Servicios sanitarios: operación
    // exent…» en una leyenda fiscal no dice nada.
    expect(txt).toContain("Servicios sanitarios: operación exenta\nde IVA");
    expect(txt).not.toContain("Quiropodia: operación exenta");
    expect(txt).not.toContain("…");
    // Y el tramo exento es UNO, con los dos importes sumados: misma tasa y
    // misma causa son el mismo tramo.
    const exentos = dos.doc.totals.taxBreakdown.filter((b) => b.exemptionCause);
    expect(exentos).toEqual([{ rate: 0, base: 50, tax: 0, exemptionCause: "E1" }]);
  });

  it("el registro lleva los dos DetalleDesglose, cada uno con SU forma", async () => {
    const { registro: r } = await registro(venta);
    const [exento, sujeto] = r.Desglose.DetalleDesglose as [
      DetalleDesglose,
      DetalleDesglose,
    ];
    expect(exento).toEqual({
      Impuesto: "01",
      ClaveRegimen: "01",
      OperacionExenta: "E1",
      BaseImponibleOimporteNoSujeto: "35.00",
    });
    expect(sujeto).toEqual({
      Impuesto: "01",
      ClaveRegimen: "01",
      CalificacionOperacion: "S1",
      TipoImpositivo: "21.00",
      BaseImponibleOimporteNoSujeto: "9.92",
      CuotaRepercutida: "2.08",
    });
    // §16: `CuotaTotal` es Σ CuotaRepercutida, y el exento no suma.
    expect(r.CuotaTotal).toBe("2.08");
    expect(r.ImporteTotal).toBe("47.00");
  });

  it("§15.7 sigue cumpliéndose en el tramo SUJETO, con su margen intacto", async () => {
    const { registro: r } = await registro(venta);
    const sujeto = r.Desglose.DetalleDesglose.find(
      (d) => d.CalificacionOperacion === "S1",
    )!;
    const esperada =
      (Number(sujeto.BaseImponibleOimporteNoSujeto) *
        Number(sujeto.TipoImpositivo)) /
      100;
    expect(Math.abs(Number(sujeto.CuotaRepercutida!) - esperada)).toBeLessThan(
      10,
    );
  });

});

// ═══ 3 · Un 0 % SUJETO no es un exento ════════════════════════════════

describe("iva-exento-sanitario · el 0 % sujeto y el exento no se mezclan", () => {
  const venta = cobrar([
    quiropodia(),
    // Un producto al 0 % SIN causa: existe (es uno de los cuatro tramos de
    // `LOCAL_TAX_RATES`) y es una operación SUJETA al 0 %.
    { nombre: "Folleto informativo", precio: 3, units: 1, taxRate: 0 },
  ]);

  it("son DOS tramos, no uno, aunque los dos valgan cero", () => {
    // `buildTicketDocument` ordena de forma estable (por tasa y luego por
    // causa) y el ORDEN DE IMPRESIÓN —exentos primero— lo fija
    // `cuadrarDesglose`, que es el que leen los tres renderers y el
    // registro. Aquí lo que importa es que sean dos.
    expect(venta.doc.totals.taxBreakdown).toEqual([
      { rate: 0, base: 3, tax: 0 },
      { rate: 0, base: 35, tax: 0, exemptionCause: "E1" },
    ]);
    const c = cuadrarDesglose({
      subtotal: venta.doc.totals.subtotal,
      buckets: venta.doc.totals.taxBreakdown,
      total: venta.persistido.total,
    });
    expect(c.buckets).toEqual([
      { rate: 0, base: 35, tax: 0, exemptionCause: "E1" },
      { rate: 0, base: 3, tax: 0 },
    ]);
  });

  it("y el registro declara DOS DetalleDesglose distintos", async () => {
    const { registro: r } = await registro(venta);
    expect(r.Desglose.DetalleDesglose).toHaveLength(2);
    const [exento, sujeto] = r.Desglose.DetalleDesglose;
    expect(exento!.OperacionExenta).toBe("E1");
    expect(sujeto!.CalificacionOperacion).toBe("S1");
    expect(sujeto!.TipoImpositivo).toBe("0.00");
    expect(sujeto!.CuotaRepercutida).toBe("0.00");
  });

  it("el papel los separa: «Exento» arriba, «Base 0 %» / «IVA 0 %» abajo", () => {
    const txt = papel(venta);
    expect(renglon(txt, "Exento")).toMatch(/Exento\s+35,00 €$/);
    expect(renglon(txt, "Base 0 %")).toMatch(/Base 0 %\s+3,00 €$/);
  });

  it("y un ticket SIN exención no lleva leyenda ninguna", () => {
    const soloSujeto = cobrar([crema()]);
    expect(leyendaExencion(soloSujeto.doc.lines)).toBeNull();
    const txt = papel(soloSujeto);
    expect(txt).not.toContain("exenta de IVA");
    // El papel de los otros catorce tenants: «IVA X% s/base» + «Subtotal»,
    // byte a byte el de ticket-con-iva.
    expect(renglon(txt, "IVA 21% s/")).toMatch(/IVA 21% s\/9,92 €\s+2,08 €$/);
    expect(renglon(txt, "Subtotal")).toMatch(/Subtotal\s+9,92 €$/);
  });
});

// ═══ 4 · El catálogo ══════════════════════════════════════════════════

describe("iva-exento-sanitario · la ficha del catálogo", () => {
  it("exento ⇒ el precio ES el precio: ni conversión ni céntimos perdidos", () => {
    expect(QUIROPODIA.basePrice).toBe(35);
    expect(QUIROPODIA.taxRate).toBe(0);
    expect(QUIROPODIA.exemptionCause).toBe("E1");
  });

  it("exento con IVA ≠ 0 se rechaza con una frase, no con un error de constraint", () => {
    const r = validateLocalProduct({
      name: "Quiropodia",
      sku: "LOC-QUIRO",
      priceGross: 35,
      taxRate: 21,
      exemptionCause: E1,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("debería haber fallado");
    expect(r.field).toBe("exemptionCause");
    expect(r.message).toContain("0 %");
  });

  it("un código que no está en la lista L10 se rechaza", () => {
    const r = validateLocalProduct({
      name: "X",
      sku: "LOC-X",
      priceGross: 1,
      taxRate: 0,
      exemptionCause: "E9",
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("debería haber fallado");
    expect(r.message).toContain("E1–E6");
  });

  it("E2 y E3 se rechazan: §15.5 las prohíbe con ClaveRegimen 01", () => {
    // Es la contradicción con el enunciado del bloque, y manda la AEAT. La
    // COLUMNA los admite (el CHECK lleva los seis) para que no haga falta
    // migración; lo que no se puede es DECLARARLOS en régimen general.
    for (const codigo of ["E2", "E3"]) {
      const r = validateLocalProduct({
        name: "X",
        sku: "LOC-X",
        priceGross: 1,
        taxRate: 0,
        exemptionCause: codigo,
      });
      expect(r.ok, codigo).toBe(false);
      if (r.ok) throw new Error("debería haber fallado");
      expect(r.message).toContain("régimen general");
    }
  });

  it("y las otras tres del régimen general sí se admiten", () => {
    for (const codigo of ["E4", "E5", "E6"]) {
      const r = validateLocalProduct({
        name: "X",
        sku: "LOC-X",
        priceGross: 1,
        taxRate: 0,
        exemptionCause: codigo,
      });
      expect(r.ok, codigo).toBe(true);
    }
  });

  it("sin causa, un producto al 0 % se guarda SIN causa (es un 0 % sujeto)", () => {
    const f = alta({ name: "Folleto", sku: "LOC-F", priceGross: 3, taxRate: 0 });
    expect(f.exemptionCause).toBeNull();
  });
});

// ═══ 5 · Las dos copias de la etiqueta, atadas ════════════════════════

describe("iva-exento-sanitario · la etiqueta del panel no se separa de la fiscal", () => {
  // `apps/admin` NO depende de `@mipiacetpv/ticket-model`, y es
  // deliberado: es la misma razón que `TAX_RATES`, duplicado allí porque
  // sacar cuatro números (y ahora tres frases) a un paquete pesa más que
  // la duplicación. Lo que no se puede es que las dos copias se separen,
  // porque una es lo que la propietaria LEE y la otra lo que el papel
  // IMPRIME.
  //
  // Desde el banco del admin no se puede comparar —no ve el paquete—, así
  // que se comprueba aquí, leyendo su fuente. Es la misma mecánica con la
  // que los bancos de migración leen el SQL.
  const fuente = readFileSync(
    new URL("../../admin/src/pages/CatalogoPage.tsx", import.meta.url),
    "utf8",
  );

  it("la etiqueta del chip es la de `PRESENTACION.E1`", () => {
    expect(fuente).toContain(
      `const EXENCION_ETIQUETA = "${PRESENTACION.E1.etiqueta}";`,
    );
  });

  it("la referencia del chip es el principio de la del papel", () => {
    // En el chip va corta («art. 20.Uno.3º») y en la leyenda del papel
    // completa («art. 20.Uno.3º Ley 37/1992»): el chip está al lado de la
    // etiqueta en 42 px de alto y la leyenda es el texto legal del
    // documento. Una tiene que ser prefijo de la otra.
    const m = /const EXENCION_REFERENCIA = "([^"]+)";/.exec(fuente);
    expect(m).not.toBeNull();
    expect(PRESENTACION.E1.referencia.startsWith(m![1]!)).toBe(true);
  });

  it("y el código de la causa que el panel manda es E1", () => {
    expect(fuente).toContain('const EXENCION_SANITARIA = "E1";');
    expect(esCausaExencionExportada("E1")).toBe(true);
  });
});
