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

// v1.3-Servicios-Pinta · Lote 2: vertical del tenant emisor. El
// renderer la usa para decidir el título de cabecera ("TICKET DE
// VENTA" vs "COMPROBANTE" para SERVICES). Opcional para no romper
// fixtures viejas: si viene `undefined` el renderer cae al copy de
// retail/hospitality (comportamiento de hoy).
export type TicketBusinessType = "HOSPITALITY" | "RETAIL" | "SERVICES";

export interface TicketMeta {
  internalNumber: string;
  publicSlug: string;
  issuedAt: Date;
  cashierName: string;
  registerName: string;
  businessType?: TicketBusinessType;
  // v1.3-Servicios-Pinta · Lote 3: profesional que atendió. Texto
  // libre (≤60 chars), opcional. El renderer lo imprime entre cabecera
  // y líneas SOLO si está presente y `businessType === "SERVICES"`.
  attendedBy?: string;
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
