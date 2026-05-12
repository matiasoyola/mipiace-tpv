import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import { App } from "./App.js";
import "./index.css";

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
