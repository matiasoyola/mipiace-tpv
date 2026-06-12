import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App.js";
import {
  ErrorBoundary,
  installGlobalErrorLogging,
} from "./components/ErrorBoundary.js";
import { initSentry } from "./lib/sentry.js";
import "./index.css";

// Sentry (v1.5-B Lote 2): gated por VITE_SENTRY_DSN — sin DSN, no-op
// absoluto.
initSentry();

// v1.5-consistencia-A §4.b: promesas rechazadas sin catch → consola
// estructurada + Sentry.
installGlobalErrorLogging();

const root = document.getElementById("root");
if (!root) throw new Error("Falta #root en index.html");
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
