// Tests del ErrorBoundary raíz del admin (v1.5-consistencia-A §4.b).

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "../src/components/ErrorBoundary.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function Bomb(): never {
  throw new Error("componente roto a propósito");
}

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe("ErrorBoundary (admin)", () => {
  it("componente que lanza → pantalla amable con botón Recargar", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toContain("Algo ha fallado");
    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Recargar");
    spy.mockRestore();
  });

  it("sin error renderiza los children tal cual", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <span>panel ok</span>
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe("panel ok");
  });
});
