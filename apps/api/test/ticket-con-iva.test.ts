// bloque ticket-con-iva · los tests de sabotaje.
//
// Este fichero vive en `apps/api/test` y no en el package porque es el
// único sitio del repo desde el que se puede recorrer la CADENA ENTERA de
// la venta del servidor con las funciones de verdad:
//
//   computeTicket (apps/api/src/tickets/totals.ts)
//     → lo que se persiste en Ticket.total / TicketLine.{subtotal,total}
//     → buildTicketDocument (@mipiacetpv/ticket-model)
//     → cuadrarDesglose + cuadrarLineasImpresas
//     → ticketToEscposInput + buildTicketReceipt (el papel)
//
// Nada de esto se mockea: las invariantes se comprueban sobre los mismos
// números que salen por la impresora del bar.
//
// Las cuatro pruebas que pide el bloque:
//
//   1. La venta real del 06-10 en producción (tenant 81f2177b).
//   2. Barrido de 1.000 tickets aleatorios, con las cuatro invariantes.
//   3. Sabotaje de la regla: volver a meter el `subtotal` en el reparto
//      del céntimo y comprobar que el barrido se cae.
//   4. El papel de un comercio con Holded, antes y después del bloque.

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";

import {
  buildTicketDocument,
  type BuildTicketLineInput,
  cuadrarDesglose,
  cuadrarLineasImpresas,
  grossToNet,
  netToGross,
  round2,
  type TicketDocument,
} from "@mipiacetpv/ticket-model";
import { buildTicketReceipt } from "@mipiacetpv/escpos-builder";
import { describe, expect, it } from "vitest";

import { computeTicket, type TicketLineInput } from "../src/tickets/totals.js";
import {
  ticketToEscposInput,
  type TicketForPrint,
} from "../src/tickets/escpos-input.js";

// La tolerancia que la AEAT admite entre la cuota declarada y
// `base × tipo / 100`. Documento «Validaciones · Sistemas Informáticos de
// Facturación y Sistemas VERI*FACTU», versión 1.2.2 (08-04-2026), §15.7:
//
//   [CuotaRepercutida] = ([BaseImponibleOimporteNoSujeto] * TipoImpositivo)
//   / 100 +/- 10,00 euros
//
// El céntimo que este bloque mueve a la cuota cabe mil veces. La fuente
// completa, con el §17 (ImporteTotal) y el §16 (CuotaTotal), está en
// `docs/blocks/ticket-con-iva-done.md`.
const TOLERANCIA_AEAT_EUR = 10;

const ISSUED_AT = new Date("2026-10-06T11:20:00Z");

// ── La venta, de punta a punta ──────────────────────────────────────────

interface LineaDeVenta {
  nombre: string;
  /** Precio de CARTA, con IVA. Es lo que el cliente ve en la pizarra. */
  precioCarta: number;
  units: number;
  taxRate: number;
  discountPct?: number;
}

interface VentaCobrada {
  lineas: LineaDeVenta[];
  /** Lo que se persiste: netos de 4 decimales y totales de `computeTicket`. */
  persistido: {
    total: number;
    lines: Array<{
      nameSnapshot: string;
      units: number;
      unitPriceNeto: number;
      discountPct: number;
      taxRate: number;
      subtotal: number;
      total: number;
    }>;
  };
  doc: TicketDocument;
}

/** Cobra la venta igual que `POST /tickets`: el precio de carta entra en
 *  neto de 4 decimales (`grossToNet`, el mismo camino que el alta del
 *  catálogo y el lápiz del cajero), `computeTicket` agrega por tramo de IVA
 *  y redondea una sola vez, y lo que sale es lo que se guarda en BD. */
