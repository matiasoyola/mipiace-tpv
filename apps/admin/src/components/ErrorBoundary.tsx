// ErrorBoundary raíz del admin (v1.5-consistencia-A §4.b). Pantalla
// amable en español + botón "Recargar" en vez de pantalla blanca.

import { Component, type ErrorInfo, type ReactNode } from "react";

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
    // Consola estructurada — gancho para Sentry en v1.5-B.
    console.error("[error-boundary]", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-50 p-6 text-center">
        <h1 className="text-xl font-semibold text-neutral-900">
          Algo ha fallado
        </h1>
        <p className="max-w-md text-sm text-neutral-600">
          Se ha producido un error inesperado en el panel de
          administración. Recarga la página para continuar.
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

// Captura promesas rechazadas fuera del árbol React. Sólo log
// estructurado — Sentry llegará en v1.5-B.
export function installGlobalErrorLogging(): void {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as unknown;
    console.error("[unhandledrejection]", {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? (reason.stack ?? null) : null,
    });
  });
}
