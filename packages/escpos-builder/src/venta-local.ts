// V1-verifactu (ADR-019) · el papel, armado EN EL DISPOSITIVO.
//
// Hasta este bloque los bytes ESC/POS los pedía siempre el terminal al
// servidor (`GET /tickets/:id/escpos`). Funcionaba y era más simple, con
// un agujero: SIN RED NO SALÍA PAPEL. Y la FAQ de desarrolladores de la
// AEAT exige entregar la factura con su QR en el momento de cobrar, no
// cuando vuelva la línea.
//
// Lo que este fichero hace NO es un segundo constructor de bytes. El
// constructor es UNO —`buildTicketReceipt`, en `@mipiacetpv/escpos-builder`—
// y lo llaman los dos lados. Aquí sólo se arma su ENTRADA con lo que el
// dispositivo tiene en la mano: el carrito, los pagos, la cabecera fiscal
// cacheada y el registro de facturación que acaba de generar.
//
// El módulo vive AQUÍ, en el paquete del constructor de bytes, y no en
// `apps/tpv-web`, por dos razones que son la misma: es puro —sin
// `localStorage`, sin `fetch`, sin React— y así lo puede importar sin
// contorsiones el test que compara sus bytes con los del camino del
// servidor (`apps/api/test/verifactu-un-solo-papel.test.ts`), que es la red
// de seguridad contra que los dos caminos se separen.

import { changeFromCash } from "@mipiacetpv/ticket-model";

import {
  buildTicketReceipt,
  type TicketLineEscpos,
  type TicketPaymentEscpos,
  type TicketReceiptInput,
} from "./ticket.js";

/** La cabecera del comercio y de la tienda, tal y como la manda
 *  `GET /tpv/fiscal/head`. Los nombres son los de `TicketReceiptInput`
 *  porque van ahí tal cual: cualquier transformación en medio sería un
 *  sitio donde los dos papeles pueden separarse. */
export interface CabeceraTicketLocal {
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  businessName: string;
  businessAddress: string | null;
  registerName: string;
  receiptFooter: string | null;
}

export interface LineaTicketLocal {
  description: string;
  units: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PagoTicketLocal {
  method: string;
  amount: number;
}

export interface VentaLocal {
  cabecera: CabeceraTicketLocal;
  cashierLabel: string;
  tableName: string | null;
  issuedAt: Date;
  lines: LineaTicketLocal[];
  payments: PagoTicketLocal[];
  /** Efectivo ENTREGADO por el cliente, si hubo. */
  cashAmount: number | null;
  /** Los tramos de IVA del carrito, sin cuadrar. */
  buckets: { rate: number; base: number; tax: number }[];
  subtotal: number;
  total: number;
  notes: string | null;
  /** `internalNumber` del servidor. Sin red todavía no existe. */
  internalNumber: string | null;
  /** URL pública del ticket digital. Sin red todavía no existe. */
  publicTicketUrl: string | null;
  /** La parte fiscal. Sin ella esto no es una factura y no se imprime. */
  verifactu: { numSerieFactura: string; qrUrl: string };
}

/** Las mismas etiquetas que `methodLabel` de `escpos-input.ts`. */
function methodLabel(method: string): string {
  switch (method) {
    case "CASH":
      return "Efectivo";
    case "CARD":
      return "Tarjeta";
    case "BIZUM":
      return "Bizum";
    case "VOUCHER":
      return "Vale";
    default:
      return "Otro";
  }
}

/**
 * La entrada del constructor de bytes, armada con lo que hay en la tablet.
 *
 * Una diferencia legítima con el camino del servidor, y sólo una: sin red
 * no existe todavía el `internalNumber` (lo asigna el servidor al
 * persistir) ni el slug público del ticket digital. El papel sale con su
 * NÚMERO FISCAL, que es el que importa, y sin la referencia interna ni el
 * segundo QR. Cuando la venta sube, el ticket digital ya existe y la
 * reimpresión sale completa.
 */
export function buildLocalTicketInput(venta: VentaLocal): TicketReceiptInput {
  const lines: TicketLineEscpos[] = venta.lines.map((l) => ({
    description: l.description,
    units: l.units,
    unitPrice: l.unitPrice,
    lineTotal: l.lineTotal,
  }));

  // La vuelta se cuelga de la ÚLTIMA fila de efectivo, exactamente igual
  // que en el servidor (v1.15-la-vuelta-existe §3).
  const change = changeFromCash(
    venta.payments.map((p) => ({ method: p.method, amount: p.amount })),
    venta.cashAmount,
  );
  const lastCashIdx = venta.payments.reduce(
    (idx, p, i) => (p.method === "CASH" ? i : idx),
    -1,
  );
  const payments: TicketPaymentEscpos[] = venta.payments.map((p, i) => {
    const base: TicketPaymentEscpos = {
      label: methodLabel(p.method),
      amount: p.amount,
    };
    if (i === lastCashIdx && change > 0 && venta.cashAmount != null) {
      base.cashReceived = +venta.cashAmount.toFixed(2);
      base.cashChange = change;
    }
    return base;
  });

  // El desglose se pasa SIN cuadrar: el cuadre lo hace `buildTicketReceipt`
  // con `cuadrarDesglose`, igual que con el desglose que le llega desde el
  // servidor. Cuadrarlo aquí lo cuadraría dos veces.
  return {
    legalName: venta.cabecera.legalName,
    taxId: venta.cabecera.taxId,
    fiscalAddress: venta.cabecera.address,
    phone: venta.cabecera.phone,
    businessName: venta.cabecera.businessName,
    businessAddress: venta.cabecera.businessAddress,
    // Sin red no hay número interno. El fiscal, que es el que identifica la
    // factura, sí está.
    internalNumber: venta.internalNumber ?? "",
    issuedAt: venta.issuedAt,
    isCopy: false,
    cashierLabel: venta.cashierLabel,
    tableName: venta.tableName,
    lines,
    total: venta.total,
    taxBreakdown: venta.buckets,
    subtotal: venta.subtotal,
    payments,
    notes: venta.notes ? [venta.notes] : [],
    publicTicketUrl: venta.publicTicketUrl,
    footer: venta.cabecera.receiptFooter,
    creditNotice: null,
    verifactu: venta.verifactu,
  };
}

/** Los bytes. Una línea, y a propósito: que se vea que aquí no se construye
 *  nada — se llama al constructor de siempre. */
export function buildLocalTicketBytes(venta: VentaLocal): Uint8Array {
  return buildTicketReceipt(buildLocalTicketInput(venta));
}

