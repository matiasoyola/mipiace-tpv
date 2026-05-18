import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import { App } from "./App.js";
import { consumeTestModeFromUrl } from "./lib/test-mode.js";
import "./index.css";

// B-OnboardingV2: si la URL trae `?testCashierToken=...&testDeviceToken=...`,
// los guardamos en sessionStorage y limpiamos la URL antes de que el
// SW registre nada (el SW podría cachear la URL con tokens en
// historial). Es síncrono — no añade latencia perceptible.
consumeTestModeFromUrl();

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
