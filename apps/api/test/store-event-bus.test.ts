// Tests del bus in-memory de eventos de mesa (B7 §6). El bus no toca
// BD ni Fastify; es puro unit.

import { describe, expect, it, vi } from "vitest";

import { getStoreEventBus } from "../src/realtime/store-event-bus.js";
import type { WsEvent } from "../src/realtime/store-events.js";

const sampleEvent: WsEvent = {
  type: "table.opened",
  tableId: "11111111-1111-1111-1111-111111111111",
  ticketId: "22222222-2222-2222-2222-222222222222",
  byEmail: "cajero@bar.es",
  at: new Date().toISOString(),
};

describe("StoreEventBus", () => {
  it("entrega eventos sólo a los suscriptores del store correcto", () => {
    const bus = getStoreEventBus();
    const subA = { send: vi.fn() };
    const subB = { send: vi.fn() };
    const unsubA = bus.subscribe("store-a", subA);
    const unsubB = bus.subscribe("store-b", subB);

    bus.broadcast("store-a", sampleEvent);

    expect(subA.send).toHaveBeenCalledWith(sampleEvent);
    expect(subB.send).not.toHaveBeenCalled();

    unsubA();
    unsubB();
  });

  it("permite múltiples suscriptores en el mismo store", () => {
    const bus = getStoreEventBus();
    const subA = { send: vi.fn() };
    const subB = { send: vi.fn() };
    const unsubA = bus.subscribe("store-multi", subA);
    const unsubB = bus.subscribe("store-multi", subB);

    bus.broadcast("store-multi", sampleEvent);

    expect(subA.send).toHaveBeenCalledTimes(1);
    expect(subB.send).toHaveBeenCalledTimes(1);
    expect(bus.subscriberCount("store-multi")).toBe(2);

    unsubA();
    expect(bus.subscriberCount("store-multi")).toBe(1);
    unsubB();
    expect(bus.subscriberCount("store-multi")).toBe(0);
  });

  it("ignora errores de envío sin romper el resto del broadcast", () => {
    const bus = getStoreEventBus();
    const subOk = { send: vi.fn() };
    const subErr = {
      send: vi.fn(() => {
        throw new Error("socket cerrado");
      }),
    };
    const unsubOk = bus.subscribe("store-err", subOk);
    const unsubErr = bus.subscribe("store-err", subErr);

    expect(() => bus.broadcast("store-err", sampleEvent)).not.toThrow();
    expect(subOk.send).toHaveBeenCalledTimes(1);

    unsubOk();
    unsubErr();
  });

  it("limpia el store del map cuando todos los suscriptores se desuscriben", () => {
    const bus = getStoreEventBus();
    const sub = { send: vi.fn() };
    const unsub = bus.subscribe("store-clean", sub);
    expect(bus.subscriberCount("store-clean")).toBe(1);
    unsub();
    expect(bus.subscriberCount("store-clean")).toBe(0);
  });
});
