// clinica-10 (paso 38) · EMPAREJAR NO PONE NOMBRE.
//
// La pasada del 27-10 volvió a ver el user-agent crudo en Panel ›
// Dispositivos, con el lector de clinica-8 (fase B, 18) ya escrito y en
// verde. El lector no se llegaba a usar: esta pantalla emparejaba
// mandando `deviceName: navigator.userAgent.slice(0, 80)` —el
// user-agent CRUDO y además cortado por la mitad— en la columna del
// NOMBRE, y un nombre puesto manda sobre lo que el panel sepa leer.
//
// El nombre lo pone una persona, desde el panel. Lo que la tablet sabe
// de sí misma es su user-agent, y va en el campo del user-agent.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiPublic: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiPublic: apiMock.apiPublic };
});

vi.mock("../src/storage.js", async () => {
  const actual = await vi.importActual<typeof import("../src/storage.js")>(
    "../src/storage.js",
  );
  return { ...actual, setDeviceToken: () => {} };
});

import { PairScreen } from "../src/pages/PairScreen.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** El user-agent de la Lenovo TB311FU con la APK, el de la pasada. */
const LENOVO_APK =
  "Mozilla/5.0 (Linux; Android 14; TB311FU Build/UP1A.231005.007; wv) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.88 " +
  "Mobile Safari/537.36";

let host: HTMLDivElement;
let root: Root;
let enviado: Array<Record<string, unknown>>;

beforeEach(() => {
  enviado = [];
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: LENOVO_APK,
  });
  apiMock.apiPublic.mockReset();
  apiMock.apiPublic.mockImplementation(
    async (_url: string, init?: { body?: Record<string, unknown> }) => {
      if (init?.body) enviado.push(init.body);
      return {
        deviceToken: "t",
        deviceId: "d",
        tenantId: "t1",
        registerId: "r1",
        registerName: "Caja 1",
        storeName: "Clínica demo",
      };
    },
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function emparejarCon(codigo: string) {
  await act(async () => {
    root.render(<PairScreen onPaired={() => {}} />);
  });
  const inputs = [...host.querySelectorAll("input")] as HTMLInputElement[];
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  for (const [i, c] of [...codigo].entries()) {
    await act(async () => {
      setValue.call(inputs[i]!, c);
      inputs[i]!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("clinica-10 (38) · lo que la tablet manda al emparejarse", () => {
  it("manda el user-agent entero y NO un nombre", async () => {
    await emparejarCon("123456");
    expect(enviado).toHaveLength(1);
    expect(enviado[0]!.code).toBe("123456");
    expect(enviado[0]!.userAgent).toBe(LENOVO_APK);
    // La clave no está, no es que venga vacía: el servidor guarda
    // `deviceName ?? null` y lo que tiene que quedar es NULL.
    expect("deviceName" in enviado[0]!).toBe(false);
  });

  it("y desde luego no manda el user-agent como nombre", async () => {
    await emparejarCon("123456");
    const comoNombre = Object.entries(enviado[0]!).filter(
      ([clave, valor]) =>
        clave !== "userAgent" &&
        typeof valor === "string" &&
        valor.startsWith("Mozilla/"),
    );
    expect(comoNombre).toEqual([]);
  });
});
