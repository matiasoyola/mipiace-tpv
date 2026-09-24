// V1-verifactu (ADR-019) · el mapeo de una venta de BD al input del
// constructor de bytes ESC/POS.
//
// Vive aparte de `print.ts` desde este bloque, y no por higiene: el
// DISPOSITIVO también arma este mismo input para poder imprimir sin red
// (`apps/tpv-web/src/lib/ticketLocal.ts`), y el test que compara los bytes
// de los dos caminos tiene que poder importar éste sin arrastrar Fastify,
// Prisma ni la validación del entorno.
//
// El constructor de bytes es UNO y sólo uno: `buildTicketReceipt`, en
// `@mipiacetpv/escpos-builder`. Aquí no se escribe ni un byte.

import {
  type TicketLineEscpos,
  type TicketPaymentEscpos,
  type TicketReceiptInput,
} from "@mipiacetpv/escpos-builder";
import { changeFromCash } from "@mipiacetpv/ticket-model";
import type { TicketTotals, TicketVerifactu } from "@mipiacetpv/ticket-model";

import { cashierLabelFrom } from "../users/display.js";

export interface TicketForPrint {
  id: string;
  registerId: string;
  internalNumber: string;
  publicSlug: string;
  total: { toString(): string };
  cashAmount: { toString(): string } | null;
  notes: string | null;
  paidAt: Date | null;
  createdAt: Date;
  // v1.8-Fiado · si el ticket es un fiado con deuda viva, imprimimos la
  // leyenda PENDIENTE DE PAGO. debtorName se hidrata desde el contacto.
  status: string;
  creditPending: { toString(): string } | null;
  debtorName?: string | null;
  table: { name: string } | null;
  user: { email: string; alias: string | null };
  register: {
    name: string;
    store: {
      name: string;
      fiscalAddress: unknown;
    };
  };
  tenant: {
    name: string;
    receiptFooter: string | null;
    fiscalProfile: unknown;
  };
  lines: Array<{
    nameSnapshot: string;
    units: { toString(): string };
    unitPrice: { toString(): string };
    unitPriceOverride: { toString(): string } | null;
    total: { toString(): string };
  }>;
  payments: Array<{
    method: string;
    amount: { toString(): string };
  }>;
}