function cobrar(lineas: LineaDeVenta[]): VentaCobrada {
  const entrada: TicketLineInput[] = lineas.map((l) => ({
    units: l.units,
    unitPrice: grossToNet(l.precioCarta, l.taxRate),
    discountPct: l.discountPct ?? 0,
    taxRate: l.taxRate,
  }));
  const totals = computeTicket(entrada);
  const lines = lineas.map((l, i) => ({
    nameSnapshot: l.nombre,
    units: l.units,
    unitPriceNeto: entrada[i]!.unitPrice,
    discountPct: entrada[i]!.discountPct,
    taxRate: l.taxRate,
    subtotal: totals.lines[i]!.subtotal,
    total: totals.lines[i]!.total,
  }));
  const docLines: BuildTicketLineInput[] = lines.map((l) => ({
    nameSnapshot: l.nameSnapshot,
    units: l.units,
    unitPrice: l.unitPriceNeto,
    discountPct: l.discountPct,
    taxRate: l.taxRate,
    subtotal: l.subtotal,
    total: l.total,
  }));
  const doc = buildTicketDocument({
    tenant: {
      name: "BAR LA MAESTRANZA SL",
      fiscalProfile: {
        legalName: "BAR LA MAESTRANZA SL",
        taxId: "B45902186",
        address: "Plaza de Toros 1, 45600 Talavera",
      },
      businessType: "HOSPITALITY",
    },
    store: { name: "Bar La Maestranza", fiscalAddress: { address: "Plaza de Toros 1" } },
    register: { name: "Caja 1" },
    cashier: { email: "ana@maestranza.es", name: "Ana" },
    ticket: {
      internalNumber: "000041",
      publicSlug: "0123456789abcdef",
      paidAt: ISSUED_AT,
      createdAt: ISSUED_AT,
      total: totals.total,
      lines: docLines,
      payments: [{ method: "CASH", amount: totals.total }],
    },
  });
  return { lineas, persistido: { total: totals.total, lines }, doc };
}

/** El papel, por el camino del servidor. `verifactu` null = comercio con
 *  Holded; con parte fiscal = comercio que emite sus facturas. */
function papel(
  venta: VentaCobrada,
  opts: { verifactu?: boolean } = {},
): string {
  const ticket: TicketForPrint = {
    id: "66666666-6666-6666-6666-666666666666",
    registerId: "33333333-3333-3333-3333-333333333333",
    internalNumber: "000041",
    publicSlug: "0123456789abcdef",
    total: { toString: () => venta.persistido.total.toFixed(2) },
    cashAmount: null,
    notes: null,
    paidAt: ISSUED_AT,
    createdAt: ISSUED_AT,
    status: "PAID",
    creditPending: null,
    debtorName: null,
    table: { name: "Mesa 3" },
    user: { email: "ana@maestranza.es", alias: "Ana" },
    register: {
      name: "Caja 1",
      store: { name: "Bar La Maestranza", fiscalAddress: { address: "Plaza de Toros 1" } },
    },
    tenant: {
      name: "BAR LA MAESTRANZA SL",
      receiptFooter: null,
      fiscalProfile: {
        legalName: "BAR LA MAESTRANZA SL",
        taxId: "B45902186",
        address: "Plaza de Toros 1",
      },
    },
    lines: venta.persistido.lines.map((l) => ({
      nameSnapshot: l.nameSnapshot,
      units: { toString: () => String(l.units) },
      unitPrice: { toString: () => String(l.unitPriceNeto) },
      unitPriceOverride: null,
      taxRate: { toString: () => String(l.taxRate) },
      total: { toString: () => l.total.toFixed(2) },
    })),
    payments: [
      { method: "CASH", amount: { toString: () => venta.persistido.total.toFixed(2) } },
    ],
  };
  const bytes = buildTicketReceipt(
    ticketToEscposInput(
      ticket,
      "https://ticket.mipiace.es",
      venta.doc.totals,
      false,
      opts.verifactu
        ? {
            numSerieFactura: "C1/000041",
            qrUrl:
              "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B45902186",
            fechaExpedicion: "06-10-2026",
          }
        : null,
    ),
  );
  // El texto imprimible, por renglones. Los comandos ESC/POS son bytes de
  // control (los volvemos espacios, menos el salto de línea, que es el que
  // separa renglones) y el "€" va en PC850 como 0xd5, que en latin-1 se lee
  // "Õ" — lo devolvemos a "€" para que los asserts se lean como el papel.
  //
  // Ojo al leer los asserts: los ARGUMENTOS de los comandos sí son bytes
  // imprimibles (ESC ! 1 deja un "!" y un "1" sueltos), así que un renglón
  // en negrita o a doble altura arrastra basura por delante. Los renglones
  // se buscan por su final, que es donde está el importe.
  return Buffer.from(bytes)
    .toString("latin1")
    .replace(/[\x00-\x09\x0b-\x1f]/g, " ")
    .replace(/\u00d5/g, "€");
}

