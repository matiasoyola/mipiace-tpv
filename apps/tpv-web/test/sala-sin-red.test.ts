// residencia-5 (D-67) · **LA SALA SIN RED, DE VERDAD.**
//
// Lo que el prompt pide con esas palabras: «un e2e que corta la red de la
// tablet de sala, confirma, la recupera y comprueba que la confirmación
// llega una vez con su hora».
//
// ── Por qué aquí y no en el banco de Playwright ─────────────────────
//
// Por lo mismo que `puerta-sin-red.test.ts` (residencia-3): lo que hay
// que probar vive **en el navegador** —IndexedDB, el lock entre pestañas y
// el reenvío del outbox— y con `fake-indexeddb` eso se prueba de verdad,
// con el mismo módulo de producción y el mismo `flushOutbox`. Y además se
// puede **reabrir la app**, que es el paso que importa y que en una
// tablet de verdad significa recargar.
//
// La otra mitad —que el servidor no duplique la confirmación y guarde los
// dos instantes— la prueba `residencia-5.e2e.ts` contra Postgres. Ninguna
// de las dos puede contestar la pregunta de la otra.
//
// ── Lo que se comprueba, en orden ───────────────────────────────────
//
//   1. Con la red caída, el «Leído y recibido» **queda guardado en la
//      tablet** (el `outboxAdd` va ANTES del POST).
//   2. **Reabrir la app** no lo pierde.
//   3. Al volver la red sale **una sola vez** y la cola se queda vacía.
//   4. Y llega con **su hora original**, no con la hora en que se envió.
//   5. Un `flush` de más no lo vuelve a mandar.
//   6. Sin sesión de sala, el 401 es TRANSITORIO: espera, no se rechaza.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  apiConSala: vi.fn(),
  apiConPuerta: vi.fn(),
  apiWithCashier: vi.fn(),
}));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return {
    ...actual,
    apiConSala: apiMock.apiConSala,
    apiConPuerta: apiMock.apiConPuerta,
    apiWithCashier: apiMock.apiWithCashier,
  };
});

import { ApiError } from "../src/api.js";
import {
  __resetOutboxForTests,
  flushOutbox,
  outboxAdd,
  outboxCounts,
  outboxList,
} from "../src/lib/outbox.js";

/** Las 15:04 de la tarde: el cambio de turno de la mañana. */
const AL_RELEVO = "2026-10-19T13:04:00.000Z";
const PARTE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

async function confirmar(at = AL_RELEVO): Promise<void> {
  await outboxAdd({
    externalId: `ack-${at}`,
    kind: "handover-ack",
    path: `/residencia/sala/relevo/${PARTE}/confirmar`,
    body: { at },
    auth: "sala",
    label: "Relevo de la mañana",
    total: 0,
  });
}

