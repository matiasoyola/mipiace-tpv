// v1.10-offline-un-terminal §3. Ciclo de turno offline a través del
// outbox: abrir turno local → encolar shift-open + ticket → "reconexión"
// → un solo turno en el server (idempotencia por externalId/openShiftId)
// y los tickets reescritos de shiftId local → serverId.
//
// Verifica también el GATE: mientras el shift-open no sincroniza, sus
// dependientes NO se envían (llevarían un shiftId que el server no
// conoce). Y la recuperación de la PWA a mitad de turno (el estado local
// vive en IndexedDB).

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
  outboxList,
  registerLocalShiftLookup,
  registerShiftResolvedCallback,
} from "../src/lib/outbox.js";
import {
  __resetOfflineAuthForTests,
} from "../src/lib/offlineAuth.js";
import {
  clearLocalShift,
  getLocalShift,
  localShiftIdForOutbox,
  openLocalShift,
  resolveLocalShift,
} from "../src/lib/offlineShift.js";

const SERVER_SHIFT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

// Encola un ticket como lo haría CheckoutPage: body.shiftId = id del
// turno (local mientras estamos offline), auto-etiquetado por el lookup.
async function enqueueTicket(shiftId: string, externalId: string) {
  await outboxAdd({
    externalId,
    kind: "ticket",
    path: "/tickets",
    body: { externalId, shiftId, registerId: "reg-1", lines: [], payments: [] },
    label: "Venta",
    total: 10,
  });
}

beforeEach(async () => {
  await __resetOutboxForTests();
  await __resetOfflineAuthForTests();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  apiMock.apiWithCashier.mockReset();
  // Cableado real (como en producción, App.tsx): offlineShift registra
  // sus hooks en el outbox.
  registerLocalShiftLookup(localShiftIdForOutbox);
  registerShiftResolvedCallback(resolveLocalShift);
});

afterEach(() => {
  registerLocalShiftLookup(null);
  registerShiftResolvedCallback(null);
});

describe("ciclo de turno offline · sync al reconectar", () => {
  it("shift-open sincroniza primero y reescribe el shiftId de los tickets", async () => {
    const shift = await openLocalShift(100);
    // Apertura encolada + venta offline.
    await outboxAdd({
      externalId: shift.localId,
      kind: "shift-open",
      path: "/shift/open",
      body: { cashOpening: 100 },
      label: "Apertura de turno",
      total: 100,
      shiftLocalId: shift.localId,
    });
    await enqueueTicket(shift.localId, "11111111-2222-4333-8444-555555555555");

    // El ticket quedó etiquetado con el turno local.
    const before = await outboxList();
    const ticketBefore = before.find((i) => i.kind === "ticket")!;
    expect(ticketBefore.shiftLocalId).toBe(shift.localId);
    expect(ticketBefore.body.shiftId).toBe(shift.localId);

    // "Reconexión": el server responde a ambos POST.
    const calls: Array<{ path: string; body: unknown }> = [];
    apiMock.apiWithCashier.mockImplementation(async (path: string, opts: any) => {
      calls.push({ path, body: opts.body });
      if (path === "/shift/open") return { shift: { id: SERVER_SHIFT_ID } };
      return { ticket: { id: "t-1" } };
    });

    await flushOutbox();

    // shift-open ANTES que el ticket.
    expect(calls[0]!.path).toBe("/shift/open");
    expect(calls[1]!.path).toBe("/tickets");
    // El ticket viajó con el shiftId del server, no el local.
    expect((calls[1]!.body as { shiftId: string }).shiftId).toBe(SERVER_SHIFT_ID);
    // Cola vacía y turno local resuelto.
    expect(await outboxList()).toHaveLength(0);
    expect((await getLocalShift())?.serverId).toBe(SERVER_SHIFT_ID);
  });

  it("GATE: si el shift-open no sincroniza, el ticket NO se envía", async () => {
    const shift = await openLocalShift(100);
    await outboxAdd({
      externalId: shift.localId,
      kind: "shift-open",
      path: "/shift/open",
      body: { cashOpening: 100 },
      label: "Apertura de turno",
      total: 100,
      shiftLocalId: shift.localId,
    });
    await enqueueTicket(shift.localId, "11111111-2222-4333-8444-555555555555");

    // Red aún caída para el shift-open (error de red), pero el mock del
    // ticket, si se llamara, "triunfaría" — así el test falla si el gate
    // no lo bloquea.
    apiMock.apiWithCashier.mockImplementation(async (path: string) => {
      if (path === "/shift/open") throw new Error("network down");
      return { ticket: { id: "t-1" } };
    });

    await flushOutbox();

    // Sólo se intentó el shift-open; el ticket quedó bloqueado.
    const paths = apiMock.apiWithCashier.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(["/shift/open"]);
    const list = await outboxList();
    expect(list).toHaveLength(2); // ambos siguen en cola
  });

  it("idempotencia: 409 SHIFT_ALREADY_OPEN adopta el openShiftId del server", async () => {
    const shift = await openLocalShift(100);
    await outboxAdd({
      externalId: shift.localId,
      kind: "shift-open",
      path: "/shift/open",
      body: { cashOpening: 100 },
      label: "Apertura de turno",
      total: 100,
      shiftLocalId: shift.localId,
    });

    apiMock.apiWithCashier.mockImplementation(async () => {
      throw new ApiError(409, "Hay un turno abierto", "SHIFT_ALREADY_OPEN", {
        openShiftId: SERVER_SHIFT_ID,
      });
    });

    await flushOutbox();

    // No queda como rechazado: se trató como éxito idempotente.
    expect(await outboxList()).toHaveLength(0);
    expect((await getLocalShift())?.serverId).toBe(SERVER_SHIFT_ID);
  });

  it("cash-count Z con 409 SHIFT_ALREADY_CLOSED es éxito idempotente", async () => {
    // Turno ya resuelto (serverId) y su cierre encolado.
    await outboxAdd({
      externalId: "22222222-3333-4444-8555-666666666666",
      kind: "cash-count",
      path: `/shift/${SERVER_SHIFT_ID}/cash-count`,
      body: { kind: "Z", denominations: {} },
      label: "Cierre de turno",
      total: 0,
    });
    apiMock.apiWithCashier.mockImplementation(async () => {
      throw new ApiError(409, "El turno ya está cerrado", "SHIFT_ALREADY_CLOSED");
    });
    await flushOutbox();
    expect(await outboxList()).toHaveLength(0);
  });

  it("recarga de la PWA a mitad de turno offline: el estado local persiste", async () => {
    const shift = await openLocalShift(100);
    // Simula recarga: cerramos la conexión cacheada de offlineAuth y
    // reabrimos (mismo IDBFactory → los datos siguen ahí).
    await __resetOfflineAuthForTests();
    const recovered = await getLocalShift();
    expect(recovered?.localId).toBe(shift.localId);
    expect(recovered?.serverId).toBeNull();
    await clearLocalShift();
    expect(await getLocalShift()).toBeNull();
  });
});
