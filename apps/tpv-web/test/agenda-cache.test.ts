// Tests de la capa de agenda del TPV (B-koibox-4): caché offline del día
// (round-trip IndexedDB) y alta offline por outbox con externalId. Node-env
// con fake-indexeddb (misma infra que clients-cache.test.ts; no jsdom).

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ apiWithCashier: vi.fn() }));
const outboxMock = vi.hoisted(() => ({ outboxAdd: vi.fn(async () => undefined) }));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>(
    "../src/api.js",
  );
  return { ...actual, apiWithCashier: apiMock.apiWithCashier };
});
vi.mock("../src/lib/outbox.js", () => ({ outboxAdd: outboxMock.outboxAdd }));

import { ApiError } from "../src/api.js";
import {
  createAppointment,
  fetchAgendaDay,
  loadAgendaDayFromCache,
  type AgendaAppointment,
} from "../src/lib/agenda.js";

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  apiMock.apiWithCashier.mockReset();
  outboxMock.outboxAdd.mockClear();
});

const SVC = "33333333-3333-4333-8333-333333333333";

describe("caché del día", () => {
  it("fetchAgendaDay guarda y loadAgendaDayFromCache lee el mismo día", async () => {
    const appt: AgendaAppointment = {
      id: "a1",
      clientId: null,
      status: "CONFIRMED",
      source: "PRESENCIAL",
      start: "2026-08-10T07:00:00.000Z",
      end: "2026-08-10T07:30:00.000Z",
      ticketId: null,
      notes: null,
      items: [
        { id: "i1", serviceId: SVC, durationMin: 30, sortOrder: 0, startOffsetMin: 0 },
      ],
      assignments: [
        { reservableType: "STAFF", staffUserId: "u1", resourceId: null },
      ],
    };
    apiMock.apiWithCashier.mockResolvedValueOnce({
      staff: [{ userId: "u1", displayName: "Sole", color: "#f0f", active: true }],
      appointments: [appt],
    });
    const day = await fetchAgendaDay("2026-08-10");
    expect(day.appointments).toHaveLength(1);
    const cached = await loadAgendaDayFromCache("2026-08-10");
    expect(cached?.appointments[0]?.id).toBe("a1");
    expect(cached?.staff[0]?.displayName).toBe("Sole");
  });

  it("fetchAgendaDay cae a la caché cuando no hay red", async () => {
    apiMock.apiWithCashier.mockResolvedValueOnce({
      staff: [],
      appointments: [],
    });
    await fetchAgendaDay("2026-08-11"); // primero cachea
    apiMock.apiWithCashier.mockRejectedValueOnce(new Error("network down"));
    const day = await fetchAgendaDay("2026-08-11"); // ahora sin red
    expect(day.date).toBe("2026-08-11");
  });
});

describe("alta offline (outbox + optimista)", () => {
  it("encola en el outbox y devuelve una cita optimista ante red caída", async () => {
    apiMock.apiWithCashier.mockRejectedValueOnce(new Error("network down"));
    const res = await createAppointment({
      clientId: null,
      items: [{ serviceId: SVC }],
      start: "2026-08-10T07:00:00.000Z",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.queuedOffline).toBe(true);
      expect(res.appointment.pendingOffline).toBe(true);
    }
    expect(outboxMock.outboxAdd).toHaveBeenCalledTimes(1);
    const arg = outboxMock.outboxAdd.mock.calls[0]![0] as { kind: string; path: string };
    expect(arg.kind).toBe("appointment");
    expect(arg.path).toBe("/agenda/appointments");
  });

  it("un error de negocio (409 hueco perdido) NO va al outbox y devuelve alternativas", async () => {
    apiMock.apiWithCashier.mockRejectedValueOnce(
      new ApiError(409, "El hueco ya no está disponible.", "TAKEN", {
        alternatives: [{ start: "x", end: "y", options: 1 }],
      }),
    );
    const res = await createAppointment({
      clientId: null,
      items: [{ serviceId: SVC }],
      start: "2026-08-10T07:00:00.000Z",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("TAKEN");
      expect(res.alternatives).toHaveLength(1);
    }
    expect(outboxMock.outboxAdd).not.toHaveBeenCalled();
  });
});
