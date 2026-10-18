// n1-vertical · los píxeles que el teclado del sistema le quita a la
// pantalla. Es la misma cuenta que llevaba `startVisualViewportSync`
// dentro, extraída para poder (a) preguntarla desde React y (b)
// probarla sin navegador.
export function offsetDelTeclado(
  innerHeight: number,
  visualHeight: number,
  visualOffsetTop: number,
): number {
  return Math.max(0, innerHeight - visualHeight - visualOffsetTop);
}

// n1-vertical · a partir de cuántos píxeles tapados decimos "el teclado
// está abierto".
//
// No vale `> 0`. En el WebView de Android el viewport visual se encoge
// unos pocos píxeles por cosas que no son el teclado: las barras de
// sistema del modo inmersivo al reaparecer con un swipe, y el rebote
// del scroll elástico, que deja `offsetTop` distinto de 0 durante la
// inercia. Con el umbral en 0, la barra inferior del ticket
// parpadearía al desplazar el catálogo.
//
// Un teclado de verdad se come mucho más: medido en el N1 (viewport de
// 360×648) ocupa ~290 px, y en el peor caso imaginable —un teclado
// numérico corto en apaisado— sigue pasando de 120. 120 px deja fuera
// el ruido y no se puede confundir con un teclado.
export const UMBRAL_TECLADO_PX = 120;

// n1-vertical · ¿está el teclado del sistema tapando la pantalla?
export function tecladoTapaLaPantalla(
  innerHeight: number,
  visualHeight: number,
  visualOffsetTop: number,
): boolean {
  return (
    offsetDelTeclado(innerHeight, visualHeight, visualOffsetTop) >=
    UMBRAL_TECLADO_PX
  );
}

// Sincroniza el alto del teclado virtual con una variable CSS global.
// El TPV usa --keyboard-offset para pegar el footer (total + Cobrar)
// y otros elementos críticos por encima del teclado en vez de quedar
// ocultos en apaisado tablet Android. visualViewport.height baja
// cuando el teclado abre; la diferencia respecto a innerHeight es la
// altura que tapa el teclado.
//
// Llamar una sola vez desde el root (App.tsx) en un useEffect; la
// función devuelta hace cleanup correcto en unmount.
export function startVisualViewportSync(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const update = () => {
    const offset = offsetDelTeclado(window.innerHeight, vv.height, vv.offsetTop);
    document.documentElement.style.setProperty(
      "--keyboard-offset",
      `${offset}px`,
    );
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
  return () => {
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
  };
}

// Centrar el input enfocado en el viewport visible tras un breve
// retardo. Android tarda ~100-150ms en ajustar visualViewport tras
// abrir el teclado; sin el setTimeout, scrollIntoView mide la
// ventana ANTES de que el teclado haya empujado la UI y deja el
// input a ras del teclado. Con 150ms es estable en Chrome Android
// (probado en piloto Sole).
//
// Uso: `<input onFocus={scrollFocusIntoView} ... />`. Si ya tienes
// otro handler (p.ej. e.target.select()), compón ambos.
export function scrollFocusIntoView(
  e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
): void {
  const el = e.target;
  setTimeout(() => {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 150);
}
