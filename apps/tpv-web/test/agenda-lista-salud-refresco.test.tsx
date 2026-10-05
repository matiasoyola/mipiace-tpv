// agenda-lista (hallazgo ⚪ 7) · el panel de salud se entera de que lo han
// arreglado.
//
// El fallo: la dueña abre el panel, se va a la matriz, marca las cuatro
// casillas del tinte, vuelve… y la tarjeta sigue diciendo 2. Hay que
// pulsar «Actualizar». Acabas de arreglar algo y la pantalla te dice que
// sigue roto, que es justo lo que hace pensar que no ha funcionado.
//
// Por qué pasaba: el panel guardaba la foto en su propio `useState` y la
// matriz se pinta ENCIMA, sin desmontarlo. Quien volvía a pedir la salud
// al cerrar la matriz era `AgendaPage`, para su badge; el panel no se
// enteraba.
//
// El arreglo es la foto compartida de `agenda-health.ts` con oyentes. Aquí
// se fija por los dos caminos que pide el bloque: alguien de fuera que
// vuelve a pedirla, y recuperar el foco.
//
// Mismo patrón que `agenda-salud.test.tsx`: createRoot + act, sin
// testing-library.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

import {
  fetchAgendaHealth,
  __resetHealthSnapshotParaTests,
} from "../src/lib/agenda-health.js";
import { AgendaHealthPanel } from "../src/pages/AgendaHealthPanel.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const TINTE_A = "00000000-0000-0000-0000-0000000000s1";
const TINTE_B = "00000000-0000-0000-0000-0000000000s2";

/** La tarjeta nº 1 con la cifra que se le pida. */
function salud(value: number) {
  return {
    generatedAt: "2026-10-04T09:00:00.000Z",
    cards: [
      {
        key: "servicios-sin-profesional",
        title: "Servicios que nadie puede hacer",
        unit: "servicios",
        unitOne: "servicio",
        status: "ok",
        value,
        items:
          value === 0
            ? []
            : [
                { id: TINTE_A, label: "Tinte · aplicación", detail: "Nadie lo tiene asignado" },
                { id: TINTE_B, label: "Tinte · lavado y peinado", detail: "Nadie lo tiene asignado" },
              ],
        goodNews: "Todos los servicios agendables tienen a alguien que los da.",
        explain: "Cuenta los servicios con ficha de agenda sin nadie detrás.",
        query: "SELECT p.id FROM service_scheduling ss WHERE ss.tenant_id = $1::uuid",
        params: ["$1 = este negocio"],
        dependsOn: null,
        unavailableReason: null,
      },
    ],
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  apiMock.apiWithCashier.mockReset();
  localStorage.clear();
  __resetHealthSnapshotParaTests();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function pintarPanel(): Promise<void> {
  await act(async () => {
    root.render(
      <AgendaHealthPanel onClose={() => undefined} onOpenMatrix={() => undefined} />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function cifra(): string | null {
  return (
    container.querySelector('[data-test="tarjeta-servicios-sin-profesional"]')
      ?.querySelector('[data-test="cifra"]')?.textContent ?? null
  );
}

describe("agenda-lista · el panel se refresca sin que se lo pidan a él", () => {
  it("al volver de la matriz: quien relee la salud es otro y la cifra baja igual", async () => {
    apiMock.apiWithCashier.mockResolvedValueOnce(salud(2));
    await pintarPanel();
    expect(cifra()).toBe("2");

    // Esto es literalmente lo que hace `AgendaPage` en el `onClose` de la
    // matriz. El panel sigue montado detrás y nadie le ha dicho nada.
    apiMock.apiWithCashier.mockResolvedValueOnce(salud(0));
    await act(async () => {
      await fetchAgendaHealth();
    });

    expect(cifra()).toBe("0");
    // Y la buena noticia, que es lo que se le enseña a la dueña.
    expect(
      container.querySelector('[data-test="buena-noticia"]'),
    ).not.toBeNull();
  });

  it("al recuperar el foco vuelve a preguntar", async () => {
    // El AP12 se queda abierto en la agenda todo el día: la pestaña se va
    // y vuelve, y un panel de diagnóstico quieto desde hace horas es peor
    // que no tenerlo.
    apiMock.apiWithCashier.mockResolvedValueOnce(salud(2));
    await pintarPanel();
    expect(cifra()).toBe("2");

    apiMock.apiWithCashier.mockResolvedValueOnce(salud(0));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(cifra()).toBe("0");
  });

  it("si la pestaña se ESCONDE no pregunta: sólo al volver", async () => {
    apiMock.apiWithCashier.mockResolvedValueOnce(salud(2));
    await pintarPanel();
    expect(apiMock.apiWithCashier).toHaveBeenCalledTimes(1);

    const original = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(apiMock.apiWithCashier).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    apiMock.apiWithCashier.mockResolvedValueOnce(salud(0));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(apiMock.apiWithCashier).toHaveBeenCalledTimes(2);

    if (original) Object.defineProperty(Document.prototype, "visibilityState", original);
  });

  it("un refresco que falla no borra lo que ya se estaba leyendo", async () => {
    // La regla de acabado de B-reservas-9: un panel de diagnóstico que se
    // queda en blanco por un error de red deja de diagnosticar justo
    // cuando más falta hace.
    apiMock.apiWithCashier.mockResolvedValueOnce(salud(2));
    await pintarPanel();
    expect(cifra()).toBe("2");

    apiMock.apiWithCashier.mockRejectedValueOnce(new Error("sin red"));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(cifra()).toBe("2");
    expect(container.querySelector('[data-test="salud-error"]')).not.toBeNull();
  });
});
