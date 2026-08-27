// v1.12-manos-de-camarero · pila del guardia del Atrás (hallazgo H6).
//
// Lo que hay que impedir, literalmente: que el Atrás del sistema saque
// del TPV con el turno abierto. En el AP11 pasó durante el arqueo —
// cerró el modal, siguió hacia atrás y acabó en el escritorio de
// Android; al volver, Chrome abrió una segunda pestaña que pedía el PIN
// otra vez.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __backGuardLayerCount,
  __resetBackGuardForTests,
  installBackGuard,
  setBackFallback,
  useBackGuard,
} from "../src/hooks/useBackGuard.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  __resetBackGuardForTests();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  __resetBackGuardForTests();
});

// El Atrás del sistema llega como `popstate`.
async function pressBack() {
  await act(async () => {
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });
}

function Layer({ onClose, open = true }: { onClose: () => void; open?: boolean }) {
  useBackGuard(onClose, open);
  return null;
}

describe("v1.12 · useBackGuard · la historia nunca se queda vacía", () => {
  it("al instalarse empuja un estado centinela", () => {
    const push = vi.spyOn(history, "pushState");
    installBackGuard();
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });

  it("cada Atrás repone el centinela, así que el siguiente tampoco sale", async () => {
    installBackGuard();
    const push = vi.spyOn(history, "pushState");
    await pressBack();
    await pressBack();
    expect(push).toHaveBeenCalledTimes(2);
    push.mockRestore();
  });

  it("instalar dos veces no duplica el listener", async () => {
    installBackGuard();
    installBackGuard();
    const onClose = vi.fn();
    await act(async () => root.render(<Layer onClose={onClose} />));
    await pressBack();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("v1.12 · useBackGuard · pila de capas", () => {
  it("el Atrás cierra la capa de MÁS ARRIBA", async () => {
    const closeSheet = vi.fn();
    const closePad = vi.fn();
    await act(async () => {
      root.render(
        <>
          <Layer onClose={closeSheet} />
          <Layer onClose={closePad} />
        </>,
      );
    });
    expect(__backGuardLayerCount()).toBe(2);

    await pressBack();
    // El pad estaba encima: se cierra él, no la hoja de cobro entera.
    expect(closePad).toHaveBeenCalledTimes(1);
    expect(closeSheet).not.toHaveBeenCalled();
  });

  it("cerrada la de arriba, el siguiente Atrás cierra la de abajo", async () => {
    const closeSheet = vi.fn();
    const closePad = vi.fn();
    await act(async () => {
      root.render(
        <>
          <Layer onClose={closeSheet} />
          <Layer onClose={closePad} open />
        </>,
      );
    });
    await pressBack();
    // La capa de arriba se desregistra al cerrarse (open = false).
    await act(async () => {
      root.render(
        <>
          <Layer onClose={closeSheet} />
          <Layer onClose={closePad} open={false} />
        </>,
      );
    });
    expect(__backGuardLayerCount()).toBe(1);

    await pressBack();
    expect(closeSheet).toHaveBeenCalledTimes(1);
    expect(closePad).toHaveBeenCalledTimes(1);
  });

  it("una capa que se desmonta sale de la pila", async () => {
    const onClose = vi.fn();
    await act(async () => root.render(<Layer onClose={onClose} />));
    expect(__backGuardLayerCount()).toBe(1);
    await act(async () => root.render(<></>));
    expect(__backGuardLayerCount()).toBe(0);

    await pressBack();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("re-renderizar con un onClose nuevo no reordena la pila", async () => {
    const closeSheet = vi.fn();
    const padV1 = vi.fn();
    const padV2 = vi.fn();
    await act(async () => {
      root.render(
        <>
          <Layer onClose={closeSheet} />
          <Layer onClose={padV1} />
        </>,
      );
    });
    // El componente de arriba re-renderiza con otra identidad de
    // callback: sigue siendo la capa de arriba, y se llama a la versión
    // fresca.
    await act(async () => {
      root.render(
        <>
          <Layer onClose={closeSheet} />
          <Layer onClose={padV2} />
        </>,
      );
    });
    await pressBack();
    expect(padV2).toHaveBeenCalledTimes(1);
    expect(padV1).not.toHaveBeenCalled();
    expect(closeSheet).not.toHaveBeenCalled();
  });
});

describe("v1.12 · useBackGuard · sin capas abiertas", () => {
  it("dentro de una venta, el Atrás vuelve al mapa de mesas", async () => {
    installBackGuard();
    const toMap = vi.fn(() => true);
    setBackFallback(toMap);
    await pressBack();
    expect(toMap).toHaveBeenCalledTimes(1);
  });

  it("en el mapa, con el turno abierto, el Atrás no hace nada", async () => {
    installBackGuard();
    // El guardia de fondo dice "no he gestionado nada"…
    const fallback = vi.fn(() => false);
    setBackFallback(fallback);
    const push = vi.spyOn(history, "pushState");
    await pressBack();
    // …y aun así el centinela vuelve: no se sale de la aplicación.
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });

  it("con una capa abierta manda la capa, no el guardia de fondo", async () => {
    const fallback = vi.fn(() => true);
    setBackFallback(fallback);
    const onClose = vi.fn();
    await act(async () => root.render(<Layer onClose={onClose} />));
    await pressBack();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });
});
