// v1.15-la-vuelta-existe §1 · la puerta única por la que entran los
// pagos de un ticket, sea por venta rápida (`POST /tickets`) o por cobro
// de mesa (`POST /tickets/:id/checkout`).
//
// Hasta v1.14.1 el servidor sólo miraba que Σ payments no fuera MENOR
// que el total: un ticket de 3,00 € pagado con un billete de 5 entraba
// con `payments[0] = { CASH, 5.00 }` y se persistía tal cual. A partir de
// ahí `shift/breakdown-sums.ts` sumaba el billete en lugar de la venta y
// el Z declaraba 2,00 € de ventas y de efectivo esperado que nunca
// existieron (hallazgo B1 de la auditoría del 2026-09-02).
//
// Decisión de este bloque: **el servidor NORMALIZA, no rechaza** —
// excepto cuando el exceso no puede salir del cajón.
//
//   · Normalizar, y no rechazar, porque hay APKs 1.14.1 en la calle y
//     porque el outbox del TPV puede llevar ventas encoladas desde antes
//     de la actualización. Un 400 dejaría clavadas ventas que ya
//     ocurrieron físicamente: peor que el bug que se arregla. Al topear,
//     esos tickets viejos entran ya correctos.
//   · Rechazar cuando Σ(no efectivo) supera el total, porque ahí no hay
//     vuelta que valga: la tarjeta no devuelve cambio, así que un cobro
//     así es dinero cobrado de más al cliente y no se puede normalizar
//     sin inventarse de dónde sale. El modal de cobro ya lo bloquea
//     (`overNotRefundable`, v1.10.3-addendum); esto es la red del
//     servidor.
//
// Invariante que sale de aquí: **no se puede persistir un pago mayor que
// su parte del total.** Σ payments == total (±1 cént.) y el sobrante
// entregado vive sólo en `ticket.cashAmount`.

import { applyPaymentsToTotal } from "@mipiacetpv/ticket-model";

import { PAYMENT_TOLERANCE_EUR } from "./totals.js";

export interface PaymentRowInput {
  method: string;
  amount: number;
}

export interface NormalizedPayments<T extends PaymentRowInput> {
  /** Filas topeadas a su parte del total, sin las que quedan a cero. */
  payments: T[];
  /**
   * Efectivo entregado a persistir en `ticket.cashAmount`, o `null` si
   * el cobro no llevó efectivo y el body tampoco lo traía (el caller
   * decide entonces su propio fallback — el DRAFT, en el checkout).
   */
  cashAmount: number | null;
  /** La vuelta implicada. Sólo para el log. */
  change: number;
  /** true si hubo que recortar algo (se registra en el log del cobro). */
  capped: boolean;
}

export interface PaymentsRejection {
  error: "PAYMENT_EXCEEDS_TOTAL";
  message: string;
  total: number;
  paymentsSum: number;
}

export type NormalizeResult<T extends PaymentRowInput> =
  | { ok: true; value: NormalizedPayments<T> }
  | { ok: false; rejection: PaymentsRejection };

export function normalizeTicketPayments<T extends PaymentRowInput>(
  rows: readonly T[],
  total: number,
  bodyCashAmount: number | null | undefined,
): NormalizeResult<T> {
  const applied = applyPaymentsToTotal(rows, total, PAYMENT_TOLERANCE_EUR);

  if (applied.nonCashOverflow > 0) {
    const paymentsSum =
      Math.round(rows.reduce((acc, r) => acc + r.amount, 0) * 100) / 100;
    return {
      ok: false,
      rejection: {
        error: "PAYMENT_EXCEEDS_TOTAL",
        message:
          `Los pagos que no son en efectivo suman ${(
            applied.nonCashOverflow + total
          ).toFixed(2)} € sobre un total de ${total.toFixed(2)} €. ` +
          "Un exceso sólo es legítimo si sale del cajón: la tarjeta no devuelve cambio.",
        total,
        paymentsSum,
      },
    };
  }

  return {
    ok: true,
    value: {
      payments: applied.payments,
      cashAmount:
        bodyCashAmount != null
          ? bodyCashAmount
          : applied.cashDelivered > 0
            ? applied.cashDelivered
            : null,
      change: applied.change,
      capped: applied.capped,
    },
  };
}
