// ErrorBoundary raíz del TPV (v1.5-consistencia-A §4.b). Si cualquier
// componente lanza durante el render, en vez de pantalla blanca el
// cajero ve un mensaje en español con botón "Recargar". El carrito en
// curso NO se pierde: SalePage lo persiste en sessionStorage
// (usePersistedCartLines) y se restaura al recargar.

import { Component, type ErrorInfo, type ReactNode } from "react";

import { captureError } from "../lib/sentry.js";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Consola estructurada + Sentry (v1.5-B Lote 2; no-op sin DSN).
    console.error("[error-boundary]", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
    captureError(error, { componentStack: info.componentStack });
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-50 p-6 text-center">
        <h1 className="text-xl font-semibold text-neutral-900">
          Algo ha fallado en el TPV
        </h1>
        <p className="max-w-md text-sm text-neutral-600">
          Se ha producido un error inesperado. La venta en curso no se
          pierde: el carrito se restaura automáticamente al recargar.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-xl bg-neutral-900 px-6 py-3 text-base font-medium text-white"
        >
          Recargar
        </button>
      </div>
    );
  }
}

// Captura promesas rechazadas fuera del árbol React (fetch sueltos,
// listeners). Log estructurado + Sentry (v1.5-B; no-op sin DSN).
export function installGlobalErrorLogging(): void {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as unknown;
    console.error("[unhandledrejection]", {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? (reason.stack ?? null) : null,
    });
    captureError(reason, { source: "unhandledrejection" });
  });
}
