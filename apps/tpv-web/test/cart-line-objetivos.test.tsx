// v1.22-el-terminal-del-bar · §3 · hallazgo C8.
//
// SABOTAJE que tiene que caer: devolver `−` y `+` a 44 × 36 px.
//
// Medido en el AP13: el stepper tenía las dos teclas a 44 × 36 y la
// papelera a 44 × 44. La escala táctil cerrada de `tokens.md` §4 empieza
// en 48 (`touch`), que a 157 dpi son ~8 mm — el mínimo con dedo de
// camarero y prisa. 44 × 36 son 7,4 × 6 mm.
//
// El test pregunta por los TOKENS y no por píxeles porque jsdom no hace
// layout: `getBoundingClientRect` devuelve ceros. Lo que no puede pasar
// es que las clases vuelvan a ser `h-9 w-11` sin que nada se ponga rojo.
// Las medidas en píxeles de verdad las da el bucle visual, y están en el
// `-done`.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartLineItem } from "../src/pages/CartLineItem.js";
import type { CartLine } from "../src/lib/cart.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function linea(over: Partial<CartLine> = {}): CartLine {
  return {
    id: "l-1",
    productId: "p-1",
    variantId: null,
    holdedProductId: "h-1",
    sku: "BOC-007",
    nameSnapshot: "Hamburguesa especial",
    units: 2,
    unitPrice: 6.3636,
    unitPriceOverride: null,
    priceGross: 7,
    discountPct: 0,
    taxRate: 10,
    modifiers: [],
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function pinta(l: CartLine = linea()) {
  await act(async () => {
    root.render(
      <CartLineItem
        line={l}
        onClick={vi.fn()}
        onUnitsChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
  });
}

function porEtiqueta(aria: string | RegExp): HTMLButtonElement {
  const todos = Array.from(container.querySelectorAll("button"));
  const b = todos.find((x) => {
    const l = x.getAttribute("aria-label") ?? "";
    return typeof aria === "string" ? l === aria : aria.test(l);
  });
  if (!b) throw new Error(`botón "${aria}" no encontrado`);
  return b as HTMLButtonElement;
}

describe("v1.22 §3 · objetivos táctiles de la línea del ticket", () => {
  it("− y + llegan a 48 × 48 (antes 44 × 36)", async () => {
    await pinta();
    for (const b of [porEtiqueta("Restar una unidad"), porEtiqueta("Sumar una unidad")]) {
      const clases = b.className.split(/\s+/);
      expect(clases).toContain("h-touch");
      expect(clases).toContain("w-touch");
      // Las medidas de antes, por su nombre: si vuelven, cae el test.
      expect(clases).not.toContain("h-9");
      expect(clases).not.toContain("w-11");
    }
  });

  it("la papelera llega a 48 × 48 (antes 44 × 44)", async () => {
    await pinta();
    const clases = porEtiqueta(/^Eliminar /).className.split(/\s+/);
    expect(clases).toContain("h-touch");
    expect(clases).toContain("w-touch");
    expect(clases).not.toContain("h-11");
  });

  it("todos los botones de la línea usan la escala cerrada, sin medidas sueltas", async () => {
    await pinta();
    for (const b of Array.from(container.querySelectorAll("button"))) {
      // `tokens.md` §4: "no se suben alturas con `h-[52px]` sueltos".
      expect(b.className).not.toMatch(/h-\[\d/);
      expect(b.className).not.toMatch(/w-\[\d/);
    }
  });

  it("la papelera no queda pegada al «−»: están en extremos opuestos", async () => {
    await pinta();
    const botones = Array.from(container.querySelectorAll("button"));
    const iMenos = botones.indexOf(porEtiqueta("Restar una unidad"));
    const iPapelera = botones.indexOf(porEtiqueta(/^Eliminar /));
    // Entre los dos está el `+` y el bloque del nombre (112 px medidos).
    expect(iPapelera).toBeGreaterThan(iMenos + 1);
    expect(botones[botones.length - 1]).toBe(porEtiqueta(/^Eliminar /));
  });
});

describe("v1.22 §3 · el nombre en la línea", () => {
  it("se pinta hasta en DOS líneas, no en una con elipsis por el final", async () => {
    await pinta();
    const nombre = container.querySelector<HTMLElement>(
      '[data-testid="cart-line-name"]',
    )!;
    expect(nombre.className).not.toContain("truncate");
    expect(nombre.style.webkitLineClamp).toBe("2");
    expect(nombre.style.overflow).toBe("hidden");
  });

  it("el nombre completo queda en el title, aunque se recorte", async () => {
    await pinta(linea({ nameSnapshot: "Tostada de pan molde con mantequilla" }));
    const nombre = container.querySelector<HTMLElement>(
      '[data-testid="cart-line-name"]',
    )!;
    expect(nombre.getAttribute("title")).toBe(
      "Tostada de pan molde con mantequilla",
    );
    expect(nombre.textContent).not.toBe("Tostada de pan molde con mantequilla");
    // Cortado por el medio: conserva la cola.
    expect(nombre.textContent).toContain("…");
    expect(nombre.textContent!.endsWith("mantequilla")).toBe(true);
  });

  it("los dos importes van juntos y con tabular-nums", async () => {
    await pinta();
    const textos = Array.from(container.querySelectorAll("span")).map(
      (s) => s.textContent ?? "",
    );
    expect(textos.some((t) => t.includes("7,00 € ud."))).toBe(true);
    expect(textos.some((t) => t.trim() === "14,00 €")).toBe(true);
  });
});
