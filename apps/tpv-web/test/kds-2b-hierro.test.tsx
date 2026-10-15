// kds-2b · LO QUE ENCONTRÓ LA PASADA EN EL HIERRO DEL 15-10.
//
// Cuatro hallazgos, y aquí están las filas de la tabla de sabotajes que
// viven en la PANTALLA (el TPV y el servidor tienen las suyas):
//
//   | La tarjeta fantasma tras «Lista» | la secuencia exacta de la pasada,
//   | de punta a punta: la tarjeta de la wifi no vuelve al centro cuando su
//   | gemela pasa a «Listas», ni cuando la sirven, ni cuando vuelve a
//   | llegar el mismo mensaje por la wifi
//   | La lista de recibidas que no se vacía | con internet puesto se sube y
//   | se vacía; si no, crece hasta romper el POST por `maxItems`
//   | Tachar mueve el plato | el orden de las líneas de una tarjeta no
//   | cambia aunque el GET las devuelva en otro orden
//   | Un plato sin alérgenos informados pasa por comprobado | sale
//   | «ALÉRGENOS SIN INFORMAR», distinto de un «SIN GLUTEN»
//
// El plugin nativo se finge instalando el global `Capacitor` que el bridge
// inyecta, igual que en kds-2: lo que se prueba es el camino de producción.

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
import {
  memoriaDeOrdenVacia,
  ordenEstable,
  type MemoriaDeOrden,
} from "../src/kitchen/orden.js";
import type {
  Comanda,
  KitchenMe,
  LineaComanda,
  VistaCocina,
} from "../src/kitchen/types.js";
import { llavesDeComanda, sinDuplicados } from "../src/kitchen/useCocinaLan.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const AHORA = "2026-10-15T13:30:00.000Z";
const CLAVE = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const ENVIO = "55555555-5555-4555-8555-555555555555";

const ME: KitchenMe = {
  device: { id: "dev-1", name: "Pase" },
  store: { id: "store-1", name: "La Maestranza" },
  sections: ["COCINA"],
  settings: { greenMaxMin: 10, amberMaxMin: 20, readyBeep: false },
  serverTime: AHORA,
  lan: { key: CLAVE, port: 8787, maxAgeMs: 60_000 },
};

/**
 * La M5 de la pasada: celíaco en la silla 3, bravas con GLUTEN a la silla 3
 * y el magro SIN ALÉRGENOS INFORMADOS, también a la silla 3.
 */
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
              notes: [],
              course: 1,
              seat: 3,
              fired: true,
              carries: ["GLUTEN"],
              seatAllergy: "SIN GLUTEN",
              allergyWarning: "¡LLEVA GLUTEN!",
              allergensUnknown: null,
            },
            {
              ticketLineId: "l2",
              name: "Magro",
              units: 1,
              notes: [],
              course: 1,
              seat: 3,
              fired: true,
              carries: [],
              seatAllergy: "SIN GLUTEN",
              allergyWarning: null,
              allergensUnknown: "ALÉRGENOS SIN INFORMAR",
            },
          ],
        },
      ],
    },
  };
}

interface PluginFalso {
  publicadas: string[];
  cola: unknown[];
}

let plugin: PluginFalso;

