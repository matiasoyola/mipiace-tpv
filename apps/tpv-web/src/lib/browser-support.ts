// v1.12-manos-de-camarero · navegador no soportado: decirlo, no pintar
// basura (hallazgo H1 del 2026-08-27).
//
// El AP11 sale de fábrica con Chrome 81 (2020). `gap` en flexbox llegó
// en Chrome 84, y la UI usa `gap-*` en 245 sitios: en ese navegador
// TODAS las separaciones colapsan a cero y la sala se lee "Sala5
// abiertas", "GEgemmamgc720,00 €". No es un detalle estético: el
// camarero no distingue el nombre del importe.
//
// No se polirrellena. Se bloquea con honestidad y se manda a actualizar
// Chrome o a instalar la APK (cuyo WebView es el 93 y sí lo soporta).

/**
 * ¿Soporta el navegador `gap` en FLEXBOX?
 *
 * Se mide de verdad, montando dos hijos en una columna con `rowGap` de
 * 1 px: si el `gap` funciona, el alto total es 1 px.
 *
 * `CSS.supports("gap", "1px")` NO vale: Chrome 81 soportaba `gap` en
 * grid y devuelve `true` mientras lo ignora en flex — que es donde lo
 * usamos.
 */
export function flexGapSupported(): boolean {
  const el = document.createElement("div");
  el.style.display = "flex";
  el.style.flexDirection = "column";
  el.style.rowGap = "1px";
  el.appendChild(document.createElement("div"));
  el.appendChild(document.createElement("div"));
  document.body.appendChild(el);
  const ok = el.scrollHeight === 1;
  el.parentNode?.removeChild(el);
  return ok;
}

/**
 * Versión legible del navegador, para que soporte sepa qué tiene
 * delante sin pedir capturas. Se pinta en la pantalla de bloqueo.
 */
export function describeBrowser(ua: string = navigator.userAgent): string {
  const patterns: [string, RegExp][] = [
    // El orden importa: Edge y Samsung Internet también dicen "Chrome".
    ["Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/],
    ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
    ["Opera", /OPR\/([\d.]+)/],
    ["Firefox", /Firefox\/([\d.]+)/],
    ["Chrome", /Chrome\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ];
  for (const [name, re] of patterns) {
    const m = ua.match(re);
    if (m) return `${name} ${m[1]}`;
  }
  return ua || "navegador desconocido";
}

/**
 * Pantalla de bloqueo, en HTML plano con estilos EN LÍNEA y sin un solo
 * `gap`: si dependiera de `gap` saldría rota exactamente igual que la
 * UI que viene a sustituir. Tampoco monta React — se pinta antes.
 *
 * Sin botón de "continuar igualmente": la UI descuadrada no es una
 * opción que podamos ofrecer a un camarero en hora punta.
 */
export function renderUnsupportedBrowser(
  mount: HTMLElement,
  browser: string = describeBrowser(),
): void {
  const card = [
    '<div style="max-width:420px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;padding:28px;text-align:center">',
    // Iconmark de la marca (tokens: barras en ink, corazón en coral).
    '<svg width="40" height="40" viewBox="0 0 28 28" fill="none" style="display:block;margin:0 auto 20px" aria-hidden="true">',
    '<path d="M5.2 4.4c-.85 0-1.55.65-1.55 1.5 0 .65 1.55 1.95 1.55 1.95s1.55-1.3 1.55-1.95c0-.85-.7-1.5-1.55-1.5z" fill="#E97058"/>',
    '<rect x="4" y="9.5" width="2.4" height="14.5" rx="1.2" fill="#1F2937"/>',
    '<rect x="8.8" y="6" width="2.4" height="18" rx="1.2" fill="#1F2937"/>',
    '<rect x="13.6" y="11" width="2.4" height="13" rx="1.2" fill="#1F2937"/>',
    '<rect x="18.4" y="8" width="2.4" height="16" rx="1.2" fill="#1F2937"/>',
    "</svg>",
    '<h1 style="margin:0 0 10px;font-size:22px;line-height:1.25;font-weight:600;letter-spacing:-0.01em;color:#1F2937">Este navegador es demasiado antiguo para el TPV</h1>',
    '<p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#64748b">Actualiza Chrome desde Play Store o instala la aplicación Mi Piace TPV. Con este navegador la pantalla se pinta descuadrada y los importes se leen pegados al nombre de la mesa.</p>',
    '<div style="background:#F8F6F3;border-radius:16px;padding:12px 14px;font-size:12.5px;color:#374151">',
    '<div style="color:#94a3b8;margin-bottom:2px">Navegador detectado</div>',
    `<div style="font-weight:500">${escapeHtml(browser)}</div>`,
    "</div>",
    "</div>",
  ].join("");

  mount.innerHTML =
    '<div style="min-height:100vh;background:#F8F6F3;padding:24px;box-sizing:border-box;display:block;font-family:\'DM Sans\',-apple-system,system-ui,sans-serif">' +
    '<div style="padding-top:12vh">' +
    card +
    "</div></div>";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
