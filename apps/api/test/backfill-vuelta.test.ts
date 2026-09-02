// v1.15-la-vuelta-existe §2 · el plan del backfill del histórico.
//
// Lo que fija este archivo es lo que pide el bloque: que reste la
// diferencia a la fila CASH, que no toque los tickets sin efectivo ni
// los fiados, y que **la segunda pasada no cambie nada**.

import { describe, expect, it } from "vitest";

import {
  planVueltaBackfill,
  type BackfillTicketRow,
} from "../src/tickets/backfill-vuelta.js";

/** Aplica el plan sobre las filas, como haría el `--apply` del script. */
function apply(
  tickets: BackfillTicketRow[],
  plan: ReturnType<typeof planVueltaBackfill>,
): BackfillTicketRow[] {
  const byPayment = new Map(
    plan.tickets.flatMap((t) => t.updates.map((u) => [u.paymentId, u.to])),
  );
  return tickets.map((t) => ({
    ...t,
    payments: t.payments.map((p) =>
      byPayment.has(p.id) ? { ...p, amount: byPayment.get(p.id)! } : p,
    ),
  }));
}

// #000020 de la auditoría: 3,00 € pagados con un billete de 5.
function ticketConBug(): BackfillTicketRow {
  return {
    id: "t-20",
    internalNumber: "000020",
    total: 3,
    cashAmount: 5,
    payments: [{ id: "p-20", method: "CASH", amount: 5 }],
  };
}

// #000019: 4,70 € clavados.
function ticketSano(): BackfillTicketRow {
  return {
    id: "t-19",
    internalNumber: "000019",
    total: 4.7,
    cashAmount: 4.7,
    payments: [{ id: "p-19", method: "CASH", amount: 4.7 }],
  };
}

describe("planVueltaBackfill", () => {
  it("resta la diferencia a la fila CASH", () => {
    const plan = planVueltaBackfill([ticketConBug()]);
    expect(plan.tickets).toHaveLength(1);
    expect(plan.excessTotal).toBe(2);
    expect(plan.tickets[0]!.updates).toEqual([
      { paymentId: "p-20", from: 5, to: 3 },
    ]);
  });

  it("no toca los tickets que ya cuadran", () => {
    const plan = planVueltaBackfill([ticketSano()]);
    expect(plan.tickets).toHaveLength(0);
    expect(plan.excessTotal).toBe(0);
  });

  it("no toca los tickets sin efectivo (no es el patrón de B1)", () => {
    const plan = planVueltaBackfill([
      {
        id: "t-card",
        internalNumber: "000021",
        total: 10,
        cashAmount: null,
        payments: [{ id: "p-card", method: "CARD", amount: 12 }],
      },
    ]);
    expect(plan.tickets).toHaveLength(0);
    expect(plan.skipped).toEqual([
      expect.objectContaining({ internalNumber: "000021", reason: "sin-cash-amount" }),
    ]);
  });

  it("no toca los fiados: nacen sin pagos y sus cobros ya vienen topeados", () => {
    const plan = planVueltaBackfill([
      {
        id: "t-credit",
        internalNumber: "000022",
        total: 8,
        cashAmount: null,
        payments: [],
      },
      {
        id: "t-credit-cobrado",
        internalNumber: "000023",
        total: 8,
        cashAmount: null,
        payments: [{ id: "p-c1", method: "CASH", amount: 8 }],
      },
    ]);
    expect(plan.tickets).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
  });

  it("mixto: el recorte cae en el efectivo y la tarjeta se queda como está", () => {
    const plan = planVueltaBackfill([
      {
        id: "t-mix",
        internalNumber: "000024",
        total: 4.7,
        cashAmount: 5,
        payments: [
          { id: "p-cash", method: "CASH", amount: 5 },
          { id: "p-card", method: "CARD", amount: 2.7 },
        ],
      },
    ]);
    expect(plan.tickets[0]!.updates).toEqual([
      { paymentId: "p-cash", from: 5, to: 2 },
    ]);
  });

  it("exceso que no cabe en el efectivo: se lista, no se toca", () => {
    const plan = planVueltaBackfill([
      {
        id: "t-raro",
        internalNumber: "000025",
        total: 10,
        cashAmount: 1,
        payments: [
          { id: "p-cash", method: "CASH", amount: 1 },
          { id: "p-card", method: "CARD", amount: 15 },
        ],
      },
    ]);
    expect(plan.tickets).toHaveLength(0);
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        internalNumber: "000025",
        reason: "sin-efectivo-suficiente",
      }),
    ]);
  });

  it("la segunda pasada no cambia nada", () => {
    const antes = [ticketConBug(), ticketSano()];
    const plan1 = planVueltaBackfill(antes);
    const despues = apply(antes, plan1);
    expect(despues[0]!.payments[0]!.amount).toBe(3);

    const plan2 = planVueltaBackfill(despues);
    expect(plan2.tickets).toHaveLength(0);
    expect(plan2.excessTotal).toBe(0);
    expect(plan2.skipped).toHaveLength(0);
    expect(apply(despues, plan2)).toEqual(despues);
  });

  it("el turno de la auditoría queda cuadrado tras el backfill", () => {
    const antes = [ticketSano(), ticketConBug()];
    const despues = apply(antes, planVueltaBackfill(antes));
    const ventas = despues
      .flatMap((t) => t.payments)
      .reduce((acc, p) => acc + p.amount, 0);
    // Antes del backfill este Z decía 9,70 €.
    expect(Math.round(ventas * 100) / 100).toBe(7.7);
  });
});
