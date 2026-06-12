// Tests del outbox offline del cobro (v1.5-consistencia-C).
//
// fake-indexeddb (devDep) aporta IndexedDB en jsdom — jsdom no lo
// implementa y el outbox vive ahí a propósito (sobrevive recargas,
// crash del navegador y cierre de pestaña, al contrario que
// sessionStorage). Cada test arranca con un IDBFactory limpio.
//
// El test de idempotencia contra el handler REAL (mismo externalId dos
// veces → 200 duplicate, un solo ticket) ya existe en
// apps/api/test/tickets-route.test.ts ("idempotente: mismo externalId
// → devuelve el ticket existente (200)") — apps/api está fuera de la
// frontera de esta rama. Aquí cubrimos que el cliente reacciona bien a
// esa respuesta duplicate (la trata como confirmación y borra).

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});

import { ApiError } from "../src/api.js";
import {
  __resetOutboxForTests,
  flushOutbox,
  outboxAdd,
  outboxCounts,
  outboxList,
  outboxRetry,
  startOutboxSync,
  subscribeOutbox,
  OUTBOX_LOCK_TTL_MS,
} from "../src/lib/outbox.js";
import type { OutboxItem } from "../src/lib/outbox.js";

const EXTERNAL_ID = "11111111-2222-4333-8444-555555555555";

function ticketInput(overrides: Partial<Parameters<typeof outboxAdd>[0]> = {}) {
  return {
    externalId: EXTERNAL_ID,
    kind: "ticket" as const,
    path: "/tickets" as const,
    body: { externalId: EXTERNAL_ID, lines: [], payments: [] },
    label: "Venta",
    total: 12.5,
    ...overrides,
  };
}

