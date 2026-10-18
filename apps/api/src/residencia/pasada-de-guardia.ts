// residencia-4 · **LA PASADA, ENTERA Y FUERA DEL WORKER.**
//
// Lo que corre cada minuto: escalar los avisos que nadie ha acusado y,
// en la hora en punto, mirar lo que NO hay (sin deposición, sin comer).
//
// Vive aquí y no dentro del worker por lo mismo que `runDayCutPass` de
// v1.13: así el e2e puede ejecutar **exactamente la misma pasada** con un
// reloj falso y sin levantar Redis, y desconectar una de las dos mitades
// pone la suite roja en vez de pasar desapercibido durante semanas.

import type { PrismaClient } from "@mipiacetpv/db";

import { pasadaDeEscalado, type AvisoCreado } from "./aviso.js";
import {
  pasadaDeAusenciasGlobal,
  type ResultadoDeLaPasada,
} from "./derivacion.js";
import { empujarAvisos } from "./guardia-bus.js";

export interface ResultadoDeLaPasadaDeGuardia {
  escalados: AvisoCreado[];
  /** `null` cuando no tocaba (no era la hora en punto). */
  ausencias: ResultadoDeLaPasada[] | null;
}

/** El minuto en el que corre la pasada de ausencias. Ver la cabecera de
 *  `queues/residencia-guardia.ts`. */
export const MINUTO_DE_LAS_AUSENCIAS = 0;

export async function pasadaDeGuardia(input: {
  prisma: PrismaClient;
  ahora?: Date;
  /** Fuerza la mitad de las ausencias aunque no sea la hora en punto. Lo
   *  usan el e2e y el disparo a mano. */
  forzarAusencias?: boolean;
  log?: { info: (o: object, m: string) => void; error: (o: unknown, m?: string) => void };
}): Promise<ResultadoDeLaPasadaDeGuardia> {
  const ahora = input.ahora ?? new Date();

  // ── 1 · ESCALAR ────────────────────────────────────────────────────
  //
  // Primero y siempre. Es lo que tiene que pasar en cinco minutos, y si
  // la mitad de abajo fallara, **esto ya habría corrido**.
  let escalados: AvisoCreado[] = [];
  try {
    escalados = await pasadaDeEscalado(input.prisma, ahora);
  } catch (err) {
    input.log?.error(err, "residencia · la pasada de escalado falló");
  }

  // ── Y EL EMPUJE A LOS MÓVILES ────────────────────────────────────
  //
  // Con el tenant de cada aviso, leído en UNA consulta: una pasada normal
  // escala cero avisos y, cuando escala, son uno o dos.
  // `pasadaDeEscalado` no empuja ella porque es pura respecto al
  // transporte —el e2e la ejecuta sin bus— y porque el bus vive en el
  // proceso de la API mientras que la pasada puede correr en el de los
  // workers.
  if (escalados.length > 0) {
    try {
      const filas = await input.prisma.guardAlert.findMany({
        where: { id: { in: escalados.map((a) => a.id) } },
        select: { id: true, tenantId: true, channel: true, severity: true, incidentId: true, queuedAt: true },
      });
      for (const f of filas) {
        empujarAvisos(
          f.tenantId,
          [
            {
              id: f.id,
              canal: f.channel,
              nivel: f.severity,
              incidentId: f.incidentId,
            },
          ],
          f.queuedAt,
        );
      }
    } catch (err) {
      input.log?.error(err, "residencia · no se pudo empujar un aviso escalado");
    }
  }

  // ── 2 · LAS AUSENCIAS, en la hora en punto ────────────────────────
  let ausencias: ResultadoDeLaPasada[] | null = null;
  const tocaAusencias =
    input.forzarAusencias === true || ahora.getMinutes() === MINUTO_DE_LAS_AUSENCIAS;
  if (tocaAusencias) {
    try {
      ausencias = await pasadaDeAusenciasGlobal(input.prisma, ahora);
    } catch (err) {
      input.log?.error(err, "residencia · la pasada de ausencias falló");
    }
  }

  return { escalados, ausencias };
}