function importe(txt: string): number {
  return Number(txt.replace(/\./g, "").replace(",", "."));
}

// Lo que suma la columna de la derecha de las líneas, leído del papel.
// `padBetween` deja el importe pegado al borde derecho de las 42 columnas,
// y las líneas de importe son las que empiezan por "<uds> x ".
const RENGLON_DE_LINEA = /^([\d,]+) x ([\d.]*,\d\d) €\s+([\d.]*,\d\d) €$/;

function importesDeLineaDelPapel(texto: string): number[] {
  return texto
    .split("\n")
    .map((l) => RENGLON_DE_LINEA.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m != null)
    .map((m) => importe(m[3]!));
}

function eur(texto: string, etiqueta: string): number | null {
  const m = new RegExp(`${etiqueta}\\s+([\\d.]*,\\d\\d) €`).exec(texto);
  return m ? importe(m[1]!) : null;
}

// ── 1 · La venta real del 06-10 ─────────────────────────────────────────
//
// Producción, tenant 81f2177b, venta de PRUEBA de tres líneas al 10 %:
// café con leche 1,60 + 2 cañas de 1,30 + una ración de 10,40 = 14,60 €.
//
// Lo que imprimía antes del bloque, y que es el bug entero en cuatro
// renglones:
//
//   Cafe con leche
//   1 x 1,45                                1,60
//   Cana
//   2 x 1,18                                2,60
//   Racion de la casa
//   1 x 9,45                               10,40
//   IVA 10% s/13,26                         1,33
//   Subtotal                               13,27
//   TOTAL                                  14,60
//
// Dos cosas mal: el unitario en neto (1,45 por un café de 1,60) y la base
// imponible con dos valores (13,26 en el tramo, 13,27 en el subtotal).
const VENTA_06_10: LineaDeVenta[] = [
  { nombre: "Cafe con leche", precioCarta: 1.6, units: 1, taxRate: 10 },
  { nombre: "Cana", precioCarta: 1.3, units: 2, taxRate: 10 },
  { nombre: "Racion de la casa", precioCarta: 10.4, units: 1, taxRate: 10 },
];

describe("1 · la venta real del 06-10 (producción, tenant 81f2177b)", () => {
  const venta = cobrar(VENTA_06_10);

  it("la venta es la que fue: 14,60 € y los netos por línea suman 13,26", () => {
    expect(venta.persistido.total).toBe(14.6);
    // Σ de los netos de línea YA redondeados — de aquí salía el 13,26 del
    // tramo. El neto crudo es 13,2726, y es por eso que el total es 14,60 y
    // no 14,59: `computeTicket` redondea una sola vez, al final.
    expect(
      round2(venta.persistido.lines.reduce((a, l) => a + l.subtotal, 0)),
    ).toBe(13.26);
    expect(venta.doc.totals.taxBreakdown).toEqual([
      { rate: 10, base: 13.26, tax: 1.33 },
    ]);
  });

  it("SABOTAJE · la base imponible tiene UN valor: 13,26 en el tramo y en el subtotal", () => {
    const cuadrado = cuadrarDesglose({
      subtotal: venta.doc.totals.subtotal,
      buckets: venta.doc.totals.taxBreakdown,
      total: venta.doc.totals.total,
    });
    expect(cuadrado.buckets.map((b) => b.base)).toEqual([13.26]);
    expect(cuadrado.subtotal).toBe(13.26);
    // El céntimo residual se fue ENTERO a la cuota: 14,60 − 13,26 = 1,34.
    expect(cuadrado.cuotaTotal).toBe(1.34);
    expect(round2(cuadrado.subtotal + cuadrado.cuotaTotal)).toBe(14.6);
    // Y sigue dentro de lo que admite la AEAT con holgura de tres órdenes
    // de magnitud: |1,34 − 13,26 × 10 %| = 0,014 €.
    expect(Math.abs(1.34 - (13.26 * 10) / 100)).toBeLessThanOrEqual(
      TOLERANCIA_AEAT_EUR,
    );
  });

  it("SABOTAJE · el papel se lee como la carta y las líneas suman 14,60", () => {
    const t = papel(venta, { verifactu: true });

    // El café con leche cuesta 1,60 € en la pizarra y 1,60 € en el ticket.
    expect(t).toContain("1 x 1,60 €");
    expect(t).toContain("2 x 1,30 €");
    expect(t).toContain("1 x 10,40 €");
    // Y ya no sale ni uno de los unitarios netos de antes.
    expect(t).not.toContain("1 x 1,45 €");
    expect(t).not.toContain("2 x 1,18 €");
    expect(t).not.toContain("1 x 9,45 €");

    // La columna de la derecha suma el total, al céntimo.
    const importes = importesDeLineaDelPapel(t);
    expect(importes).toEqual([1.6, 2.6, 10.4]);
    expect(round2(importes.reduce((a, b) => a + b, 0))).toBe(14.6);

    // Un único valor de base imponible en todo el papel.
    expect(t).toContain("IVA 10% s/13,26");
    expect(eur(t, "Subtotal")).toBe(13.26);
    expect(t).not.toContain("13,27");
    expect(eur(t, "TOTAL")).toBe(14.6);
  });
});

