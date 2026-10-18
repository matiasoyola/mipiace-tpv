// residencia-3 · **SIN RED, DE VERDAD.**
//
// Lo que el prompt pide con esas palabras: «un e2e que corta la red,
// registra tres cosas, reabre la app, recupera la red y comprueba que
// llegan una vez, con su `recordedAt` original y su turno».
//
// ── Por qué aquí y no en el banco de Playwright ─────────────────────
//
// Porque lo que hay que probar vive **en el navegador**: IndexedDB, el
// lock entre pestañas y el reenvío del outbox. Con `fake-indexeddb` eso se
// prueba de verdad —el mismo módulo de producción, la misma base, el mismo
// `flushOutbox`— y además se puede **reabrir la app**, que es el paso que
// importa y que en un navegador de verdad significa recargar.
//
// La otra mitad —que el servidor no duplique y guarde los dos instantes—
// la prueba `residencia-3.e2e.ts` contra Postgres. Ninguna de las dos
// puede contestar la pregunta de la otra, y las dos juntas son la
// garantía.
//
// ── Lo que se comprueba, en orden ───────────────────────────────────
//
//   1. Con la red caída, los tres gestos **quedan guardados en la tablet**
//      (el `outboxAdd` va ANTES del POST, como en una venta desde v1.5).
//   2. **Reabrir la app** no pierde nada: se cierra la conexión cacheada,
//      se resetea el módulo y los tres siguen ahí.
//   3. Al volver la red salen **una sola vez** y la cola se queda vacía.
//   4. Y llegan con su `recordedAt` ORIGINAL, su turno y su día del
//      centro — no con la hora en que se enviaron.
//   5. Un `flush` de más no los vuelve a mandar.
//   6. Sin sesión de puerta el 401 es TRANSITORIO: esperan, no se
//      rechazan.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  apiConPuerta: vi.fn(),
  apiWithCashier: vi.fn(),
}));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return {
    ...actual,
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
import {
  algoNoVaBien,
  comoSiempre,
  dimensionesDeLaObservacion,
  registroDeConstante,
  registroDeOcurrencia,
  type ContextoDelGesto,
} from "../src/residencia/puerta-gestos.js";
import type { ControlDeLaPuerta } from "../src/residencia/puerta-tipos.js";

/** Las 02:10 de la madrugada: turno de noche, y el día del centro es el
 *  de AYER. Es el caso que de verdad pasa sin red — el turno de noche es
 *  cuando una residencia está más sola. */
const DE_MADRUGADA = new Date("2026-10-15T00:10:00.000Z");
const TURNO_DE_NOCHE = "11111111-1111-1111-1111-111111111111";

const CTX: ContextoDelGesto = {
  clientId: "carmen",
  recordedAt: DE_MADRUGADA,
  centerShiftId: TURNO_DE_NOCHE,
  // El día del turno: la madrugada del 15 pertenece a la noche del 14.
  careDay: "2026-10-14",
};

const DIMENSIONES: ControlDeLaPuerta[] = ["ANIMO", "PIEL"].map((code) => ({
  id: `id-${code}`,
  code,
  name: code,
  version: 1,
  layer: "OBS" as const,
  nature: "SCHEDULED" as const,
  valueDomain: "ORDINAL" as const,
  groupCode: null,
  opciones: [
    { code: "COMO_SIEMPRE", label: "Como siempre", isAsUsual: true },
    { code: "MAL", label: "Mal", isAsUsual: false },
  ],
}));

/** Un gesto = un item de la cola, con N registros dentro. */
async function encolar(registros: unknown[], label: string): Promise<void> {
  await outboxAdd({
    externalId: `gesto-${label}-${registros.length}`,
    kind: "care-record",
    path: "/residencia/puerta/registros",
    body: { registros } as unknown as Record<string, unknown>,
    auth: "puerta",
    label,
    total: 0,
  });
}

describe("la puerta SIN RED", () => {
  beforeEach(async () => {
    indexedDB = new IDBFactory();
    await __resetOutboxForTests();
    apiMock.apiConPuerta.mockReset();
    apiMock.apiWithCashier.mockReset();
  });

  afterEach(async () => {
    await __resetOutboxForTests();
  });

  it("corta la red, registra TRES cosas, reabre la app, vuelve la red y llegan UNA VEZ", async () => {
    // ── 1 · LA RED, CAÍDA ────────────────────────────────────────────
    apiMock.apiConPuerta.mockRejectedValue(new TypeError("Failed to fetch"));

    const dimensiones = dimensionesDeLaObservacion(DIMENSIONES, () => true);
    const gestoComoSiempre = comoSiempre(CTX, dimensiones);
    const gestoHecho = [
      registroDeOcurrencia(CTX, {
        controlCode: "CAMBIO_POSTURAL",
        planItemId: "linea-1",
        occurrenceAt: "2026-10-15T00:00:00.000Z",
      }),
    ];
    const gestoNota = [algoNoVaBien(CTX, { texto: "le huele raro el pie" })];

    await encolar(gestoComoSiempre, "como-siempre");
    await encolar(gestoHecho, "hecho");
    await encolar(gestoNota, "nota");

    // Los tres gestos están EN LA TABLET. La pantalla 6 dice «Apuntado» por
    // esto y no porque el servidor haya contestado.
    expect(await outboxCounts()).toEqual({ pending: 3, rejected: 0 });

    // Un intento con la red caída no los pierde ni los marca rechazados: un
    // error de red es TRANSITORIO.
    await flushOutbox();
    expect(await outboxCounts()).toEqual({ pending: 3, rejected: 0 });

    // ── 2 · SE REABRE LA APP ─────────────────────────────────────────
    //
    // Cerrar la conexión cacheada y resetear el módulo es lo que pasa al
    // recargar la PWA. La base `mipiacetpv-outbox` sobrevive a propósito:
    // está FUERA de `IDB_NAMES_TO_CLEAR`.
    await __resetOutboxForTests();
    expect(await outboxCounts()).toEqual({ pending: 3, rejected: 0 });

    // ── 3 · VUELVE LA RED ────────────────────────────────────────────
    apiMock.apiConPuerta.mockReset();
    apiMock.apiConPuerta.mockResolvedValue({ registros: [] });
    await flushOutbox();

    expect(apiMock.apiConPuerta).toHaveBeenCalledTimes(3);
    expect(await outboxCounts()).toEqual({ pending: 0, rejected: 0 });

    // ── 4 · CON SU INSTANTE ORIGINAL, SU TURNO Y SU DÍA ──────────────
    //
    // Es la mitad que importa: el cuidado se hizo a las 02:10 y se apunta a
    // las 02:10, aunque llegue a las ocho de la mañana. Si se sellara al
    // enviar, la ronda de la madrugada aparecería en el turno de mañana y
    // el parte de relevo de la noche saldría vacío.
    const enviados = apiMock.apiConPuerta.mock.calls.flatMap(
      (c) =>
        (c[1] as { body: { registros: Array<Record<string, unknown>> } }).body
          .registros,
    );
    expect(enviados).toHaveLength(4); // 2 del «como siempre» + 1 + 1
    for (const r of enviados) {
      expect(r.recordedAt).toBe(DE_MADRUGADA.toISOString());
      expect(r.centerShiftId).toBe(TURNO_DE_NOCHE);
      expect(r.careDay).toBe("2026-10-14");
    }
    // Y la ruta es la de la puerta, con la auth de la puerta.
    for (const c of apiMock.apiConPuerta.mock.calls) {
      expect(c[0]).toBe("/residencia/puerta/registros");
    }

    // ── 5 · UN FLUSH DE MÁS NO REPITE NADA ───────────────────────────
    await flushOutbox();
    expect(apiMock.apiConPuerta).toHaveBeenCalledTimes(3);
  });

  it("y la NOTA DE VOZ viaja DENTRO del lote, no en una petición aparte", () => {
    // Si fueran dos peticiones, una podría llegar y la otra no: quedaría un
    // registro que dice que hay un audio que no existe, o un audio que no
    // es de nadie.
    const nota = algoNoVaBien(CTX, { vozBase64: "GkXfo0A=" });
    expect(nota.voz).toEqual({ webmBase64: "GkXfo0A=" });
  });

  it("SIN SESIÓN DE PUERTA el 401 es transitorio: el lote ESPERA, no se rechaza", async () => {
    // Pasa de verdad: el turno de noche registra, la sesión caduca y el
    // lote tiene que salir con la sesión de la persona siguiente que entre
    // en esa puerta. Si el 401 fuera permanente, se quedaría `rejected` y
    // nadie lo volvería a intentar.
    apiMock.apiConPuerta.mockRejectedValue(
      new ApiError(401, "Teclea tu PIN para registrar.", "PUERTA_SIN_SESION"),
    );
    await encolar([algoNoVaBien(CTX)], "sin-sesion");
    await flushOutbox();
    expect(await outboxCounts()).toEqual({ pending: 1, rejected: 0 });

    // Y cuando alguien entra, sale.
    apiMock.apiConPuerta.mockReset();
    apiMock.apiConPuerta.mockResolvedValue({ registros: [] });
    await flushOutbox();
    expect(await outboxCounts()).toEqual({ pending: 0, rejected: 0 });
  });

  it("un LOTE RECHAZADO (409) se queda VISIBLE y no se reintenta en bucle", async () => {
    // Es lo que pasa con el reloj de la tablet mal puesto: no se arregla
    // reintentando y alguien tiene que verlo. `rejected` es un estado
    // visible en el chip de pendientes.
    apiMock.apiConPuerta.mockRejectedValue(
      new ApiError(
        409,
        "Este registro viene con una hora del futuro.",
        "LOTE_RECHAZADO",
      ),
    );
    await encolar([algoNoVaBien(CTX)], "reloj-malo");
    await flushOutbox();
    expect(await outboxCounts()).toEqual({ pending: 0, rejected: 1 });

    const items = await outboxList();
    expect(items[0]!.lastError).toContain("hora del futuro");

    // Y no se vuelve a intentar solo.
    apiMock.apiConPuerta.mockClear();
    await flushOutbox();
    expect(apiMock.apiConPuerta).not.toHaveBeenCalled();
  });

  // ── residencia-4 · EL AVISO QUE NO SALIÓ ──────────────────────────
  it("una CONSTANTE con aviso sobrevive sin red y sale con su hora ORIGINAL", async () => {
    // Es el caso del prompt: «un e2e que corta la red de la puerta,
    // registra 38,6, comprueba que la puerta dice que NO ha salido,
    // recupera la red y comprueba que el móvil lo recibe una vez, con su
    // hora original».
    //
    // La mitad de la puerta está aquí (la cola, el `recordedAt` y el
    // «una vez»); la del móvil, en `residencia-4.e2e.ts` («un lote que
    // llega TARDE»), y la de la pantalla en
    // `residencia-4-pantallas.test.tsx` («la banda ámbar dice que el
    // aviso NO ha salido»). Ninguna de las tres puede contestar lo que
    // contestan las otras.
    apiMock.apiConPuerta.mockRejectedValue(new TypeError("Failed to fetch"));
    const fiebre = registroDeConstante(CTX, {
      controlCode: "TEMPERATURA",
      numero: 38.6,
      avisarEnfermera: true,
    });
    await encolar([fiebre], "Temperatura: 38,6 °C");
    await flushOutbox();

    // Sigue en la tablet: la pantalla 6 pinta la banda ámbar del «NO ha
    // salido» porque esto es lo que hay.
    expect(await outboxCounts()).toMatchObject({ pending: 1, rejected: 0 });

    // Vuelve la red.
    apiMock.apiConPuerta.mockReset();
    apiMock.apiConPuerta.mockResolvedValue({ registros: [] });
    await flushOutbox();
    await flushOutbox();

    expect(apiMock.apiConPuerta).toHaveBeenCalledTimes(1);
    const [, opciones] = apiMock.apiConPuerta.mock.calls[0]!;
    const enviados = (opciones as { body: { registros: Array<Record<string, unknown>> } })
      .body.registros;
    expect(enviados).toHaveLength(1);
    // La hora ORIGINAL y el turno de noche de AYER, no la de ahora.
    expect(enviados[0]!.recordedAt).toBe(DE_MADRUGADA.toISOString());
    expect(enviados[0]!.careDay).toBe("2026-10-14");
    expect(enviados[0]!.centerShiftId).toBe(TURNO_DE_NOCHE);
    // Y el aviso viaja DENTRO del registro: no es una petición aparte
    // que se pueda perder mientras el registro entra.
    expect(enviados[0]!.avisarEnfermera).toBe(true);
    expect(enviados[0]!.valor).toEqual({ tipo: "NUMERIC", numero: 38.6 });
    expect(await outboxCounts()).toMatchObject({ pending: 0, rejected: 0 });
  });

  it("los items de la puerta NO salen por la auth del cajero", async () => {
    // El sabotaje de esta línea: si `sendItem` ignorara `auth`, un lote de
    // la puerta saldría con `apiWithCashier` y la tablet no tiene sesión de
    // cajero — 401 para siempre y ningún cuidado subido.
    apiMock.apiConPuerta.mockResolvedValue({ registros: [] });
    await encolar([algoNoVaBien(CTX)], "auth");
    await flushOutbox();
    expect(apiMock.apiConPuerta).toHaveBeenCalledTimes(1);
    expect(apiMock.apiWithCashier).not.toHaveBeenCalled();
  });
});
