// auditoria-sirope (#21) · EL VIGILANTE DE ARRANQUE.
//
// ── Lo que pasó ───────────────────────────────────────────────────────
//
// Dos veces (17-10 y 18-10), `am force-stop` + abrir la app del D8 dejó
// la pantalla **en blanco**: `Displayed +667ms`, ningún error en logcat y
// sólo lo arreglaba reiniciar el aparato. WebView de sistema 101.
//
// La causa no está confirmada (ver `docs/blocks/auditoria-sirope-done.md`
// §#21: lo que se descartó y lo que queda). Esto no depende de eso:
//
//   **Una caja nunca se queda en blanco sin salida.**
//
// ── Cómo funciona ─────────────────────────────────────────────────────
//
// El reloj lo arranca un `<script>` CLÁSICO dentro de `index.html`, no
// este módulo. Es deliberado: si lo que falla es el bundle —que se
// descargue a medias, que el WebView no sepa parsearlo, que el servidor
// local de Capacitor no lo sirva—, un módulo nunca llega a ejecutarse y
// el vigilante no existiría justo el día que hace falta. Un script
// clásico en línea se ejecuta aunque el `type="module"` de al lado no lo
// haga.
//
// Este fichero es la otra mitad: la que el bundle sí ejecuta.
//
//   · `arranqueConseguido()` — «he pintado»: apaga el reloj.
//   · `arranqueFallidoPendiente()` — ¿el arranque ANTERIOR se quedó en
//     blanco? Se reporta ahora, que es cuando hay con qué: si la app no
//     arranca, no hay nadie que pueda contarlo.

/** Lo que el `<script>` de `index.html` deja colgado de `window`. */
interface VigilanteGlobal {
  /** Apaga el reloj: la app ya pintó. */
  ok?: () => void;
  /** El arranque anterior se quedó en blanco (lo escribe el fallback). */
  fallo?: FalloDeArranque | null;
}

export interface FalloDeArranque {
  /** Cuándo se rindió el vigilante (ISO). */
  at: string;
  /** El user-agent, que es donde viaja la versión del WebView:
   *  «… Chrome/101.0.4951.61 …». */
  userAgent: string;
  /** La versión del bundle que no llegó a pintar. */
  appVersion: string;
  /** Segundos que esperó antes de rendirse. */
  esperaSegundos: number;
}

const CLAVE_FALLO = "mipiacetpv-arranque-fallido";

function global(): VigilanteGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __tpvVigilante?: VigilanteGlobal })
    .__tpvVigilante ?? null;
}

/** La app ha pintado su primera pantalla. Apaga el vigilante. */
export function arranqueConseguido(): void {
  global()?.ok?.();
}

/**
 * ¿El arranque ANTERIOR se quedó en blanco?
 *
 * Devuelve el parte y lo borra: se reporta una vez. Se lee del
 * `localStorage` porque el que lo escribió fue otra carga de la página —
 * la que no llegó— y porque el reporte sólo puede salir desde una que sí.
 */
export function arranqueFallidoPendiente(): FalloDeArranque | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CLAVE_FALLO);
    if (!raw) return null;
    localStorage.removeItem(CLAVE_FALLO);
    const v = JSON.parse(raw) as FalloDeArranque;
    return typeof v?.at === "string" ? v : null;
  } catch {
    return null;
  }
}
