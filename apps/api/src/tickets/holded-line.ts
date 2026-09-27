// EL constructor de líneas de Holded. Uno solo, para la venta y para la
// devolución (bloque abonos-holded, 26-09-2026).
//
// Por qué existe este archivo: durante cuatro meses hubo DOS
// constructores. `buildTicketSalesreceiptPayload` aprendió en v1.3-hotfix8
// que una línea de SERVICIO necesita `serviceId`, y
// `buildRefundSalesreceiptPayload` nunca se enteró: seguía mandando `sku`
// para todo. Resultado: las seis devoluciones de Peluquería Sole del
// 10-09-2026 nacieron en Holded con total 0 € (23,00 € que salieron del
// cajón y allí no existen). Un arreglo en un lado que no llega al otro es
// la forma más cara que tiene este código de fallar, así que ahora la
// línea la construye una sola función y la venta y el abono se
// diferencian EXACTAMENTE en un sitio: el signo de `units`.
//
// Lo que Holded hace de verdad con un item de `salesreceipt` (probado
// contra la cuenta PRUEBAS MIPIACE el 26-09-2026, no deducido):
//
//   · `subtotal` es el precio unitario que respeta. `price` lo IGNORA.
//   · sin `subtotal`, con `sku`/`serviceId` que allí resuelve, pone el
//     precio del CATÁLOGO de Holded (se perdía el override del cajero y
//     los recargos de modificadores, sin ruido).
//   · sin `subtotal` y sin identificador que resuelva, pone 0.
//   · `units` negativas dan totales negativos, y así es como se manda un
//     abono. `discount` (%) y `tax` (%) se aplican encima. `desc` se
//     respeta tal cual.
//
// Ver `packages/holded-client/src/salesreceipt.ts` para la tabla completa.

import type { SalesreceiptItem } from "@mipiacetpv/holded-client";

// Decimal de Prisma, number, o cualquier cosa con toString(). Igual que
// lo que ya aceptaban los dos builders.
type Numish = { toString(): string } | number;

export type HoldedProductKind = "PRODUCT" | "SERVICE";

// La vista de una línea que necesita el payload. La venta la rellena con
// su `TicketLine`; la devolución, con su `RefundLine` + el `TicketLine`
// original (que es un snapshot fiscal inmutable, así que sigue siendo
// reproducible).
export interface HoldedLineSnapshot {
  nameSnapshot: string;
  units: Numish;
  unitPrice: Numish;
  // v1.2-Lite Lote 4.B: el lápiz del cajero. Manda sobre `unitPrice`.
  unitPriceOverride?: Numish | null;
  taxRate: Numish;
  discountPct: Numish;
  sku: string;
  // Discriminante producto/servicio + id de Holded. Nullable: línea libre
  // (TPV-OTROS-*) o producto borrado del catálogo.
  product?: { kind: HoldedProductKind; holdedProductId: string | null } | null;
  // Snapshot de modificadores (B-Bar-Modifiers): null, string[] legacy, o
  // object[] con `priceDeltaCents`.
  modifiers?: unknown;
}

// El ÚNICO sitio donde la venta y el abono se diferencian.
export const SALE_SIGN = 1;
export const REFUND_SIGN = -1;
export type HoldedLineSign = typeof SALE_SIGN | typeof REFUND_SIGN;

// Precio unitario REALMENTE COBRADO: override del cajero si lo hay, más
// los recargos/descuentos de los modificadores. Es el número que va en
// `subtotal` y el que tiene que cuadrar con el total del ticket o del
// abono.
export function resolveChargedUnitPrice(line: {
  unitPrice: Numish;
  unitPriceOverride?: Numish | null;
  modifiers?: unknown;
}): number {
  const base =
    line.unitPriceOverride != null
      ? Number(line.unitPriceOverride)
      : Number(line.unitPrice);
  const deltaCents = sumModifierDeltaCents(line.modifiers);
  if (deltaCents === 0) return base;
  // v1.4-Precio-Decimales · b30: NO redondeamos a 2 decimales. Holded
  // acepta 4 en el precio unitario y conservar la precisión es lo que
  // elimina el drift entre el TPV y el documento emitido.
  return round4(base + deltaCents / 100);
}

