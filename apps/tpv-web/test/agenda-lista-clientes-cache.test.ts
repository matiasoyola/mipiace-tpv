// agenda-lista (hallazgo 🟡 1) · la agenda conoce los nombres sin pasar
// por Clientes.
//
// El fallo: el caché de clientes lo llenaba SÓLO la pantalla Clientes, y
// la agenda lee de ese caché. En un dispositivo recién emparejado —el
// AP11 el primer día en casa de Sole— la rejilla decía «09:00 · Sin
// nombre» en todas las citas hasta que a alguien se le ocurría abrir
// Clientes una vez.
//
// Aquí se fija la DECISIÓN (pura, sin navegador) y el rellenado contra
// una IndexedDB de mentira. Que el nombre acabe pintado en la rejilla lo
// comprueba el capítulo 7 del banco, por la interfaz real.
//
// Node-env con fake-indexeddb, como `agenda-cache.test.ts`.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

import {
  asegurarClientesEnCache,
  CLIENTS_CACHE_TTL_MS,
  loadClientsFromCache,
  necesitaRefrescoDeClientes,
  readClientsLastSyncAt,
  upsertClientInCache,
  type ClientRow,
} from "../src/lib/clients.js";

const AHORA = Date.UTC(2026, 9, 4, 9, 0, 0);

function clienta(id: string, firstName: string): ClientRow {
  return {
    id,
    externalId: null,
    firstName,
    lastName: "",
    phone: null,
    email: null,
    birthdate: null,
    holdedContactId: null,
    marketingOptIn: false,
    notes: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
  };
}

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  localStorage.clear();
  apiMock.apiWithCashier.mockReset();
});

describe("necesitaRefrescoDeClientes · la decisión, sin navegador", () => {
  it("caché vacío: siempre sí. Es el dispositivo recién emparejado", () => {
    expect(
      necesitaRefrescoDeClientes({ enCache: 0, ultimaSync: AHORA, ahora: AHORA }),
    ).toBe(true);
  });

  it("caché lleno sin marca: sí, una vez", () => {
    // La marca nació en este bloque: un TPV que viene de la versión
    // anterior tiene caché y no tiene marca.
    expect(
      necesitaRefrescoDeClientes({ enCache: 40, ultimaSync: null, ahora: AHORA }),
    ).toBe(true);
  });

  it("caché lleno y recién sincronizado: no", () => {
    expect(
      necesitaRefrescoDeClientes({
        enCache: 40,
        ultimaSync: AHORA - 60_000,
        ahora: AHORA,
      }),
    ).toBe(false);
  });

  it("caché lleno y vencido: sí", () => {
    expect(
      necesitaRefrescoDeClientes({
        enCache: 40,
        ultimaSync: AHORA - CLIENTS_CACHE_TTL_MS - 1,
        ahora: AHORA,
      }),
    ).toBe(true);
  });

  it("justo en el borde cuenta como vencido", () => {
    expect(
      necesitaRefrescoDeClientes({
        enCache: 40,
        ultimaSync: AHORA - CLIENTS_CACHE_TTL_MS,
        ahora: AHORA,
      }),
    ).toBe(true);
  });

  it("una marca en el futuro también vence: el reloj del hierro se mueve", () => {
    // Si alguien cambia la hora del AP12 hacia atrás, `ahora - ultimaSync`
    // sale negativo. Sin el valor absoluto, el caché se quedaría congelado
    // para siempre.
    expect(
      necesitaRefrescoDeClientes({
        enCache: 40,
        ultimaSync: AHORA + CLIENTS_CACHE_TTL_MS * 10,
        ahora: AHORA,
      }),
    ).toBe(true);
  });
});

describe("asegurarClientesEnCache · el rellenado", () => {
  it("dispositivo recién emparejado: se baja los clientes y deja su marca", async () => {
    apiMock.apiWithCashier.mockResolvedValueOnce({
      items: [clienta("c1", "Rosa"), clienta("c2", "Pili")],
      nextCursor: null,
    });

    expect(await asegurarClientesEnCache(AHORA)).toBe(true);

    const cache = await loadClientsFromCache();
    expect(cache.map((c) => c.firstName).sort()).toEqual(["Pili", "Rosa"]);
    expect(readClientsLastSyncAt()).not.toBeNull();
  });

  it("con el caché caliente no pide nada: la agenda se abre muchas veces al día", async () => {
    await upsertClientInCache(clienta("c1", "Rosa"));
    apiMock.apiWithCashier.mockResolvedValueOnce({
      items: [clienta("c1", "Rosa")],
      nextCursor: null,
    });
    await asegurarClientesEnCache(AHORA);
    expect(apiMock.apiWithCashier).toHaveBeenCalledTimes(1);

    // Segunda apertura, dos minutos después.
    expect(await asegurarClientesEnCache(AHORA + 120_000)).toBe(false);
    expect(apiMock.apiWithCashier).toHaveBeenCalledTimes(1);

    // Y pasada la ventana, otra vez sí.
    apiMock.apiWithCashier.mockResolvedValueOnce({
      items: [clienta("c1", "Rosa")],
      nextCursor: null,
    });
    expect(
      await asegurarClientesEnCache(AHORA + CLIENTS_CACHE_TTL_MS + 1),
    ).toBe(true);
    expect(apiMock.apiWithCashier).toHaveBeenCalledTimes(2);
  });

  it("sin red no rompe la agenda: se queda con lo que haya", async () => {
    await upsertClientInCache(clienta("c1", "Rosa"));
    apiMock.apiWithCashier.mockRejectedValue(new Error("sin red"));

    expect(await asegurarClientesEnCache(AHORA)).toBe(false);
    expect((await loadClientsFromCache()).map((c) => c.firstName)).toEqual([
      "Rosa",
    ]);
    // Y sin marca, para que lo vuelva a intentar en cuanto haya WiFi.
    expect(readClientsLastSyncAt()).toBeNull();
  });

  it("no pisa un alta offline que el servidor todavía no conoce", async () => {
    // Es la mezcla que ya hacía `refreshClients`, y por eso se reutiliza
    // esa función en vez de duplicar la llamada: la clienta que se acaba
    // de dar de alta sin cobertura no puede desaparecer de la lista.
    await upsertClientInCache({
      ...clienta("local-1", "Mari"),
      externalId: "ext-1",
      syncState: "pending",
    });
    apiMock.apiWithCashier.mockResolvedValueOnce({
      items: [clienta("c1", "Rosa")],
      nextCursor: null,
    });

    await asegurarClientesEnCache(AHORA);

    const nombres = (await loadClientsFromCache()).map((c) => c.firstName).sort();
    expect(nombres).toEqual(["Mari", "Rosa"]);
  });
});
