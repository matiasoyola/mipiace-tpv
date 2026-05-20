import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import { App } from "./App.js";
import { consumeTestModeFromUrl } from "./lib/test-mode.js";
import { runVersionCheck } from "./lib/version-check.js";
import "./index.css";

// B-OnboardingV2: si la URL trae `?testCashierToken=...&testDeviceToken=...`,
// los guardamos en sessionStorage y limpiamos la URL antes de que el
// SW registre nada (el SW podría cachear la URL con tokens en
// historial). Es síncrono — no añade latencia perceptible.
consumeTestModeFromUrl();

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
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
