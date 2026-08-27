// v1.11-cierre-de-dia · extraído de `shift/routes.ts` sin cambios de
// lógica. Lo necesitan ahora TRES caminos y no sólo dos: el cierre Z, el
// arqueo X y —nuevo— el cierre automático por corte de día, que corre en
// el worker y no puede importar el módulo de rutas.

import type { getPrisma } from "../context.js";

// Σ pagos y Σ devoluciones del turno agrupados por método, en EUR.
// Input de `computeZBreakdown` — lo usan el cierre Z y el arqueo X.
export async function loadShiftBreakdownSums(
  prisma: ReturnType<typeof getPrisma>,
  shiftId: string,
): Promise<{
  paymentsByMethod: Record<string, number>;
  refundsByMethod: Record<string, number>;
  creditCollectionsByMethod: Record<string, number>;
  creditSales: { count: number; total: number };
}> {
  const [paymentTotals, refundTotals, creditCollectionTotals, creditSalesAgg] =
    await Promise.all([
      // Ventas normales del turno: pagos de tickets vendidos AQUÍ que NO
      // son cobros de deuda (collectedInShiftId null). Excluir los cobros
      // de deuda evita contarlos dos veces (van en su propia sección) y
      // que un fiado saldado en otro turno contamine el de la venta.
      prisma.ticketPayment.groupBy({
        by: ["method"],
        where: { ticket: { shiftId }, collectedInShiftId: null },
        _sum: { amount: true },
      }),
      // v1.9.5-formacion · Frente 1: incluye refunds TEST en el desglose
      // (coherente con las ventas TEST, cuyos pagos no se filtran por
      // status). Sin efecto en turnos reales (no tienen refunds TEST).
      prisma.refund.groupBy({
        by: ["method"],
        where: { shiftId, status: { notIn: ["DRAFT", "VOIDED"] } },
        _sum: { total: true },
      }),
      // v1.8-Fiado · cobros de deuda imputados a ESTE turno (por
      // collectedInShiftId), sin importar en qué turno se vendió el fiado.
      prisma.ticketPayment.groupBy({
        by: ["method"],
        where: { collectedInShiftId: shiftId },
        _sum: { amount: true },
      }),
      // v1.8-Fiado · fiados VENDIDOS en este turno (deuda viva). No entra
      // dinero: sección informativa "Ventas a crédito (no cobradas)".
      prisma.ticket.aggregate({
        where: { shiftId, status: "ON_CREDIT" },
        _count: { _all: true },
        _sum: { total: true },
      }),
    ]);
  const paymentsByMethod: Record<string, number> = {};
  for (const row of paymentTotals) {
    paymentsByMethod[row.method] = Number(row._sum.amount ?? 0);
  }
  const refundsByMethod: Record<string, number> = {};
  for (const row of refundTotals) {
    // method null (no debería darse — el endpoint de refunds siempre lo
    // fija) cae al bucket OTHER para no perder el importe del desglose.
    const key = row.method ?? "OTHER";
    refundsByMethod[key] = (refundsByMethod[key] ?? 0) + Number(row._sum.total ?? 0);
  }
  const creditCollectionsByMethod: Record<string, number> = {};
  for (const row of creditCollectionTotals) {
    creditCollectionsByMethod[row.method] = Number(row._sum.amount ?? 0);
  }
  return {
    paymentsByMethod,
    refundsByMethod,
    creditCollectionsByMethod,
    creditSales: {
      count: creditSalesAgg._count._all,
      total: Number(creditSalesAgg._sum.total ?? 0),
    },
  };
}

