// A5 · Frente 4 · el barrido que hace verdad la retención de 24 h.
//
// Sin esto, «retención corta y declarada» sería una frase en un documento y un
// directorio lleno de fotos de las pantallas de nuestros clientes. La promesa
// la cumple este bucle, no la columna `expiresAt`.
//
// Mismo patrón que `upload-sweeper`: intervalo simple con dependencias
// inyectables, sin BullMQ. No hace falta una cola para borrar ficheros
// caducados, y una cola añade un punto de fallo entre la promesa y su
// cumplimiento.

import { getPrisma } from "../context.js";
import { purgarCapturasCaducadas } from "../devices/screenshots.js";

/**
 * Cada 15 min. Con una retención de 24 h, el retraso máximo entre caducar y
 * desaparecer del disco es despreciable; y una captura ya caducada no se sirve
 * aunque el fichero siga ahí (`abrirCaptura` mira la fecha antes que el disco).
 */
export const SCREENSHOT_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export interface ScreenshotSweeperDeps {
  prisma?: Parameters<typeof purgarCapturasCaducadas>[0]["prisma"];
  dir?: string;
  now?: Date;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export async function sweepDeviceScreenshots(
  deps: ScreenshotSweeperDeps = {},
): Promise<{ filasBorradas: number; ficherosBorrados: number; errores: number }> {
  const prisma = deps.prisma ?? (getPrisma() as never);
  const log =
    deps.log ??
    ((msg: string, extra?: Record<string, unknown>) =>
      console.warn(`[device-screenshot-sweeper] ${msg}`, extra ?? ""));
  return purgarCapturasCaducadas({
    prisma,
    dir: deps.dir,
    now: deps.now,
    log,
  });
}

export function startDeviceScreenshotSweeper(
  deps: ScreenshotSweeperDeps = {},
): { stop: () => void } {
  const timer = setInterval(() => {
    void sweepDeviceScreenshots(deps)
      .then((r) => {
        if (r.filasBorradas > 0 || r.errores > 0) {
          console.log(
            `[device-screenshot-sweeper] ${r.filasBorradas} captura(s) purgada(s), ${r.errores} error(es)`,
          );
        }
      })
      .catch((err: unknown) => {
        // El barrido no puede tumbar el proceso de workers: el siguiente ciclo
        // lo reintenta, y las filas caducadas siguen sin servirse mientras
        // tanto.
        console.error("[device-screenshot-sweeper] fallo en el barrido", err);
      });
  }, SCREENSHOT_SWEEP_INTERVAL_MS);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
