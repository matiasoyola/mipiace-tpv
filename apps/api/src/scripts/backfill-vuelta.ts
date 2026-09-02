// v1.15-la-vuelta-existe §2 · CLI del backfill del histórico.
//
// Uso:
//   pnpm --filter @mipiacetpv/api backfill:vuelta            # sólo informa
//   pnpm --filter @mipiacetpv/api backfill:vuelta -- --apply # escribe
//
// Sin `--apply` no toca nada: imprime el mismo recuento que el SELECT de
// `docs/blocks/v1-15-la-vuelta-existe-done.md` (cuántos tickets llevan el
// error de B1 dentro y por cuánto importe), para poder decidir si el
// backfill entra en la ventana de despliegue o va aparte.
//
// Idempotente: la segunda pasada informa de 0 tickets y no escribe. Ver
// `tickets/backfill-vuelta.ts` para el porqué.
//
// El filtro de entrada es deliberadamente ancho —todo ticket con
// `cashAmount` no nulo— y el descarte lo hace la función pura, para que
// el informe pueda enseñar también lo que NO se toca.

import "dotenv/config";

import { Prisma } from "@mipiacetpv/db";

import { getPrisma, shutdown } from "../context.js";
import {
  planVueltaBackfill,
  type BackfillTicketRow,
} from "../tickets/backfill-vuelta.js";

function eur(n: number): string {
  return `${n.toFixed(2)} €`;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const prisma = getPrisma();

  console.log("─".repeat(72));
  console.log("Mipiacetpv · v1.15 · backfill de la vuelta (B1)");
  console.log(apply ? "MODO: APLICAR (escribe)" : "MODO: informe (no escribe)");
  console.log("─".repeat(72));

  const rows = await prisma.ticket.findMany({
    where: { cashAmount: { not: null } },
    select: {
      id: true,
      tenantId: true,
      internalNumber: true,
      createdAt: true,
      total: true,
      cashAmount: true,
      payments: { select: { id: true, method: true, amount: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const tickets: BackfillTicketRow[] = rows.map((t) => ({
    id: t.id,
    internalNumber: t.internalNumber,
    total: Number(t.total),
    cashAmount: t.cashAmount != null ? Number(t.cashAmount) : null,
    payments: t.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amount: Number(p.amount),
    })),
  }));

  const plan = planVueltaBackfill(tickets);
  const byId = new Map(rows.map((t) => [t.id, t]));

  console.log(`Tickets con efectivo declarado examinados: ${tickets.length}`);
  console.log(`Tickets afectados por B1:                  ${plan.tickets.length}`);
  console.log(`Importe inflado a corregir:                ${eur(plan.excessTotal)}`);
  if (plan.tickets.length > 0) {
    const first = byId.get(plan.tickets[0]!.ticketId)!;
    const last = byId.get(plan.tickets[plan.tickets.length - 1]!.ticketId)!;
    console.log(
      `Rango:                                     ${first.createdAt.toISOString()} → ${last.createdAt.toISOString()}`,
    );
    const perTenant = new Map<string, { count: number; excess: number }>();
    for (const p of plan.tickets) {
      const tid = byId.get(p.ticketId)!.tenantId;
      const acc = perTenant.get(tid) ?? { count: 0, excess: 0 };
      acc.count += 1;
      acc.excess = Math.round((acc.excess + p.excess) * 100) / 100;
      perTenant.set(tid, acc);
    }
    console.log("Por tenant:");
    for (const [tid, acc] of perTenant) {
      console.log(`  ${tid}  ${String(acc.count).padStart(6)} tickets  ${eur(acc.excess)}`);
    }
  }
  if (plan.skipped.length > 0) {
    console.log("");
    console.log(
      `NO se tocan ${plan.skipped.length} tickets con Σ payments > total que no encajan en el patrón:`,
    );
    for (const s of plan.skipped) {
      console.log(
        `  #${s.internalNumber}  total ${eur(s.total)}  Σ pagos ${eur(s.paymentsSumBefore)}  · ${s.reason}`,
      );
    }
  }

  if (!apply) {
    console.log("");
    console.log("Informe únicamente. Vuelve a lanzarlo con --apply para escribir.");
    return;
  }
  if (plan.tickets.length === 0) {
    console.log("");
    console.log("Nada que escribir.");
    return;
  }

  let updated = 0;
  // Una transacción por ticket: son `update` sobre PK de `ticket_payments`
  // y no hay ninguna razón para tomar un lock largo sobre toda la tabla en
  // una base de producción con el TPV vendiendo.
  for (const t of plan.tickets) {
    await prisma.$transaction(
      t.updates.map((u) =>
        prisma.ticketPayment.update({
          where: { id: u.paymentId },
          data: { amount: new Prisma.Decimal(u.to) },
        }),
      ),
    );
    updated += t.updates.length;
  }

  console.log("");
  console.log(
    `Hecho. ${plan.tickets.length} tickets corregidos, ${updated} filas de pago actualizadas, ${eur(plan.excessTotal)} retirados de las ventas.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => shutdown());
