import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App.js";
import {
  ErrorBoundary,
  installGlobalErrorLogging,
} from "./components/ErrorBoundary.js";
import "./index.css";

// v1.5-consistencia-A §4.b: promesas rechazadas sin catch → consola
// estructurada (gancho Sentry v1.5-B).
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
