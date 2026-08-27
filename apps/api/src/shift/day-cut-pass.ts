// v1.13 · LA pasada del corte de día, entera y en un solo sitio.
//
// Hasta aquí la composición vivía dentro del handler del worker: primero
// `runShiftDayCut`, después `runAbandonedTableSweep`. Funcionaba, pero
// era **el único trozo de la pasada que ningún test podía tocar** — para
// ejecutarla hacía falta Redis y BullMQ. Si alguien borraba la segunda
// llamada, toda la suite seguía verde y el fallo aparecía semanas
// después: un mapa de sala lleno de mesas zombi, que es exactamente lo
// que pasó en Cafetería Sirope (cuatro mesas ocupadas desde el 9 de
// julio, descubiertas el 20 de agosto mirando la BD a mano).
//
// Ahora la pasada es una función pelada: el worker la llama y el e2e
// llama a la misma. Borrar el barrido de aquí pone la suite roja.
//
// El orden y el aislamiento son los de v1.12-B, sin cambios:
//   - La caja PRIMERO. Cerrar turnos es lo que no puede fallar.
//   - El barrido va aislado: si peta, los turnos ya están cerrados y la
//     pasada devuelve el error para que el llamante lo reporte.

import type { getPrisma } from "../context.js";
import {
  runAbandonedTableSweep,
  type AbandonedSweepOutcome,
} from "../tables/abandoned.js";
import { runShiftDayCut, type DayCutLog, type DayCutOutcome } from "./day-cut-run.js";

export interface DayCutPassResult {
  shifts: { scanned: number; closed: DayCutOutcome[]; failed: number };
  // `null` sólo si el barrido lanzó. Ver `tablesError`.
  tables: {
    scanned: number;
    released: AbandonedSweepOutcome[];
    keptWithLines: number;
    failed: number;
  } | null;
  // Lo que lanzó el barrido, para que el llamante decida qué hace con él
  // (el worker lo manda a Sentry). La pasada NO lo relanza: los turnos ya
  // están cerrados y ese trabajo no se tira por una mesa.
  tablesError: unknown | null;
}

export async function runDayCutPass(args: {
  prisma: ReturnType<typeof getPrisma>;
  log: DayCutLog;
  now?: Date;
}): Promise<DayCutPassResult> {
  const { prisma, log } = args;
  const now = args.now ?? new Date();

  const shifts = await runShiftDayCut({ prisma, log, now });

  try {
    const tables = await runAbandonedTableSweep({ prisma, log, now });
    return { shifts, tables, tablesError: null };
  } catch (err) {
    log.error(
      { err, event: "shift.day_cut.abandoned_sweep_failed" },
      "corte de día: el barrido de mesas abandonadas falló; los turnos ya están cerrados",
    );
    return { shifts, tables: null, tablesError: err };
  }
}
