// Cálculo y validación de totales de un ticket (B4 §1.2). Vive aparte
// porque lo usan el endpoint POST /tickets, el worker upload-ticket (al
// construir el payload Holded) y los tests.
//
// Convención de redondeo: el TPV trabaja en céntimos con 2 decimales.
// La aritmética usa Number (suficiente hasta 9 billones) y redondeamos
// a 2 decimales por línea, luego sumamos. Coincide con el algoritmo
// del spike y de Holded (ver §05 del spike: Holded preserva precios
// con 2 decimales y suma redondeando línea-a-línea).

export interface TicketLineInput {
  units: number;
  unitPrice: number; // bruto antes de descuento
  discountPct: number; // 0..100
  taxRate: number; // 0..100
}

export interface ComputedLine {
  // subtotal SIN IVA después del descuento de línea, redondeado a 2dec.
  subtotal: number;
  // total CON IVA después del descuento de línea, redondeado a 2dec.
  total: number;
  // monto de IVA correspondiente a la línea, redondeado a 2dec.
  tax: number;
}

export const TOTAL_TOLERANCE_EUR = 0.05;
export const PAYMENT_TOLERANCE_EUR = 0.01;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeLine(line: TicketLineInput): ComputedLine {
  const grossPerUnit = line.unitPrice * (1 - line.discountPct / 100);
  const subtotal = round2(grossPerUnit * line.units);
  const total = round2(subtotal * (1 + line.taxRate / 100));
  const tax = round2(total - subtotal);
  return { subtotal, total, tax };
}

export interface TicketTotals {
  subtotal: number;
  tax: number;
  total: number;
  discount: number;
  lines: ComputedLine[];
}

export function computeTicket(lines: TicketLineInput[]): TicketTotals {
  const computed = lines.map(computeLine);
  const subtotal = round2(computed.reduce((acc, l) => acc + l.subtotal, 0));
  const tax = round2(computed.reduce((acc, l) => acc + l.tax, 0));
  const total = round2(computed.reduce((acc, l) => acc + l.total, 0));
  const grossNoDiscount = round2(
    lines.reduce((acc, l) => acc + l.unitPrice * l.units, 0),
  );
  // Discount como agregado de descuentos por línea (sin IVA), no
  // descuento global del ticket. Suficiente para reportar al admin.
  const subtotalNoDiscount = round2(grossNoDiscount);
  const discount = round2(subtotalNoDiscount - subtotal);
  return { subtotal, tax, total, discount, lines: computed };
}

export function totalsClose(a: number, b: number, tolerance = TOTAL_TOLERANCE_EUR): boolean {
  return Math.abs(a - b) <= tolerance + 1e-9;
}

export function paymentsClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= PAYMENT_TOLERANCE_EUR + 1e-9;
}
