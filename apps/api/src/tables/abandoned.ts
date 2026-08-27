// v1.12-mesas-abandonadas · el barrido de mesas que nadie soltó.
//
// Hallazgo (BD de producción, 2026-08-20, confirmado el 26): Cafetería
// Sirope tiene cuatro mesas ocupadas desde el 9 de julio —M1, M2 y M4 de
// `gemmamgc72`, y T1—, todas a 0,00 €. Nadie las abrió a propósito: un
// toque en el mapa crea el `Ticket DRAFT` con `tableId` y desde ese
// momento la mesa está ocupada para siempre. Un mapa de sala con cuatro
// mesas falsas ocupadas deja de ser un mapa.
//
// Esto es la misma idea que v1.11 una capa más abajo: el estado que nadie
// apaga. Por eso NO es un job nuevo — se engancha a la pasada horaria del
// corte de día, que ya sabe la hora local de cada tenant.
//
// La regla, entera:
//
//   Un DRAFT con `tableId`, SIN NI UNA LÍNEA, creado antes del último
//   corte de día de su tenant, se anula (`VOIDED`) y su mesa queda libre.
//
// Y su contrario, que importa más:
//
//   Un DRAFT CON LÍNEAS no se toca JAMÁS, tenga la edad que tenga.
//
// Puede ser una cuenta de verdad que se quedó a medias; anularla es
// borrar una comanda. Esos van a `listAbandonedTables` — una lista en el
// admin para que lo resuelva una persona, que es de quien es la decisión.

import type { getPrisma } from "../context.js";
import { crossedDayCut } from "../shift/day-cut.js";
import { voidDraftTicket } from "./void-draft.js";

// Umbral del aviso (punto 2 del bloque): un DRAFT con líneas que lleva
// más de un día abierto ya no es una mesa en servicio. No es un criterio
// de corte —no se anula nada por esto—, es cuándo aparece en la lista.
export const ABANDONED_WITH_LINES_HOURS = 24;

export interface AbandonedSweepOutcome {
  ticketId: string;
  tenantId: string;
  tableId: string | null;
  storeId: string;
  openedAt: string;
  voidedAt: string;
}

export interface AbandonedSweepLog {
  info: (obj: object, msg: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

/**
 * Una pasada completa del barrido. Devuelve un outcome por mesa liberada.
 *
 * Un fallo en un tenant no aborta los demás — mismo criterio que
 * `runShiftDayCut`: la sala de un bar no puede quedarse mintiendo porque
 * a otro tenant le petara una fila.
 */
export async function runAbandonedTableSweep(args: {
  prisma: ReturnType<typeof getPrisma>;
  log: AbandonedSweepLog;
  now?: Date;
}): Promise<{
  scanned: number;
  released: AbandonedSweepOutcome[];
  keptWithLines: number;
  failed: number;
}> {
  const { prisma, log } = args;
  const now = args.now ?? new Date();

  // Los DRAFT con mesa de todos los tenants, con su hora de corte al
  // lado. Son pocos por definición (una fila por mesa ocupada ahora
  // mismo en toda la plataforma), así que una query basta.
  const drafts = await prisma.ticket.findMany({
    where: { status: "DRAFT", tableId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      tenantId: true,
      tableId: true,
      createdAt: true,
      register: { select: { storeId: true } },
      tenant: { select: { id: true, dayCutHour: true } },
      _count: { select: { lines: true } },
    },
  });

  const released: AbandonedSweepOutcome[] = [];
  let keptWithLines = 0;
  let failed = 0;

  for (const draft of drafts) {
    // Con líneas no se toca, punto. Ni aquí ni con 43 días encima.
    if (draft._count.lines > 0) {
      keptWithLines += 1;
      continue;
    }
    if (!crossedDayCut(draft.createdAt, now, draft.tenant.dayCutHour)) continue;
    try {
      const voided = await voidDraftTicket({
        prisma,
        ticketId: draft.id,
        tenantId: draft.tenantId,
        reason: "AUTO_ABANDONED_EMPTY",
        // NULL = SISTEMA. Igual que `closedByUserId` en el corte de día:
        // no le atribuimos a nadie algo que hizo el servidor.
        byUserId: null,
        note: "[LIBERADA] Mesa vacía desde antes del corte de día (v1.12)",
        // La red de seguridad de la carrera: si un camarero teclea la
        // primera línea entre la lectura de arriba y este update, el
        // WHERE deja de casar y la comanda se salva.
        requireEmpty: true,
        now,
      });
      if (!voided.ok) {
        // Ni error ni mesa liberada: alguien la usó mientras barríamos.
        log.info(
          {
            event: "tables.abandoned.skipped",
            ticketId: draft.id,
            tenantId: draft.tenantId,
            code: voided.code,
          },
          "mesa abandonada: el draft dejó de estar vacío durante la pasada; no se toca",
        );
        continue;
      }
      const outcome: AbandonedSweepOutcome = {
        ticketId: draft.id,
        tenantId: draft.tenantId,
        tableId: draft.tableId,
        storeId: draft.register.storeId,
        openedAt: draft.createdAt.toISOString(),
        voidedAt: now.toISOString(),
      };
      released.push(outcome);
      log.info(
        { event: "tables.abandoned.released", ...outcome },
        "mesa liberada: draft vacío de antes del corte de día",
      );
    } catch (err) {
      failed += 1;
      log.error(
        {
          err,
          event: "tables.abandoned.failed",
          ticketId: draft.id,
          tenantId: draft.tenantId,
        },
        "mesa abandonada: no se pudo anular el draft vacío",
      );
    }
  }

  return { scanned: drafts.length, released, keptWithLines, failed };
}

export interface AbandonedTableRow {
  ticketId: string;
  tableId: string | null;
  tableName: string | null;
  total: string;
  lineCount: number;
  openedAt: string;
  openedByEmail: string | null;
  openedByAlias: string | null;
}

/**
 * Las que SÍ tienen dinero dentro: la lista del admin.
 *
 * DRAFT con líneas y más de `ABANDONED_WITH_LINES_HOURS` de antigüedad.
 * Es un aviso, no una acción: aquí no se anula nada — se enseña para que
 * una persona cobre o anule con PIN.
 */
export async function listAbandonedTables(
  prisma: ReturnType<typeof getPrisma>,
  tenantId: string,
  storeId: string,
  now: Date = new Date(),
): Promise<AbandonedTableRow[]> {
  const cutoff = new Date(
    now.getTime() - ABANDONED_WITH_LINES_HOURS * 60 * 60 * 1000,
  );
  const drafts = await prisma.ticket.findMany({
    where: {
      tenantId,
      status: "DRAFT",
      tableId: { not: null },
      createdAt: { lt: cutoff },
      table: { storeId, deletedAt: null },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      tableId: true,
      total: true,
      createdAt: true,
      table: { select: { name: true } },
      user: { select: { email: true, alias: true } },
      _count: { select: { lines: true } },
    },
  });
  return drafts
    // Sin líneas no entra: esa la suelta el barrido de madrugada sin
    // molestar a nadie. Aquí sólo lo que tiene consumo dentro.
    .filter((d) => d._count.lines > 0)
    .map((d) => ({
      ticketId: d.id,
      tableId: d.tableId,
      tableName: d.table?.name ?? null,
      total: d.total.toString(),
      lineCount: d._count.lines,
      openedAt: d.createdAt.toISOString(),
      openedByEmail: d.user?.email ?? null,
      openedByAlias: d.user?.alias ?? null,
    }));
}
