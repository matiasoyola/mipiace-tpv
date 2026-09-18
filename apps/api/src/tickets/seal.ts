// S1-sello · el cálculo del sello de una venta (ADR-015 §4.1).
//
// Se calcula **en el servidor, al persistir el cobro**, nunca en el
// terminal (ADR-015 §4.2). Eso es lo que hace que el outbox offline no
// estorbe: un ticket que llega dos horas tarde entra por el mismo
// `POST /tickets` y se sella al llegar, igual que uno inmediato. No hay
// orden que respetar entre ventas — el sello es POR VENTA, no encadenado,
// que es justo lo que nos mantiene fuera del ámbito SIF (ADR-015 §2).
//
// Tres caminos de entrada lo llaman, y son tres y no dos:
//   · `POST /tickets`                    — venta rápida y outbox diferido
//   · `POST /tickets/:id/checkout`       — cobro de mesa
//   · `POST /tickets/:id/credit-payments`— el fiado, al SALDARSE
//
// El fiado se sella al saldarse y no al venderse porque su `paid_at` —
// columna sellada— es la fecha del saldo (variante B: es la fecha fiscal
// que recibe Holded). Mientras hay deuda viva el ticket no está cobrado y
// no está sellado; `credit_pending` queda fuera del sello de todos modos
// (ADR-015 §5.1).

import { createHash } from "node:crypto";

import { type Prisma, SEALED_DECIMAL_SCALE } from "@mipiacetpv/db";

/** El ticket tal y como lo necesita el sello. Deliberadamente estructural
 *  (no el tipo de Prisma): el payload se construye igual desde el cliente
 *  Prisma, desde una tx y desde un test. */
export interface SealableTicket {
  internalNumber: string | null;
  shiftId: string;
  total: unknown;
  totalTax: unknown;
  totalDiscount: unknown;
  cashAmount: unknown;
  paidAt: Date | null;
  lines: SealableLine[];
  payments: SealablePayment[];
}

export interface SealableLine {
  id: string;
  productId: string | null;
  variantId: string | null;
  holdedProductId: string | null;
  sku: string;
  nameSnapshot: string;
  units: unknown;
  unitPrice: unknown;
  unitPriceOverride: unknown;
  discountPct: unknown;
  taxRate: unknown;
  subtotal: unknown;
  total: unknown;
  modifiers: unknown;
}

export interface SealablePayment {
  id: string;
  method: string;
  amount: unknown;
  meta: unknown;
  externalId: string | null;
  collectedInShiftId: string | null;
}

/** Versión del formato del payload. Va DENTRO del hash: si algún día
 *  cambia lo que se sella, un sello v1 y uno v2 no se pueden confundir. */
export const SEAL_VERSION = 1;

export const SEAL_ALGORITHM = "sha256";

/**
 * Decimal → string con la escala EXACTA de la columna.
 *
 * `12.3` y `12.3000` son el mismo importe y tienen que dar el mismo hash.
 * Prisma devuelve `Decimal`, un SELECT crudo devuelve string y un test
 * escribe number: los tres pasan por aquí.
 */
export function sealDecimal(value: unknown, column: string): string | null {
  if (value === null || value === undefined) return null;
  const scale = SEALED_DECIMAL_SCALE[column];
  if (scale === undefined) {
    throw new Error(`sello: la columna ${column} no declara escala decimal`);
  }
  const n = Number(value.toString());
  if (!Number.isFinite(n)) {
    throw new Error(`sello: valor no numérico en ${column}: ${String(value)}`);
  }
  return n.toFixed(scale);
}

/** JSON con las claves ordenadas, recursivamente. `modifiers` y `meta`
 *  son Json de Postgres y vuelven con el orden de claves que le apetezca
 *  al motor; sin esto el sello sería una lotería. */
export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = canonicalize(src[key]);
    return out;
  }
  return value;
}

/**
 * El payload que se hashea, como string.
 *
 * **Orden de las líneas y los pagos: por `id` ascendente.** No es una
 * elección estética. `TicketLine` no tiene columna de orden —y este
 * bloque no cambia el modelo (ADR-015 §4.1)—, así que el único criterio
 * disponible que es a la vez único, presente desde el INSERT e inmutable
 * es la PK. Ordenar por un importe empataría; ordenar por `sku` empata en
 * cuanto se venden dos cafés; y "el orden en que vinieron" no existe como
 * dato. Con la PK, dos verificaciones del mismo ticket en momentos
 * distintos leen la misma secuencia.
 */
