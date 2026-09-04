// A5 · el diario de a bordo del terminal.
//
// Un anillo en memoria con las últimas líneas de consola y los errores no
// capturados. Es lo que devuelve el comando `volcar-logs`, y conviene tomárselo
// en serio: si la escalada por adb no sobrevive a los reinicios del AP11 (§5),
// esto deja de ser un extra y pasa a ser LA herramienta de diagnóstico de un
// terminal en casa de un cliente.
//
// ── Decisiones ────────────────────────────────────────────────────────────
//
//   - Anillo acotado en memoria, no persistido. Un log que crece sin freno en
//     el disco de una caja acaba siendo el problema en vez de la ayuda; y
//     escribirlo en IndexedDB obligaría a purgarlo y a decidir cuánto guardar
//     de una máquina que puede llevar semanas encendida.
//   - Se instala ANTES de montar React, para que el fallo de arranque —el que
//     deja la barra sin TPV y el que más importa— quede dentro.
//   - No captura `console.debug` ni `console.info`: en una hora punta eso es
//     ruido que expulsa del anillo justo lo que se busca.
//   - Los argumentos se serializan acotados. Un objeto enorme volcado a la
//     consola no puede comerse el diario entero.

/** Líneas que se guardan. ~200 cubre de sobra el arranque y el fallo. */
export const LOG_BUFFER_MAX_LINES = 200;

/** Tope por línea. Un stack trace largo cabe; un JSON de catálogo no. */
export const LOG_LINE_MAX_CHARS = 1_000;

export interface LogLine {
  /** ISO con la hora del terminal (que puede estar desviada; se dice aparte). */
  at: string;
  level: "log" | "warn" | "error";
  text: string;
}

const buffer: LogLine[] = [];
let instalado = false;

function recortar(texto: string): string {
  return texto.length > LOG_LINE_MAX_CHARS
    ? `${texto.slice(0, LOG_LINE_MAX_CHARS)}…[recortado]`
    : texto;
}

function serializar(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ""}`;
      try {
        return JSON.stringify(a);
      } catch {
        // Referencias circulares, Proxies raros: preferimos una etiqueta a
        // perder la línea entera.
        return String(a);
      }
    })
    .join(" ");
}

export function appendLogLine(level: LogLine["level"], texto: string): void {
  buffer.push({ at: new Date().toISOString(), level, text: recortar(texto) });
  // Anillo: la línea más vieja cae. `shift` sobre un array de 200 es
  // irrelevante frente a cualquier cosa que haga el TPV.
  while (buffer.length > LOG_BUFFER_MAX_LINES) buffer.shift();
}

/**
 * Engancha consola y errores globales. Idempotente: llamarlo dos veces no
 * encadena wrappers (en dev, con HMR, pasaría).
 *
 * NO sustituye a `installGlobalErrorLogging` ni a Sentry: aquéllos mandan el
 * error fuera, esto lo deja a mano para cuando alguien llama por teléfono.
 */
export function installLogBuffer(): void {
  if (instalado || typeof window === "undefined") return;
  instalado = true;

  for (const level of ["log", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        appendLogLine(level, serializar(args));
      } catch {
        // El diario no puede romper una llamada a console.
      }
      original(...args);
    };
  }

  window.addEventListener("error", (ev: ErrorEvent) => {
    appendLogLine(
      "error",
      `window.onerror: ${ev.message} @ ${ev.filename}:${ev.lineno}:${ev.colno}`,
    );
  });

  window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
    const r = ev.reason as unknown;
    appendLogLine(
      "error",
      `unhandledrejection: ${
        r instanceof Error ? `${r.message}\n${r.stack ?? ""}` : String(r)
      }`,
    );
  });
}

/** Copia del anillo, de la más vieja a la más nueva. */
export function readLogBuffer(): LogLine[] {
  return [...buffer];
}

/** Sólo para tests. */
export function __resetLogBufferForTests(): void {
  buffer.length = 0;
  instalado = false;
}
