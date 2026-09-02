// v1.15-la-vuelta-existe · la regla única de "aplicado" contra "entregado".
//
// El defecto que arregla este bloque: para el TPV la vuelta no existía.
// `CheckoutPage` mandaba las filas de pago TAL CUAL las tecleaba el
// cajero, así que un ticket de 3,00 € pagado con un billete de 5 se
// persistía como `payments[0] = { CASH, 5.00 }`. El importe entregado
// entraba en el sitio donde el resto del sistema lee el importe cobrado:
// el desglose del turno (`shift/breakdown-sums.ts`) sumaba 5,00 y el Z
// declaraba 2,00 € de ventas y de efectivo esperado que no existían.
//
// La regla, en una frase:
//
//   `payments[].amount` es lo APLICADO al total. Lo entregado de más
//   vive SÓLO en `ticket.cashAmount`, y la diferencia es el cambio.
//
// El exceso siempre sale del efectivo: un billete de 20 sobre 14 son 6
// de vuelta; 15 € en TARJETA sobre 14 son 1 € cobrado de más al cliente,
// y la tarjeta no devuelve cambio. Por eso el tope reparte el total
// dejando intactas las filas que no son efectivo y recortando el
// efectivo a lo que quede por cubrir.
//
// Vive en `ticket-model` —y no en la API ni en el front— porque los
// CUATRO caminos que tocan este número tienen que usar el mismo: el
// payload del TPV, la persistencia de la API, el cambio impreso en el
// ticket y el backfill del histórico.

/** Lo mínimo que necesita una fila de pago para repartirse. */
export interface PaymentRowLike {
  method: string;
  amount: number;
}

export interface AppliedPayments<T extends PaymentRowLike> {
  /**
   * Las filas con `amount` topeado a su parte del total y sin las que
   * quedan a cero. La suma es `min(Σ entregado, total)`.
   */
  payments: T[];
  /** Σ de las filas CASH tal como las tecleó el cajero (lo entregado). */
  cashDelivered: number;
  /** Σ de las filas CASH ya topeadas (lo cobrado en efectivo). */
  cashApplied: number;
  /** `cashDelivered − cashApplied`. La vuelta. 0 si no hubo exceso. */
  change: number;
  /** true si alguna fila se recortó (el caller puede loguearlo). */
  capped: boolean;
  /**
   * Exceso que NO sale del efectivo: Σ(no efectivo) por encima del
   * total. Un cobro así no se puede normalizar sin inventarse de dónde
   * sale la vuelta — el caller lo rechaza.
   */
  nonCashOverflow: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Reparte `total` entre las filas de pago dejando el exceso fuera.
 *
 * - Las filas que no son efectivo conservan su importe (el cajero cobró
 *   eso exacto por datáfono; un exceso ahí no es vuelta, es un cobro de
 *   más → `nonCashOverflow`).
 * - Las filas de efectivo se recortan, en orden, a lo que queda por
 *   cubrir después de las demás.
 * - Las filas que quedan a cero se descartan: un pago de 0,00 € ensucia
 *   el ticket, el desglose del Z y el recibo de Holded con un cobro que
 *   no existió.
 *
 * `tolerance` es la misma que usa la API para aceptar que la suma de
 * pagos cierre el total (1 céntimo).
 */
export function applyPaymentsToTotal<T extends PaymentRowLike>(
  rows: readonly T[],
  total: number,
  tolerance = 0.01,
): AppliedPayments<T> {
  const safeTotal = Math.max(0, round2(total));
  const isCash = (r: PaymentRowLike): boolean => r.method === "CASH";

  const cashDelivered = round2(
    rows.filter(isCash).reduce((acc, r) => acc + r.amount, 0),
  );
  const nonCashSum = round2(
    rows.filter((r) => !isCash(r)).reduce((acc, r) => acc + r.amount, 0),
  );

  const nonCashOverflow =
    nonCashSum > safeTotal + tolerance ? round2(nonCashSum - safeTotal) : 0;

  // Presupuesto que le queda al efectivo una vez descontado lo que
  // cubren las demás filas. Con `nonCashOverflow > 0` es 0 y el caller
  // ya va a rechazar, pero lo dejamos coherente igualmente.
  let cashBudget = Math.max(0, round2(safeTotal - nonCashSum));

  let capped = false;
  const payments: T[] = [];
  for (const row of rows) {
    let amount = round2(row.amount);
    if (isCash(row)) {
      const applied = Math.min(amount, cashBudget);
      if (applied < amount - 1e-9) capped = true;
      amount = round2(applied);
      cashBudget = round2(cashBudget - amount);
    }
    // Una fila a cero no se persiste. El reparto automático del modal
    // deja la última fila en 0,00 € en cuanto el cajero teclea en otra
    // un importe ≥ total, y ese cobro nunca ocurrió.
    if (amount <= 0.005) {
      if (round2(row.amount) > 0.005) capped = true;
      continue;
    }
    payments.push({ ...row, amount });
  }

  const cashApplied = round2(
    payments.filter(isCash).reduce((acc, r) => acc + r.amount, 0),
  );

  return {
    payments,
    cashDelivered,
    cashApplied,
    change: Math.max(0, round2(cashDelivered - cashApplied)),
    capped,
    nonCashOverflow,
  };
}

/**
 * La vuelta de un ticket YA persistido: lo entregado en efectivo menos
 * lo aplicado en las filas CASH.
 *
 * No usa `Σ payments − total`: desde v1.15 la suma de pagos **es** el
 * total, así que esa resta da siempre cero. Este es el cálculo que
 * imprimen el ticket térmico y el PDF.
 */
export function changeFromCash(
  payments: readonly PaymentRowLike[],
  cashAmount: number | null | undefined,
): number {
  if (cashAmount == null) return 0;
  const cashApplied = payments
    .filter((p) => p.method === "CASH")
    .reduce((acc, p) => acc + p.amount, 0);
  if (cashApplied <= 0) return 0;
  return Math.max(0, round2(cashAmount - cashApplied));
}