// ── 2 · El barrido ──────────────────────────────────────────────────────

/** LCG de 32 bits. Determinista a propósito: un barrido que falla una vez
 *  cada cien ejecuciones no es una red de seguridad, es una lotería. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  const siguiente = () => {
    // Math.imul: el producto de 32 bits se trunca como en C, sin pasar por
    // el double de 53 bits (1664525 · 2^32 se saldría).
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
  // Calentar: los primeros valores de un LCG con semillas contiguas son
  // casi el mismo número, y el barrido saldría con 1.000 tickets del mismo
  // tamaño. Se tiran unos cuantos antes de usarlo.
  for (let i = 0; i < 16; i++) siguiente();
  return siguiente;
}

function ticketAleatorio(r: () => number): LineaDeVenta[] {
  const n = 1 + Math.floor(r() * 15);
  const lineas: LineaDeVenta[] = [];
  for (let i = 0; i < n; i++) {
    // Precio de carta de 0,50 a 30,00 €, en pasos de 5 céntimos.
    const pasos = Math.floor(r() * ((3000 - 50) / 5 + 1));
    lineas.push({
      nombre: `Articulo ${i + 1}`,
      precioCarta: round2((50 + pasos * 5) / 100),
      units: 1 + Math.floor(r() * 5),
      taxRate: r() < 0.5 ? 10 : 21,
      // Descuentos de línea, incluido el 0 (el caso normal).
      discountPct: [0, 0, 0, 5, 10, 15, 50][Math.floor(r() * 7)]!,
    });
  }
  return lineas;
}

const BARRIDO = Array.from({ length: 1000 }, (_, i) => {
  const r = rng(0x5eed_0000 + i);
  return cobrar(ticketAleatorio(r));
});

/** Las cuatro invariantes del bloque sobre una venta ya cobrada. Devuelve
 *  la lista de las que se rompen — vacía si el ticket está bien. */
function invariantesRotas(venta: VentaCobrada): string[] {
  const roto: string[] = [];
  const { subtotal, taxBreakdown, total } = venta.doc.totals;
  const cuadrado = cuadrarDesglose({ subtotal, buckets: taxBreakdown, total });
  const sumaBases = round2(
    cuadrado.buckets.reduce((a, b) => a + b.base, 0),
  );
  const sumaCuotas = round2(cuadrado.buckets.reduce((a, b) => a + b.tax, 0));

  // a) El subtotal impreso ES la suma de las bases.
  if (cuadrado.subtotal !== sumaBases) {
    roto.push(`subtotal ${cuadrado.subtotal} != Σ bases ${sumaBases}`);
  }
  // b) Σ bases + Σ cuotas === total, al céntimo.
  if (Math.round((sumaBases + sumaCuotas) * 100) !== Math.round(total * 100)) {
    roto.push(`Σ bases + Σ cuotas ${sumaBases + sumaCuotas} != total ${total}`);
  }
  // c) Cada cuota, dentro de la tolerancia de la AEAT (§15.7).
  for (const b of cuadrado.buckets) {
    const teorica = (b.base * b.rate) / 100;
    if (Math.abs(b.tax - teorica) > TOLERANCIA_AEAT_EUR) {
      roto.push(`cuota ${b.tax} fuera de tolerancia para ${b.base} al ${b.rate}%`);
    }
  }
  // d) La columna de importes de línea IMPRESOS suma el total.
  const impresos = cuadrarLineasImpresas(
    venta.doc.lines.map((l) => l.totalGross),
    total,
  );
  const sumaLineas = impresos.reduce((a, b) => a + Math.round(b * 100), 0);
  if (sumaLineas !== Math.round(total * 100)) {
    roto.push(`Σ líneas impresas ${sumaLineas / 100} != total ${total}`);
  }
  return roto;
}

