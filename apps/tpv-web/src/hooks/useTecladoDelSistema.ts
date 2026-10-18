import { useEffect, useRef, useState } from "react";

import {
  tecladoTapaLaPantalla,
  ventanaEncogio,
} from "../lib/visualViewportSync.js";

/**
 * n1-vertical · ¿está abierto el teclado del sistema?
 *
 * ── El fallo que esto arregla ───────────────────────────────────────
 *
 * En la pasada del N1 (2026-10-16, captura `27-busqueda-teclado`): el
 * cajero toca el buscador, el teclado de Android se come la mitad de
 * abajo, y la barra inferior del ticket ocupa el ÚNICO hueco que queda
 * entre el buscador y el teclado. Se busca un producto y no se ve ni un
 * resultado. Medido otra vez en el aparato el 18-10, con la 1.27.0 y
 * «bran» tecleado: cuatro resultados, los cuatro tapados por la barra.
 *
 * La barra tiene sentido cuando el cajero está marcando (es lo único
 * que enseña el total en estrecho) y no lo tiene mientras teclea.
 *
 * ── Por qué DOS señales y no una ────────────────────────────────────
 *
 * No hay API de «hay teclado» en el WebView, y lo que se improvisa en su
 * lugar depende de cómo cada sistema reparta el hueco:
 *
 *   1. **El viewport visual encoge** y la ventana no. Es el caso que
 *      documenta la web (`visualViewport`), el que alimenta
 *      `--keyboard-offset`, y el que se dio por bueno al escribir esto.
 *   2. **La ventana entera encoge** (`adjustResize`). ES LO QUE HACE EL
 *      N1: medido, `innerHeight` 720 → 449 con `visualViewport.height`
 *      también 449, así que la resta del caso 1 da cero y el detector no
 *      se enteraba. Por eso se compara `innerHeight` contra lo más alta
 *      que se ha visto la ventana en esta sesión.

 * Con cualquiera de las dos se oculta la barra. Sin ninguna —jsdom,
 * navegadores viejos, un terminal sin teclado— se devuelve `false`:
 * nadie pierde el total por una API que no existe.
 *
 * ── Y por qué NO vale «hay un campo de texto enfocado» ───────────────
 *
 * Era la señal más directa y es la primera que escribí. El banco la tiró
 * en el primer intento: la pantalla de venta deja **el buscador
 * enfocado de continuo** —es lo que hace que un escáner de códigos
 * escriba donde tiene que escribir— así que con esa regla la barra
 * desaparecía nada más abrir la venta, sin teclado ninguno.
 */
export function useTecladoDelSistema(): boolean {
  const [abierto, setAbierto] = useState(false);
  // La ventana más alta vista en esta sesión. No se puede usar
  // `screen.height`: en el N1 son 360 px CSS en vertical (la pantalla
  // física girada), que no tiene nada que ver con el alto de la ventana.
  const alturaMaxima = useRef(0);

  useEffect(() => {
    const vv = window.visualViewport;
    const leer = () => {
      const alto = window.innerHeight;
      if (alto > alturaMaxima.current) alturaMaxima.current = alto;
      const porViewportVisual = vv
        ? tecladoTapaLaPantalla(alto, vv.height, vv.offsetTop)
        : false;
      const porVentanaEncogida = ventanaEncogio(alto, alturaMaxima.current);
      setAbierto(porViewportVisual || porVentanaEncogida);
    };

    window.addEventListener("resize", leer);
    vv?.addEventListener("resize", leer);
    vv?.addEventListener("scroll", leer);
    leer();
    return () => {
      window.removeEventListener("resize", leer);
      vv?.removeEventListener("resize", leer);
      vv?.removeEventListener("scroll", leer);
    };
  }, []);

  return abierto;
}