describe("la tablet de la sala SIN RED", () => {
  beforeEach(async () => {
    indexedDB = new IDBFactory();
    await __resetOutboxForTests();
    apiMock.apiConSala.mockReset();
    apiMock.apiConPuerta.mockReset();
    apiMock.apiWithCashier.mockReset();
  });

  afterEach(async () => {
    await __resetOutboxForTests();
  });

  it("corta la red, confirma, reabre la app, vuelve la red y llega UNA VEZ con su hora", async () => {
    // ── 1 · LA RED, CAÍDA ────────────────────────────────────────────
    apiMock.apiConSala.mockRejectedValue(new TypeError("Failed to fetch"));

    await confirmar();

    // El «Leído y recibido» está EN LA TABLET. La pantalla lo dice por
    // esto y no porque el servidor haya contestado.
    expect(await outboxCounts()).toEqual({ pending: 1, rejected: 0 });

    // Un intento con la red caída no lo pierde ni lo marca rechazado: un
    // error de red es TRANSITORIO.
    await flushOutbox();
    expect(await outboxCounts()).toEqual({ pending: 1, rejected: 0 });

    // ── 2 · SE REABRE LA APP ─────────────────────────────────────────
    //
    // Es lo que pasa al recargar: la base `mipiacetpv-outbox` sobrevive a
    // propósito, porque está FUERA de `IDB_NAMES_TO_CLEAR`.
    await __resetOutboxForTests();
    expect(await outboxCounts()).toEqual({ pending: 1, rejected: 0 });

    // ── 3 · VUELVE LA RED ────────────────────────────────────────────
    apiMock.apiConSala.mockReset();
    apiMock.apiConSala.mockResolvedValue({ ackId: "x", yaEstaba: false });
    await flushOutbox();

    expect(apiMock.apiConSala).toHaveBeenCalledTimes(1);
    expect(await outboxCounts()).toEqual({ pending: 0, rejected: 0 });

    // ── 4 · CON SU HORA ORIGINAL ─────────────────────────────────────
    //
    // Es la mitad que importa: la auxiliar lo leyó y lo firmó a las 15:04,
    // y así queda — aunque el wifi volviera a las 15:51. Si se sellara al
    // enviar, «la información pasó de un turno a otro a las 15:04» dejaría
    // de ser verdad.
    const llamada = apiMock.apiConSala.mock.calls[0]!;
    expect(llamada[0]).toBe(`/residencia/sala/relevo/${PARTE}/confirmar`);
    expect((llamada[1] as { body: { at: string } }).body.at).toBe(AL_RELEVO);

    // ── 5 · UN FLUSH DE MÁS NO REPITE NADA ───────────────────────────
    await flushOutbox();
    expect(apiMock.apiConSala).toHaveBeenCalledTimes(1);
  });

  it("sin sesión de sala, el 401 ESPERA: no se rechaza", async () => {
    // Es el mismo reparto que en la puerta. La confirmación se firmó en la
    // tablet con el PIN resuelto EN LOCAL; cuando vuelva la red, el
    // servidor todavía no tiene sesión y contesta 401 `SALA_SIN_SESION`.
    //
    // Si fuera permanente, el item se quedaría `rejected` y nadie lo
    // volvería a intentar: la confirmación de ese relevo se perdería para
    // siempre. Con el 401 transitorio, espera a que alguien teclee su PIN
    // en esa tablet y sale entonces, con su `at` original.
    apiMock.apiConSala.mockRejectedValue(
      new ApiError(401, "Teclea tu PIN para leer el parte.", "SALA_SIN_SESION"),
    );
    await confirmar();
    await flushOutbox();
    expect(await outboxCounts()).toEqual({ pending: 1, rejected: 0 });

    // Y cuando hay sesión, sale.
    apiMock.apiConSala.mockReset();
    apiMock.apiConSala.mockResolvedValue({ ackId: "x", yaEstaba: false });
    await flushOutbox();
    expect(await outboxCounts()).toEqual({ pending: 0, rejected: 0 });
  });

  it("y un 404 del parte SÍ es permanente: no se reintenta para siempre", async () => {
    // Un parte que no existe no va a existir nunca. Dejarlo pendiente
    // sería una cola que no se vacía jamás, y una cola que no se vacía es
    // un chip de pendientes que nadie vuelve a mirar.
    apiMock.apiConSala.mockRejectedValue(
      new ApiError(404, "Ese parte no existe.", "RELEVO_NO_ENCONTRADO"),
    );
    await confirmar();
    await flushOutbox();
    expect(await outboxCounts()).toEqual({ pending: 0, rejected: 1 });
  });

  it("la confirmación va con la auth de la SALA, no con la del cajero", async () => {
    apiMock.apiConSala.mockResolvedValue({ ackId: "x" });
    await confirmar();
    const items = await outboxList();
    expect(items).toHaveLength(1);
    expect(items[0]!.auth).toBe("sala");
    expect(items[0]!.kind).toBe("handover-ack");
    await flushOutbox();
    // Y NO por el camino del cajero: una tablet de sala no tiene sesión
    // de cajero y ese camino habría dado un 401 que nadie entiende.
    expect(apiMock.apiWithCashier).not.toHaveBeenCalled();
    expect(apiMock.apiConPuerta).not.toHaveBeenCalled();
  });
});
