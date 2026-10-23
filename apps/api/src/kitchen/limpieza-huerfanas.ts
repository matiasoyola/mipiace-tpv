// hierro-sirope (A) · LA LIMPIEZA ÚNICA DE LO QUE YA HAY.
//
// El barrido del corte de día (`huerfanas.ts`) impide que sobreviva una
// huérfana al día siguiente **a partir de que se despliegue**. Lo que
// lleva meses en producción no lo toca nadie: la T6 de Cafetería Sirope
// lleva nueve horas «esperando» en el AP11, M1 sigue en BARRA desde el
// N1, y en la base habrá más.
//
// Esto es la pasada única que las cierra. Vive en un módulo propio —y no
// dentro del script— para que tenga banco: el sabotaje «el script escribe
// sin `--apply`» tiene que poder ponerse rojo sin lanzar un proceso.
//
// ── Las tres decisiones ───────────────────────────────────────────────
//
//   · **`--dry-run` por defecto.** Sin `--apply` no se escribe una fila.
//     Es un script que toca `kitchen_orders` de quince comercios.
//   · **Idempotente.** La segunda pasada encuentra 0: el filtro es
//     `servedAt: null`, y lo que se escribe es justamente `servedAt`.
//   · **Edad mínima, 6 h por defecto.** Una mesa que se vació hace dos
//     minutos con un plato en la plancha NO es basura histórica: la
//     cocina lo está haciendo ahora mismo y la decisión de
//     `auditoria-sirope` (#22) dice que tiene que verlo. Lo que se limpia
//     es lo viejo. Con `--edad-horas=0` se limpia todo, y es una decisión
//     que se toma a mano.

import type { getPrisma } from "../context.js";
import { ticketSigueVivo } from "./servir.js";

/** 6 h: pasado un servicio entero, lo que queda ya no lo cocina nadie. */
export const EDAD_MINIMA_HORAS = 6;

export interface FilaHuerfana {
  id: string;
  ticketId: string;
  storeId: string;
  tableName: string | null;
  section: string;
  sentAt: Date;
  readyAt: Date | null;
  ticket: { status: string; tenantId: string };
}

export interface ResumenTenant {
  tenantId: string;
  /** Las que ya estaban marcadas Lista: las que se ven en «Listas». */
  listas: number;
  /** Las que ni siquiera se tacharon. */
  sinMarcar: number;
  total: number;
}

export interface PlanLimpieza {
  /** Las que se van a servir, en el orden en que se leyeron. */
  aServir: FilaHuerfana[];
  /** Vivas: su ticket sigue siendo un borrador. No se tocan. */
  vivas: number;
  /** Demasiado recientes para esta pasada. */
  recientes: number;
  porTenant: ResumenTenant[];
}

/**
 * Qué se tocaría. Pura: ni lee ni escribe, para que el banco pueda
 * afirmar el reparto sin base de datos.
 */
export function planLimpiezaHuerfanas(
  filas: readonly FilaHuerfana[],
  opts: { now: Date; edadHoras: number },
): PlanLimpieza {
  const corte = new Date(opts.now.getTime() - opts.edadHoras * 60 * 60 * 1000);
  const aServir: FilaHuerfana[] = [];
  let vivas = 0;
  let recientes = 0;
  for (const f of filas) {
    if (ticketSigueVivo(f.ticket.status)) {
      vivas += 1;
      continue;
    }
    if (f.sentAt.getTime() > corte.getTime()) {
      recientes += 1;
      continue;
    }
    aServir.push(f);
  }
  const porTenant = new Map<string, ResumenTenant>();
  for (const f of aServir) {
    const t = f.ticket.tenantId;
    const previo =
      porTenant.get(t) ?? { tenantId: t, listas: 0, sinMarcar: 0, total: 0 };
    if (f.readyAt == null) previo.sinMarcar += 1;
    else previo.listas += 1;
    previo.total += 1;
    porTenant.set(t, previo);
  }
  return {
    aServir,
    vivas,
    recientes,
    porTenant: [...porTenant.values()].sort((a, b) =>
      a.tenantId.localeCompare(b.tenantId),
    ),
  };
}

export interface ResultadoLimpieza extends PlanLimpieza {
  /** Cuántas se escribieron de verdad. 0 en `--dry-run`. */
  escritas: number;
  apply: boolean;
}

/**
 * La pasada. **Sin `apply` no escribe nada**: eso es lo que comprueba el
 * banco del dry-run, y por eso el `updateMany` está detrás de un `if` y
 * no detrás de un parámetro que alguien pueda invertir sin darse cuenta.
 */
export async function limpiarComandasHuerfanas(args: {
  prisma: ReturnType<typeof getPrisma>;
  apply: boolean;
  now?: Date;
  edadHoras?: number;
}): Promise<ResultadoLimpieza> {
  const now = args.now ?? new Date();
  const edadHoras = args.edadHoras ?? EDAD_MINIMA_HORAS;

  const filas = (await args.prisma.kitchenOrder.findMany({
    where: { servedAt: null },
    orderBy: { sentAt: "asc" },
    select: {
      id: true,
      ticketId: true,
      storeId: true,
      tableName: true,
      section: true,
      sentAt: true,
      readyAt: true,
      ticket: { select: { status: true, tenantId: true } },
    },
  })) as unknown as FilaHuerfana[];

  const plan = planLimpiezaHuerfanas(filas, { now, edadHoras });
  if (!args.apply) {
    return { ...plan, escritas: 0, apply: false };
  }

  let escritas = 0;
  for (const f of plan.aServir) {
    // `readyAt` sólo si no lo tenía, y `servedAt` nunca anterior a él:
    // el CHECK `kitchen_orders_cronologia` y la verdad del informe.
    const servedAt =
      f.readyAt == null || f.readyAt.getTime() < now.getTime() ? now : f.readyAt;
    const r = await args.prisma.kitchenOrder.updateMany({
      where: { id: f.id, servedAt: null },
      data: {
        ...(f.readyAt == null ? { readyAt: now, readyByDeviceId: null } : {}),
        servedAt,
        servedByUserId: null,
      },
    });
    escritas += r.count;
  }
  return { ...plan, escritas, apply: true };
}