export function buildSealPayload(ticket: SealableTicket): string {
  const payload = {
    v: SEAL_VERSION,
    ticket: {
      internalNumber: ticket.internalNumber,
      // El turno al que se imputa la venta. No es un importe, pero el
      // arqueo agrupa los pagos por él: mover un ticket de turno mueve
      // la venta entera de un Z a otro sin tocar un euro.
      shiftId: ticket.shiftId,
      total: sealDecimal(ticket.total, "total"),
      totalTax: sealDecimal(ticket.totalTax, "total_tax"),
      totalDiscount: sealDecimal(ticket.totalDiscount, "total_discount"),
      cashAmount: sealDecimal(ticket.cashAmount, "cash_amount"),
      paidAt: ticket.paidAt ? new Date(ticket.paidAt).toISOString() : null,
    },
    lines: [...ticket.lines]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        holdedProductId: l.holdedProductId,
        sku: l.sku,
        nameSnapshot: l.nameSnapshot,
        units: sealDecimal(l.units, "units"),
        unitPrice: sealDecimal(l.unitPrice, "unit_price"),
        unitPriceOverride: sealDecimal(l.unitPriceOverride, "unit_price_override"),
        discountPct: sealDecimal(l.discountPct, "discount_pct"),
        taxRate: sealDecimal(l.taxRate, "tax_rate"),
        subtotal: sealDecimal(l.subtotal, "subtotal"),
        total: sealDecimal(l.total, "total"),
        modifiers: canonicalize(l.modifiers),
      })),
    payments: [...ticket.payments]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((p) => ({
        method: p.method,
        amount: sealDecimal(p.amount, "amount"),
        meta: canonicalize(p.meta),
        externalId: p.externalId,
        collectedInShiftId: p.collectedInShiftId,
      })),
  };
  return JSON.stringify(payload);
}

/** SHA-256 en hex del payload. Por venta; nunca encadenado con el sello
 *  de otra venta (ADR-015 §2 — esa frontera no se cruza). */
export function computeSealHash(ticket: SealableTicket): string {
  return createHash(SEAL_ALGORITHM).update(buildSealPayload(ticket), "utf8").digest("hex");
}

/** Lo que hay que leer de la BD para poder sellar. Un solo sitio: si
 *  mañana el payload crece, crece aquí y en `buildSealPayload`. */
export const SEAL_TICKET_SELECT = {
  internalNumber: true,
  shiftId: true,
  total: true,
  totalTax: true,
  totalDiscount: true,
  cashAmount: true,
  paidAt: true,
  lines: {
    select: {
      id: true,
      productId: true,
      variantId: true,
      holdedProductId: true,
      sku: true,
      nameSnapshot: true,
      units: true,
      unitPrice: true,
      unitPriceOverride: true,
      discountPct: true,
      taxRate: true,
      subtotal: true,
      total: true,
      modifiers: true,
    },
  },
  payments: {
    select: {
      id: true,
      method: true,
      amount: true,
      meta: true,
      externalId: true,
      collectedInShiftId: true,
    },
  },
} as const;

/** Sellar SIEMPRE ocurre dentro de la misma transacción que persiste el
 *  cobro: si el cobro hace rollback, el sello se va con él. */
type SealTxLike = Prisma.TransactionClient;

/**
 * Relee el ticket recién persistido DENTRO de la transacción, calcula el
 * sello y lo escribe. Devuelve el hash.
 *
 * Se relee a propósito en vez de sellar lo que trae el request: lo que se
 * sella es lo que quedó en la base, con las líneas y los pagos tal y como
 * los guardó el servidor. Un sello sobre el body sería un sello sobre lo
 * que dijo el terminal.
 */
export async function sealTicket(
  tx: SealTxLike,
  ticketId: string,
): Promise<{ sealedHash: string; sealedAt: Date }> {
  const row = (await tx.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: SEAL_TICKET_SELECT,
  })) as SealableTicket;
  const sealedHash = computeSealHash(row);
  const sealedAt = new Date();
  await tx.ticket.update({
    where: { id: ticketId },
    data: { sealedHash, sealedAt },
  });
  return { sealedHash, sealedAt };
}
