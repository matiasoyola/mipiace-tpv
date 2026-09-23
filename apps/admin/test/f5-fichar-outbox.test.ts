// F1 · la cola local de la pantalla de fichar (ADR-018).
//
// Lo que este banco fija:
//
//   1. El toque se persiste ANTES de salir a la red. Si la app muere en
//      ese instante, el fichaje sigue ahí y se envía al arrancar. Es LA
//      garantía del bloque: el toque nunca falla por red.
//   2. `holdUntil` — el "deshacer durante 4 s" no borra nada en el
//      servidor porque el item no ha salido todavía. Pasado el plazo,
//      deshacer ya no vale y lo que toca es corregir.
//   3. Un error permanente del servidor no se reintenta en bucle.
//
// Sabotajes que este fichero pone en rojo (§3 del done):
//   · lanzar el POST antes de persistir
//   · que el flush ignore `holdUntil` (el deshacer dejaría de existir)
//   · que deshacer siga valiendo cuando el fichaje ya está en el servidor

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ ficharApi: vi.fn() }));

vi.mock("../src/fichar/lib/api.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/fichar/lib/api.js")
  >("../src/fichar/lib/api.js");
  return { ...actual, ficharApi: apiMock.ficharApi };
});

import { FicharApiError } from "../src/fichar/lib/api.js";
import {
  __resetOutboxForTests,
  flushOutbox,
  isReleasable,
  outboxAdd,
  outboxList,
  outboxUndo,
  subscribeOutbox,
  UNDO_WINDOW_MS,
  type FicharOutboxItem,
} from "../src/fichar/lib/outbox.js";

function entrada(over: Partial<Parameters<typeof outboxAdd>[0]> = {}) {
  const externalId = over.externalId ?? "11111111-2222-4333-8444-555555555555";
  const tappedAt = over.tappedAt ?? Date.now();
  return {
    externalId,
    kind: "in" as const,
    path: "/fichaje/v1/entries",
    body: { externalId, deviceAt: new Date(tappedAt).toISOString() },
    tappedAt,
    ...over,
  };
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await __resetOutboxForTests();
  apiMock.ficharApi.mockReset();
});

afterEach(async () => {
  await __resetOutboxForTests();
});

describe("F1 · el toque se persiste antes de salir", () => {
  it("queda en la cola sin haber llamado a la API", async () => {
    await outboxAdd(entrada());
    expect(apiMock.ficharApi).not.toHaveBeenCalled();
    const items = await outboxList();
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("in");
  });

  it("guarda la hora del TOQUE, no la de envío", async () => {
    const toque = Date.now() - 3 * 3_600_000;
    await outboxAdd(entrada({ tappedAt: toque }));
    const [item] = await outboxList();
    expect(item!.tappedAt).toBe(toque);
    expect(item!.body.deviceAt).toBe(new Date(toque).toISOString());
  });
});

describe("F1 · los 4 segundos de deshacer", () => {
  it("el item no sale mientras el plazo no vence", async () => {
    const item = await outboxAdd(entrada());
    expect(item.holdUntil - item.createdAt).toBe(UNDO_WINDOW_MS);
    await flushOutbox();
    expect(apiMock.ficharApi).not.toHaveBeenCalled();
    expect(await outboxList()).toHaveLength(1);
  });

  it("deshacer lo borra de la cola y nunca llega al servidor", async () => {
    await outboxAdd(entrada());
    const ok = await outboxUndo("11111111-2222-4333-8444-555555555555");
    expect(ok).toBe(true);
    expect(await outboxList()).toHaveLength(0);
    await flushOutbox();
    expect(apiMock.ficharApi).not.toHaveBeenCalled();
  });

  it("pasado el plazo sale, y deshacer ya no vale", async () => {
    apiMock.ficharApi.mockResolvedValue({ entry: { id: "x" } });
    await outboxAdd(entrada({ undoMs: 0 }));
    await flushOutbox();
    expect(apiMock.ficharApi).toHaveBeenCalledTimes(1);
    expect(await outboxList()).toHaveLength(0);
    // Y deshacer sobre algo que ya no está devuelve false: la pantalla
    // manda al empleado a corregir en vez de mentirle.
    expect(await outboxUndo("11111111-2222-4333-8444-555555555555")).toBe(false);
  });

  it("un item con el plazo vivo no se considera enviable", () => {
    const base: FicharOutboxItem = {
      externalId: "x",
      kind: "in",
      path: "/fichaje/v1/entries",
      body: {},
      tappedAt: 1_000,
      holdUntil: 5_000,
      createdAt: 1_000,
      attempts: 0,
      lastError: null,
      lockedAt: null,
    };
    expect(isReleasable(base, 4_999)).toBe(false);
    expect(isReleasable(base, 5_000)).toBe(true);
    // Y con un lock fresco de otra pestaña, tampoco.
    expect(isReleasable({ ...base, lockedAt: 5_000 }, 6_000)).toBe(false);
  });
});

describe("F1 · el reenvío", () => {
  it("un fallo de red deja el item en la cola para el siguiente ciclo", async () => {
    apiMock.ficharApi.mockRejectedValue(new Error("Failed to fetch"));
    await outboxAdd(entrada({ undoMs: 0 }));
    await flushOutbox();
    const [item] = await outboxList();
    expect(item).toBeTruthy();
    expect(item!.attempts).toBe(1);
    expect(item!.lockedAt).toBeNull();

    // Vuelve la red.
    apiMock.ficharApi.mockResolvedValue({ entry: { id: "x" } });
    await flushOutbox();
    expect(await outboxList()).toHaveLength(0);
  });

  it("un rechazo permanente del servidor NO se reintenta en bucle", async () => {
    apiMock.ficharApi.mockRejectedValue(
      new FicharApiError(409, "PENDING_EXIT_REQUIRES_REASON", "Es de otro día"),
    );
    const avisos: string[] = [];
    const off = subscribeOutbox((e) => {
      if (e.type === "failed") avisos.push(e.reason);
    });
    await outboxAdd(entrada({ undoMs: 0 }));
    await flushOutbox();
    off();
    expect(await outboxList()).toHaveLength(0);
    expect(avisos).toHaveLength(1);
    // Y no se reintenta: "pendiente de enviar" para siempre sería mentir.
    await flushOutbox();
    expect(apiMock.ficharApi).toHaveBeenCalledTimes(1);
  });

  it("un 429 SÍ se reintenta: es transitorio", async () => {
    apiMock.ficharApi.mockRejectedValue(
      new FicharApiError(429, "TOO_MANY", "Espera"),
    );
    await outboxAdd(entrada({ undoMs: 0 }));
    await flushOutbox();
    expect(await outboxList()).toHaveLength(1);
  });
});
