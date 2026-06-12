// Cálculo y validación de totales de un ticket (B4 §1.2). Vive aparte
// porque lo usan el endpoint POST /tickets, el worker upload-ticket (al
// construir el payload Holded) y los tests.
//
// v1.4-Precio-Decimales · b30:
//
//   Antes (bug): el precio NET se almacenaba como Decimal(10,2) →
//   truncábamos `3.8843 → 3.88` al sincronizar desde Holded. Resultado:
//   gross/línea = round2(3.88·1.21) = 4.69, mientras que Holded factura
//   3.8843·1.21 = 4.70 → 1 céntimo de drift por unidad, multiplicado por
//   la cantidad y por las líneas del ticket.
//
//   Ahora: persistimos NET con 4 decimales y el cálculo no redondea por
//   línea hasta el último paso. Por bucket de IVA agregamos netos en
//   precisión completa, aplicamos el % de IVA al agregado y redondeamos
//   UNA SOLA VEZ al final (esquema fiscal correcto). Así el total del
//   TPV coincide con el de Holded.

export interface TicketLineInput {
  units: number;
  unitPrice: number; // bruto antes de descuento — precisión 4 decimales
  discountPct: number; // 0..100
  taxRate: number; // 0..100
}

export interface ComputedLine {
  // subtotal SIN IVA después del descuento de línea, redondeado a 2dec
  // para mostrar al cajero y persistir como display final.
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

// Calcula la línea individual con redondeo a 2 decimales para display.
// El cálculo interno usa precisión IEEE-754 (≈15 dígitos decimales —
// muy por encima de los 4 decimales necesarios para precios NET). El
// redondeo a 2 dec sólo ocurre al producir los valores que verá el
// cajero. La agregación del ticket (computeTicket) reagrega los netos
// crudos por bucket de IVA antes de redondear → evita drift línea-a-línea.
export function computeLine(line: TicketLineInput): ComputedLine {
  const netPerUnit = line.unitPrice * (1 - line.discountPct / 100);
  const subtotalRaw = netPerUnit * line.units;
  const totalRaw = subtotalRaw * (1 + line.taxRate / 100);
  const subtotal = round2(subtotalRaw);
  const total = round2(totalRaw);
  return { subtotal, total, tax: round2(total - subtotal) };
}

export interface TicketTotals {
  subtotal: number;
  tax: number;
  total: number;
  discount: number;
  lines: ComputedLine[];
}

// Agrega netos por bucket de IVA en precisión completa, aplica IVA al
// agregado de cada bucket y redondea al final. Esto reproduce la
// aritmética fiscal de Holded (que mantiene 4 decimales internamente)
// y elimina el drift de céntimos que existía cuando redondeábamos por
// línea sobre un net truncado a 2 decimales.
export function computeTicket(lines: TicketLineInput[]): TicketTotals {
  const computed = lines.map(computeLine);

  // netPerLineRaw[i] = unitPrice(4dec) · (1 - descuento) · units, SIN
  // redondear. Lo usamos para agregar por bucket de IVA sin perder
  // precisión. (computed[i].subtotal está redondeado a 2dec; sirve sólo
  // para display, no para reagregar.)
  const netPerLineRaw = lines.map(
    (l) => l.unitPrice * (1 - l.discountPct / 100) * l.units,
  );

  // Bucket: { taxRate → suma de netos crudos }. Una clave por cada tipo
  // de IVA presente en el ticket. Aplicamos el % de IVA al agregado del
  // bucket, no a cada línea por separado.
  const bucketsByTaxRate = new Map<number, number>();
  for (let i = 0; i < lines.length; i += 1) {
    const rate = lines[i]!.taxRate;
    bucketsByTaxRate.set(
      rate,
      (bucketsByTaxRate.get(rate) ?? 0) + netPerLineRaw[i]!,
    );
  }

  let subtotalAgg = 0;
  let taxAgg = 0;
  let totalAgg = 0;
  for (const [taxRate, netSum] of bucketsByTaxRate) {
    const taxForBucket = netSum * (taxRate / 100);
    subtotalAgg += netSum;
    taxAgg += taxForBucket;
    totalAgg += netSum + taxForBucket;
  }

  // grossNoDiscount lo usamos para reportar el "descuento total"
  // (subtotal teórico sin descuento − subtotal real). Agrega precios
  // completos sin descuento por línea, en precisión 4 dec.
  const grossNoDiscount = lines.reduce(
    (acc, l) => acc + l.unitPrice * l.units,
    0,
  );

  return {
    subtotal: round2(subtotalAgg),
    tax: round2(taxAgg),
    total: round2(totalAgg),
    discount: round2(grossNoDiscount - subtotalAgg),
    lines: computed,
  };
}

// Suma de `priceDeltaCents` del snapshot estructurado de modifiers
// (B-Bar-Modifiers). Devuelve 0 si el campo es null, string[] legacy o
// no es array. Compartido por POST /tickets, operativa de mesa y
// grouping — el unitPrice persistido es siempre el BASE y el delta se
// aplica al recalcular totales.
export function readUnitPriceDeltaCents(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  let sum = 0;
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      "priceDeltaCents" in entry &&
      typeof (entry as { priceDeltaCents?: unknown }).priceDeltaCents ===
        "number"
    ) {
      sum += (entry as { priceDeltaCents: number }).priceDeltaCents;
    }
  }
  return sum;
}

export function totalsClose(a: number, b: number, tolerance = TOTAL_TOLERANCE_EUR): boolean {
  return Math.abs(a - b) <= tolerance + 1e-9;
}

export function paymentsClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= PAYMENT_TOLERANCE_EUR + 1e-9;
}