describe("2 · barrido de 1.000 tickets aleatorios", () => {
  it("el barrido es variado de verdad (si no, no prueba nada)", () => {
    const nLineas = BARRIDO.map((v) => v.lineas.length);
    expect(Math.min(...nLineas)).toBe(1);
    expect(Math.max(...nLineas)).toBe(15);
    // Tickets con los dos tipos mezclados, que son los que obligan a
    // repartir el céntimo entre varias cuotas.
    const mixtos = BARRIDO.filter(
      (v) => v.doc.totals.taxBreakdown.length > 1,
    ).length;
    expect(mixtos).toBeGreaterThan(700);
    // Y tickets en los que el céntimo residual EXISTE: Σ de las bases
    // redondeadas más Σ de las cuotas naturales no da el total. Sin éstos
    // el barrido pasaría con cualquier implementación.
    const conResiduo = BARRIDO.filter((v) => {
      const { taxBreakdown, total } = v.doc.totals;
      const natural = taxBreakdown.reduce(
        (a, b) => a + round2(b.base) + round2((b.base * b.rate) / 100),
        0,
      );
      return Math.round(natural * 100) !== Math.round(total * 100);
    }).length;
    expect(conResiduo).toBeGreaterThan(100);
  });

  it("SABOTAJE · las cuatro invariantes se cumplen en los 1.000", () => {
    const fallos = BARRIDO.map((v, i) => ({ i, roto: invariantesRotas(v) }))
      .filter((f) => f.roto.length > 0)
      .slice(0, 10);
    expect(fallos).toEqual([]);
  });

  it("MEDIDA · cuánto se desvía la cuota, como mucho", () => {
    let peor = 0;
    let peorTicket = -1;
    BARRIDO.forEach((v, i) => {
      const { subtotal, taxBreakdown, total } = v.doc.totals;
      for (const b of cuadrarDesglose({ subtotal, buckets: taxBreakdown, total })
        .buckets) {
        const d = Math.abs(b.tax - (b.base * b.rate) / 100);
        if (d > peor) {
          peor = d;
          peorTicket = i;
        }
      }
    });
    // El número, fijado: con esta semilla el peor caso de los 1.000 es
    // 0,0230 € (ticket 214, de 14 líneas). El techo se deja en 3 céntimos
    // para no fijar el decimal exacto. La tolerancia de la AEAT (§15.7) es
    // de 10,00 € — tres órdenes de magnitud por encima. Si este techo sube
    // de golpe, algo ha cambiado en cómo se agregan las bases de los tramos.
    expect(peor).toBeLessThanOrEqual(0.03);
    expect(peorTicket).toBeGreaterThanOrEqual(0);
  });

  it("el papel impreso también suma, en una muestra del barrido", () => {
    // Parsear 1.000 tickets ESC/POS es lento y no añade nada: las
    // invariantes de arriba son sobre los mismos números. Una muestra
    // cierra el círculo —que lo que se calcula es lo que se imprime— sin
    // convertir el barrido en un test de 20 segundos.
    for (const venta of BARRIDO.slice(0, 40)) {
      const t = papel(venta, { verifactu: true });
      const importes = importesDeLineaDelPapel(t);
      expect(importes).toHaveLength(venta.doc.lines.length);
      expect(round2(importes.reduce((a, b) => a + b, 0))).toBe(
        venta.persistido.total,
      );
      expect(eur(t, "Subtotal")).toBe(
        round2(venta.doc.totals.taxBreakdown.reduce((a, b) => a + b.base, 0)),
      );
      expect(eur(t, "TOTAL")).toBe(venta.persistido.total);
    }
  });
});

