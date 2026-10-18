import { useEffect, useState } from "react";

import { tecladoTapaLaPantalla } from "../lib/visualViewportSync.js";

/**
 * n1-vertical · ¿está abierto el teclado del sistema?
 *
 * ── El fallo que esto arregla ───────────────────────────────────────
 *
 * En la pasada del N1 (2026-10-16, captura `27-busqueda-teclado`): el
 * cajero toca el buscador, el teclado de Android se come la mitad de
 * abajo, y la barra inferior del ticket —que es `fixed` y se pega sobre
 * el teclado con `--keyboard-offset`— ocupa el ÚNICO hueco que queda
 * entre el buscador y el teclado. Resultado: se busca un producto y no
 * se ve ni un resultado.
 *
 * La barra tiene sentido cuando el cajero está marcando (es lo único
 * que enseña el total en estrecho) y no lo tiene mientras teclea: lo
 * que importa entonces es la lista de resultados.
 *
 * ── Por qué `visualViewport` y no otra cosa ─────────────────────────
 *
 * No hay API de "hay teclado" en el WebView. Lo que sí hay, y funciona
 * en el WebView 154 del N1, es `visualViewport`: su alto baja cuando el
 * teclado abre. La cuenta y el umbral viven en
 * `lib/visualViewportSync.ts` junto a la que ya alimentaba
 * `--keyboard-offset`, para que no haya dos ideas distintas de "cuánto
 * tapa el teclado" en la misma app.
 *
 * Sin `visualViewport` (jsdom, navegadores viejos) devuelve `false`:
 * nadie pierde la barra por una API que no existe.
 */
export function useTecladoDelSistema(): boolean {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const leer = () =>
      setAbierto(
        tecladoTapaLaPantalla(window.innerHeight, vv.height, vv.offsetTop),
      );
    vv.addEventListener("resize", leer);
    vv.addEventListener("scroll", leer);
    leer();
    return () => {
      vv.removeEventListener("resize", leer);
      vv.removeEventListener("scroll", leer);
    };
  }, []);

  return abierto;
}
