// v1.12-mesas-abandonadas · el ÚNICO camino que anula un ticket DRAFT.
//
// Hasta v1.12 la anulación vivía entera dentro del handler de
// `DELETE /tickets/:ticketId` ("vaciar mesa" desde el TPV). El bloque
// añade dos actores más —el barrido del corte de día y el botón "Anular"
// del admin con PIN de encargado— y los tres tienen que hacer exactamente
// lo mismo: reclamar el DRAFT, marcarlo VOIDED con su auditoría, y avisar
// al mapa de que la mesa quedó libre. Un segundo camino sería un segundo
// sitio donde olvidarse de liberar la mesa.
//
// Lo que NO hace, a propósito:
//   - No decide si el draft se puede anular por su antigüedad ni por su
//     importe. Eso es política de cada llamante (el barrido sólo toca
//     vacíos y antiguos; el admin exige PIN). Aquí sólo está el `requireEmpty`
//     como red de seguridad de la carrera, no como criterio de negocio.
//   - No toca `internalNumber`: un DRAFT nunca consumió serie fiscal.

import { getPrisma } from "../context.js";
import { getStoreEventBus } from "../realtime/store-event-bus.js";

export type VoidDraftReason = "MANUAL" | "AUTO_ABANDONED_EMPTY" | "MANAGER_VOID";

export interface VoidDraftOk {
  ok: true;
  ticketId: string;
  tableId: string | null;
  storeId: string;
  lineCount: number;
  total: string;
}

export type VoidDraftFailure =
  // No existe, no es de este tenant, o ya no está en DRAFT.
  | { ok: false; code: "NOT_DRAFT" }
  // Tiene líneas y el llamante pidió `requireEmpty`. Un draft con
  // consumo no se anula sin que lo pulse una persona.
  | { ok: false; code: "NOT_EMPTY"; lineCount: number }
  // La reclamación no ganó: entre la lectura y el update alguien cobró
  // la mesa, la anuló, o —el caso que importa— le metió una línea.
  | { ok: false; code: "RACED" };

/**
 * DRAFT → VOIDED, con auditoría y liberando la mesa.
 *
 * La reclamación es un `updateMany` condicionado (mismo patrón que el
 * checkout de B7 y que el corte de día de v1.11): la condición viaja en
 * el WHERE, así que la carrera la resuelve Postgres y no nosotros.
 *
 * Con `requireEmpty`, el `lines: { none: {} }` del WHERE es lo que
 * garantiza que el barrido de las 05:00 NO borra la comanda que un
 * camarero acaba de teclear mientras corría la pasada.
 */
export async function voidDraftTicket(args: {
  prisma: ReturnType<typeof getPrisma>;
  ticketId: string;
  tenantId: string;
  reason: VoidDraftReason;
  // Quién lo anuló. NULL = SISTEMA (el barrido del corte de día).
  byUserId: string | null;
  // Texto que se concatena a `notes`, como hacía "vaciar mesa" desde el
  // primer día. La columna `voidReason` dice el porqué en máquina; esto
  // lo dice en cristiano para quien mire el ticket.
  note?: string | null;
  requireEmpty?: boolean;
  now?: Date;
}): Promise<VoidDraftOk | VoidDraftFailure> {
  const { prisma, ticketId, tenantId, reason, byUserId } = args;
  const now = args.now ?? new Date();

  const draft = await prisma.ticket.findFirst({
    where: { id: ticketId, tenantId, status: "DRAFT" },
    select: {
      id: true,
      tableId: true,
      notes: true,
      total: true,
      register: { select: { storeId: true } },
      _count: { select: { lines: true } },
    },
  });
  if (!draft) return { ok: false, code: "NOT_DRAFT" };
  if (args.requireEmpty && draft._count.lines > 0) {
    return { ok: false, code: "NOT_EMPTY", lineCount: draft._count.lines };
  }

  const claimed = await prisma.ticket.updateMany({
    where: {
      id: draft.id,
      tenantId,
      status: "DRAFT",
      ...(args.requireEmpty ? { lines: { none: {} } } : {}),
    },
    data: {
      status: "VOIDED",
      voidReason: reason,
      voidedAt: now,
      voidedByUserId: byUserId,
      notes: args.note ?? draft.notes,
    },
  });
  if (claimed.count === 0) return { ok: false, code: "RACED" };

  if (draft.tableId) {
    // Bus in-memory (B7 §6): sólo llega a los devices conectados a ESTA
    // instancia de api. Desde el worker del corte de día no llega a
    // nadie —proceso distinto— y no pasa nada: el mapa del TPV repolla
    // cada 30 s y el barrido corre a las 05:00.
    getStoreEventBus().broadcast(draft.register.storeId, {
      type: "table.cleared",
      tableId: draft.tableId,
      ticketId: draft.id,
      reason: args.note ?? null,
      at: now.toISOString(),
    });
  }

  return {
    ok: true,
    ticketId: draft.id,
    tableId: draft.tableId,
    storeId: draft.register.storeId,
    lineCount: draft._count.lines,
    total: draft.total.toString(),
  };
}