// Manipula el item directamente en IDB para simular el estado que
// dejaría OTRA pestaña (lock ajeno) sin pasar por el módulo.
async function rawPatchItem(
  externalId: string,
  patch: Partial<OutboxItem>,
): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("mipiacetpv-outbox", 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("outbox", "readwrite");
    const store = tx.objectStore("outbox");
    const get = store.get(externalId);
    get.onsuccess = () => {
      store.put({ ...(get.result as OutboxItem), ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

let stopSync: (() => void) | null = null;

beforeEach(async () => {
  await __resetOutboxForTests();
  (globalThis as Record<string, unknown>).indexedDB = new IDBFactory();
  apiMock.apiWithCashier.mockReset();
});

afterEach(() => {
  stopSync?.();
  stopSync = null;
});

describe("outbox · ciclo de vida", () => {
  it("cobro con red OK: escribe → POST → confirmación → borrado", async () => {
    apiMock.apiWithCashier.mockResolvedValue({
      ticket: { id: "t1", internalNumber: "000001" },
    });
    const sent: string[] = [];
    const unsub = subscribeOutbox((e) => {
      if (e.type === "sent") sent.push(e.externalId);
    });

    await outboxAdd(ticketInput());
    expect(await outboxCounts()).toEqual({ pending: 1, rejected: 0 });

    await flushOutbox();

    expect(apiMock.apiWithCashier).toHaveBeenCalledTimes(1);
    const [path, opts] = apiMock.apiWithCashier.mock.calls[0]!;
    expect(path).toBe("/tickets");
    expect(opts.method).toBe("POST");
    expect(opts.body.externalId).toBe(EXTERNAL_ID);
    expect(await outboxList()).toHaveLength(0);
    expect(sent).toEqual([EXTERNAL_ID]);
    unsub();
  });

  it("respuesta 200 duplicate:true (doble reenvío) también confirma y borra", async () => {
    apiMock.apiWithCashier.mockResolvedValue({
      ticket: { id: "t1", internalNumber: "000001" },
      duplicate: true,
    });
    await outboxAdd(ticketInput());
    await flushOutbox();
    expect(await outboxList()).toHaveLength(0);
  });

  it("error de red → queda pending → evento online → reenvío → confirmado", async () => {
    // 1º flush directo y 2º flush de arranque de startOutboxSync fallan;
    // el reenvío del evento `online` confirma.
    apiMock.apiWithCashier
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ ticket: { id: "t1", internalNumber: "000001" } });

    await outboxAdd(ticketInput());
    await flushOutbox();

    const afterFail = await outboxList();
    expect(afterFail).toHaveLength(1);
    expect(afterFail[0]!.status).toBe("pending");
    expect(afterFail[0]!.attempts).toBe(1);
    expect(afterFail[0]!.lastError).toContain("Failed to fetch");

    stopSync = startOutboxSync({ intervalMs: 3_600_000 });
    await vi.waitFor(async () => {
      expect(apiMock.apiWithCashier).toHaveBeenCalledTimes(2);
    });
    expect(await outboxList()).toHaveLength(1);

    window.dispatchEvent(new Event("online"));
    await vi.waitFor(async () => {
      expect(await outboxList()).toHaveLength(0);
    });
  });

  it("recarga simulada: item persistido sin enviar se reenvía al arrancar", async () => {
    apiMock.apiWithCashier.mockResolvedValue({
      ticket: { id: "t1", internalNumber: "000001" },
    });
    // El item quedó escrito antes del POST y la pestaña "murió".
    await outboxAdd(ticketInput());

    stopSync = startOutboxSync({ intervalMs: 3_600_000 });
    await vi.waitFor(async () => {
      expect(await outboxList()).toHaveLength(0);
    });
    expect(apiMock.apiWithCashier).toHaveBeenCalledTimes(1);
  });
});

describe("outbox · errores permanentes", () => {
  it("422 → rejected, visible, y SIN bucle de reintentos", async () => {
    apiMock.apiWithCashier.mockRejectedValue(
      new ApiError(422, "IVA inválido", "VALIDATION_ERROR"),
    );
    const rejected: string[] = [];
    const unsub = subscribeOutbox((e) => {
      if (e.type === "rejected") rejected.push(e.reason);
    });

    await outboxAdd(ticketInput());
    await flushOutbox();

    const items = await outboxList();
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe("rejected");
    expect(items[0]!.lastError).toBe("VALIDATION_ERROR: IVA inválido");
    expect(rejected).toEqual(["VALIDATION_ERROR: IVA inválido"]);

    // Más flushes no reintentan un rechazado.
    await flushOutbox();
    await flushOutbox();
    expect(apiMock.apiWithCashier).toHaveBeenCalledTimes(1);
    expect(await outboxCounts()).toEqual({ pending: 0, rejected: 1 });
    unsub();
  });

  it("401 (sin sesión de cajero) NO es permanente: sigue pending", async () => {
    apiMock.apiWithCashier.mockRejectedValue(
      new ApiError(401, "Sin sesión de cajero", "UNAUTHENTICATED"),
    );
    await outboxAdd(ticketInput());
    await flushOutbox();
    expect(await outboxCounts()).toEqual({ pending: 1, rejected: 0 });
  });

  it("outboxRetry devuelve un rechazado a pending y lo reenvía", async () => {
    apiMock.apiWithCashier
      .mockRejectedValueOnce(new ApiError(422, "IVA inválido", "VALIDATION_ERROR"))
      .mockResolvedValue({ ticket: { id: "t1", internalNumber: "000001" } });
    await outboxAdd(ticketInput());
    await flushOutbox();
    expect((await outboxList())[0]!.status).toBe("rejected");

    await outboxRetry(EXTERNAL_ID);
    await vi.waitFor(async () => {
      expect(await outboxList()).toHaveLength(0);
    });
  });
});

describe("outbox · lock multi-pestaña", () => {
  it("lock fresco de otra pestaña → este flush NO reenvía; caducado → sí", async () => {
    apiMock.apiWithCashier.mockResolvedValue({
      ticket: { id: "t1", internalNumber: "000001" },
    });
    await outboxAdd(ticketInput());

    await rawPatchItem(EXTERNAL_ID, {
      lockedAt: Date.now(),
      lockOwner: "otra-pestaña",
    });
    await flushOutbox();
    expect(apiMock.apiWithCashier).not.toHaveBeenCalled();
    expect(await outboxList()).toHaveLength(1);

    await rawPatchItem(EXTERNAL_ID, {
      lockedAt: Date.now() - OUTBOX_LOCK_TTL_MS - 1,
      lockOwner: "otra-pestaña",
    });
    await flushOutbox();
    expect(apiMock.apiWithCashier).toHaveBeenCalledTimes(1);
    expect(await outboxList()).toHaveLength(0);
  });

  it("outboxAdd con lock (POST interactivo en vuelo) no se reenvía en paralelo", async () => {
    apiMock.apiWithCashier.mockResolvedValue({
      ticket: { id: "t1", internalNumber: "000001" },
    });
    await outboxAdd(ticketInput(), { lock: true });
    await flushOutbox();
    expect(apiMock.apiWithCashier).not.toHaveBeenCalled();
    expect(await outboxList()).toHaveLength(1);
  });
});
