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

export function computeLine(
  line: Pick<
    CartLine,
    "units" | "unitPrice" | "discountPct" | "taxRate"
  > & { modifierSelections?: ModifierSelection[] },
): LineTotals {
  const deltaPerUnit = sumModifierDeltas(line.modifierSelections) / 100;
  const grossPerUnit = (line.unitPrice + deltaPerUnit) * (1 - line.discountPct / 100);
  const subtotalNet = round2(grossPerUnit * line.units);
  const totalGross = round2(subtotalNet * (1 + line.taxRate / 100));
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

export function computeCart(lines: CartLine[]): CartTotals {
  let subtotalNet = 0;
  let tax = 0;
  let total = 0;
  let grossNoDiscount = 0;
  let itemCount = 0;
  for (const l of lines) {
    const t = computeLine(l);
    subtotalNet += t.subtotalNet;
    tax += t.tax;
    total += t.totalGross;
    // "Bruto sin descuento" para el cálculo del % global de descuento
    // incluye los deltas de modificadores — son parte del precio "lista".
    const deltaPerUnit = sumModifierDeltas(l.modifierSelections) / 100;
    grossNoDiscount += round2((l.unitPrice + deltaPerUnit) * l.units);
    itemCount += l.units;
  }
  return {
    subtotalNet: round2(subtotalNet),
    tax: round2(tax),
    total: round2(total),
    discount: round2(grossNoDiscount - subtotalNet),
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
