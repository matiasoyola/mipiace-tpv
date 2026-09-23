// F1 · lo que convierte /fichar en una app del móvil (ADR-018).
//
// Todo se inyecta EN RUNTIME y sólo desde esta rama. El `index.html` del
// admin es el mismo para el panel y para fichar, así que un
// `<link rel="manifest">` estático dejaría el panel del propietario
// instalable como "Fichar", que es justo lo que no queremos.
//
// El service worker se registra con ámbito `/fichar` aunque el fichero
// viva en la raíz: un ámbito MÁS ESTRECHO que el directorio del script
// siempre está permitido, y así no hace falta la cabecera
// `Service-Worker-Allowed` — que obligaría a tocar el Caddyfile.

const MANIFEST_HREF = "/fichar-manifest.webmanifest";
const SW_URL = "/fichar-sw.js";
const SW_SCOPE = "/fichar";

function ensureTag(
  selector: string,
  create: () => HTMLElement,
): void {
  if (document.head.querySelector(selector)) return;
  document.head.appendChild(create());
}

export function installFicharPwaTags(): void {
  document.title = "Fichar · mipiacetpv";

  ensureTag(`link[rel="manifest"]`, () => {
    const l = document.createElement("link");
    l.rel = "manifest";
    l.href = MANIFEST_HREF;
    return l;
  });

  // iOS no lee el manifest para "Añadir a pantalla de inicio": lee estas
  // metas del DOM en el momento en que el usuario toca Compartir. Por eso
  // inyectarlas en runtime funciona ahí igual que un tag estático.
  ensureTag(`meta[name="apple-mobile-web-app-capable"]`, () => {
    const m = document.createElement("meta");
    m.name = "apple-mobile-web-app-capable";
    m.content = "yes";
    return m;
  });
  ensureTag(`meta[name="apple-mobile-web-app-title"]`, () => {
    const m = document.createElement("meta");
    m.name = "apple-mobile-web-app-title";
    m.content = "Fichar";
    return m;
  });
  ensureTag(`meta[name="apple-mobile-web-app-status-bar-style"]`, () => {
    const m = document.createElement("meta");
    m.name = "apple-mobile-web-app-status-bar-style";
    m.content = "default";
    return m;
  });
  ensureTag(`link[rel="apple-touch-icon"]`, () => {
    const l = document.createElement("link");
    l.rel = "apple-touch-icon";
    l.href = "/icons/icon-192.png";
    return l;
  });
  ensureTag(`meta[name="theme-color"]`, () => {
    const m = document.createElement("meta");
    m.name = "theme-color";
    m.content = "#E97058";
    return m;
  });
}

export function registerFicharServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  // `catch` y a otra cosa: sin service worker la pantalla funciona igual
  // con red, y la cola local —que es donde el fichaje está a salvo— no
  // depende de él.
  navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE }).catch(() => {
    /* sin SW: se pierde el arranque sin red, no el fichaje */
  });
}
