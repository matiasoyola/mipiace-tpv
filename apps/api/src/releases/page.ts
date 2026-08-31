// A3-distribución · Frente 4 · la página que se ve en el terminal roto.
//
// Se sirve desde Fastify y NO desde la PWA a propósito: el navegador de
// fábrica del AP11 es Chrome 81 (2020), que no soporta `gap` en flexbox y
// pinta el TPV con los textos pegados. Si esta página dependiera del bundle de
// tpv-web se rompería igual que él y el bloque no serviría de nada. Es la
// excepción consciente a "tpv-web es la única fuente de UI" (mini-ADR en
// docs/04-stack-y-decisiones.md).
//
// REGLAS DE LA PÁGINA, todas por el Chrome 81:
//   - Cero JavaScript. Un <form method="POST"> y punto.
//   - Ni `gap`, ni `grid`, ni variables CSS (`var(--x)`), ni `:is()`. La
//     separación se hace con margin/padding, como en 2015.
//   - Colores de marca por valor literal (docs/design/tokens.md), porque no
//     hay variables CSS donde meterlos.
//   - El botón, en la MITAD SUPERIOR: el teclado del SO tapa el 52 % inferior
//     de la pantalla. Un botón de enviar abajo es un botón inalcanzable.
//   - Área táctil de 44 px como mínimo, que es un dedo.

import { escapeHtml } from "../lib/html-escape.js";
import type { PublicReleaseMeta } from "./store.js";

/** Coral, ink, stone: docs/design/tokens.md. Literales, no variables. */
const CORAL = "#E97058";
const CORAL_DARK = "#C75A45";
const INK = "#1F2937";
const INK_SOFT = "#374151";
const STONE = "#F8F6F3";

export type ApkPageError =
  | { kind: "incorrecto" }
  | { kind: "caducado" }
  | { kind: "agotado" }
  | { kind: "bloqueado"; retryAfterMinutes: number }
  | { kind: "sin-version" };

function mensajeDeError(error: ApkPageError): string {
  switch (error.kind) {
    case "incorrecto":
      return "Código incorrecto. Revísalo y vuelve a escribirlo.";
    case "caducado":
      return "Ese código ha caducado. Pide uno nuevo.";
    case "agotado":
      return "Ese código ya se ha usado las veces permitidas. Pide uno nuevo.";
    case "bloqueado":
      return `Demasiados intentos fallidos. Prueba otra vez dentro de ${error.retryAfterMinutes} min.`;
    case "sin-version":
      return "Ese código apunta a una versión que ya no está publicada. Pide uno nuevo.";
  }
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  // Sin Intl ni toLocaleDateString con opciones: en un WebView viejo el
  // soporte de locales es irregular. Partimos el ISO a mano.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px 20px;
    background: ${STONE};
    color: ${INK};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 17px;
    line-height: 1.45;
  }
  .caja { max-width: 460px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px 0; }
  h1 .marca { color: ${CORAL}; }
  p.sub { margin: 0 0 20px 0; color: ${INK_SOFT}; font-size: 15px; }
  label { display: block; font-weight: 600; margin-bottom: 8px; }
  input[type="text"] {
    display: block;
    width: 100%;
    height: 56px;
    padding: 0 14px;
    margin-bottom: 14px;
    font-size: 30px;
    letter-spacing: 6px;
    text-align: center;
    color: ${INK};
    background: #FFFFFF;
    border: 2px solid #D8D2CB;
    border-radius: 10px;
  }
  input[type="text"]:focus { border-color: ${CORAL}; outline: none; }
  button {
    display: block;
    width: 100%;
    min-height: 56px;
    padding: 14px;
    font-size: 18px;
    font-weight: 700;
    color: #FFFFFF;
    background: ${CORAL};
    border: 0;
    border-radius: 10px;
    cursor: pointer;
  }
  button:active { background: ${CORAL_DARK}; }
  .error {
    margin: 0 0 16px 0;
    padding: 12px 14px;
    background: #FDEAE3;
    border-left: 4px solid ${CORAL_DARK};
    border-radius: 6px;
    color: ${CORAL_DARK};
    font-size: 15px;
    font-weight: 600;
  }
  .meta {
    margin-top: 28px;
    padding-top: 16px;
    border-top: 1px solid #E2DCD5;
    font-size: 13px;
    color: ${INK_SOFT};
  }
  .meta dt { font-weight: 600; margin-top: 10px; }
  .meta dd { margin: 2px 0 0 0; }
  .huella {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    word-break: break-all;
  }
`;

function metaBlock(
  meta: PublicReleaseMeta | null,
  titulo: string,
): string {
  if (!meta) return "";
  return `
    <div class="meta">
      <p style="margin:0;font-weight:600;">${escapeHtml(titulo)}</p>
      <dl style="margin:6px 0 0 0;">
        <dt>Versión</dt>
        <dd>${escapeHtml(meta.versionName)} (${meta.versionCode})</dd>
        <dt>Publicada</dt>
        <dd>${escapeHtml(formatDate(meta.publishedAt))}</dd>
        <dt>Tamaño</dt>
        <dd>${escapeHtml(formatBytes(meta.size))}</dd>
        <dt>SHA-256</dt>
        <dd class="huella">${escapeHtml(meta.sha256)}</dd>
      </dl>
      <p style="margin-top:12px;">Compara este SHA-256 con el del archivo descargado antes de instalarlo.</p>
    </div>`;
}

/**
 * Página del formulario. `latest` se pinta debajo como referencia; cuando la
 * descarga sale bien no se llega aquí (se responde el binario), y cuando falla
 * el instalador todavía no sabe qué versión le tocaba.
 */
export function renderApkPage(params: {
  latest: PublicReleaseMeta | null;
  error?: ApkPageError;
}): string {
  const error = params.error
    ? `<p class="error">${escapeHtml(mensajeDeError(params.error))}</p>`
    : "";
  // El bloqueo por intentos no ofrece formulario: no hay nada que teclear
  // durante la espera, y dejarlo invita a seguir probando.
  const bloqueado = params.error?.kind === "bloqueado";
  const formulario = bloqueado
    ? ""
    : `
      <form method="POST" action="/apk">
        <label for="codigo">Código de instalación</label>
        <input
          id="codigo"
          name="codigo"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="6"
          autocomplete="off"
          autofocus
          placeholder="000000"
        >
        <button type="submit">Descargar la app</button>
      </form>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Instalar mipiacetpv</title>
<style>${CSS}</style>
</head>
<body>
  <div class="caja">
    <h1>mipiace<span class="marca">tpv</span></h1>
    <p class="sub">Escribe el código de 6 dígitos que te ha dado el instalador.</p>
    ${error}
    ${formulario}
    ${metaBlock(params.latest, "Última versión publicada")}
  </div>
</body>
</html>`;
}
