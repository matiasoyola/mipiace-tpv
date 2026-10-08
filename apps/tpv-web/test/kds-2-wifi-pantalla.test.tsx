// kds-2-wifi · LA PANTALLA DE COCINA CON INTERNET CAÍDO.
//
// Las filas de la tabla de sabotajes que viven aquí:
//
//   | Pantalla roja con la wifi funcionando | franja ÁMBAR, no roja
//   | Sin internet, el TPV no manda por la wifi | la comanda que llega por
//   | el camino directo se pinta con su alergia y su silla
//   | Al volver internet, duplicar | la tarjeta de la wifi se suelta
//   | cuando el servidor trae la suya
//   | Abrir el servidor local en un TERMINAL | sin clave de tienda no se
//   | abre ningún puerto
//
// El plugin nativo se finge instalando el global `Capacitor` que el bridge
// inyecta: es exactamente lo que `platform/index.ts` lee, así que lo que
// se prueba es el camino de producción y no un atajo.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithDevice: vi.fn() }));
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
  return { ...actual, getDeviceToken: () => "token-de-la-pantalla" };
});

import { KitchenScreen } from "../src/kitchen/KitchenScreen.js";
import { conMarcasLocales } from "../src/kitchen/KitchenScreen.js";
import type { Comanda, KitchenMe, VistaCocina } from "../src/kitchen/types.js";
import {
  sinDuplicados,
  type MarcaLocal,
} from "../src/kitchen/useCocinaLan.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const AHORA = "2026-10-09T13:00:00.000Z";
const CLAVE = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const ENVIO = "33333333-3333-4333-8333-333333333333";

const ME: KitchenMe = {
  device: { id: "dev-1", name: "Pase" },
  store: { id: "store-1", name: "La Maestranza" },
  sections: ["COCINA"],
  settings: { greenMaxMin: 10, amberMaxMin: 20, readyBeep: false },
  serverTime: AHORA,
  lan: { key: CLAVE, port: 8787, maxAgeMs: 60_000 },
};

