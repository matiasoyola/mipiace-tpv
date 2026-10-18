// residencia-4 · worker de las dos pasadas de la residencia. Concurrency
// 1: una sola a la vez, para no escalar dos veces el mismo aviso si el
// cron se solapa con un disparo manual.
//
// El worker **no compone nada**: la pasada entera vive en
// `residencia/pasada-de-guardia.ts`, por lo mismo que `runDayCutPass` en
// v1.13. Así el e2e ejecuta exactamente lo mismo con un reloj falso y sin
// Redis, y desconectar una mitad pone la suite roja.

import { Worker } from "bullmq";

import { getPrisma, getRedis } from "../context.js";
import { captureError } from "../lib/sentry.js";
import { pasadaDeGuardia } from "../residencia/pasada-de-guardia.js";
import {
  RESIDENCIA_GUARDIA_QUEUE_NAME,
  type ResidenciaGuardiaJob,
} from "../queues/residencia-guardia.js";

export function startResidenciaGuardiaWorker(): Worker<ResidenciaGuardiaJob> {
  const worker = new Worker<ResidenciaGuardiaJob>(
    RESIDENCIA_GUARDIA_QUEUE_NAME,
    async (job) => {
      const log = {
        info: (obj: object, msg: string) =>
          console.log(`[residencia-guardia] ${msg}`, obj),
        error: (obj: unknown, msg?: string) =>
          console.error(`[residencia-guardia] ${msg ?? ""}`, obj),
      };
      const pasada = await pasadaDeGuardia({
        prisma: getPrisma(),
        forzarAusencias: job.data.source === "manual",
        // residencia-5 · a mano también se generan las ocurrencias de las
        // obligaciones, por lo mismo que las ausencias: un disparo manual
        // es «haz todo ahora».
        forzarObligaciones: job.data.source === "manual",
        log,
      });
      return {
        source: job.data.source,
        escalados: pasada.escalados.length,
        // **Sin un solo dato de salud**, igual que el resto de los
        // workers de la casa: cuántos, no quiénes. El `returnvalue` de un
        // job se queda en Redis y se lee desde el panel de BullMQ.
        ausencias:
          pasada.ausencias == null
            ? null
            : pasada.ausencias.reduce(
                (n, r) => n + r.sinDeposicion.length + r.sinComer.length,
                0,
              ),
        errores:
          (pasada.ausencias?.reduce((n, r) => n + r.errores, 0) ?? 0) +
          (pasada.relevo?.errores ?? 0),
        // residencia-5 · cuántos partes se congelaron y cuántos añadidos
        // tardíos se anotaron. **Sin un dato de salud**, igual que el
        // resto: cuántos, no de quién.
        relevos: pasada.relevo?.congelados.length ?? 0,
        tardios: pasada.relevo?.tardios ?? 0,
        obligaciones: pasada.relevo?.obligaciones?.creadas ?? null,
      };
    },
    { connection: getRedis(), concurrency: 1 },
  );
  worker.on("completed", (job) => {
    const r = job.returnvalue as
      | {
          escalados?: number;
          ausencias?: number | null;
          errores?: number;
          relevos?: number;
          tardios?: number;
          obligaciones?: number | null;
        }
      | undefined;
    // Sólo se registra cuando PASA algo. Una línea por minuto con
    // «0 escalados» son 1.440 líneas al día que tapan la que importa.
    if ((r?.escalados ?? 0) > 0) {
      console.log(`[residencia-guardia] ${r?.escalados} aviso(s) escalados`);
    }
    if ((r?.ausencias ?? 0) > 0) {
      console.log(
        `[residencia-guardia] ${r?.ausencias} incidencia(s) por ausencia`,
      );
    }
    // residencia-5 · lo mismo: sólo se registra cuando PASA algo. Un
    // «0 relevos» por minuto son 1.440 líneas al día que tapan la que
    // importa.
    if ((r?.relevos ?? 0) > 0) {
      console.log(`[residencia-guardia] ${r?.relevos} parte(s) de relevo congelados`);
    }
    if ((r?.tardios ?? 0) > 0) {
      console.log(
        `[residencia-guardia] ${r?.tardios} añadido(s) «llegó después del relevo»`,
      );
    }
    if ((r?.obligaciones ?? 0) > 0) {
      console.log(
        `[residencia-guardia] ${r?.obligaciones} ocurrencia(s) de obligaciones generadas`,
      );
    }
    if ((r?.errores ?? 0) > 0) {
      console.warn(
        `[residencia-guardia] ${r?.errores} centro(s) o residente(s) fallaron en la pasada`,
      );
    }
  });
  worker.on("failed", (job, err) => {
    console.error(`[residencia-guardia] job ${job?.id} falló: ${err.message}`);
    captureError(err, {
      extra: { queue: RESIDENCIA_GUARDIA_QUEUE_NAME, jobId: job?.id },
    });
  });
  return worker;
}
