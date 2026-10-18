// residencia-4 (D-19, D-20, D-66) · LA COLA DE LAS DOS PASADAS.
//
// Un único job repeatable GLOBAL (no por tenant): la pasada itera lo que
// hay y cada fila lleva su tenant dentro. Mismo patrón que
// `reconciliation`, `agenda-hold-ttl` y `shift-day-cut` — ADR-005, y la
// misma razón: un repeatable por centro obligaría a registrarlo y
// desregistrarlo al encender y apagar el módulo, y el día que uno se
// quedara sin registrar, ese centro no escalaría ningún aviso y nadie se
// enteraría.
//
// ── CADA MINUTO, Y ES EL NÚMERO QUE IMPORTA ─────────────────────────
//
// El escalado de serie son cinco minutos (D-66). Con una pasada por
// minuto, el peor caso real es 5:59 y el mejor 5:00 — un minuto de
// desvío sobre cinco. Con una pasada cada cinco, el peor caso serían
// nueve minutos y pico, que ya no es el número que el centro configuró.
//
// La pasada de AUSENCIAS, en cambio, no corre cada minuto: corre **una
// vez por hora en punto**, y la decide la propia función mirando el
// minuto. Sin deposición en tres días no cambia de un minuto a otro, y
// recorrer 49 residentes sesenta veces por hora sería trabajo por nada.
//
// `attempts: 1` — la pasada del minuto siguiente cubre cualquier fallo, y
// las dos funciones ya aíslan el fallo de una fila de las demás.

import { Queue } from "bullmq";

import { getRedis } from "../context.js";

export const RESIDENCIA_GUARDIA_QUEUE_NAME = "residencia-guardia";

export interface ResidenciaGuardiaJob {
  source: "cron" | "manual";
}

const REPEATABLE_JOB_ID = "residencia-guardia";

let _queue: Queue<ResidenciaGuardiaJob> | null = null;
export function getResidenciaGuardiaQueue(): Queue<ResidenciaGuardiaJob> {
  if (!_queue) {
    _queue = new Queue<ResidenciaGuardiaJob>(RESIDENCIA_GUARDIA_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 30,
        removeOnFail: 30,
      },
    });
  }
  return _queue;
}

export async function registerResidenciaGuardiaRepeatable(): Promise<void> {
  const queue = getResidenciaGuardiaQueue();
  await queue.add(
    "residencia-guardia",
    { source: "cron" },
    {
      // Cada minuto. La `tz` no cambia nada aquí —no hay hora local que
      // respetar— pero se pone igual, por lo mismo que en `shift-day-cut`:
      // que todos los repeatables de la casa se lean igual.
      repeat: { pattern: "* * * * *", tz: "Europe/Madrid" },
      jobId: REPEATABLE_JOB_ID,
    },
  );
}
