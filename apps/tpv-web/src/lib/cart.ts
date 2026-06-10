// Modelo del carrito en cliente. Lo mantiene SalePage en useState, lo
// persiste suspender/recuperar en localStorage, y CheckoutPage lo
// transforma al payload para POST /tickets.

// B-Bar-Modifiers: cada selección estructurada lleva el desnormalizado
// completo. El TPV lo calcula a partir del catálogo en memoria al
// confirmar el modal — no se vuelve a consultar al cobrar. El backend
// re-valida groupId/modifierId contra el catálogo del tenant y persiste
// el mismo snapshot en TicketLine.modifiers para auditoría inmutable.
export interface ModifierSelection {
  groupId: string;
  groupName: string;
  modifierId: string;
  label: string;
  priceDeltaCents: number;
}

export interface CartLine {
  // ID local — UUID v4 por línea (independiente del producto, porque la
  // misma referencia puede aparecer dos veces con modificadores distintos).
  id: string;
  productId: string | null;
  variantId: string | null;
  holdedProductId: string | null;
  sku: string;
  nameSnapshot: string;
  units: number;
  // BASE sin deltas — los suplementos de modificadores viven en
  // `modifierSelections` y `computeLine` los suma a runtime. Mantener
  // `unitPrice` "limpio" hace fácil renderizar el desglose "X € + delta".
  unitPrice: number;
  // v1.2-Lite Lote 4.B · T-5: si el cajero modifica el precio puntualmente
  // con el lápiz, queda aquí. null = sin override. Cuando hay override,
  // computeLine lo usa como base (los deltas de modificadores se siguen
  // aplicando encima). El payload del POST /tickets envía este valor y
  // mantiene unitPrice como histórico del catálogo.
  unitPriceOverride: number | null;
  priceGross: number; // unitPrice * (1 + taxRate/100) — sin modifiers
  discountPct: number;
  taxRate: number;
  // Modificadores ad-hoc tipeados por el cajero ("Sin azúcar").
  modifiers: string[];
  // Modificadores estructurados (selección desde el modal).
  modifierSelections?: ModifierSelection[];
}

export interface SuspendedCart {
  id: string;
  label: string;
  createdAt: string;
  lines: CartLine[];
  contactHoldedId?: string;
  // T-3 (v1.1 Thalia): nombre del cliente snapshotted al suspender,
  // para que la lista de "Pendientes" lo muestre sin tener que ir a
  // BD. Opcional: carritos suspendidos antes de v1.1 no lo tienen.
  contactName?: string;
  notes?: string;
}

const SUSPENDED_KEY = "mipiacetpv-suspended-carts";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface LineTotals {
  subtotalNet: number;
  tax: number;
  totalGross: number;
}

// v1.4-Precio-Decimales · b30: el `unitPrice` que llega a esta función
// es el NET con precisión de 4 decimales (tal como lo persiste Holded
// internamente, p.ej. `3.8843`). El cálculo intermedio NO redondea hasta
// el último paso: subtotal neto = units · (base + delta), gross = sub ·
// (1+IVA). El redondeo a 2 decimales sólo ocurre al devolver el valor
// que verá el cajero — y `computeCart` reagrega los netos crudos por
// bucket de IVA antes de redondear (esquema fiscal correcto).
export function computeLine(
  line: Pick<
    CartLine,
    "units" | "unitPrice" | "discountPct" | "taxRate"
  > & {
    modifierSelections?: ModifierSelection[];
    // v1.2-Lite Lote 4.B: override del cajero (lápiz). Si está
    // presente, prevalece sobre unitPrice del catálogo.
    unitPriceOverride?: number | null;
  },
): LineTotals {
  const deltaPerUnit = sumModifierDeltas(line.modifierSelections) / 100;
  const baseUnit =
    line.unitPriceOverride != null ? line.unitPriceOverride : line.unitPrice;
  const netPerUnit = (baseUnit + deltaPerUnit) * (1 - line.discountPct / 100);
  // Mantén los valores crudos hasta el último round2. Si redondeamos
  // subtotalNet a 2 decimales y luego multiplicamos por (1+IVA) perdemos
  // los cuatro decimales del NET y reaparece el drift de 1 céntimo.
  const subtotalNetRaw = netPerUnit * line.units;
  const totalGrossRaw = subtotalNetRaw * (1 + line.taxRate / 100);
  const subtotalNet = round2(subtotalNetRaw);
  const totalGross = round2(totalGrossRaw);
  return {
    subtotalNet,
    tax: round2(totalGross - subtotalNet),
    totalGross,
  };
}

export function sumModifierDeltas(
  selections: ModifierSelection[] | undefined,
): number {
  if (!selections) return 0;
  let sum = 0;
  for (const s of selections) sum += s.priceDeltaCents;
  return sum;
}

export interface CartTotals {
  subtotalNet: number;
  tax: number;
  total: number;
  discount: number;
  itemCount: number;
}

// v1.4-Precio-Decimales · b30: para el total del carrito agregamos los
// netos crudos POR BUCKET DE IVA (sin redondear por línea) y aplicamos
// el % de IVA al neto agregado del bucket. Esto reproduce la aritmética
// de Holded y evita el drift de 1 céntimo que aparecía al redondear cada
// línea por separado.
export function computeCart(lines: CartLine[]): CartTotals {
  // bucketNetByRate[taxRate] = suma de netos crudos (4dec) por bucket.
  const bucketNetByRate = new Map<number, number>();
  let grossNoDiscount = 0;
  let itemCount = 0;
  for (const l of lines) {
    const deltaPerUnit = sumModifierDeltas(l.modifierSelections) / 100;
    const baseUnit =
      l.unitPriceOverride != null ? l.unitPriceOverride : l.unitPrice;
    const netPerUnit = (baseUnit + deltaPerUnit) * (1 - l.discountPct / 100);
    const netLineRaw = netPerUnit * l.units;
    bucketNetByRate.set(
      l.taxRate,
      (bucketNetByRate.get(l.taxRate) ?? 0) + netLineRaw,
    );
    // "Bruto sin descuento" para el cálculo del % global de descuento
    // incluye los deltas de modificadores — son parte del precio "lista".
    // En precisión 4dec; el redondeo final ocurre abajo.
    grossNoDiscount += (baseUnit + deltaPerUnit) * l.units;
    itemCount += l.units;
  }

  let subtotalNetRaw = 0;
  let taxRaw = 0;
  let totalRaw = 0;
  for (const [taxRate, netSum] of bucketNetByRate) {
    const taxBucket = netSum * (taxRate / 100);
    subtotalNetRaw += netSum;
    taxRaw += taxBucket;
    totalRaw += netSum + taxBucket;
  }

  return {
    subtotalNet: round2(subtotalNetRaw),
    tax: round2(taxRaw),
    total: round2(totalRaw),
    discount: round2(grossNoDiscount - subtotalNetRaw),
    itemCount,
  };
}

export function getSuspendedCarts(): SuspendedCart[] {
  const raw = localStorage.getItem(SUSPENDED_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as SuspendedCart[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveSuspendedCart(cart: SuspendedCart): void {
  const list = getSuspendedCarts().filter((c) => c.id !== cart.id);
  list.unshift(cart);
  localStorage.setItem(SUSPENDED_KEY, JSON.stringify(list.slice(0, 20)));
}

export function removeSuspendedCart(id: string): void {
  const list = getSuspendedCarts().filter((c) => c.id !== id);
  localStorage.setItem(SUSPENDED_KEY, JSON.stringify(list));
}
