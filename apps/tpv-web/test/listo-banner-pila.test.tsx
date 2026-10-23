// hierro-sirope (D) · LAS BANDAS NO EMPUJAN EL TICKET SIN LÍMITE.
//
// Captura 25: con tres bandas apiladas la segunda línea del ticket queda
// bajo la franja «Urgente». A 1442 × 811 (el D8) el ticket y sus botones
// tienen que estar SIEMPRE visibles, así que la pila se pliega: la más
// antigua —la que lleva más tiempo en el pase— y una fila «N mesas listas
// más · Ver» que despliega el resto en su propio scroll.

import type * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ListoBanner,
  MAX_BANDAS,
  type AvisoListo,
} from "../src/kitchen/tpv/ListoBanner.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

function aviso(n: number): AvisoListo {
  return {
    clave: `mesa:${n}`,
    texto: `M${n} · listo para servir`,
    orderIds: [`o-${n}`],
    readyAt: `2026-10-18T23:${String(10 + n).padStart(2, "0")}:00.000Z`,
  };
}

async function render(avisos: AvisoListo[], onServido = (_: string[]) => {}) {
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <ListoBanner avisos={avisos} beep={false} onServido={onServido} />,
    );
  });
}

const bandas = () =>
  [...container.querySelectorAll('[data-testid="listo-banda"]')];
const verMas = () =>
  container.querySelector<HTMLButtonElement>('[data-testid="listo-mas"]');

describe("hierro-sirope D · la pila de bandas", () => {
  it(`hasta ${MAX_BANDAS} se pintan enteras`, async () => {
    await render([aviso(1), aviso(2)]);
    expect(bandas()).toHaveLength(2);
    expect(verMas()).toBeNull();
  });

  it("a partir de la tercera: la más antigua y «2 mesas listas más»", async () => {
    await render([aviso(3), aviso(1), aviso(2)]);
    expect(bandas()).toHaveLength(1);
    // La que lleva más tiempo en el pase es la que hay que atender.
    expect(bandas()[0]!.textContent).toContain("M1");
    expect(verMas()?.textContent).toContain("2 mesas listas más");
  });

  it("«Ver» despliega todas, y la pila scrollea en vez de crecer", async () => {
    await render([aviso(1), aviso(2), aviso(3), aviso(4)]);
    await act(async () => {
      verMas()!.click();
    });
    expect(bandas()).toHaveLength(4);
    const pila = container.querySelector<HTMLElement>('[data-testid="listo-pila"]');
    expect(pila).not.toBeNull();
    expect(pila!.style.maxHeight).not.toBe("");
    expect(pila!.className).toContain("overflow-y-auto");
  });

  it("un toque sirve TODO lo listo de esa mesa", async () => {
    const servidos: string[][] = [];
    await render(
      [
        {
          clave: "mesa:3",
          texto: "M3 · cocina y barra listas",
          orderIds: ["o-cocina", "o-barra"],
          readyAt: "2026-10-18T23:40:00.000Z",
        },
      ],
      (ids) => servidos.push(ids),
    );
    await act(async () => {
      (bandas()[0] as HTMLButtonElement).click();
    });
    expect(servidos).toEqual([["o-cocina", "o-barra"]]);
  });

  it("sin avisos no se pinta nada: el ticket empieza arriba del todo", async () => {
    await render([]);
    expect(
      container.querySelector('[data-testid="listo-banner"]'),
    ).toBeNull();
  });
});
