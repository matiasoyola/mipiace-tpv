// agenda-1 · LO COBRADO DE CADA CITA.
//
// La columna izquierda del tablero 1 lleva tres cifras del día: citas,
// cobrado y minutos libres. Y las filas de las citas ya hechas dicen
// «Cobrada · 25 €».
//
// ── Por qué no sale del catálogo ─────────────────────────────────────
//
// Porque sumar el precio de catálogo de los servicios RESERVADOS es
// exactamente el fallo que clinica-8 cerró: cobrar la previsión en vez del
// trabajo. En una clínica la cita se reserva como «Cura» y la consulta
// acaba siendo una quiropodia completa; el importe de verdad está en el
// ticket, y es el único número que cuadra con el arqueo.
//
// Así que esto lee el TICKET de la cita y nada más. Una cita sin ticket no
// aparece en el mapa, y la pantalla no dice «0 €»: dice «Hecha».
//
// ── Y por qué no sale del arqueo del turno ───────────────────────────
//
// Porque el arqueo es del TURNO ABIERTO y esta cifra es de un DÍA que
// puede ser el martes pasado. Y porque el arqueo incluye la venta suelta
// (unas plantillas, un producto) que no es de ninguna cita. La cifra de la
// agenda contesta «cuánto ha dejado la agenda de hoy», que no es lo mismo
// que «cuánto hay en el cajón» — y mezclarlas sería dar dos nombres al
// mismo número en dos pantallas.
//
// ── Qué cuenta como cobrado ──────────────────────────────────────────
//
// Los cuatro estados en los que el dinero YA ENTRÓ: `PAID` y los tres de
// la subida a Holded (`PENDING_SYNC`, `SYNCED`, `SYNC_FAILED`) — que un
// envío falle no devuelve el dinero. Fuera quedan:
//
//   · `DRAFT`     · cobro empezado y no terminado. Es justo lo que
//                   `sesionesPorCobrarDe` cuenta como PENDIENTE.
//   · `VOIDED`    · anulado.
//   · `ON_CREDIT` · entregado y NO cobrado (v1.8-Fiado). Sumarlo diría que
//                   hay dinero que no hay.
//   · `TEST`      · el cajero técnico del ensayo. Nunca fue dinero.

import type { PrismaClient } from "@mipiacetpv/db";

export interface RangoCobrado {
  tenantId: string;
  desde: Date;
  hasta: Date;
}

/** Los estados de ticket en los que el dinero ya entró. */
const COBRADOS = ["PAID", "PENDING_SYNC", "SYNCED", "SYNC_FAILED"] as const;

/**
 * `appointmentId` → céntimos cobrados, para las citas del rango que tienen
 * un ticket cobrado. Las que no, no están en el mapa.
 *
 * Céntimos enteros y no un decimal: el total del ticket es
 * `Decimal(12,4)`, y un `number` con decimales que viaja por JSON y se
 * suma en el front es cómo se consigue «57,999999 €» en una tarjeta.
 */
export async function cobradoPorCitaDe(
  prisma: PrismaClient,
  input: RangoCobrado,
): Promise<Record<string, number>> {
  const filas = await prisma.$queryRawUnsafe<
    Array<{ id: string; total_cents: bigint | number }>
  >(
    `SELECT a.id, round(t.total * 100)::bigint AS total_cents
       FROM appointments a
       JOIN tickets t ON t.id = a.ticket_id
      WHERE a.tenant_id = $1::uuid
        AND a.timeslot && tstzrange($2::timestamptz, $3::timestamptz, '[)')
        AND t.status = ANY($4::text[])`,
    input.tenantId,
    input.desde.toISOString(),
    input.hasta.toISOString(),
    [...COBRADOS],
  );
  const fuera: Record<string, number> = {};
  for (const f of filas) fuera[f.id] = Number(f.total_cents);
  return fuera;
}
