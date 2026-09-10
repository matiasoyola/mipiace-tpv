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

import { getPrisma, shutdown } from "../context.js";
import {
  planVueltaBackfill,
  type BackfillTicketRow,
} from "../tickets/backfill-vuelta.js";
import {
  CorrectionRejectedError,
  recordTicketCorrection,
} from "../tickets/corrections.js";

// S1-sello · el autor que queda en `ticket_corrections`. El convenio para
// lo que no es una persona es `script:<nombre>`.
const AUTHOR = "script:backfill-vuelta";

// S1-sello · el motivo por defecto. Es el que documenta v1.15: los pagos
// de estos tickets llevaban dentro el importe ENTREGADO en vez del
// cobrado (B1), y esta pasada retira la diferencia. Se puede sustituir
// con `--motivo="..."` — lo que no se puede es no dar ninguno.
const DEFAULT_REASON =
  "v1.15-la-vuelta-existe §2 · backfill B1: el pago llevaba el efectivo entregado en vez del aplicado; se retira la vuelta.";

function eur(n: number): string {
  return `${n.toFixed(2)} €`;
}

function readReason(argv: string[]): string {
  const flag = argv.find((a) => a.startsWith("--motivo="));
  return flag ? flag.slice("--motivo=".length) : DEFAULT_REASON;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const reason = readReason(process.argv);
  const prisma = getPrisma();

  // S1-sello · el guardia RUIDOSO. Este script escribe sobre
  // `ticket_payments` de ventas ya cobradas: es literalmente el caso que
  // motivó el bloque (12 tickets y 161,57 € en v1.15, indistinguibles
  // después de una manipulación). Ahora escribe por la vía de corrección,
  // y sin motivo no arranca — mejor que se pare aquí, con un mensaje, que
  // reventar a mitad de la pasada con un error del motor.
  if (reason.trim() === "") {
    console.error(
      "Una corrección sin motivo no se escribe. Usa --motivo=\"...\" o deja el motivo por defecto.",
    );
    process.exitCode = 1;
    return;
  }

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
  const rejected: Array<{ internalNumber: string; message: string }> = [];
  // Una transacción por ticket: son `update` sobre PK de `ticket_payments`
  // y no hay ninguna razón para tomar un lock largo sobre toda la tabla en
  // una base de producción con el TPV vendiendo.
  //
  // S1-sello · el `ticketPayment.update` directo desapareció. Un pago de
  // una venta sellada sólo se toca por `record_ticket_correction`, que
  // deja quién, cuándo, valor anterior, valor nuevo y motivo. Si un día
  // alguien vuelve a necesitar un backfill como este, la traza existirá
  // sin que tenga que acordarse de escribirla.
  for (const t of plan.tickets) {
    const row = byId.get(t.ticketId)!;
    try {
      await prisma.$transaction(async (tx) => {
        for (const u of t.updates) {
          await recordTicketCorrection(tx, {
            table: "ticket_payments",
            rowId: u.paymentId,
            field: "amount",
            newValue: u.to.toFixed(4),
            reason: `${reason} (#${row.internalNumber}: ${u.from.toFixed(2)} € → ${u.to.toFixed(2)} €)`,
            author: AUTHOR,
          });
        }
      });
      updated += t.updates.length;
    } catch (err) {
      // Ruidoso, no silencioso: se informa del ticket que no se pudo
      // corregir y se sigue con el resto. Al final el resumen lo dice y
      // el proceso sale con código de error.
      const message =
        err instanceof CorrectionRejectedError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      console.error(`  ✗ #${row.internalNumber}: ${message}`);
      rejected.push({ internalNumber: row.internalNumber, message });
    }
  }

  console.log("");
  console.log(
    `Hecho. ${plan.tickets.length - rejected.length} tickets corregidos, ${updated} filas de pago actualizadas, ${eur(plan.excessTotal)} retirados de las ventas.`,
  );
  if (rejected.length > 0) {
    console.error("");
    console.error(
      `${rejected.length} tickets NO se pudieron corregir. Nada se escribió para ellos.`,
    );
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => shutdown());