/** El mensaje tal como lo entrega la pieza nativa, ya verificado. */
function mensajeComanda() {
  return {
    kind: "COMANDA",
    opId: ENVIO,
    deviceId: "terminal-1",
    sentAt: AHORA,
    payload: {
      comandas: [
        {
          clientSendId: ENVIO,
          section: "COCINA",
          ticketId: "t1",
          tableId: "m5",
          tableName: "M5",
          number: 1,
          urgent: false,
          sentAt: AHORA,
          allergyBands: [{ titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" }],
          lines: [
            {
              ticketLineId: "l1",
              name: "Patatas bravas",
              units: 2,
              notes: ["Sin picante"],
              course: 1,
              seat: 3,
              fired: true,
              carries: ["GLUTEN"],
              seatAllergy: "SIN GLUTEN",
              allergyWarning: "¡LLEVA GLUTEN!",
            },
          ],
        },
      ],
    },
  };
}

interface PluginFalso {
  arrancadas: number;
  ultimoArranque: Record<string, unknown> | null;
  publicadas: string[];
  cola: unknown[];
}

let plugin: PluginFalso;

function instalarPlugin(opts: { arranca?: boolean } = {}) {
  plugin = {
    arrancadas: 0,
    ultimoArranque: null,
    publicadas: [],
    cola: [],
  };
  (globalThis as Record<string, unknown>).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    Plugins: {
      KitchenLan: {
        arrancar: async (o: Record<string, unknown>) => {
          plugin.arrancadas += 1;
          plugin.ultimoArranque = o;
          const ok = opts.arranca !== false;
          return {
            listening: ok,
            port: ok ? 8787 : 0,
            ip: ok ? "192.168.1.44" : null,
            error: ok ? null : "Address already in use",
          };
        },
        parar: async () => ({ listening: false }),
        refrescar: async () => ({ ok: true }),
        publicar: async (o: { snapshotJson: string }) => {
          plugin.publicadas.push(o.snapshotJson);
          return { ok: true };
        },
        recibidos: async () => {
          const mensajes = plugin.cola.map((m) => JSON.stringify(m));
          plugin.cola = [];
          return { mensajes };
        },
        estado: async () => ({ listening: true, port: 8787 }),
        enviar: async () => ({ status: 0, bodyJson: null, error: "no procede" }),
        descubrir: async () => ({ destinos: [] }),
      },
    },
  };
}

let container: HTMLDivElement;
let root: Root;

function monta(v: VistaCocina | null) {
  apiMock.apiWithDevice.mockImplementation(
    async (path: string) => {
      if (path === "/kitchen/comandas") {
        if (!v) throw new Error("sin red");
        return v;
      }
      if (path === "/kitchen/comandas/hoy") return { orders: [], ready: [] };
      if (path === "/kitchen/latido") {
        if (!v) throw new Error("sin red");
        return { ok: true, serverTime: AHORA, lan: { key: CLAVE } };
      }
      if (path === "/kitchen/sincronizar") {
        if (!v) throw new Error("sin red");
        return { guardadas: 0, aplicadas: 0, pendientes: 0, reconocidas: 0 };
      }
      return { ok: true };
    },
  );
}

function vista(orders: Comanda[], ready: Comanda[] = []): VistaCocina {
  return {
    serverTime: AHORA,
    settings: ME.settings,
    sections: ["COCINA"],
    orders,
    ready,
  };
}

function comandaDelServidor(over: Partial<Comanda> = {}): Comanda {
  return {
    id: "o1",
    section: "COCINA",
    ticketId: "t1",
    tableId: "m5",
    tableName: "M5",
    number: 1,
    urgent: false,
    lateArrival: false,
    sentAt: AHORA,
    firedAt: AHORA,
    orderAt: AHORA,
    readyAt: null,
    servedAt: null,
    recoveredAt: null,
    isNew: true,
    allergyBands: [],
    lines: [
      {
        id: "l1",
        name: "Patatas bravas",
        units: 2,
        unitsOriginal: null,
        notes: [],
        course: 1,
        seat: null,
        fired: true,
        done: false,
        voidedUnits: 0,
        voidPending: false,
        doneBeforeVoid: false,
        changeNote: null,
        changePending: false,
        carries: [],
        seatAllergy: null,
        allergyWarning: null,
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  apiMock.apiWithDevice.mockReset();
  instalarPlugin();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  try {
    await act(async () => root.unmount());
  } catch {
    /* ya estaba desmontado */
  }
  container.remove();
  delete (globalThis as Record<string, unknown>).Capacitor;
});

async function settle(vueltas = 8) {
  for (let i = 0; i < vueltas; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(me: KitchenMe = ME) {
  root = createRoot(container);
  await act(async () => {
    root.render(<KitchenScreen me={me} />);
  });
  await settle();
}

const $ = <T extends HTMLElement>(sel: string): T | null =>
  container.querySelector<T>(sel);
const $$ = <T extends HTMLElement>(sel: string): T[] => [
  ...container.querySelectorAll<T>(sel),
];

// ──────────────────────────────────────────────────────────────────────

describe("kds-2 · la pantalla abre el servidor local", () => {
  it("lo abre con la clave de la tienda y anuncia su IP en el latido", async () => {
    monta(vista([]));
    await render();
    expect(plugin.arrancadas).toBe(1);
    expect(plugin.ultimoArranque).toMatchObject({
      storeId: "store-1",
      key: CLAVE,
      deviceId: "dev-1",
      port: 8787,
    });
    const latido = apiMock.apiWithDevice.mock.calls.find(
      (c) => c[0] === "/kitchen/latido",
    );
    expect(latido?.[1]?.body).toMatchObject({
      lanIp: "192.168.1.44",
      lanPort: 8787,
      lanListening: true,
    });
  });

  it("SABOTAJE · sin clave de tienda NO abre ningún puerto", async () => {
    // Es la mitad de front de «abrir el servidor local en un TERMINAL»: un
    // terminal no recibe clave de `/kitchen/me` —esa ruta es de la
    // pantalla— así que no tiene con qué arrancar. La otra mitad es el
    // CHECK `devices_kitchen_lan_solo_cocina`, que vive en el motor.
    monta(vista([]));
    const sinClave: KitchenMe = { ...ME, lan: undefined };
    await render(sinClave);
    expect(plugin.arrancadas).toBe(0);
  });

  it("si el puerto está ocupado, lo anuncia como que NO escucha", async () => {
    // El TPV tiene que saber que ahí no hay nadie en vez de reintentar
    // contra un puerto muerto.
    instalarPlugin({ arranca: false });
    monta(vista([]));
    await render();
    const latido = apiMock.apiWithDevice.mock.calls.find(
      (c) => c[0] === "/kitchen/latido",
    );
    expect(latido?.[1]?.body).toMatchObject({ lanListening: false });
  });
});

describe("kds-2 · SABOTAJE · sin internet, la comanda llega por la wifi", () => {
  it("se pinta con su mesa, su alergia y su silla, y la pantalla NO se pone roja", async () => {
    monta(null); // la nube no contesta
    plugin.cola.push(mensajeComanda());
    await render();
    await settle(12);

    const tarjeta = $('[data-testid="kds-comanda"]');
    expect(tarjeta).not.toBeNull();
    expect(container.textContent).toMatch(/M5/);
    expect(container.textContent).toMatch(/Patatas bravas/);
    expect(container.textContent).toMatch(/SILLA 3 · CELÍACO/);
    expect(container.textContent).toMatch(/¡LLEVA GLUTEN!/);

    // SABOTAJE · «pantalla roja con la wifi funcionando».
    expect($('[data-testid="kds-sin-conexion"]')).toBeNull();
    const franja = $('[data-testid="kds-solo-wifi"]');
    expect(franja).not.toBeNull();
    expect(franja!.textContent).toMatch(
      /Sin internet · recibiendo por la wifi del local/,
    );
    // Y la pastilla de arriba dice por dónde llega.
    expect($('[data-testid="kds-en-linea"]')!.textContent).toMatch(/POR LA WIFI/);
  });

  it("ni internet ni wifi → la pantalla roja de kds-1", async () => {
    monta(null);
    await render();
    await settle(12);
    expect($('[data-testid="kds-solo-wifi"]')).toBeNull();
    const roja = $('[data-testid="kds-sin-conexion"]');
    expect(roja).not.toBeNull();
    expect(roja!.textContent).toMatch(/SIN CONEXIÓN/);
    expect(roja!.textContent).toMatch(/las comandas no llegan/);
  });

  it("con internet, ni franja ni rojo", async () => {
    monta(vista([comandaDelServidor()]));
    await render();
    expect($('[data-testid="kds-solo-wifi"]')).toBeNull();
    expect($('[data-testid="kds-sin-conexion"]')).toBeNull();
    expect($('[data-testid="kds-en-linea"]')!.textContent).toMatch(/En línea/);
  });
});

describe("kds-2 · SABOTAJE · al volver internet, duplicar", () => {
  it("la tarjeta de la wifi se suelta cuando el servidor trae la suya", () => {
    // La regla, en limpio: una tarjeta de la wifi cuya gemela ya está en el
    // GET no se pinta. La llave es mesa + sección + nº de comanda, que es
    // lo único que los dos caminos comparten (el `clientSendId` vive en el
    // despacho, y la vista de cocina no lo trae).
    const deLaWifi = {
      ...comandaDelServidor({ id: "lan:x:COCINA" }),
      ticketId: "t1",
      section: "COCINA" as const,
      number: 1,
    };
    const delServidor = comandaDelServidor({ id: "o-servidor" });
    // `sinDuplicados` devuelve LAS DE LA WIFI QUE SIGUEN HACIENDO FALTA; la
    // pantalla pinta `[...delServidor, ...eso]`. Aquí no hace falta
    // ninguna: la del servidor ya la cubre.
    expect(sinDuplicados([delServidor], [deLaWifi])).toEqual([]);
    expect(
      [...[delServidor], ...sinDuplicados([delServidor], [deLaWifi])].map(
        (c) => c.id,
      ),
    ).toEqual(["o-servidor"]);
  });

  it("y si el servidor todavía no la tiene, se pinta la de la wifi", () => {
    const deLaWifi = comandaDelServidor({ id: "lan:x:COCINA", number: 2 });
    const delServidor = comandaDelServidor({ id: "o-servidor", number: 1 });
    expect(
      [...[delServidor], ...sinDuplicados([delServidor], [deLaWifi])].map(
        (c) => c.id,
      ),
    ).toEqual(["o-servidor", "lan:x:COCINA"]);
  });

  it("una tarjeta de la wifi ya SERVIDA no vuelve a la pantalla", () => {
    const servida = comandaDelServidor({
      id: "lan:x:COCINA",
      number: 2,
      servedAt: AHORA,
    });
    expect(sinDuplicados([], [servida])).toEqual([]);
  });

  it("en pantalla, mientras la nube no contesta, hay UNA sola tarjeta", async () => {
    monta(null);
    plugin.cola.push(mensajeComanda());
    await render();
    await settle(12);
    expect($$('[data-testid="kds-comanda"]')).toHaveLength(1);
  });
});

describe("kds-2 · el libro de marcas", () => {
  it("un tachado sin red se guarda con la hora de la tablet y se sube al volver", async () => {
    monta(null);
    plugin.cola.push(mensajeComanda());
    await render();
    await settle(12);

    // Se tacha el plato. La nube no contesta, así que va al libro.
    const plato = $('[data-testid="kds-linea"]')?.querySelector("button");
    expect(plato).not.toBeNull();
    await act(async () => {
      (plato as HTMLButtonElement).click();
    });
    await settle(8);

    const guardadas = JSON.parse(
      localStorage.getItem("mipiacetpv-kds-marcas") ?? "[]",
    ) as MarcaLocal[];
    expect(guardadas).toHaveLength(1);
    expect(guardadas[0]).toMatchObject({
      kind: "HECHO",
      clientSendId: ENVIO,
      section: "COCINA",
      ticketLineId: "l1",
      done: true,
    });
    // La hora es la de la TABLET corregida con el desvío del servidor.
    expect(Number.isNaN(Date.parse(guardadas[0]!.at))).toBe(false);

    // La franja dice cuántas quedan por subir: el cocinero tiene que poder
    // ver que su trabajo no se ha perdido.
    expect($('[data-testid="kds-marcas-pendientes"]')!.textContent).toMatch(
      /1 por subir/,
    );
  });
});

describe("kds-2 · las marcas locales se ven en el momento", () => {
  // Función pura: lo que se prueba es la REGLA, y una regla se prueba con
  // datos. Que el DOM la pinte ya lo cubre el test de arriba.
  const marca = (over: Partial<MarcaLocal>): MarcaLocal => ({
    markId: "m1",
    kind: "HECHO",
    clientSendId: "o1",
    section: "COCINA",
    ticketLineId: "l1",
    done: true,
    at: AHORA,
    ...over,
  });

  it("un tachado se aplica sobre la tarjeta", () => {
    const [c] = conMarcasLocales([comandaDelServidor()], [marca({})]);
    expect(c!.lines[0]!.done).toBe(true);
  });

  it("tachar y destachar acaba DESTACHADO, venga la lista como venga", () => {
    const tachado = marca({ markId: "m1", done: true, at: AHORA });
    const destachado = marca({
      markId: "m2",
      done: false,
      at: new Date(Date.parse(AHORA) + 60_000).toISOString(),
    });
    // Al revés de como pasaron: la regla las ordena por `at`.
    const [c] = conMarcasLocales([comandaDelServidor()], [destachado, tachado]);
    expect(c!.lines[0]!.done).toBe(false);
  });

  it("todos tachados → la tarjeta pasa sola a «Lista» (decisión 4)", () => {
    const [c] = conMarcasLocales([comandaDelServidor()], [marca({})]);
    expect(c!.readyAt).toBe(AHORA);
  });

  it("un «Visto» quita el parpadeo del anulado", () => {
    const conAnulado = comandaDelServidor();
    conAnulado.lines[0]!.voidPending = true;
    const [c] = conMarcasLocales(
      [conAnulado],
      [marca({ kind: "VISTO", done: null })],
    );
    expect(c!.lines[0]!.voidPending).toBe(false);
  });

  it("y una marca de OTRA tarjeta no toca esta", () => {
    const [c] = conMarcasLocales(
      [comandaDelServidor()],
      [marca({ clientSendId: "otro-envio" })],
    );
    expect(c!.lines[0]!.done).toBe(false);
  });
});
