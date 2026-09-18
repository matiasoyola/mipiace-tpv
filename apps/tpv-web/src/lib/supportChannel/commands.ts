// A5 · Frente 3 · qué hace el terminal cuando le llega un comando.
//
// La lista blanca vive en el servidor (`apps/api/src/devices/commands.ts`) y se
// repite aquí, en un `switch` cerrado: el terminal tampoco ejecuta lo que no
// conoce. Dos puertas para lo mismo es a propósito — una versión antigua de la
// APK no debe poder ejecutar un comando que se inventó después, y un servidor
// comprometido no debe poder pedirle al terminal algo que no esté escrito en su
// propio binario.
//
// NINGÚN comando toca dinero. No hay forma de cerrar un turno, anular un
// ticket, cobrar ni tocar el arqueo desde aquí, y no la va a haber: para eso
// hay un humano al teléfono.

import { flushOutbox, outboxCounts } from "../outbox.js";
import { mostrarAvisoCaptura } from "./aviso.js";
import { readLogBuffer } from "./logBuffer.js";
import { collectDeviceStatus } from "./status.js";
import {
  captureOwnWindow,
  readSupportAgentLogs,
  restartApp,
} from "../../platform/SupportAgent.js";

export type ComandoSoporte =
  | "recargar"
  | "volcar-logs"
  | "captura-de-pantalla"
  | "forzar-sync"
  | "reiniciar-app"
  | "decir-version";

export type ResultadoComando =
  | { ok: true; datos: unknown }
  | { ok: false; error: string };

/**
 * Acciones que hay que ejecutar DESPUÉS de contestar.
 *
 * `recargar` y `reiniciar-app` se llevan por delante el contexto que tendría
 * que mandar la respuesta. Se devuelven aparte para que el canal conteste
 * primero y las dispare después; si no, el panel vería siempre «no volvió»
 * justo en los dos comandos que sí funcionaron.
 */
export interface EjecucionComando {
  resultado: ResultadoComando;
  despues?: () => void;
}

export async function ejecutarComando(
  accion: string,
): Promise<EjecucionComando> {
  switch (accion as ComandoSoporte) {
    case "decir-version":
      return { resultado: { ok: true, datos: await collectDeviceStatus() } };

    case "forzar-sync": {
      // No se espera indefinidamente: `flushOutbox` habla con la red y el
      // servidor corta a los 25 s. Se contesta con lo que haya quedado.
      await flushOutbox().catch(() => {});
      return { resultado: { ok: true, datos: await outboxCounts() } };
    }

    case "volcar-logs": {
      const [nativo, estado] = await Promise.all([
        readSupportAgentLogs(),
        collectDeviceStatus().catch(() => null),
      ]);
      return {
        resultado: {
          ok: true,
          datos: {
            // El diario del WebView: lo que el JS vio.
            consola: readLogBuffer(),
            // El logcat del propio proceso: lo que el JS no puede ver
            // (Capacitor, el rescate de A4, el plugin de la impresora).
            logcat: nativo?.logcat ?? null,
            logcatError: nativo?.error ?? null,
            // El estado va dentro del volcado a propósito: quien lo lee está
            // diagnosticando y necesita las dos cosas en el mismo sitio.
            estado,
          },
        },
      };
    }

    case "captura-de-pantalla": {
      const captura = await captureOwnWindow();
      if (!captura) {
        return {
          resultado: {
            ok: false,
            error:
              "Este terminal no puede capturar su pantalla (no es la app Android).",
          },
        };
      }
      // El aviso va DESPUÉS de capturar: si se pintara antes, saldría en la
      // foto tapando justo lo que se está diagnosticando. Que un cliente pueda
      // ver cuándo hemos mirado su pantalla no es una concesión, es lo que
      // separa esto de una cámara oculta en la barra.
      mostrarAvisoCaptura();
      return { resultado: { ok: true, datos: captura } };
    }

    case "recargar":
      return {
        resultado: { ok: true, datos: { recargando: true } },
        despues: () => window.location.reload(),
      };

    case "reiniciar-app":
      return {
        resultado: { ok: true, datos: { reiniciando: true } },
        despues: () => {
          void restartApp().then((hecho) => {
            // En navegador no hay Activity que recrear: recargar es lo más
            // parecido, y es honesto decir que es lo que se ha hecho.
            if (!hecho) window.location.reload();
          });
        },
      };

    default:
      // Un comando que este binario no conoce. No se ejecuta nada.
      return {
        resultado: {
          ok: false,
          error: `Comando desconocido en esta versión del terminal: ${String(
            accion,
          ).slice(0, 60)}`,
        },
      };
  }
}
