// Lote 4 v1.1 Thalia: helpers de emisión de eventos ticket-level a
// través del bus realtime. Encapsulan el lookup de storeId del
// register + email del cashier (para que las páginas suscritas
// muestren quién hizo qué sin pegar otro round-trip).
//
// Los helpers son defensivos: si el register o el user no existen
// (datos inconsistentes que no deberían darse), no emitimos y NO
// lanzamos — el realtime es best-effort, no debe tumbar el handler
// que cobró el ticket.

import type { PrismaClient } from "@mipiacetpv/db";

import { getStoreEventBus } from "./store-event-bus.js";

export interface EmitTicketPaidParams {
  prisma: PrismaClient;
  ticketId: string;
  internalNumber: string | null;
  registerId: string;
  cashierUserId: string;
  tableId: string | null;
  totalEur: number;
}

export async function emitTicketPaid(params: EmitTicketPaidParams): Promise<void> {
  try {
    // v1.9.5-formacion · Frente 2: además del storeId, cargamos el
    // nombre de la caja y (si hay) el de la mesa para que el banner de
    // concurrencia nombre caja y mesa reales en vez de «otra caja».
    const [register, user, table] = await Promise.all([
      params.prisma.register.findUnique({
        where: { id: params.registerId },
        select: { storeId: true, name: true },
      }),
      params.prisma.user.findUnique({
        where: { id: params.cashierUserId },
        select: { email: true },
      }),
      params.tableId
        ? params.prisma.table.findUnique({
            where: { id: params.tableId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);
    if (!register || !user) return;
    getStoreEventBus().broadcast(register.storeId, {
      type: "ticket.paid",
      ticketId: params.ticketId,
      internalNumber: params.internalNumber,
      registerId: params.registerId,
      registerName: register.name ?? null,
      tableId: params.tableId,
      tableName: table?.name ?? null,
      byEmail: user.email,
      totalEur: params.totalEur,
      at: new Date().toISOString(),
    });
  } catch {
    // Realtime es best-effort. Un fallo aquí no debe escalar.
  }
}

export interface EmitTicketRefundedParams {
  prisma: PrismaClient;
  refundId: string;
  originalTicketId: string;
  registerId: string;
  cashierUserId: string;
  totalEur: number;
}

export async function emitTicketRefunded(
  params: EmitTicketRefundedParams,
): Promise<void> {
  try {
    const [register, user] = await Promise.all([
      params.prisma.register.findUnique({
        where: { id: params.registerId },
        select: { storeId: true },
      }),
      params.prisma.user.findUnique({
        where: { id: params.cashierUserId },
        select: { email: true },
      }),
    ]);
    if (!register || !user) return;
    getStoreEventBus().broadcast(register.storeId, {
      type: "ticket.refunded",
      refundId: params.refundId,
      originalTicketId: params.originalTicketId,
      registerId: params.registerId,
      byEmail: user.email,
      totalEur: params.totalEur,
      at: new Date().toISOString(),
    });
  } catch {
    /* best-effort */
  }
}
