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

// ── hierro-sirope (A) · LA COMANDA HUÉRFANA ───────────────────────────
//
// Lo que la pasada del 18-10 reprodujo (capturas 37–41):
//
//   1. M5 con un café enviado a BARRA, SIN marcar Lista.
//   2. «Vaciar mesa» → Invitación. La mesa queda libre. La tarjeta sigue
//      en el AP11, que es la decisión de arriba y se mantiene.
//   3. Cocina pulsa «Lista» → la tarjeta pasa a «Listas» y AHÍ SE QUEDA
//      PARA SIEMPRE: M5 sale con LISTO en el mapa estando libre y la
//      banda «M5 · listo para servir» tapa cualquier venta en todos los
//      TPV. Nadie la puede servir: su ticket ya no existe.
//
// Es el estado exacto de la T6 (nueve horas «esperando» en el AP11) y de
// M1. `servirComandasListas` sólo sirve lo que YA tiene `readyAt`; el
// `readyAt` que llega DESPUÉS no lo miraba nadie.
//
// ── La regla ──────────────────────────────────────────────────────────
//
// Una comanda cuyo ticket ya no está vivo se SIRVE SOLA en el momento en
// que se marca Lista, en la misma transacción que pone `readyAt`, con
// `servedByUserId = null` —no fue nadie— y con el mismo evento
// `kitchen.order_served` que el toque del camarero. Así cocina ve que la
// ha terminado (sale de pendientes) y desaparece a la vez de «Listas»,
// del mapa y de las bandas.
//
// Los DOS caminos que ponen `readyAt` pasan por aquí —el toque online del
// KDS (`kitchen/routes.ts`) y la marca que sube por LAN (`kitchen/lan.ts`)—
// porque una regla escrita dos veces es una regla que se arregla una vez.
// Tiene su fila en la tabla de sabotajes.
//
// `servedAt = readyAt` y no `now`: el CHECK `kitchen_orders_cronologia`
// exige que servir no sea anterior a estar listo, y la marca de la tablet
// puede venir del pasado (subida al volver la red). El mismo instante es
// además lo honesto: no la sirvió nadie, se cerró en el momento en que
// quedó lista.

/** Un ticket vivo es el que todavía se puede cobrar: el borrador. */
export function ticketSigueVivo(status: string): boolean {
  return status === "DRAFT";
}

export interface MarcarListaOpts {
  orderId: string;
  /** La pantalla que la marcó. */
  deviceId: string;
  /** La hora que se escribe en `readyAt` (la de la tablet por LAN). */
  at: Date;
  /**
   * LAN: una tarjeta ya lista con una hora ANTERIOR no se mueve —la
   * primera vez que estuvo lista es la que cuenta para el tiempo de
   * cocina—. El toque online no lo necesita: comprueba antes que no
   * estaba lista.
   */
  soloSiPosterior?: boolean;
}

/**
 * Pone «Lista» y, si su ticket ya no está vivo, la sirve en el acto.
 *
 * Devuelve la comanda servida para que el llamante emita su evento
 * **fuera** de la transacción, por el mismo motivo que
 * `servirComandasListas`: el evento hace que una pantalla pida el GET de
 * cocina, y emitirlo dentro la haría pedirlo antes del commit.
 */
export async function marcarListaYServirSiHuerfana(
  tx: Prisma.TransactionClient,
  opts: MarcarListaOpts,
): Promise<ComandaServida | null> {
  await tx.kitchenOrder.updateMany({
    where: opts.soloSiPosterior
      ? {
          id: opts.orderId,
          OR: [{ readyAt: null }, { readyAt: { gt: opts.at } }],
        }
      : { id: opts.orderId },
    data: { readyAt: opts.at, readyByDeviceId: opts.deviceId },
  });

  const order = await tx.kitchenOrder.findUnique({
    where: { id: opts.orderId },
    select: {
      id: true,
      storeId: true,
      ticketId: true,
      tableId: true,
      readyAt: true,
      servedAt: true,
      ticket: { select: { status: true } },
    },
  });
  // Sin `readyAt` no hay nada que servir (el `updateMany` no casó y la
  // tarjeta no estaba lista), y servida ya no se vuelve a servir.
  if (!order || order.readyAt == null || order.servedAt != null) return null;
  if (ticketSigueVivo(order.ticket.status)) return null;

  await tx.kitchenOrder.update({
    where: { id: order.id },
    data: { servedAt: order.readyAt, servedByUserId: null },
  });
  return {
    orderId: order.id,
    storeId: order.storeId,
    ticketId: order.ticketId,
    tableId: order.tableId,
  };
}
