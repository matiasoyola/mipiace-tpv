// hierro-sirope (A) · EL BARRIDO DE LAS COMANDAS HUÉRFANAS.
//
// Una comanda huérfana es la de un ticket que ya no está vivo —se cobró o
// se vació— y que sigue sin servir. Desde este bloque no se fabrican:
// `marcarListaYServirSiHuerfana` las sirve en el momento en que se marcan
// Lista, por los dos caminos. Pero quedan dos huecos que esa regla no
// tapa, y los tapa esto:
//
//   · **la que nunca se marca Lista.** La mesa se vació con un plato en
//     la plancha, la cocina no lo tacha —se tira, al fin y al cabo— y la
//     tarjeta se queda en la pantalla. Al día siguiente sigue ahí.
//   · **las de antes del bloque.** T6 y M1 llevan en el AP11 desde el
//     18-10. Para ésas hay además un script de limpieza única
//     (`scripts/servir-comandas-huerfanas.ts`), porque el barrido sólo
//     corre cuando cruza el corte del día.
//
// ── Por qué en el corte de día y no en el acto ────────────────────────
//
// Porque la otra mitad de la decisión de `auditoria-sirope` (#22) sigue en
// pie: **un plato en la plancha sigue en la plancha**. Una comanda sin
// marcar Lista cuya mesa se acaba de vaciar tiene que seguir viéndose en
// la cocina durante el servicio: alguien la está haciendo y tiene derecho
// a enterarse por la pantalla, no porque la tarjeta desaparezca sola.
//
// Al cruzar el corte del día eso deja de ser cierto: el servicio acabó, no
// queda nadie a quien avisar, y lo único que hace la tarjeta es ensuciar
// la pantalla de mañana.
//
// Las no listas se cierran con `readyAt = servedAt = ahora` y no sólo con
// `servedAt`: el CHECK `kitchen_orders_cronologia` exige que servido
// implique listo, y además «se terminó sin que nadie la tachara» es
// exactamente lo que pasó.

import type { getPrisma } from "../context.js";
import { crossedDayCut } from "../shift/day-cut.js";
import {
  avisarComandasServidas,
  ticketSigueVivo,
  type ComandaServida,
} from "./servir.js";

export interface HuerfanaBarrida {
  orderId: string;
  ticketId: string;
  tenantId: string;
  storeId: string;
  tableName: string | null;
  section: string;
  /** `true` si ni siquiera estaba marcada Lista. */
  sinMarcar: boolean;
  sentAt: string;
}

export interface HuerfanasLog {
  info: (obj: object, msg: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

/**
 * Una pasada completa. Sirve las comandas de tickets muertos que cruzaron
 * el corte de día de su tenant.
 *
 * Un fallo en una comanda no aborta las demás, mismo criterio que
 * `runAbandonedTableSweep`.
 */
export async function runComandasHuerfanasSweep(args: {
  prisma: ReturnType<typeof getPrisma>;
  log: HuerfanasLog;
  now?: Date;
}): Promise<{
  scanned: number;
  servidas: HuerfanaBarrida[];
  /** Las que siguen vivas: su ticket sigue siendo un borrador. */
  vivas: number;
  failed: number;
}> {
  const { prisma, log } = args;
  const now = args.now ?? new Date();

  // Sin servir y con el ticket muerto. Son pocas por definición: una fila
  // por comanda pendiente ahora mismo en toda la plataforma.
  const abiertas = await prisma.kitchenOrder.findMany({
    where: { servedAt: null },
    orderBy: { sentAt: "asc" },
    select: {
      id: true,
      ticketId: true,
      storeId: true,
      tableId: true,
      tableName: true,
      section: true,
      sentAt: true,
      readyAt: true,
      ticket: {
        select: {
          status: true,
          tenantId: true,
          tenant: { select: { dayCutHour: true } },
        },
      },
    },
  });

  const servidas: HuerfanaBarrida[] = [];
  const eventos: ComandaServida[] = [];
  let vivas = 0;
  let failed = 0;

  for (const o of abiertas) {
    if (ticketSigueVivo(o.ticket.status)) {
      vivas += 1;
      continue;
    }
    // Lo de hoy no se toca: el servicio puede estar en marcha.
    if (!crossedDayCut(o.sentAt, now, o.ticket.tenant.dayCutHour)) continue;
    try {
      // El `where` repite `servedAt: null` para que dos pasadas a la vez
      // —o el toque de un camarero en mitad del barrido— no se pisen.
      const escrita = await prisma.kitchenOrder.updateMany({
        where: { id: o.id, servedAt: null },
        data: {
          ...(o.readyAt == null
            ? { readyAt: now, readyByDeviceId: null }
            : {}),
          servedAt: o.readyAt == null ? now : maxFecha(o.readyAt, now),
          // NULL = SISTEMA, igual que `closedByUserId` en el corte de día:
          // no le atribuimos a nadie algo que hizo el servidor.
          servedByUserId: null,
        },
      });
      if (escrita.count === 0) continue;
      const fila: HuerfanaBarrida = {
        orderId: o.id,
        ticketId: o.ticketId,
        tenantId: o.ticket.tenantId,
        storeId: o.storeId,
        tableName: o.tableName,
        section: o.section,
        sinMarcar: o.readyAt == null,
        sentAt: o.sentAt.toISOString(),
      };
      servidas.push(fila);
      eventos.push({
        orderId: o.id,
        storeId: o.storeId,
        ticketId: o.ticketId,
        tableId: o.tableId,
      });
      log.info(
        { event: "kitchen.huerfana.servida", ...fila },
        "comanda huérfana: su ticket ya no estaba vivo y cruzó el corte de día",
      );
    } catch (err) {
      failed += 1;
      log.error(
        { err, event: "kitchen.huerfana.failed", orderId: o.id },
        "comanda huérfana: no se pudo servir",
      );
    }
  }

  // El bus es in-memory: desde el worker del corte de día esto no llega a
  // ningún TPV (mismo caso que `tables.cleared` en `void-draft.ts`) y no
  // pasa nada —a las 05:00 no hay nadie mirando y la pantalla repolla—.
  // Se emite igual porque la pasada también se llama desde el e2e y desde
  // el proceso de la API, y ahí sí llega.
  avisarComandasServidas(eventos, now);

  return { scanned: abiertas.length, servidas, vivas, failed };
}

function maxFecha(a: Date, b: Date): Date {
  return a.getTime() > b.getTime() ? a : b;
}
