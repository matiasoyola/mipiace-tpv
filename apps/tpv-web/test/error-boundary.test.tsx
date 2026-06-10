// Tests del ErrorBoundary raíz del TPV (v1.5-consistencia-A §4.b).

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "../src/components/ErrorBoundary.js";
import { loadPersistedCartLines } from "../src/lib/persistedCart.js";
import type { CartLine } from "../src/lib/cart.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function Bomb(): never {
  throw new Error("componente roto a propósito");
}

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  sessionStorage.clear();
});

afterEach(() => {
  container.remove();
});

describe("ErrorBoundary", () => {
  it("componente que lanza → pantalla amable con botón Recargar", async () => {
    // React loguea el error capturado por consola — lo silenciamos
    // para no ensuciar la salida del runner.
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
    expect(container.textContent).toContain("La venta en curso no se pierde");
    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Recargar");
    spy.mockRestore();
  });

  it("sin error renderiza los children tal cual", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <span>contenido ok</span>
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe("contenido ok");
  });
});

describe("persistencia del carrito (sessionStorage)", () => {
  it("las líneas guardadas se recuperan tras un remount", () => {
    const line: CartLine = {
      id: "l1",
      productId: "p1",
      variantId: null,
      holdedProductId: "h1",
      sku: "SKU-1",
      nameSnapshot: "Café",
      units: 2,
      unitPrice: 1.4,
      unitPriceOverride: null,
      priceGross: 1.54,
      discountPct: 0,
      taxRate: 10,
      modifiers: [],
    };
    sessionStorage.setItem(
      "mipiacetpv-cart-in-progress:quick-sale",
      JSON.stringify([line]),
    );
    const restored = loadPersistedCartLines(
      "mipiacetpv-cart-in-progress:quick-sale",
    );
    expect(restored).toHaveLength(1);
    expect(restored[0]!.nameSnapshot).toBe("Café");
    expect(restored[0]!.units).toBe(2);
  });

  it("storage corrupto → carrito vacío, sin lanzar", () => {
    sessionStorage.setItem("mipiacetpv-cart-in-progress:quick-sale", "{nope");
    expect(
      loadPersistedCartLines("mipiacetpv-cart-in-progress:quick-sale"),
    ).toEqual([]);
  });
});