// ── 3 · Rompiendo la regla a propósito ──────────────────────────────────

/** `cuadrarDesglose` TAL COMO ERA antes del bloque: el `subtotal` entra en
 *  el reparto del céntimo residual junto a las cuotas y las bases se
 *  quedan como vinieron. Copiado de `packages/ticket-model/src/desglose.ts`
 *  en `master` (6e6f0df) — es el sabotaje, no se usa en producción. */
function cuadrarDesgloseSaboteado(input: {
  subtotal: number;
  buckets: Array<{ rate: number; base: number; tax: number }>;
  total: number;
}) {
  // El mismo método del resto mayor, con el subtotal como un componente
  // más. `allocateRoundingRemainder` se reimplementa aquí en corto para
  // que el sabotaje no dependa de nada que este bloque haya tocado.
  const comps = [
    { key: "subtotal", amount: input.subtotal },
    ...input.buckets.map((b, i) => ({ key: `tax:${i}`, amount: b.tax })),
  ];
  const parts = comps.map((c) => {
    const raw = c.amount * 100;
    const floor = Math.floor(raw + 1e-6);
    return { key: c.key, amount: c.amount, cents: floor, rem: Math.max(0, raw - floor) };
  });
  let diff =
    Math.round(input.total * 100) - parts.reduce((a, p) => a + p.cents, 0);
  if (diff > 0) {
    const orden = [...parts].sort((a, b) => b.rem - a.rem || b.amount - a.amount);
    for (let i = 0; i < diff && i < orden.length; i++) orden[i]!.cents += 1;
  } else if (diff < 0) {
    const orden = [...parts].sort((a, b) => a.rem - b.rem || a.amount - b.amount);
    for (let i = 0; i < -diff && i < orden.length; i++) orden[i]!.cents -= 1;
  }
  const porClave = new Map(parts.map((p) => [p.key, p.cents / 100]));
  return {
    subtotal: porClave.get("subtotal")!,
    buckets: input.buckets.map((b, i) => ({
      rate: b.rate,
      base: b.base,
      tax: porClave.get(`tax:${i}`)!,
    })),
  };
}

describe("3 · si se vuelve a meter el subtotal en el reparto, el barrido cae", () => {
  it("SABOTAJE · la regla vieja rompe «subtotal = Σ bases» en cientos de tickets", () => {
    const rotos = BARRIDO.filter((v) => {
      const { subtotal, taxBreakdown, total } = v.doc.totals;
      const malo = cuadrarDesgloseSaboteado({
        subtotal,
        buckets: taxBreakdown,
        total,
      });
      const sumaBases = round2(malo.buckets.reduce((a, b) => a + b.base, 0));
      return malo.subtotal !== sumaBases;
    });
    // No es un caso de borde: pasa en una fracción grande de las ventas
    // reales de un bar, y el ticket del 06-10 fue el tercero que se miró.
    expect(rotos.length).toBeGreaterThan(100);
  });

  it("SABOTAJE · y rompe «ImporteTotal = Σ bases + Σ cuotas» del registro", () => {
    const rotos = BARRIDO.filter((v) => {
      const { subtotal, taxBreakdown, total } = v.doc.totals;
      const malo = cuadrarDesgloseSaboteado({
        subtotal,
        buckets: taxBreakdown,
        total,
      });
      const suma = malo.buckets.reduce((a, b) => a + b.base + b.tax, 0);
      return Math.round(suma * 100) !== Math.round(total * 100);
    });
    // Ésta es la que importa de verdad: es el §17 del documento de
    // validaciones de la AEAT, y lo que se declaraba no cuadraba con lo
    // que se declaraba. Lo salvaba la tolerancia de ±10 €, no nosotros.
    expect(rotos.length).toBeGreaterThan(100);
  });

  it("y la venta del 06-10 es uno de esos tickets", () => {
    const venta = cobrar(VENTA_06_10);
    const malo = cuadrarDesgloseSaboteado({
      subtotal: venta.doc.totals.subtotal,
      buckets: venta.doc.totals.taxBreakdown,
      total: venta.doc.totals.total,
    });
    // El papel que se imprimió en producción, reproducido: 13,26 arriba y
    // 13,27 abajo.
    expect(malo.buckets[0]!.base).toBe(13.26);
    expect(malo.subtotal).toBe(13.27);
  });
});

