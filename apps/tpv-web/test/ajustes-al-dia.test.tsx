// auditoria-sirope (#20) · LA CAJA SE ENTERA SIN REINICIAR.
//
// El 18-10 el super-admin encendió Cocina con el D8 delante y el D8 no
// se enteró: `useDeviceBootstrap` lee `/devices/me` al arrancar y lo
// cachea, y nadie lo refrescaba. Hubo que cerrar y abrir la aplicación —
// y esa vez se quedó en blanco (#21).
//
// La fila de la tabla de sabotajes que vive aquí:
//
//   | Los ajustes del tenant no se refrescan tras el cambio

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithDevice: vi.fn() }));
const storageMock = vi.hoisted(() => ({ getDeviceToken: vi.fn(() => "tok") }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithDevice: apiMock.apiWithDevice };
});
vi.mock("../src/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../src/storage.js")>(
    "../src/storage.js",
  );
  return { ...actual, getDeviceToken: storageMock.getDeviceToken };
});

const { avisarAjustesCambiados, useDeviceBootstrap } = await import(
  "../src/hooks/useDeviceBootstrap.js"
);

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** El `/devices/me` de Sirope. `cocina` cambia entre llamadas. */
let cocina = false;
let llamadas = 0;

function respuesta() {
  return {
    device: { id: "d-1", name: "D8", pairedAt: new Date().toISOString() },
    register: { id: "r-1", name: "Caja 1", numSerieHolded: null },
    store: { id: "s-1", name: "Sirope" },
    tenant: {
      id: "t-1",
      name: "Sirope",
      cashierAutoLogoutMinutes: 30,
      kitchenDisplayEnabled: cocina,
    },
    kitchen: null,
  };
}

let container: HTMLDivElement;
let root: Root;
let visto: boolean | undefined;

function Sonda() {
  const { state } = useDeviceBootstrap();
  visto =
    state.kind === "paired" ? state.data.tenant.kitchenDisplayEnabled : undefined;
  return null;
}

beforeEach(() => {
  cocina = false;
  llamadas = 0;
  visto = undefined;
  localStorage.clear();
  apiMock.apiWithDevice.mockReset();
  apiMock.apiWithDevice.mockImplementation(async (path: string) => {
    if (path !== "/devices/me") throw new Error(`ruta inesperada: ${path}`);
    llamadas += 1;
    return respuesta();
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("#20 · los ajustes del tenant se repasan sin reiniciar", () => {
  it("el aviso del bus los vuelve a pedir y Cocina se enciende", async () => {
    await act(async () => {
      root.render(<Sonda />);
    });
    await settle();
    expect(visto).toBe(false);
    expect(llamadas).toBe(1);

    // El super-admin enciende Cocina.
    cocina = true;
    await act(async () => {
      avisarAjustesCambiados();
    });
    await settle();

    // EL SABOTAJE: sin el repaso, `visto` sigue en `false` hasta que
    // alguien cierre y abra la aplicación.
    expect(llamadas).toBe(2);
    expect(visto).toBe(true);
  });

  it("volver al primer plano también los repasa", async () => {
    await act(async () => {
      root.render(<Sonda />);
    });
    await settle();
    cocina = true;

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    expect(visto).toBe(true);
  });

  it("un repaso que falla NO tumba el terminal: se queda lo que había", async () => {
    await act(async () => {
      root.render(<Sonda />);
    });
    await settle();
    expect(visto).toBe(false);

    apiMock.apiWithDevice.mockImplementation(async () => {
      throw new Error("sin red");
    });
    await act(async () => {
      avisarAjustesCambiados();
    });
    await settle();
    // Sigue emparejado y operando con lo que tenía.
    expect(visto).toBe(false);
  });
});
