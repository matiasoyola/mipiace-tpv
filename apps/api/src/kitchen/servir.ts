// auditoria-sirope (#22) · COBRAR CIERRA LO QUE ESTABA «LISTO».
//
// ── Lo que pasó el 18-10 ──────────────────────────────────────────────
//
// Se cobró la T6. La mesa quedó libre en el mapa **con la etiqueta
// LISTO** puesta, el AP11 la seguía «esperando» en su columna de listas,
// y la banda «T6 · listo para servir» siguió apareciendo encima de las
// ventas siguientes. Tres pantallas distintas contando que había comida
// esperando a una mesa que ya se había ido. (Capturas 73, 74, 81.)
//
// El motivo: una comanda sale de la pantalla de cocina con `servedAt`, y
// `servedAt` sólo lo ponía UN sitio — el toque del camarero en la banda
// (`POST /kitchen/comandas/:orderId/servido`). Cobrar no lo tocaba.
//
// ── La regla ──────────────────────────────────────────────────────────
//
// Cuando un ticket deja de estar vivo —se cobra o se vacía— lo que esté
// LISTO y sin servir pasa a servido, con el MISMO evento que el toque del
// camarero (`kitchen.order_served`) para que se apague a la vez en todos
// los TPV y en la tablet.
//
// Lo que NO se toca, y es la mitad de la decisión:
//
//   · Las comandas que **no están listas**. Un plato en la plancha sigue
//     en la plancha aunque la cuenta esté pagada: la cocina tiene que
//     verlo y decidir. Marcarlo servido lo haría desaparecer de la
//     pantalla con el pedido a medio hacer.
//   · El CHECK `kitchen_orders_cronologia` exige `served_at >=
//     ready_at`, así que servir algo sin `readyAt` ni siquiera sería
//     legal en la base.
//
// `servedByUserId` es el cajero que cobró. No es mentira: fue su gesto el
// que cerró el servicio.

import type { Prisma } from "@mipiacetpv/db";

import { emitirComandaServida } from "./eventos.js";

export interface ComandaServida {
  orderId: string;
  storeId: string;
  ticketId: string;
  tableId: string | null;
}

/**
 * Marca como servidas las comandas LISTAS de un ticket. Devuelve las que
 * cambiaron, para emitir sus eventos **fuera** de la transacción.
 *
 * Los eventos van fuera por lo mismo que en `enviarComanda`: son avisos,
 * la verdad está en el GET de cocina, y emitirlos dentro haría que una
 * pantalla pidiera ese GET antes del commit y no viera el cambio.
 */
export async function servirComandasListas(
  tx: Prisma.TransactionClient,
  opts: { ticketId: string; byUserId: string | null; now: Date },
): Promise<ComandaServida[]> {
  const listas = await tx.kitchenOrder.findMany({
    where: {
      ticketId: opts.ticketId,
      readyAt: { not: null },
      servedAt: null,
    },
    select: { id: true, storeId: true, ticketId: true, tableId: true },
  });
  if (listas.length === 0) return [];
  await tx.kitchenOrder.updateMany({
    where: { id: { in: listas.map((o) => o.id) } },
    data: { servedAt: opts.now, servedByUserId: opts.byUserId },
  });
  return listas.map((o) => ({
    orderId: o.id,
    storeId: o.storeId,
    ticketId: o.ticketId,
    tableId: o.tableId,
  }));
}

/** El aviso de que se apague en todas las pantallas. Mismo evento que el
 *  toque del camarero. */
export function avisarComandasServidas(
  servidas: readonly ComandaServida[],
  at: Date,
): void {
  for (const s of servidas) {
    emitirComandaServida({
      storeId: s.storeId,
      orderId: s.orderId,
      ticketId: s.ticketId,
      tableId: s.tableId,
      at,
    });
  }
}
