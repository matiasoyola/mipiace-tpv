// B-reservas-5 §4 · censo de borradores huérfanos del puente cita→caja.
//
// Uso:
//   pnpm --filter @mipiacetpv/api audit:appointment-drafts
//   pnpm --filter @mipiacetpv/api audit:appointment-drafts -- --tenant=<uuid>
//
// SÓLO LEE Y CUENTA. El borrado va en un segundo paso, con el recuento
// delante — que es la razón de que este script exista antes que él.
//
// Qué busca. Hasta B-reservas-5, "Cobrar en caja" abría un ticket DRAFT
// pre-poblado, lo enlazaba a la cita… y después el cobro salía por
// `POST /tickets`, que creaba un ticket NUEVO. Resultado: un DRAFT vivo
// para siempre, enlazado a una cita cuyo dinero está en otro sitio.
//
// Cómo se detecta, en dos poblaciones distintas y separadas a propósito:
//
//   A · HUÉRFANOS CON COBRO AL LADO. La cita apunta a un DRAFT y existe
//       en el mismo turno otra venta cobrada por el importe del DRAFT.
//       Es el caso del bug: el dinero está, pero en otro ticket.
//   B · BORRADORES SIN COBRO IDENTIFICADO. La cita apunta a un DRAFT y no
//       aparece nada que cuadre. Puede ser el bug con un cobro que no
//       casa por importe, o simplemente una cita que se abrió en caja y
//       nadie llegó a cobrar. NO se pueden mezclar: borrar la población B
//       sin mirar sería borrar cobros pendientes de verdad.
//
// El emparejamiento de A es una HEURÍSTICA (mismo tenant, mismo turno,
// importe igual, cobrado después de crearse el borrador). Se dice aquí
// para que nadie lea el recuento como una certeza: lo que este script
// produce es una lista para mirar, no una orden de borrado.
//
// Hoy en producción esto debería dar CERO en las dos poblaciones: la
// agenda nunca se ha encendido (`agendaEnabled` apagado en todos los
// tenants). Es higiene preventiva y una red por si alguien la encendió.

import "dotenv/config";

import { getPrisma, shutdown } from "../context.js";

interface OrphanRow {
  tenantId: string;
  tenantName: string;
  appointmentId: string;
  appointmentStatus: string;
  draftTicketId: string;
  draftTotal: string;
  draftCreatedAt: Date;
  // Ticket cobrado que parece llevarse el dinero de esa cita (población A).
  paidTicketId: string | null;
  paidInternalNumber: string | null;
  paidAt: Date | null;
}

function eur(v: string | number): string {
  return `${Number(v).toFixed(2)} €`;
}

async function main(): Promise<void> {
  const tenantArg = process.argv
    .find((a) => a.startsWith("--tenant="))
    ?.slice("--tenant=".length);

  const prisma = getPrisma();

  // Una sola consulta: el LEFT JOIN lateral trae el candidato a cobro. Se
  // escribe en SQL porque `appointments.timeslot` es `tstzrange` y Prisma
  // no lo modela (B4 §Decisiones 2) — y porque el emparejamiento es un
  // LATERAL que el query builder no expresa.
  const rows = await prisma.$queryRawUnsafe<OrphanRow[]>(
    `
    SELECT a.tenant_id                        AS "tenantId",
           t.name                             AS "tenantName",
           a.id                               AS "appointmentId",
           a.status::text                     AS "appointmentStatus",
           d.id                               AS "draftTicketId",
           d.total::text                      AS "draftTotal",
           d.created_at                       AS "draftCreatedAt",
           p.id                               AS "paidTicketId",
           p.internal_number                  AS "paidInternalNumber",
           p.paid_at                          AS "paidAt"
      FROM appointments a
      JOIN tickets d  ON d.id = a.ticket_id
      JOIN tenants t  ON t.id = a.tenant_id
      LEFT JOIN LATERAL (
        SELECT p.id, p.internal_number, p.paid_at
          FROM tickets p
         WHERE p.tenant_id = d.tenant_id
           AND p.shift_id  = d.shift_id
           AND p.id       <> d.id
           AND p.status NOT IN ('DRAFT', 'VOIDED')
           AND p.paid_at IS NOT NULL
           AND p.paid_at >= d.created_at
           AND p.total = d.total
         ORDER BY p.paid_at ASC
         LIMIT 1
      ) p ON TRUE
     WHERE d.status = 'DRAFT'
       ${tenantArg ? "AND a.tenant_id = $1::uuid" : ""}
     ORDER BY t.name, d.created_at
    `,
    ...(tenantArg ? [tenantArg] : []),
  );

  const conCobro = rows.filter((r) => r.paidTicketId !== null);
  const sinCobro = rows.filter((r) => r.paidTicketId === null);

  console.log("");
  console.log("B-reservas-5 · borradores de cita que siguen en DRAFT");
  console.log("=".repeat(72));
  if (tenantArg) console.log(`Filtrado por tenant ${tenantArg}`);
  console.log("");

  console.log(
    `A · Con un cobro que cuadra al lado (el bug): ${conCobro.length}`,
  );
  for (const r of conCobro) {
    console.log(
      `    ${r.tenantName} · cita ${r.appointmentId} (${r.appointmentStatus})`,
    );
    console.log(
      `      borrador ${r.draftTicketId} ${eur(r.draftTotal)} creado ${r.draftCreatedAt.toISOString()}`,
    );
    console.log(
      `      cobrado en el ticket ${r.paidInternalNumber} (${r.paidTicketId}) el ${r.paidAt?.toISOString()}`,
    );
  }

  console.log("");
  console.log(`B · Sin cobro identificado (MIRAR ANTES DE TOCAR): ${sinCobro.length}`);
  for (const r of sinCobro) {
    console.log(
      `    ${r.tenantName} · cita ${r.appointmentId} (${r.appointmentStatus})`,
    );
    console.log(
      `      borrador ${r.draftTicketId} ${eur(r.draftTotal)} creado ${r.draftCreatedAt.toISOString()}`,
    );
  }

  const totalA = conCobro.reduce((acc, r) => acc + Number(r.draftTotal), 0);
  const totalB = sinCobro.reduce((acc, r) => acc + Number(r.draftTotal), 0);

  console.log("");
  console.log("-".repeat(72));
  console.log(
    `TOTAL: ${rows.length} borradores · A=${conCobro.length} (${eur(totalA)}) · B=${sinCobro.length} (${eur(totalB)})`,
  );
  if (rows.length === 0) {
    console.log("Nada que limpiar.");
  } else {
    console.log("");
    console.log("Este script NO borra nada. El borrado va en un segundo");
    console.log("paso, con este recuento delante y decidido a mano.");
  }
  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void shutdown());