// ── 4 · El comercio con Holded ──────────────────────────────────────────

describe("4 · el papel de un comercio con Holded", () => {
  // Un comercio que factura con Holded no lleva parte fiscal: ni QR
  // tributario ni "Factura C1/…". Lo que este bloque le cambia es el
  // CUERPO del ticket, igual que al que emite sus facturas — y eso es
  // deliberado: el cliente del bar de Holded también quiere leer la carta
  // en su ticket.
  const venta = cobrar(VENTA_06_10);

  it("sigue sin parte fiscal: nada de QR tributario ni número de factura", () => {
    const t = papel(venta, { verifactu: false });
    expect(t).not.toContain("QR tributario:");
    expect(t).not.toContain("VERI*FACTU");
    expect(t).not.toContain("Factura C1/");
    expect(t).toContain("000041");
  });

  it("SNAPSHOT · el papel entero, antes y después del bloque", () => {
    const t = papel(venta, { verifactu: false });
    // Lo que cambia respecto de `master` (6e6f0df): CINCO renglones y ni
    // uno más. Los dos papeles completos, generados de verdad sobre cada
    // commit, están pegados en `docs/blocks/ticket-con-iva-done.md` §1.
    //
    // ANTES                              DESPUÉS
    //   1 x 1,45 €         1,60 €          1 x 1,60 €         1,60 €
    //   2 x 1,18 €         2,60 €          2 x 1,30 €         2,60 €
    //   1 x 9,45 €        10,40 €          1 x 10,40 €       10,40 €
    //   IVA 10% s/13,26 €  1,33 €          IVA 10% s/13,26 €  1,34 €
    //   Subtotal          13,27 €          Subtotal          13,26 €
    //
    // El TOTAL, los pagos, la cabecera y el QR del ticket digital no se
    // mueven — y eso es la mitad de lo que este test guarda.
    const cuerpo = t
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    expect(cuerpo).toContain("Cafe con leche");
    expect(cuerpo.some((l) => /^1 x 1,60 €\s+1,60 €$/.test(l))).toBe(true);
    expect(cuerpo.some((l) => /^2 x 1,30 €\s+2,60 €$/.test(l))).toBe(true);
    expect(cuerpo.some((l) => /^1 x 10,40 €\s+10,40 €$/.test(l))).toBe(true);
    expect(cuerpo.some((l) => /^IVA 10% s\/13,26 €\s+1,34 €$/.test(l))).toBe(true);
    expect(cuerpo.some((l) => /^Subtotal\s+13,26 €$/.test(l))).toBe(true);
    expect(cuerpo.some((l) => /TOTAL\s+14,60 €$/.test(l))).toBe(true);

    // Lo que NO cambia: cabecera, cajero, mesa, pagos y el QR del ticket
    // digital siguen exactamente donde estaban.
    expect(cuerpo.some((l) => l.endsWith("BAR LA MAESTRANZA SL"))).toBe(true);
    expect(cuerpo).toContain("NIF: B45902186");
    expect(cuerpo.some((l) => l.endsWith("Cajero: Ana"))).toBe(true);
    expect(cuerpo.some((l) => l.startsWith("Mesa:"))).toBe(true);
    expect(cuerpo.some((l) => /Efectivo\s+14,60 €$/.test(l))).toBe(true);
    expect(t).toContain("/tickets/0123456789abcdef/pdf");
  });

  it("SABOTAJE · el total no se mueve ni un céntimo: es entrada, no se recalcula", () => {
    const t = papel(venta, { verifactu: false });
    expect(eur(t, "TOTAL")).toBe(14.6);
    expect(venta.persistido.total).toBe(14.6);
  });
});
