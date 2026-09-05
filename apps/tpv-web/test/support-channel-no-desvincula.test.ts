// A5 · R1 · el canal de soporte NO PUEDE DESVINCULAR NADA. Nunca.
//
// Es el riesgo de este bloque, y no es teórico: la vinculación vive en
// `localStorage` (`mipiacetpv-device-token`, `mipiacetpv-device-me`) y borrarla
// significa que un lunes por la mañana el TPV pide un código de 6 dígitos en la
// barra, con el bar abriendo. A5 añade un canal permanente que habla con el
// servidor cada 30 s: si algún día alguien «arregla» un 4401 llamando a
// `unpair()`, un fallo transitorio de la API desvincula la flota entera.
//
// Dos redes, a propósito:
//
//   1. Comportamiento: ante cualquier cierre —incluido el que dice que el
//      device está revocado— el token sigue donde estaba.
//   2. Estructura: el fichero del canal no puede ni mencionar `unpair`,
//      `clearAllDeviceState` o `useDeviceBootstrap`. Esta segunda red es la que
//      sobrevive a un refactor que la primera no vería.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "token-de-terminal-con-entropia-de-sobra";

const clearAllDeviceState = vi.fn();
const setDeviceToken = vi.fn();

vi.mock("../src/storage.js", () => ({
  getDeviceToken: () => TOKEN,
  setDeviceToken,
  clearAllDeviceState,
}));

vi.mock("../src/lib/supportChannel/status.js", () => ({
  collectDeviceStatus: async () => ({}),
}));

vi.mock("../src/lib/supportChannel/commands.js", () => ({
  ejecutarComando: async () => ({ resultado: { ok: true, datos: null } }),
}));

const { startSupportChannel } = await import(
  "../src/lib/supportChannel/index.js"
);

/** WebSocket de mentira: no abre nada y deja disparar los eventos a mano. */
class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  readonly listeners: Record<string, Array<(ev: unknown) => void>> = {};
  enviados: string[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(tipo: string, fn: (ev: unknown) => void): void {
    (this.listeners[tipo] ??= []).push(fn);
  }
  removeEventListener(): void {}
  send(data: string): void {
    this.enviados.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  disparar(tipo: string, ev: unknown = {}): void {
    for (const fn of this.listeners[tipo] ?? []) fn(ev);
  }
  abrir(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.disparar("open");
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeWebSocket.instances = [];
  localStorage.clear();
  localStorage.setItem("mipiacetpv-device-token", TOKEN);
  localStorage.setItem("mipiacetpv-device-me", '{"device":{"id":"x"}}');
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
});

afterEach(() => {
  vi.useRealTimers();
});

/** Estado de la vinculación tal y como lo mira el arranque del TPV. */
function sigueEmparejado(): boolean {
  return (
    localStorage.getItem("mipiacetpv-device-token") === TOKEN &&
    localStorage.getItem("mipiacetpv-device-me") !== null &&
    clearAllDeviceState.mock.calls.length === 0
  );
}

describe("R1 · el canal no desvincula", () => {
  it("un token rechazado (4401) NO desvincula: sólo reintenta", async () => {
    const canal = startSupportChannel();
    const ws = FakeWebSocket.instances[0]!;
    ws.abrir();
    ws.disparar("close", { code: 4401 });

    expect(sigueEmparejado(), "un 4401 no puede tocar la vinculación").toBe(true);
    canal.stop();
  });

  it("un cierre por REVOCADO (4403) tampoco desvincula", async () => {
    // Aunque el servidor diga que el device está revocado, el canal no es quien
    // decide eso: se calla y ya. Quien sabe qué hacer con una revocación es
    // `/devices/me` en el arranque.
    const canal = startSupportChannel();
    const ws = FakeWebSocket.instances[0]!;
    ws.abrir();
    ws.disparar("close", { code: 4403 });

    expect(sigueEmparejado(), "ni un 4403 puede borrar el token").toBe(true);
    canal.stop();
  });

  it("un fallo transitorio del servidor (4500) tampoco, y sigue reintentando", async () => {
    vi.useFakeTimers();
    const canal = startSupportChannel();
    FakeWebSocket.instances[0]!.abrir();
    FakeWebSocket.instances[0]!.disparar("close", { code: 4500 });

    expect(sigueEmparejado()).toBe(true);
    // Y vuelve a intentarlo: un problema NUESTRO no deja al terminal sin canal
    // hasta que alguien vaya al local.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
    canal.stop();
  });

  it("un error de socket tampoco desvincula", async () => {
    const canal = startSupportChannel();
    const ws = FakeWebSocket.instances[0]!;
    ws.disparar("error", {});
    ws.disparar("close", { code: 1006 });
    expect(sigueEmparejado()).toBe(true);
    canal.stop();
  });

  it("parar el canal no desvincula", async () => {
    const canal = startSupportChannel();
    FakeWebSocket.instances[0]!.abrir();
    canal.stop();
    expect(sigueEmparejado()).toBe(true);
  });

  it("del token sólo se LEE: nunca se reescribe", async () => {
    const canal = startSupportChannel();
    const ws = FakeWebSocket.instances[0]!;
    ws.abrir();
    await Promise.resolve();
    ws.disparar("close", { code: 4401 });
    expect(setDeviceToken).not.toHaveBeenCalled();
    canal.stop();
  });
});

describe("R1 · red estructural", () => {
  /**
   * Ruta real de un fuente de `src`. El cwd de vitest depende del proyecto
   * desde el que se lance la suite, así que se prueban las dos posibilidades
   * en vez de asumir una.
   */
  function fuenteReal(rel: string): string {
    const nombre = rel.replace("../src/", "");
    for (const base of ["apps/tpv-web/src", "src"]) {
      const ruta = resolve(process.cwd(), base, nombre);
      if (existsSync(ruta)) return ruta;
    }
    throw new Error(`no encuentro ${rel} desde ${process.cwd()}`);
  }

  const FUENTES = [
    "../src/lib/supportChannel/index.ts",
    "../src/lib/supportChannel/commands.ts",
    "../src/lib/supportChannel/status.ts",
  ];

  // Nombres que, si aparecen en el canal, significan que alguien le ha dado la
  // capacidad de desvincular un terminal.
  const PROHIBIDOS = ["unpair", "clearAllDeviceState", "useDeviceBootstrap"];

  for (const fuente of FUENTES) {
    it(`${fuente} no puede desvincular`, () => {
      const codigo = readFileSync(fuenteReal(fuente), "utf8");
      // Se ignoran los comentarios: el fichero EXPLICA que no los usa, y esa
      // explicación no puede hacer fallar su propio guardia.
      const sinComentarios = codigo
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const prohibido of PROHIBIDOS) {
        expect(
          sinComentarios.includes(prohibido),
          `${fuente} menciona ${prohibido}: el canal de soporte no puede desvincular un terminal`,
        ).toBe(false);
      }
    });
  }

  it("el comando `recargar` es un reload y nada más (R4)", () => {
    const codigo = readFileSync(
      fuenteReal("../src/lib/supportChannel/commands.ts"),
      "utf8",
    ).replace(/^\s*\/\/.*$/gm, "");
    // Nada de limpiar cachés ni storage: `recargar` recarga, y punto. Lo que
    // limpia cachés es el rescate nativo de A4, que decide por versionCode y no
    // por un comando del panel.
    for (const prohibido of [
      "caches",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "deleteDatabase",
    ]) {
      expect(
        codigo.includes(prohibido),
        `commands.ts menciona ${prohibido}: ningún comando puede tocar el almacenamiento del terminal`,
      ).toBe(false);
    }
  });
});
