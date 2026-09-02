// v1.15-la-vuelta-existe §2 · el plan del backfill del histórico, como
// función pura.
//
// Los tickets emitidos antes de este bloque llevan el error dentro:
// `payments[].amount` guarda el importe ENTREGADO, no el cobrado, así
// que en un ticket de 3,00 € pagado con un billete de 5 la fila CASH
// dice 5,00. Mientras esas filas sigan ahí, cualquier Z que se reimprima
// de un turno viejo seguirá contando la vuelta como venta, y el PDF de
// ese ticket dejará de imprimir su línea "Cambio" (el cálculo nuevo mira
// entregado − aplicado, y en un ticket sin arreglar los dos son el mismo
// billete).
//
// La regla del arreglo: en los tickets con `Σ payments > total` y
// `cashAmount != null`, **restar la diferencia a las filas CASH**. No se
// tocan los tickets sin efectivo ni los fiados (nacen sin pagos y sus
// cobros de deuda ya vienen topeados contra el pendiente desde v1.8).
//
// Idempotente por construcción: después de la pasada `Σ payments` es
// igual al total, así que el filtro de entrada ya no los selecciona. La
// segunda pasada no encuentra nada y no escribe nada.
//
// Vive separado del script de CLI para que se pueda probar sin BD.

export interface BackfillPaymentRow {
  id: string;
  method: string;
  amount: number;
}

export interface BackfillTicketRow {
  id: string;
  internalNumber: string;
  total: number;
  cashAmount: number | null;
  payments: BackfillPaymentRow[];
}

export interface BackfillPaymentUpdate {
  paymentId: string;
  from: number;
  to: number;
}

export interface BackfillTicketPlan {
  ticketId: string;
  internalNumber: string;
  total: number;
  /** Σ payments antes de tocar nada. */
  paymentsSumBefore: number;
  /** Lo que sobra: `paymentsSumBefore − total`. Es la vuelta. */
  excess: number;
  updates: BackfillPaymentUpdate[];
}

export interface BackfillPlan {
  /** Tickets que se van a corregir. */
  tickets: BackfillTicketPlan[];
  /** Σ de los excesos: el dinero que el histórico declara de más. */
  excessTotal: number;
  /**
   * Tickets con `Σ payments > total` cuyo exceso NO cabe en las filas de
   * efectivo. No se tocan: restarles la diferencia dejaría una fila de
   * tarjeta por debajo de lo que se cobró de verdad. Se listan para
   * mirarlos a mano.
   */
  skipped: Array<{
    ticketId: string;
    internalNumber: string;
    total: number;
    paymentsSumBefore: number;
    reason: "sin-efectivo-suficiente" | "sin-cash-amount";
  }>;
}

const EPS = 0.005;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function planVueltaBackfill(
  tickets: readonly BackfillTicketRow[],
): BackfillPlan {
  const plan: BackfillPlan = { tickets: [], excessTotal: 0, skipped: [] };

  for (const t of tickets) {
    const paymentsSumBefore = round2(
      t.payments.reduce((acc, p) => acc + p.amount, 0),
    );
    const excess = round2(paymentsSumBefore - t.total);
    if (excess <= EPS) continue; // ticket sano: nada que hacer.

    if (t.cashAmount == null) {
      // Σ payments > total sin efectivo declarado. No es el patrón de
      // B1 y no hay forma de saber de dónde salió el exceso.
      plan.skipped.push({
        ticketId: t.id,
        internalNumber: t.internalNumber,
        total: t.total,
        paymentsSumBefore,
        reason: "sin-cash-amount",
      });
      continue;
    }

    const cashRows = t.payments.filter((p) => p.method === "CASH");
    const cashSum = round2(cashRows.reduce((acc, p) => acc + p.amount, 0));
    if (cashSum + EPS < excess) {
      plan.skipped.push({
        ticketId: t.id,
        internalNumber: t.internalNumber,
        total: t.total,
        paymentsSumBefore,
        reason: "sin-efectivo-suficiente",
      });
      continue;
    }

    // Se resta empezando por la última fila de efectivo: en el caso real
    // (una sola fila CASH) da igual, y en un mixto con dos filas de
    // efectivo deja la primera —la que el cajero tecleó primero— intacta.
    let left = excess;
    const updates: BackfillPaymentUpdate[] = [];
    for (const row of [...cashRows].reverse()) {
      if (left <= EPS) break;
      const take = Math.min(row.amount, left);
      updates.push({
        paymentId: row.id,
        from: round2(row.amount),
        to: round2(row.amount - take),
      });
      left = round2(left - take);
    }

    plan.tickets.push({
      ticketId: t.id,
      internalNumber: t.internalNumber,
      total: t.total,
      paymentsSumBefore,
      excess,
      updates,
    });
    plan.excessTotal = round2(plan.excessTotal + excess);
  }

  return plan;
}
