import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import { App } from "./App.js";
import {
  ValoracionPublica,
  tokenDeLaUrl,
} from "./clinica/ValoracionPublica.js";
import {
  ErrorBoundary,
  installGlobalErrorLogging,
} from "./components/ErrorBoundary.js";
import {
  flexGapSupported,
  renderUnsupportedBrowser,
} from "./lib/browser-support.js";
import { initSentry } from "./lib/sentry.js";
import { installLogBuffer } from "./lib/supportChannel/logBuffer.js";
import { consumeTestModeFromUrl } from "./lib/test-mode.js";
import { runVersionCheck } from "./lib/version-check.js";
import { bootstrapPrinters } from "./platform/printer/bootstrap.js";
import "./index.css";

// Sentry (v1.5-B Lote 2): gated por VITE_SENTRY_DSN — sin DSN, no-op
// absoluto. Antes de installGlobalErrorLogging para que el primer
// unhandledrejection ya se capture.
initSentry();

// v1.5-consistencia-A §4.b: promesas rechazadas sin catch → consola
// estructurada + Sentry.
installGlobalErrorLogging();

// A5 · diario de a bordo del terminal: anillo en memoria con las últimas
// líneas de consola y los errores no capturados, que es lo que devuelve el
// comando `volcar-logs`. Va aquí, antes de montar React, para que el fallo de
// arranque —el que deja la barra sin TPV— quede dentro.
installLogBuffer();

// B-OnboardingV2: si la URL trae `?testCashierToken=...&testDeviceToken=...`,
// los guardamos en sessionStorage y limpiamos la URL antes de que el
// SW registre nada (el SW podría cachear la URL con tokens en
// historial). Es síncrono — no añade latencia perceptible.
consumeTestModeFromUrl();

// A1-Android · Frente 1: registra los transportes de impresión según la
// plataforma (WebUSB+WiFi en navegador, USB nativo+WiFi en la app
// Android). Idempotente; el registry también se auto-inicializa perezoso
// desde lib/escposPrint.ts si esta llamada no corriera.
bootstrapPrinters();

// v1.2-Lite Lote 3.B: version-check antes de registerSW para que, si
// hay bundle viejo, la limpieza+reload ocurran ANTES de que el SW
// re-establezca cache stale. Sin await: el render arranca en paralelo
// y, si hay reload, lo desencadenamos a media render — coste menor que
// bloquear la UI los ~50ms del fetch a /version.json.
void runVersionCheck();

// `vite-plugin-pwa` inyecta este módulo virtual. autoUpdate => al
// detectar nueva versión, recarga sin pedir confirmación.
registerSW({ immediate: true });

const root = document.getElementById("root");
if (!root) throw new Error("Falta #root en index.html");

// clinica-2 · EL TEST DEL PACIENTE, ANTES DEL TPV.
//
// `/valoracion/<token>` no es una pantalla del TPV: es el formulario que
// abre un paciente desde el enlace de su email, o la tablet de la sala en
// modo paciente. Se desvía AQUÍ, antes de montar `App`, y por lo que
// evita:
//
//   · `App` arranca con `useDeviceBootstrap`, así que un móvil sin
//     emparejar caería en la pantalla de pairing — que es lo que pasaba
//     con la URL del PDF público del ticket antes de su `handle` en Caddy
//     (B-TPV-Bugfix, Bug-04). Aquí el desvío es en el cliente y no hace
//     falta regla nueva: el `try_files` de la PWA ya trae el index.html.
//   · Y en la tablet, el modo paciente NO puede ser una pantalla DENTRO
//     del TPV: si lo fuera, el paciente tendría detrás la sesión de la
//     podóloga y «sin forma de salir» sería un adorno. Montando sólo
//     esto, lo único que hay en pantalla es su test. Para volver al TPV se
//     recarga la raíz y se teclea el PIN, que es el login de siempre.
//
const tokenDelTest = tokenDeLaUrl();

// v1.12-manos-de-camarero · hallazgo H1: en el Chrome 81 de fábrica del
// AP11 no existe `gap` en flexbox y la UI entera se pinta con los
// textos pegados ("Sala5 abiertas", "GEgemmamgc720,00 €"). Se comprueba
// ANTES de montar React y se bloquea con una pantalla honesta: no hay
// polyfill que valga para 245 `gap-*`, y una UI descuadrada en barra es
// peor que una puerta cerrada.
//
// clinica-2 · y va DELANTE del test del paciente a propósito, no sólo del
// TPV: el test se ve en móviles viejos y en la tablet de la sala, y una
// pantalla descuadrada ahí es un paciente que no contesta.
if (!flexGapSupported()) {
  renderUnsupportedBrowser(root);
} else {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        {tokenDelTest ? (
          <ValoracionPublica token={tokenDelTest} />
        ) : (
          <App />
        )}
      </ErrorBoundary>
    </StrictMode>,
  );
}