export function ticketToEscposInput(
  ticket: TicketForPrint,
  publicTicketUrlBase: string,
  // v1.9.10 · totales del modelo compartido (con el desglose de IVA por
  // tipo, idéntico al del PDF). Opcional: si es null el ticket sale sin
  // desglose, como antes.
  totals: TicketTotals | null = null,
  // v1.10.2-impresion-honesta · reimpresión: el papel lleva "COPIA - no
  // fiscal". El original (impresión tras el cobro) nunca la lleva.
  isCopy = false,
  // V1-verifactu (ADR-019) · número fiscal + QR tributario. Null en un
  // comercio que factura con Holded: su papel sale EXACTAMENTE igual que
  // antes de este bloque.
  verifactu: TicketVerifactu | null = null,
): TicketReceiptInput {
  const lines: TicketLineEscpos[] = ticket.lines.map((l) => {
    const baseUnit = Number(l.unitPrice.toString());
    const override = l.unitPriceOverride != null
      ? Number(l.unitPriceOverride.toString())
      : null;
    return {
      description: l.nameSnapshot,
      units: Number(l.units.toString()),
      unitPrice: override ?? baseUnit,
      lineTotal: Number(l.total.toString()),
    };
  });

  // Pagos, con la vuelta colgando de la ÚLTIMA fila de efectivo.
  //
  // v1.15-la-vuelta-existe §3 · antes se comparaba `cashAmount` contra
  // el importe de cada fila CASH por separado. Con el error de B1 dentro
  // del ticket los dos números eran el mismo billete, así que la
  // condición `cash > amount` no se cumplía nunca y **el térmico no
  // imprimía la línea CAMBIO jamás**: el cliente se llevaba un papel con
  // "Efectivo 5,00" bajo un "TOTAL 3,00" y ninguna vuelta.
  //
  // Ahora la vuelta se calcula una sola vez —entregado menos el total
  // aplicado en efectivo, `changeFromCash`— y se cuelga de la última
  // fila CASH. En un cobro mixto con dos filas de efectivo la vuelta es
  // una sola, no una por fila.
  const cashAmountNum =
    ticket.cashAmount != null ? Number(ticket.cashAmount.toString()) : null;
  const change = changeFromCash(
    ticket.payments.map((p) => ({
      method: p.method,
      amount: Number(p.amount.toString()),
    })),
    cashAmountNum,
  );
  const lastCashIdx = ticket.payments.reduce(
    (idx, p, i) => (p.method === "CASH" ? i : idx),
    -1,
  );
  const payments: TicketPaymentEscpos[] = ticket.payments.map((p, i) => {
    const amount = Number(p.amount.toString());
    const base: TicketPaymentEscpos = {
      label: methodLabel(p.method),
      amount,
    };
    if (i === lastCashIdx && change > 0 && cashAmountNum != null) {
      base.cashReceived = +cashAmountNum.toFixed(2);
      base.cashChange = change;
    }
    return base;
  });

  const issuedAt = ticket.paidAt ?? ticket.createdAt;

  const fiscal = extractFiscal(ticket.tenant.fiscalProfile);

  return {
    legalName: fiscal.legalName,
    taxId: fiscal.taxId,
    fiscalAddress: fiscal.address,
    phone: fiscal.phone,
    businessName:
      ticket.register.store.name && ticket.register.store.name.length > 0
        ? ticket.register.store.name
        : ticket.tenant.name,
    businessAddress: formatAddress(ticket.register.store.fiscalAddress),
    internalNumber: ticket.internalNumber,
    issuedAt,
    isCopy,
    cashierLabel: cashierLabelFrom(ticket.user),
    tableName: ticket.table?.name ?? null,
    lines,
    total: Number(ticket.total.toString()),
    // v1.9.10 · desglose IVA por tipo + neto, del modelo compartido. Los
    // shapes coinciden: TicketTaxBucket {rate,base,tax} === TicketTaxBucketEscpos.
    taxBreakdown: totals?.taxBreakdown ?? null,
    subtotal: totals?.subtotal ?? null,
    verifactu: verifactu
      ? {
          numSerieFactura: verifactu.numSerieFactura,
          qrUrl: verifactu.qrUrl,
        }
      : null,
    payments,
    notes: ticket.notes ? [ticket.notes] : [],
    publicTicketUrl: `${publicTicketUrlBase}/tickets/${ticket.publicSlug}/pdf`,
    footer: ticket.tenant.receiptFooter,
    // v1.8-Fiado · leyenda PENDIENTE DE PAGO si hay deuda viva.
    creditNotice:
      ticket.creditPending != null && Number(ticket.creditPending) > 0
        ? {
            debtorName: ticket.debtorName ?? null,
            amountDue: Number(ticket.creditPending.toString()),
          }
        : null,
  };
}

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

export function formatAddress(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const street = typeof a.address === "string" ? a.address : null;
  const city = typeof a.city === "string" ? a.city : null;
  const zip = typeof a.postalCode === "string" ? a.postalCode : null;
  const parts = [street, [zip, city].filter(Boolean).join(" ").trim()].filter(
    (s) => s && s.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

// Extrae la cabecera fiscal del `fiscalProfile` (jsonb libre del
// onboarding/Holded o editado a mano). `address` puede venir como string
// o como objeto estructurado (Holded a veces lo devuelve así), igual que
// en el renderer del PDF. Devuelve null en los campos vacíos para que el
// builder los omita.
export function extractFiscal(raw: unknown): {
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  phone: string | null;
} {
  if (!raw || typeof raw !== "object") {
    return { legalName: null, taxId: null, address: null, phone: null };
  }
  const fp = raw as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  let address: string | null = null;
  if (typeof fp.address === "string") {
    address = str(fp.address);
  } else if (fp.address && typeof fp.address === "object") {
    address = formatAddress(fp.address);
  }
  return {
    legalName: str(fp.legalName),
    taxId: str(fp.taxId),
    address,
    phone: str(fp.phone),
  };
}
