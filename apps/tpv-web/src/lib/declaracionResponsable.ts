// declaracion-responsable · la URL del documento del art. 15 desde el TPV.
//
// El art. 15 de la Orden HAC/1177/2024 pide que la declaración responsable
// esté disponible «dentro del propio sistema informático». El terminal es
// parte del sistema —es la parte que el cliente ve— así que también tiene su
// línea en el menú del cajero.
//
// Sin pantalla propia: la línea abre el PDF, que es el mismo documento que
// sirve el panel y el mismo que se entrega en papel. Una tercera maqueta del
// mismo texto sería una tercera cosa que desincronizar.
//
// El endpoint es PÚBLICO y sin sesión, y eso importa aquí más que en el
// panel: el menú del cajero se abre con una sesión de cajero, que no es la
// que autoriza en el panel. Un documento que se entrega a cualquiera no
// necesita ninguna de las dos.

/** Base de la API. Mismo criterio que `escposPrint.ts`: en la APK viaja la
 *  URL absoluta embebida (`VITE_API_URL`), en la web el proxy `/api`. */
function readBaseUrl(): string {
  const envBase = (
    import.meta as unknown as { env?: { VITE_API_URL?: string } }
  ).env?.VITE_API_URL;
  return ((envBase ?? "/api") as string).replace(/\/$/, "");
}

export const RUTA_DECLARACION_RESPONSABLE = "/legal/declaracion-responsable.pdf";

/**
 * URL del PDF de la declaración responsable.
 *
 * `base` es parámetro con default para poder probarlo: Vite sustituye
 * `import.meta.env.VITE_API_URL` en tiempo de build y dentro de un test el
 * valor real no se puede fingir. En producción nadie pasa el argumento.
 */
export function urlDeclaracionResponsable(base: string = readBaseUrl()): string {
  return `${base.replace(/\/$/, "")}${RUTA_DECLARACION_RESPONSABLE}`;
}
