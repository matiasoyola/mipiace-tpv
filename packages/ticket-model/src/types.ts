// Tipos puros del modelo abstracto de ticket (B-Print fase 1).
//
// Se mantienen sin dependencias externas para que se puedan importar
// tanto desde apps/api (Node) como desde apps/tpv-web (browser PWA).
// La validación con zod vive en `./schema.ts` y se aplica antes de
// renderizar.

export interface TicketFiscal {
  legalName: string;
  taxId: string;
  address: string;
  phone?: string;
}

export interface TicketStore {
  name: string;
  address: string;
  phone?: string;
}

export interface TicketMeta {
  internalNumber: string;
  publicSlug: string;
  issuedAt: Date;
  cashierName: string;
  registerName: string;
}

export interface TicketCustomer {
  name?: string;
  taxId?: string;
  email?: string;
}

export interface TicketTaxBucket {
  rate: number;
  base: number;
  tax: number;
}

export interface TicketTotals {
  subtotal: number;
  taxBreakdown: TicketTaxBucket[];
  total: number;
}

export type TicketPaymentMethod = "CASH" | "CARD" | "TRANSFER" | "OTHER";

export interface TicketPayment {
  method: TicketPaymentMethod;
  paid: number;
  change?: number;
}

export interface TicketRefund {
  originalTicketNumber: string;
  reason?: string;
}

export interface TicketFooter {
  thankYouMessage: string;
  returnPolicy?: string;
  qrCaption?: string;
}

export interface TicketLine {
  description: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate: number;
  subtotal: number;
}

export interface TicketDocument {
  fiscal: TicketFiscal;
  store: TicketStore;
  ticket: TicketMeta;
  customer?: TicketCustomer;
  lines: TicketLine[];
  totals: TicketTotals;
  payment: TicketPayment;
  refund?: TicketRefund;
  footer: TicketFooter;
}
