// Modelo del carrito en cliente. Lo mantiene SalePage en useState, lo
// persiste suspender/recuperar en localStorage, y CheckoutPage lo
// transforma al payload para POST /tickets.

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
  unitPrice: number; // bruto antes de descuento (sin IVA)
  priceGross: number; // unitPrice * (1 + taxRate/100)
  discountPct: number;
  taxRate: number;
  modifiers: string[];
}

export interface SuspendedCart {
  id: string;
  label: string;
  createdAt: string;
  lines: CartLine[];
  contactHoldedId?: string;
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

export function computeLine(line: Pick<CartLine, "units" | "unitPrice" | "discountPct" | "taxRate">): LineTotals {
  const grossPerUnit = line.unitPrice * (1 - line.discountPct / 100);
  const subtotalNet = round2(grossPerUnit * line.units);
  const totalGross = round2(subtotalNet * (1 + line.taxRate / 100));
  return {
    subtotalNet,
    tax: round2(totalGross - subtotalNet),
    totalGross,
  };
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
    grossNoDiscount += round2(l.unitPrice * l.units);
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
