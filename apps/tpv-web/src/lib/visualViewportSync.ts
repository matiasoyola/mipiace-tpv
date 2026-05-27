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
    const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
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