// Desglose textual de los modificadores para el `desc` del item, que
// Holded imprime debajo del nombre. Dos shapes históricos.
export function resolveModifierDesc(line: { modifiers?: unknown }): string | null {
  if (!Array.isArray(line.modifiers) || line.modifiers.length === 0) return null;
  const first = line.modifiers[0];
  if (typeof first === "string") {
    const labels = (line.modifiers as unknown[]).filter(
      (s): s is string => typeof s === "string",
    );
    return labels.length > 0 ? `(${labels.join("; ")})` : null;
  }
  const parts: string[] = [];
  for (const entry of line.modifiers as unknown[]) {
    if (entry && typeof entry === "object" && "groupName" in entry && "label" in entry) {
      const e = entry as { groupName: string; label: string };
      parts.push(`${e.groupName}: ${e.label}`);
    }
  }
  return parts.length > 0 ? `(${parts.join("; ")})` : null;
}

// Identificador con el que la línea se engancha al catálogo de Holded:
// `serviceId` (id MongoDB) para un servicio, `sku` para un producto.
// Exclusivos. Si no hay ninguno, la línea va libre — con `subtotal` sigue
// llevando su precio, pero pierde el enganche con el catálogo.
export function resolveHoldedLineIdentifier(
  line: Pick<HoldedLineSnapshot, "sku" | "product">,
): { sku?: string; serviceId?: string } {
  const isService = line.product?.kind === "SERVICE";
  const holdedId = line.product?.holdedProductId ?? null;
  if (isService && holdedId) return { serviceId: holdedId };
  if (!isService && line.sku) {
    // Incluye los `AUTO-*`: `runAutoSku` los sube a Holded con GET-back,
    // así que allí son canónicos (v1.3-hotfix8).
    return { sku: line.sku };
  }
  return {};
}

// La línea del payload. `sign` es lo único que separa una venta de un
// abono: las unidades van en negativo y el precio unitario se queda
// positivo (convención confirmada contra Holded el 26-09-2026).
export function buildHoldedLineItem(
  line: HoldedLineSnapshot,
  sign: HoldedLineSign,
): SalesreceiptItem {
  const chargedUnitPrice = resolveChargedUnitPrice(line);
  const desc = resolveModifierDesc(line);
  const units = sign * Math.abs(Number(line.units));
  return {
    name: line.nameSnapshot,
    units,
    // `subtotal` es el que lee Holded; `price` va con el mismo valor.
    subtotal: chargedUnitPrice,
    price: chargedUnitPrice,
    tax: Number(line.taxRate),
    discount: Number(line.discountPct),
    ...resolveHoldedLineIdentifier(line),
    ...(desc ? { desc } : {}),
  };
}

// Total con IVA de una línea a partir del precio cobrado. Es la cuenta
// que hace el TPV al cobrar; la devolución la repite para que el snapshot
// de `RefundLine` guarde el dinero que de verdad sale del cajón.
export function chargedLineTotal(line: {
  unitPrice: Numish;
  unitPriceOverride?: Numish | null;
  modifiers?: unknown;
  units: Numish;
  taxRate: Numish;
  discountPct: Numish;
}): number {
  const price = resolveChargedUnitPrice(line);
  const gross = price * (1 - Number(line.discountPct) / 100);
  return (
    Math.round(gross * Number(line.units) * (1 + Number(line.taxRate) / 100) * 100) / 100
  );
}

function sumModifierDeltaCents(modifiers: unknown): number {
  if (!Array.isArray(modifiers) || modifiers.length === 0) return 0;
  if (typeof modifiers[0] === "string") return 0; // legacy: sólo texto.
  let deltaCents = 0;
  for (const entry of modifiers as unknown[]) {
    if (entry && typeof entry === "object" && "priceDeltaCents" in entry) {
      const d = (entry as { priceDeltaCents?: unknown }).priceDeltaCents;
      if (typeof d === "number") deltaCents += d;
    }
  }
  return deltaCents;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
