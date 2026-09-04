// A5 · Frente 4 · el aviso de que se acaba de mirar.
//
// Que un cliente pueda ver cuándo hemos mirado su pantalla. No es una
// concesión: es lo que separa una herramienta de soporte de una cámara oculta
// en la barra de un bar.
//
// Se pinta en DOM directo, fuera de React, por dos motivos:
//
//   - el canal de soporte no depende de que haya ninguna pantalla montada, y
//     este aviso tampoco puede depender de ello;
//   - si el JS de la aplicación está atascado —que es cuando más se pide una
//     captura— un cambio de estado de React no se repintaría, y el aviso no
//     saldría justo el día que hace falta.
//
// Se muestra DESPUÉS de capturar, no antes: si no, el propio aviso saldría en
// la foto tapando lo que se está diagnosticando.

const ID = "mipiacetpv-aviso-captura";

/** Cuánto se queda en pantalla. Suficiente para verlo sin estorbar una venta. */
export const AVISO_CAPTURA_MS = 6_000;

/**
 * Enseña una banda «se ha tomado una captura de esta pantalla».
 *
 * No captura toques (`pointer-events: none`): un camarero con una comanda a
 * medias no puede quedarse sin poder pulsar por esto. Va arriba y a la derecha,
 * donde el TPV no tiene controles.
 */
export function mostrarAvisoCaptura(
  ms: number = AVISO_CAPTURA_MS,
  hora: Date = new Date(),
): void {
  if (typeof document === "undefined") return;
  try {
    document.getElementById(ID)?.remove();
    const el = document.createElement("div");
    el.id = ID;
    el.setAttribute("role", "status");
    el.textContent = `Soporte ha tomado una captura de esta pantalla · ${hora.toLocaleTimeString(
      "es-ES",
      { hour: "2-digit", minute: "2-digit" },
    )}`;
    // Estilos en línea a propósito: este aviso tiene que salir aunque la hoja
    // de estilos de la app no haya cargado, que es parte del caso «algo va mal
    // en ese terminal».
    el.style.cssText = [
      "position:fixed",
      "top:8px",
      "right:8px",
      "z-index:2147483647",
      "pointer-events:none",
      "max-width:min(92vw,520px)",
      "padding:10px 14px",
      "border-radius:10px",
      "background:#0F172A",
      "color:#F8FAFC",
      "font:600 14px/1.3 system-ui,-apple-system,sans-serif",
      "box-shadow:0 4px 16px rgba(15,23,42,.35)",
    ].join(";");
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  } catch {
    // El aviso no puede romper nada. Si no se puede pintar, la traza en
    // `SuperAdminAudit` sigue existiendo: el registro de que hemos mirado no
    // depende de que el DOM colabore.
  }
}