function instalarPlugin() {
  plugin = { publicadas: [], cola: [] };
  (globalThis as Record<string, unknown>).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    Plugins: {
      KitchenLan: {
        arrancar: async () => ({
          listening: true,
          port: 8787,
          ip: "192.168.1.44",
          error: null,
        }),
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
/** Lo que contesta el servidor AHORA MISMO. El test la va cambiando. */
let vistaViva: VistaCocina | null;
let sincronizaciones: Array<{ marcas: unknown[]; recibidas: string[] }>;

function montaApi() {
  sincronizaciones = [];
  apiMock.apiWithDevice.mockImplementation(async (path: string, opts?: any) => {
    if (path === "/kitchen/comandas") {
      if (!vistaViva) throw new Error("sin red");
      return vistaViva;
    }
    if (path === "/kitchen/comandas/hoy") return { orders: [], ready: [] };
    if (path === "/kitchen/latido") {
      if (!vistaViva) throw new Error("sin red");
      return { ok: true, serverTime: AHORA, lan: { key: CLAVE } };
    }
    if (path === "/kitchen/sincronizar") {
      if (!vistaViva) throw new Error("sin red");
      sincronizaciones.push(opts?.body ?? { marcas: [], recibidas: [] });
      return { guardadas: 0, aplicadas: 0, pendientes: 0, reconocidas: 0 };
    }
    return { ok: true };
  });
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

function linea(over: Partial<LineaComanda> = {}): LineaComanda {
  return {
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
    ...over,
  };
}

/** La gemela: la tarjeta que crea el servidor con el MISMO envío. */
function gemela(over: Partial<Comanda> = {}): Comanda {
  return {
    id: "o-servidor",
    clientSendId: ENVIO,
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
    allergyBands: [{ titulo: "SILLA 3 · CELÍACO", alergenos: "Gluten" }],
    lines: [
      linea({ id: "l1", seat: 3, carries: ["gluten"], seatAllergy: "SIN GLUTEN", allergyWarning: "¡LLEVA GLUTEN!" }),
      linea({ id: "l2", name: "Magro", units: 1, seat: 3, seatAllergy: "SIN GLUTEN", allergensUnknown: "ALÉRGENOS SIN INFORMAR" }),
    ],
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  apiMock.apiWithDevice.mockReset();
  instalarPlugin();
  vistaViva = vista([]);
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  try {
    await act(async () => root.unmount());
  } catch {
    /* ya estaba desmontado */
  }
  vi.useRealTimers();
  container.remove();
  delete (globalThis as Record<string, unknown>).Capacitor;
});

async function settle(vueltas = 10) {
  for (let i = 0; i < vueltas; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Deja pasar el tiempo del reloj de la pantalla (el GET va cada 20 s). */
async function avanzar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

async function render() {
  root = createRoot(container);
  await act(async () => {
    root.render(<KitchenScreen me={ME} />);
  });
  await settle();
}

const $ = <T extends HTMLElement>(sel: string): T | null =>
  container.querySelector<T>(sel);
const $$ = <T extends HTMLElement>(sel: string): T[] => [
  ...container.querySelectorAll<T>(sel),
];

const enElCentro = () => $$('[data-testid="kds-comanda"]');
const enListas = () => $$('[data-testid="kds-lista-item"]');

// ──────────────────────────────────────────────────────────────────────

describe("kds-2b · SABOTAJE · la tarjeta fantasma tras «Lista»", () => {
  it("la secuencia EXACTA de la pasada: ni al pasar a Listas, ni al servirla, ni si el mensaje de la wifi vuelve a llegar", async () => {
    // Esto es lo que pasó en el AP11 el 15-10, paso por paso. El D8 tenía
    // internet, así que la comanda salió por LOS DOS CAMINOS.
    vi.useFakeTimers();
    montaApi();
    await render();

    // 1 · llega por la wifi. El servidor todavía no la tiene (su POST va en
    //     paralelo): la pantalla pinta la de la wifi.
    plugin.cola.push(mensajeComanda());
    await avanzar(1_100);
    expect(enElCentro()).toHaveLength(1);
    expect(container.textContent).toMatch(/M5/);
    expect(container.textContent).toMatch(/¡LLEVA GLUTEN!/);

    // 2 · el servidor crea la suya con el mismo envío. UNA sola tarjeta.
    vistaViva = vista([gemela()]);
    await avanzar(20_000);
    expect(enElCentro()).toHaveLength(1);

    // 3 · el cocinero tacha todo y toca «Lista». La tarjeta del servidor se
    //     va a la columna «Listas» y desaparece de `orders`.
    //
    //     **Aquí salía la fantasma**: la de la wifi se quedaba sin gemela en
    //     `vista.orders` y volvía al centro sin tachados, con el «ERAN 2 ·
    //     −1» ya visto y con las bravas sin su «¡LLEVA GLUTEN!».
    vistaViva = vista([], [gemela({ readyAt: AHORA })]);
    await avanzar(20_000);
    expect(enElCentro()).toHaveLength(0);
    expect(enListas()).toHaveLength(1);

    // 4 · el camarero marca «Servido»: la tarjeta desaparece del GET
    //     ENTERA. La de la wifi tampoco puede volver por eso.
    vistaViva = vista([]);
    await avanzar(20_000);
    expect(enElCentro()).toHaveLength(0);
    expect(enListas()).toHaveLength(0);

    // 5 · y si el mismo mensaje vuelve a entrar por la wifi (un reintento
    //     del TPV, un sobre repetido), tampoco resucita.
    plugin.cola.push(mensajeComanda());
    await avanzar(1_100);
    expect(enElCentro()).toHaveLength(0);
  });

  it("y la del apagón, que aparece en «Listas» SIN haber pasado por abiertas", async () => {
    // La otra forma de quedarse sin gemela, y la que de verdad pasa en un
    // apagón: la comanda entra por la wifi sin internet, el cocinero la
    // marca «Lista» en el libro de marcas, y al volver la red el libro
    // sube y el servidor la crea **ya lista**. En el siguiente GET la
    // tarjeta del servidor está en `ready` y NO en `orders`: si el cruce
    // sólo mirara las abiertas, la de la wifi se quedaría en el centro con
    // su gemela en la columna «Listas». Dos tarjetas de la misma mesa.
    vi.useFakeTimers();
    montaApi();
    vistaViva = null; // apagón
    await render();
    plugin.cola.push(mensajeComanda());
    await avanzar(1_100);
    expect(enElCentro()).toHaveLength(1);

    // Vuelve la red, y el servidor ya la tiene LISTA.
    vistaViva = vista([], [gemela({ readyAt: AHORA })]);
    await avanzar(20_000);
    expect(enElCentro()).toHaveLength(0);
    expect(enListas()).toHaveLength(1);
  });

  it("pero una comanda de la wifi que el servidor NO tiene sí se pinta", async () => {
    // El arreglo no puede comerse lo que hace falta: es la mitad que de
    // verdad salva el servicio de un apagón.
    vi.useFakeTimers();
    montaApi();
    vistaViva = null; // sin internet
    await render();
    plugin.cola.push(mensajeComanda());
    await avanzar(1_100);
    expect(enElCentro()).toHaveLength(1);
    expect($('[data-testid="kds-solo-wifi"]')).not.toBeNull();
  });
});

describe("kds-2b · SABOTAJE · la lista de recibidas que no se vacía", () => {
  it("con internet puesto se sube y se vacía sola", async () => {
    // Antes sólo se subía al VOLVER la red o si había marcas pendientes, y
    // un bar que no se queda sin internet no cumple ninguna de las dos: la
    // lista crecía un id por comanda hasta pasar del `maxItems: 500` de la
    // ruta, y a partir de ahí el POST contestaba 400 **para siempre** — con
    // el libro de marcas del siguiente apagón dentro.
    vi.useFakeTimers();
    montaApi();
    await render();
    plugin.cola.push(mensajeComanda());
    await avanzar(1_100);
    expect(
      JSON.parse(localStorage.getItem("mipiacetpv-kds-recibidas") ?? "[]"),
    ).toEqual([ENVIO]);

    await avanzar(6_000);
    expect(sincronizaciones).toHaveLength(1);
    expect(sincronizaciones[0]!.recibidas).toEqual([ENVIO]);
    expect(
      JSON.parse(localStorage.getItem("mipiacetpv-kds-recibidas") ?? "[]"),
    ).toEqual([]);
  });
});

describe("kds-2b · el cruce de una tarjeta de la wifi con la del servidor", () => {
  const deLaWifi = () =>
    gemela({ id: `lan:${ENVIO}:COCINA`, clientSendId: undefined });

  it("cruza por el id del ENVÍO cuando el servidor lo manda", () => {
    // Es la llave exacta. El nº de comanda de una tarjeta de la wifi lo
    // calcula el TPV sin internet y puede no coincidir con el del servidor.
    const otroNumero = gemela({ number: 9 });
    expect(sinDuplicados([otroNumero], [deLaWifi()])).toEqual([]);
  });

  it("y por mesa + sección + nº con un servidor que todavía no lo manda", () => {
    const sinEnvio = gemela({ clientSendId: undefined });
    expect(sinDuplicados([sinEnvio], [deLaWifi()])).toEqual([]);
  });

  it("una vez confirmada no vuelve, aunque el servidor ya no la tenga", () => {
    const confirmadas = new Set(llavesDeComanda(gemela()));
    expect(sinDuplicados([], [deLaWifi()], confirmadas)).toEqual([]);
    // Y sin la confirmación, se pintaría: es exactamente la fantasma.
    expect(sinDuplicados([], [deLaWifi()])).toHaveLength(1);
  });
});

describe("kds-2b · SABOTAJE · tachar mueve el plato al final", () => {
  const tarjeta = (lines: LineaComanda[]): Comanda =>
    gemela({ lines });
  const a = linea({ id: "a", name: "Bravas" });
  const b = linea({ id: "b", name: "Magro" });
  const c = linea({ id: "c", name: "Calamares" });

  it("el GET devuelve la tachada al final y la pantalla NO la mueve", () => {
    // Es lo que hacía Postgres sin `orderBy`: un `UPDATE` reescribe la fila
    // al final de la tabla. El cocinero tachaba y el siguiente toque caía
    // en otro plato.
    let memoria: MemoriaDeOrden = memoriaDeOrdenVacia();
    const primera = ordenEstable([tarjeta([a, b, c])], memoria);
    memoria = primera.memoria;
    expect(primera.comandas[0]!.lines.map((l) => l.id)).toEqual(["a", "b", "c"]);

    const tachada = { ...a, done: true };
    const segunda = ordenEstable([tarjeta([b, c, tachada])], memoria);
    expect(segunda.comandas[0]!.lines.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(segunda.comandas[0]!.lines[0]!.done).toBe(true);
  });

  it("lo que llega nuevo va al FINAL, no donde caiga", () => {
    let memoria: MemoriaDeOrden = memoriaDeOrdenVacia();
    memoria = ordenEstable([tarjeta([a, b])], memoria).memoria;
    const d = linea({ id: "d", name: "Croquetas" });
    const r = ordenEstable([tarjeta([d, b, a])], memoria);
    expect(r.comandas[0]!.lines.map((l) => l.id)).toEqual(["a", "b", "d"]);
  });

  it("una línea que el servidor deja de mandar se cae del orden", () => {
    let memoria: MemoriaDeOrden = memoriaDeOrdenVacia();
    memoria = ordenEstable([tarjeta([a, b, c])], memoria).memoria;
    const r = ordenEstable([tarjeta([c, a])], memoria);
    expect(r.comandas[0]!.lines.map((l) => l.id)).toEqual(["a", "c"]);
    expect(r.memoria.get("o-servidor")).toEqual(["a", "c"]);
  });

  it("y la memoria no se queda con tarjetas que ya no están", () => {
    // Una tablet lleva doce horas encendida: lo que se sirvió a mediodía no
    // puede seguir ocupando sitio a las once de la noche.
    let memoria: MemoriaDeOrden = memoriaDeOrdenVacia();
    memoria = ordenEstable([tarjeta([a])], memoria).memoria;
    expect(memoria.size).toBe(1);
    memoria = ordenEstable([], memoria).memoria;
    expect(memoria.size).toBe(0);
  });

  it("EN PANTALLA: el GET reordena y los platos NO se mueven de sitio", async () => {
    // El sabotaje de verdad: que la pantalla la USE. Con la regla puesta
    // pero sin llamarla, los tests de arriba siguen verdes y el cocinero
    // sigue tachando el plato que no era.
    vi.useFakeTimers();
    montaApi();
    vistaViva = vista([gemela({ lines: [a, b, c] })]);
    await render();
    const ids = () =>
      $$("[data-linea-id]").map((e) => e.getAttribute("data-linea-id"));
    expect(ids()).toEqual(["a", "b", "c"]);

    // Lo que devolvía Postgres sin `orderBy` después de tachar: la fila
    // reescrita, al final.
    vistaViva = vista([gemela({ lines: [b, c, { ...a, done: true }] })]);
    await avanzar(20_000);
    expect(ids()).toEqual(["a", "b", "c"]);
    expect($$("[data-linea-id]")[0]!.getAttribute("data-hecha")).toBe("1");
  });

  it("sin cambios, devuelve la MISMA tarjeta (no repinta de más)", () => {
    const t = tarjeta([a, b]);
    const memoria = ordenEstable([t], memoriaDeOrdenVacia()).memoria;
    const r = ordenEstable([t], memoria);
    expect(r.comandas[0]).toBe(t);
  });
});

describe("kds-2b · SABOTAJE · un plato sin alérgenos informados pasa por comprobado", () => {
  it("sale «ALÉRGENOS SIN INFORMAR», y en una franja distinta de la del comprobado", async () => {
    vi.useFakeTimers();
    montaApi();
    vistaViva = vista([gemela()]);
    await render();
    await settle();

    // El magro: sin alérgenos en su ficha, en la silla de la celíaca.
    const sinInformar = $('[data-testid="kds-sin-informar"]');
    expect(sinInformar).not.toBeNull();
    expect(sinInformar!.textContent).toMatch(/SILLA 3 · ALÉRGENOS SIN INFORMAR/);

    // Y las bravas, comprobadas y con gluten, siguen gritando en ROJO.
    expect(container.textContent).toMatch(/¡LLEVA GLUTEN!/);
    // Las dos franjas no se pintan igual: la del sin informar es ámbar.
    expect(sinInformar!.getAttribute("style")).toMatch(/E9A93E|233, 169, 62/);
  });

  it("un plato sin alérgenos en una mesa SIN alergias no lleva aviso", async () => {
    vi.useFakeTimers();
    montaApi();
    vistaViva = vista([
      gemela({
        allergyBands: [],
        lines: [linea({ id: "l9", name: "Magro", seat: 2 })],
      }),
    ]);
    await render();
    await settle();
    expect($('[data-testid="kds-sin-informar"]')).toBeNull();
  });
});
