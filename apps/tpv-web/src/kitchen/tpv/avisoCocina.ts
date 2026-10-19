// hierro-sirope (H4) · EL AVISO DE COCINA, DE QUIEN TIENE EL SOCKET A
// QUIEN TIENE LA LISTA.
//
// Lo que medía la pasada del 18-10: entre que cocina pulsa «Lista» en el
// AP11 y que sale la banda en el D8 pasaban 15–30 s; lo mismo para que
// el LISTO desapareciera del mapa tras cobrar (capturas 13→13b, 27→29).
//
// La causa no era la red. `useAvisosListo` dice en su cabecera que se
// refresca «con el evento del bus», y **no estaba suscrito a nada**: el
// WebSocket de la tienda lo abren `SalePage` y `TableMapScreen`, y sus
// manejadores llamaban a `kitchen.recargar()` (el estado de LA MESA) y a
// `load()` (el mapa), pero nunca a `avisosListo.recargar()`, que vive un
// nivel más arriba, en `TpvHome`. Así que la banda sólo se enteraba por
// el repaso de 30 s — que es exactamente el retraso medido.
//
// El arreglo es el mismo patrón que `avisarAjustesCambiados` (#20) y por
// la misma razón: quien recibe el evento lo RELANZA como evento del
// navegador, y quien tiene la lista lo escucha. Un segundo WebSocket
// desde `TpvHome` habría costado una conexión más por terminal para
// enterarse de lo mismo.

export const EVENTO_COCINA = "mipiacetpv:cocina-cambio";

/** Lo llama quien tiene el socket, con cualquier `kitchen.*`. */
export function avisarCambioEnCocina(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENTO_COCINA));
}
