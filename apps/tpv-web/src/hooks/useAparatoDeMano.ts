import { useEffect, useState } from "react";

import { MEDIA_MANO } from "../lib/aparatoDeMano.js";

/**
 * n1-hosteleria · ¿estamos en un aparato de mano?
 *
 * Es el `useIsHandheld` que vivía privado dentro de
 * `SalePage.hospitality.tsx`, subido aquí y con el umbral tomado de
 * `lib/aparatoDeMano.ts` en vez de escrito a mano dos veces. Lo sube
 * este bloque porque ahora hacen falta las TRES pantallas contándolo
 * igual: la venta (que ya lo usaba), el mapa de sala y la comanda.
 *
 * Hace falta en JS y no sólo en CSS porque hay números que entran por
 * `style` calculado: las columnas de la rejilla (`grid-cols-${n}` no lo
 * compila el JIT de Tailwind), el lado de la mesa del mapa y el reparto
 * de la línea de comanda.
 *
 * Con `matchMedia` y su listener, **no** con `window.innerWidth` leído
 * en el render: leído en el render, girar la tablet o abrir el teclado
 * del sistema no vuelve a pintar y la pantalla se queda con el reparto
 * del tamaño anterior. `ux-principles` §3.6 pide justamente que se
 * reorganice sola al cambiar de orientación.
 *
 * `matchMedia` puede no existir (jsdom sin stub): ahí se asume
 * **terminal**, que es el caso para el que están medidos los números de
 * siempre y el que no puede regresar.
 */
export function useAparatoDeMano(): boolean {
  const [deMano, setDeMano] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(MEDIA_MANO).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(MEDIA_MANO);
    const onChange = (e: MediaQueryListEvent) => setDeMano(e.matches);
    setDeMano(mq.matches);
    // `addEventListener` sobre MediaQueryList existe desde Chrome 39, así
    // que el WebView 101 del D8 lo tiene de sobra; el `addListener`
    // legacy no hace falta.
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return deMano;
}
