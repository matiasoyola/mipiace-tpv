import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import {
  ErrorBoundary,
  installGlobalErrorLogging,
} from "./components/ErrorBoundary.js";
import { initSentry } from "./lib/sentry.js";
import { esRutaDeFichar } from "./fichar/lib/ruta.js";
import "./index.css";

// Sentry (v1.5-B Lote 2): gated por VITE_SENTRY_DSN — sin DSN, no-op
// absoluto.
initSentry();

// v1.5-consistencia-A §4.b: promesas rechazadas sin catch → consola
// estructurada + Sentry.
installGlobalErrorLogging();

const root = document.getElementById("root");
if (!root) throw new Error("Falta #root en index.html");

// F1 (ADR-018) · LA BIFURCACIÓN. `/fichar` es la pantalla del empleado y
// no tiene nada que ver con el panel: ni router, ni sesión de propietario,
// ni shell. Y sobre todo, ni su bundle — `App.tsx` importa de forma
// estática las ~30 pantallas del admin, y servirle eso al móvil de un
// profesor para enseñarle un botón sería absurdo.
//
// Los DOS lados van por `import()` dinámico: así Vite parte el chunk y
// cada rama se lleva sólo lo suyo. Es el único cambio de este fichero.
async function arrancar(): Promise<void> {
  if (esRutaDeFichar(window.location.pathname)) {
    const { FicharApp } = await import("./fichar/FicharApp.js");
    createRoot(root!).render(
      <StrictMode>
        <ErrorBoundary>
          <FicharApp />
        </ErrorBoundary>
      </StrictMode>,
    );
    return;
  }
  const { App } = await import("./App.js");
  createRoot(root!).render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>,
  );
}

void arrancar();
